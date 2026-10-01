import { describe, expect, it, vi } from "vitest";
import { deliver } from "../src/delivery.js";
import { deliveryJobKey, scheduleDelivery } from "../src/dispatch.js";
import type { DeliveryJob, DeliveryQueue } from "../src/domain/contracts.js";
import { sha256, signPayload } from "../src/domain/security.js";
import type { DestinationPost } from "../src/outbound-http.js";
import { FakeStore } from "./fake-store.js";

class FakeQueue implements DeliveryQueue {
  jobs: Array<{ job: DeliveryJob; delayMs: number; jobId?: string }> = [];
  async enqueue(job: DeliveryJob, options: { delayMs?: number; jobId?: string } = {}) {
    this.jobs.push({ job, delayMs: options.delayMs ?? 0, ...(options.jobId ? { jobId: options.jobId } : {}) });
  }
  async health() { return { latencyMs: 0, jobs: { waiting: 0, active: 0, delayed: 0, failed: 0 }, workerHeartbeat: null, cronHeartbeat: null }; }
  async heartbeat() {}
  async consumeRateLimit(_key: string, limit: number, windowSeconds: number) { return { allowed: true, remaining: limit - 1, retryAfterSeconds: windowSeconds }; }
  async close() {}
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

async function setup(status: "queued" | "dead_letter" = "queued") {
  const store = new FakeStore(); const queue = new FakeQueue();
  const created = await store.createEvent({ endpointId: store.endpoint.id, idempotencyKey: "evt-1", headers: {}, payload: { type: "invoice.paid" }, payloadSha256: sha256("payload") });
  await store.updateEvent(created.event.id, { status });
  return { store, queue, eventId: created.event.id };
}

describe("delivery processor", () => {
  it("fails closed on an intent-less production worker job", async () => {
    const { store, queue, eventId } = await setup();
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 204, body: "", retryAfter: null }));

    await expect(deliver(
      { eventId, mode: "live" },
      { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup, requireIntent: true },
    )).rejects.toThrow("require a durable intent");

    expect(postFn).not.toHaveBeenCalled();
    expect((await store.getEvent(eventId))?.status).toBe("queued");
  });

  it("records a successful live delivery", async () => {
    const { store, queue, eventId } = await setup();
    const postFn = vi.fn(async () => ({ status: 204, body: "", retryAfter: null }));
    const result = await deliver({ eventId, mode: "live" }, { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup, now: (() => { let n = 100; return () => n += 20; })() });
    expect(result.nextStatus).toBe("delivered");
    expect((await store.getEvent(eventId))?.status).toBe("delivered");
    expect(store.attempts[0]?.statusCode).toBe(204);
  });

  it("re-signs outbound payloads with the endpoint provider profile", async () => {
    const { store, queue, eventId } = await setup();
    store.endpoint.signatureProfile = "github";
    store.endpoint.signingSecret = "github-delivery-secret";
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 202, body: "", retryAfter: null }));

    await deliver({ eventId, mode: "live" }, { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup, now: () => 1_000 });

    const [request] = postFn.mock.calls[0]!;
    expect(request.destination).toMatchObject({
      url: new URL("https://example.com/hook"),
      addresses: [{ address: "93.184.216.34", family: 4 }],
    });
    expect(request.headers["x-hub-signature-256"]).toBe(signPayload(store.endpoint.signingSecret, request.body));
  });

  it("schedules retry for a transient failure", async () => {
    const { store, queue, eventId } = await setup();
    await deliver({ eventId, mode: "live" }, { store, queue, allowPrivateTargets: false, postFn: async () => ({ status: 503, body: "down", retryAfter: null }), lookupFn: publicLookup });
    expect((await store.getEvent(eventId))?.status).toBe("retrying");
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]!.delayMs).toBeGreaterThan(0);
    expect(store.audit[0]).toMatchObject({ action: "delivery.retry_scheduled", metadata: { strategy: "backoff" } });
  });

  it("honors a receiver Retry-After hint and records the scheduling decision", async () => {
    const { store, queue, eventId } = await setup();
    const now = Date.parse("2026-09-30T20:00:00.000Z");
    store.now = () => now;

    const result = await deliver(
      { eventId, mode: "live" },
      {
        store,
        queue,
        allowPrivateTargets: false,
        postFn: async () => ({ status: 429, body: "slow down", retryAfter: "120" }),
        lookupFn: publicLookup,
        now: () => now,
      },
    );

    expect(result.retryDelayMs).toBe(120_000);
    expect(queue.jobs[0]?.delayMs).toBe(120_000);
    expect(store.audit[0]).toMatchObject({
      action: "delivery.retry_scheduled",
      metadata: {
        statusCode: 429,
        delayMs: 120_000,
        strategy: "retry-after",
        receiverDelayMs: 120_000,
        intentCreated: true,
        availableAt: "2026-09-30T20:02:00.000Z",
      },
    });
  });

  it("reports the durable retry schedule when the next intent already exists", async () => {
    const { store, queue, eventId } = await setup();
    const now = Date.parse("2026-09-30T20:00:00.000Z");
    store.now = () => now;
    const retryJob = { eventId, mode: "live" as const, cycleId: "live", attemptNumber: 2 };
    await store.createDeliveryIntent(deliveryJobKey(retryJob), retryJob, { availableAt: "2026-09-30T20:03:00.000Z" });

    const result = await deliver(
      { eventId, mode: "live", cycleId: "live", attemptNumber: 1 },
      {
        store,
        queue,
        allowPrivateTargets: false,
        postFn: async () => ({ status: 429, body: "slow down", retryAfter: "120" }),
        lookupFn: publicLookup,
        now: () => now,
      },
    );

    expect(result.retryDelayMs).toBe(180_000);
    expect(queue.jobs[0]?.delayMs).toBe(180_000);
    expect(store.audit[0]).toMatchObject({
      action: "delivery.retry_scheduled",
      metadata: {
        delayMs: 180_000,
        strategy: "existing-intent",
        proposedDelayMs: 120_000,
        proposedStrategy: "retry-after",
        availableAt: "2026-09-30T20:03:00.000Z",
      },
    });
  });

  it("completes a stale current claim without reviving an already completed next intent", async () => {
    const { store, eventId } = await setup();
    store.now = () => Date.parse("2026-09-30T20:00:01.000Z");
    const currentJob = { eventId, mode: "live" as const, cycleId: "live", attemptNumber: 1 };
    const nextJob = { eventId, mode: "live" as const, cycleId: "live", attemptNumber: 2 };
    const current = await store.createDeliveryIntent(deliveryJobKey(currentJob), currentJob, { availableAt: "2026-09-30T20:00:00.000Z" });
    await store.prepareDeliveryIntentDispatch(current.intent.id);
    const claim = await store.claimDeliveryIntent(current.intent.id);
    expect(claim.status).toBe("claimed");
    const next = await store.createDeliveryIntent(deliveryJobKey(nextJob), nextJob, { availableAt: "2026-09-30T20:02:00.000Z" });
    await store.completeDeliveryIntent(next.intent.id, "2026-09-30T20:02:01.000Z");

    const result = await store.commitRetryTransition({
      eventId,
      jobKey: deliveryJobKey(nextJob),
      job: nextJob,
      backoffMs: 60_000,
      retryAfter: "120",
      currentIntentId: current.intent.id,
      currentIntentProcessingAt: "2026-09-30T20:00:01.000Z",
      completedAt: "2026-09-30T20:00:02.000Z",
      lastError: "Destination returned HTTP 429",
      audit: {
        eventId,
        action: "delivery.retry_scheduled",
        actor: "worker",
        reason: "Destination returned HTTP 429",
        metadata: {},
      },
    });

    expect(result).toEqual({ scheduled: false, nextStatus: "queued" });
    expect(store.intents.get(current.intent.id)?.state).toBe("completed");
    expect(store.intents.get(next.intent.id)?.state).toBe("completed");
    expect(store.audit).toHaveLength(0);
  });

  it("rejects a conflicting durable retry job without mutating the current claim", async () => {
    const { store, eventId } = await setup();
    const processingAt = "2026-09-30T20:00:01.000Z";
    store.now = () => Date.parse(processingAt);
    const currentJob = { eventId, mode: "live" as const, cycleId: "live", attemptNumber: 1 };
    const storedNextJob = { eventId, mode: "live" as const, cycleId: "live", attemptNumber: 2, destinationUrl: "https://receiver.example/original" };
    const conflictingNextJob = { ...storedNextJob, destinationUrl: "https://receiver.example/conflict" };
    const current = await store.createDeliveryIntent(deliveryJobKey(currentJob), currentJob, { availableAt: "2026-09-30T20:00:00.000Z" });
    await store.prepareDeliveryIntentDispatch(current.intent.id);
    expect(await store.claimDeliveryIntent(current.intent.id)).toMatchObject({ status: "claimed" });
    await store.createDeliveryIntent(deliveryJobKey(storedNextJob), storedNextJob, { availableAt: "2026-09-30T20:02:00.000Z" });

    await expect(store.commitRetryTransition({
      eventId,
      jobKey: deliveryJobKey(conflictingNextJob),
      job: conflictingNextJob,
      backoffMs: 60_000,
      retryAfter: "120",
      currentIntentId: current.intent.id,
      currentIntentProcessingAt: processingAt,
      completedAt: "2026-09-30T20:00:02.000Z",
      lastError: "Destination returned HTTP 429",
      audit: {
        eventId,
        action: "delivery.retry_scheduled",
        actor: "worker",
        reason: "Destination returned HTTP 429",
        metadata: {},
      },
    })).rejects.toThrow("contains a different job");

    expect(store.intents.get(current.intent.id)).toMatchObject({ state: "processing", processingAt });
    expect((await store.getEvent(eventId))?.status).toBe("queued");
    expect(store.audit).toHaveLength(0);
  });

  it("does not dispatch a retry when the durable transition fails", async () => {
    const { store, queue, eventId } = await setup();
    vi.spyOn(store, "commitRetryTransition").mockRejectedValueOnce(new Error("transaction failed"));

    await expect(deliver(
      { eventId, mode: "live" },
      {
        store,
        queue,
        allowPrivateTargets: false,
        postFn: async () => ({ status: 503, body: "down", retryAfter: null }),
        lookupFn: publicLookup,
      },
    )).rejects.toThrow("transaction failed");

    expect(queue.jobs).toHaveLength(0);
    expect(store.audit).toHaveLength(0);
  });

  it("suppresses a retry when another delivery wins while the request is in flight", async () => {
    const { store, queue, eventId } = await setup();

    const result = await deliver(
      { eventId, mode: "live" },
      {
        store,
        queue,
        allowPrivateTargets: false,
        postFn: async () => {
          await store.updateEvent(eventId, { status: "delivered", lastError: null });
          return { status: 429, body: "slow down", retryAfter: "120" };
        },
        lookupFn: publicLookup,
      },
    );

    expect(result).toMatchObject({ delivered: true, terminal: true, nextStatus: "delivered", retryDelayMs: null });
    expect(queue.jobs).toHaveLength(0);
    expect((await store.getEvent(eventId))?.status).toBe("delivered");
    expect(store.audit).toHaveLength(0);
  });

  it("does not dead-letter an event delivered by another cycle", async () => {
    const { store, queue, eventId } = await setup();
    store.endpoint.maxAttempts = 1;

    const result = await deliver(
      { eventId, mode: "live", attemptNumber: 1 },
      {
        store,
        queue,
        allowPrivateTargets: false,
        postFn: async () => {
          await store.updateEvent(eventId, { status: "delivered", lastError: null });
          return { status: 429, body: "slow down", retryAfter: "120" };
        },
        lookupFn: publicLookup,
      },
    );

    expect(result).toMatchObject({ delivered: true, terminal: true, nextStatus: "delivered" });
    expect((await store.getEvent(eventId))?.status).toBe("delivered");
    expect(store.audit).toHaveLength(0);
  });

  it("rejects a stale worker after its processing claim is replaced", async () => {
    const { store, queue, eventId } = await setup();
    const now = Date.parse("2026-09-30T20:00:00.000Z");
    store.now = () => now;
    const job = { eventId, mode: "live", cycleId: "live", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job, jobKey: deliveryJobKey(job) });
    const queued = queue.jobs[0]!.job;

    await expect(deliver(
      queued,
      {
        store,
        queue,
        allowPrivateTargets: false,
        postFn: async () => {
          const intent = store.intents.get(queued.intentId!);
          if (!intent) throw new Error("missing claimed intent");
          store.intents.set(intent.id, { ...intent, processingAt: "2026-09-30T20:00:30.000Z" });
          return { status: 503, body: "down", retryAfter: null };
        },
        lookupFn: publicLookup,
        now: () => now,
      },
    )).rejects.toThrow("lost its processing claim");

    expect(queue.jobs).toHaveLength(1);
    expect(store.intents.size).toBe(1);
    expect(store.audit).toHaveLength(0);
  });

  it("defers an early queue delivery until the durable availability time", async () => {
    const { store, queue, eventId } = await setup();
    const now = Date.parse("2026-09-30T20:00:00.000Z");
    store.now = () => now;
    const job = { eventId, mode: "live", cycleId: "live", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job, jobKey: deliveryJobKey(job), delayMs: 120_000 });
    const queued = queue.jobs[0]!.job;
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 204, body: "", retryAfter: null }));

    const result = await deliver(
      queued,
      { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup, now: () => now },
    );

    expect(result).toMatchObject({
      delivered: false,
      terminal: false,
      retryDelayMs: 120_000,
      deferredUntil: "2026-09-30T20:02:00.000Z",
    });
    expect(postFn).not.toHaveBeenCalled();
    expect(store.intents.get(queued.intentId!)?.state).toBe("dispatched");
  });

  it("completes a deferred intent when another cycle delivers after the claim check", async () => {
    const { store, queue, eventId } = await setup();
    const now = Date.parse("2026-09-30T20:00:00.000Z");
    store.now = () => now;
    const job = { eventId, mode: "live", cycleId: "live", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job, jobKey: deliveryJobKey(job), delayMs: 120_000 });
    const queued = queue.jobs[0]!.job;
    const originalClaim = store.claimDeliveryIntent.bind(store);
    vi.spyOn(store, "claimDeliveryIntent").mockImplementationOnce(async (intentId) => {
      const claim = await originalClaim(intentId);
      await store.updateEvent(eventId, { status: "delivered", lastError: null });
      return claim;
    });
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 204, body: "", retryAfter: null }));

    const result = await deliver(
      queued,
      { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup, now: () => now },
    );

    expect(result).toMatchObject({ delivered: true, terminal: true, nextStatus: "delivered" });
    expect(result).not.toHaveProperty("deferredUntil");
    expect(store.intents.get(queued.intentId!)?.state).toBe("completed");
    expect(postFn).not.toHaveBeenCalled();
  });

  it("serializes concurrent non-rehearsal intents before any second outbound send", async () => {
    const { store, queue, eventId } = await setup();
    const now = Date.parse("2026-09-30T20:00:00.000Z");
    let clock = now;
    store.now = () => clock;
    const firstJob = { eventId, mode: "live", cycleId: "live-a", attemptNumber: 1 } as const;
    const secondJob = { eventId, mode: "replay", cycleId: "replay-b", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job: firstJob, jobKey: deliveryJobKey(firstJob) });
    await scheduleDelivery({ store, queue, job: secondJob, jobKey: deliveryJobKey(secondJob) });
    const firstQueued = queue.jobs[0]!.job;
    const secondQueued = queue.jobs[1]!.job;
    let finishFirst: ((response: { status: number; body: string; retryAfter: null }) => void) | undefined;
    const firstPost = vi.fn<DestinationPost>(() => new Promise((resolve) => { finishFirst = resolve; }));
    const secondPost = vi.fn<DestinationPost>(async () => ({ status: 204, body: "", retryAfter: null }));

    const firstDelivery = deliver(
      firstQueued,
      { store, queue, allowPrivateTargets: false, postFn: firstPost, lookupFn: publicLookup, now: () => now },
    );
    await vi.waitFor(() => expect(finishFirst).toBeTypeOf("function"));
    const deferred = await deliver(
      secondQueued,
      { store, queue, allowPrivateTargets: false, postFn: secondPost, lookupFn: publicLookup, now: () => now },
    );

    expect(deferred.deferredUntil).toBe("2026-09-30T20:00:01.000Z");
    expect(secondPost).not.toHaveBeenCalled();
    finishFirst!({ status: 204, body: "", retryAfter: null });
    await expect(firstDelivery).resolves.toMatchObject({ delivered: true, nextStatus: "delivered" });

    clock = now + 1_000;
    const suppressed = await deliver(
      secondQueued,
      { store, queue, allowPrivateTargets: false, postFn: secondPost, lookupFn: publicLookup, now: () => now + 1_000 },
    );
    expect(suppressed).toMatchObject({ delivered: true, terminal: true, nextStatus: "delivered" });
    expect(secondPost).not.toHaveBeenCalled();
  });

  it("revokes a stale event lease before admitting a replacement intent", async () => {
    const { store, queue, eventId } = await setup();
    let clock = Date.parse("2026-09-30T20:00:00.000Z");
    store.now = () => clock;
    const firstJob = { eventId, mode: "live", cycleId: "live-a", attemptNumber: 1 } as const;
    const secondJob = { eventId, mode: "replay", cycleId: "replay-b", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job: firstJob, jobKey: deliveryJobKey(firstJob) });
    await scheduleDelivery({ store, queue, job: secondJob, jobKey: deliveryJobKey(secondJob) });
    const firstIntent = store.intents.get(queue.jobs[0]!.job.intentId!)!;
    const secondIntent = store.intents.get(queue.jobs[1]!.job.intentId!)!;
    const firstClaim = await store.claimDeliveryIntent(firstIntent.id);
    if (firstClaim.status !== "claimed" || !firstClaim.intent.processingAt) throw new Error("Expected first claim");

    clock += 5 * 60_000 + 1;
    const replacement = await store.claimDeliveryIntent(secondIntent.id);
    expect(replacement).toMatchObject({ status: "claimed", intent: { id: secondIntent.id } });
    expect(store.intents.get(firstIntent.id)?.state).toBe("completed");

    await expect(store.commitDeliveryOutcome({
      eventId,
      status: "delivered",
      lastError: null,
      currentIntentId: firstIntent.id,
      currentIntentProcessingAt: firstClaim.intent.processingAt,
      completedAt: new Date(clock).toISOString(),
      audit: {
        eventId,
        action: "delivery.succeeded",
        actor: "worker",
        reason: null,
        metadata: {},
      },
    })).rejects.toThrow("lost its processing claim");
    expect((await store.getEvent(eventId))?.status).toBe("queued");
  });

  it("suppresses a stale earlier attempt after a higher attempt exists", async () => {
    const { store, queue, eventId } = await setup();
    const now = Date.parse("2026-09-30T20:00:00.000Z");
    store.now = () => now;
    const firstJob = { eventId, mode: "live", cycleId: "live", attemptNumber: 1 } as const;
    const secondJob = { eventId, mode: "live", cycleId: "live", attemptNumber: 2 } as const;
    await scheduleDelivery({ store, queue, job: firstJob, jobKey: deliveryJobKey(firstJob) });
    await scheduleDelivery({ store, queue, job: secondJob, jobKey: deliveryJobKey(secondJob) });
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 204, body: "", retryAfter: null }));

    const result = await deliver(
      queue.jobs[0]!.job,
      { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup, now: () => now },
    );

    expect(result).toMatchObject({ delivered: false, terminal: true, nextStatus: "queued" });
    expect(postFn).not.toHaveBeenCalled();
    expect(store.intents.get(queue.jobs[0]!.job.intentId!)?.state).toBe("completed");
  });

  it("uses the durable intent job instead of mutable queue payload fields", async () => {
    const { store, queue, eventId } = await setup();
    const job = { eventId, mode: "live", cycleId: "live", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job, jobKey: deliveryJobKey(job) });
    const queued = queue.jobs[0]!.job;
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 204, body: "", retryAfter: null }));

    const result = await deliver(
      { ...queued, eventId: "00000000-0000-0000-0000-000000000000", mode: "replay", destinationUrl: "http://127.0.0.1/private" },
      { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup },
    );

    expect(result.delivered).toBe(true);
    expect(postFn.mock.calls[0]?.[0].destination.url.toString()).toBe("https://example.com/hook");
    expect((await store.getEvent(eventId))?.status).toBe("delivered");
  });

  it("stores rehearsal evidence without changing dead-letter state", async () => {
    const { store, queue, eventId } = await setup("dead_letter");
    await deliver({ eventId, mode: "rehearsal", destinationUrl: "https://example.com/hook", actor: "abhi" }, { store, queue, allowPrivateTargets: false, postFn: async () => ({ status: 202, body: "accepted", retryAfter: null }), lookupFn: publicLookup });
    expect(store.rehearsals[0]?.passed).toBe(true);
    expect((await store.getEvent(eventId))?.status).toBe("dead_letter");
    expect(store.audit[0]?.action).toBe("rehearsal.passed");
  });

  it("records a private DNS resolution as a terminal security failure", async () => {
    const { store, queue, eventId } = await setup();
    const postFn = vi.fn();
    const result = await deliver(
      { eventId, mode: "live" },
      {
        store,
        queue,
        allowPrivateTargets: false,
        postFn,
        lookupFn: async () => [{ address: "127.0.0.1", family: 4 }],
      },
    );

    expect(postFn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ terminal: true, nextStatus: "dead_letter" });
    expect(store.attempts[0]?.error).toContain("private or reserved network");
    expect((await store.getEvent(eventId))?.status).toBe("dead_letter");
  });

  it("bounds DNS resolution within the delivery deadline", async () => {
    const { store, queue, eventId } = await setup();
    const postFn = vi.fn<DestinationPost>();
    let resolutionCancelled = false;
    const result = await deliver(
      { eventId, mode: "live" },
      {
        store,
        queue,
        allowPrivateTargets: false,
        postFn,
        lookupFn: async (_hostname, signal) => new Promise((_resolve, reject) => {
          const cancel = () => {
            resolutionCancelled = true;
            reject(new Error("DNS lookup cancelled"));
          };
          if (signal?.aborted) cancel();
          else signal?.addEventListener("abort", cancel, { once: true });
        }),
        timeoutMs: 25,
      },
    );

    expect(postFn).not.toHaveBeenCalled();
    expect(resolutionCancelled).toBe(true);
    expect(result).toMatchObject({ terminal: false, nextStatus: "retrying" });
    expect(store.attempts[0]?.error).toBe("Destination resolution timed out after 25ms");
  });

  it("passes every validated DNS answer to the pinned transport in resolver order", async () => {
    const { store, queue, eventId } = await setup();
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 204, body: "", retryAfter: null }));
    const addresses = [
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
      { address: "93.184.216.34", family: 4 },
    ];

    await deliver(
      { eventId, mode: "live" },
      { store, queue, allowPrivateTargets: false, postFn, lookupFn: async () => addresses },
    );

    expect(postFn.mock.calls[0]![0].destination.addresses).toEqual(addresses);
  });

  it("claims a durable intent once so duplicate queue delivery cannot resend", async () => {
    const { store, queue, eventId } = await setup();
    const job = { eventId, mode: "live", cycleId: "live", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job, jobKey: deliveryJobKey(job) });
    const queued = queue.jobs[0]!.job;
    const postFn = vi.fn(async () => ({ status: 204, body: "", retryAfter: null }));

    const first = await deliver(queued, { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup });
    const duplicate = await deliver(queued, { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup });

    expect(first.delivered).toBe(true);
    expect(duplicate.delivered).toBe(true);
    expect(postFn).toHaveBeenCalledTimes(1);
    expect(store.intents.get(queued.intentId!)?.state).toBe("completed");
  });

  it("starts a fresh retry budget for a guarded replay and persists the next attempt", async () => {
    const { store, queue, eventId } = await setup("dead_letter");
    await store.updateEvent(eventId, { attemptCount: store.endpoint.maxAttempts });
    const job = { eventId, mode: "replay", cycleId: "replay-rehearsal-1", attemptNumber: 1 } as const;
    await scheduleDelivery({ store, queue, job, jobKey: deliveryJobKey(job) });
    const result = await deliver(queue.jobs[0]!.job, {
      store,
      queue,
      allowPrivateTargets: false,
      postFn: async () => ({ status: 503, body: "temporarily unavailable", retryAfter: null }),
      lookupFn: publicLookup,
    });

    expect(result).toMatchObject({ terminal: false, nextStatus: "retrying" });
    expect(queue.jobs.at(-1)?.job).toMatchObject({ mode: "replay", cycleId: "replay-rehearsal-1", attemptNumber: 2 });
    expect(queue.jobs.at(-1)?.jobId).toContain("attempt-2");
    expect([...store.intents.values()].map((intent) => intent.state).sort()).toEqual(["completed", "dispatched"]);
  });
});
