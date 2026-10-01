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
  it("records a successful live delivery", async () => {
    const { store, queue, eventId } = await setup();
    const postFn = vi.fn(async () => ({ status: 204, body: "" }));
    const result = await deliver({ eventId, mode: "live" }, { store, queue, allowPrivateTargets: false, postFn, lookupFn: publicLookup, now: (() => { let n = 100; return () => n += 20; })() });
    expect(result.nextStatus).toBe("delivered");
    expect((await store.getEvent(eventId))?.status).toBe("delivered");
    expect(store.attempts[0]?.statusCode).toBe(204);
  });

  it("re-signs outbound payloads with the endpoint provider profile", async () => {
    const { store, queue, eventId } = await setup();
    store.endpoint.signatureProfile = "github";
    store.endpoint.signingSecret = "github-delivery-secret";
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 202, body: "" }));

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
    await deliver({ eventId, mode: "live" }, { store, queue, allowPrivateTargets: false, postFn: async () => ({ status: 503, body: "down" }), lookupFn: publicLookup });
    expect((await store.getEvent(eventId))?.status).toBe("retrying");
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]!.delayMs).toBeGreaterThan(0);
  });

  it("stores rehearsal evidence without changing dead-letter state", async () => {
    const { store, queue, eventId } = await setup("dead_letter");
    await deliver({ eventId, mode: "rehearsal", destinationUrl: "https://example.com/hook", actor: "abhi" }, { store, queue, allowPrivateTargets: false, postFn: async () => ({ status: 202, body: "accepted" }), lookupFn: publicLookup });
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
    const postFn = vi.fn<DestinationPost>(async () => ({ status: 204, body: "" }));
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
    const postFn = vi.fn(async () => ({ status: 204, body: "" }));

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
      postFn: async () => ({ status: 503, body: "temporarily unavailable" }),
      lookupFn: publicLookup,
    });

    expect(result).toMatchObject({ terminal: false, nextStatus: "retrying" });
    expect(queue.jobs.at(-1)?.job).toMatchObject({ mode: "replay", cycleId: "replay-rehearsal-1", attemptNumber: 2 });
    expect(queue.jobs.at(-1)?.jobId).toContain("attempt-2");
    expect([...store.intents.values()].map((intent) => intent.state).sort()).toEqual(["completed", "dispatched"]);
  });
});
