import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { PostgresStore } from "../src/db/postgres-store.js";
import { RedisDeliveryQueue } from "../src/queue.js";
import type { RetryTransitionInput } from "../src/domain/contracts.js";

const run = process.env.INTEGRATION_TESTS === "true";
const databaseUrl = process.env.DATABASE_URL ?? "postgresql://replay_room:replay_room@127.0.0.1:5432/replay_room_test";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379/15";

describe.runIf(run)("managed Postgres and Key Value contracts", () => {
  let store: PostgresStore;
  let queue: RedisDeliveryQueue;

  beforeAll(async () => {
    store = new PostgresStore(databaseUrl);
    queue = new RedisDeliveryQueue(redisUrl);
    await migrate(databaseUrl);
    await migrate(databaseUrl);
    await store.pool.query("TRUNCATE delivery_intents, audit_log, rehearsals, delivery_attempts, webhook_events, endpoints CASCADE");
  });

  afterAll(async () => {
    await queue?.close();
    await store?.close();
  });

  it("persists an idempotent incident transcript and computes reliability", async () => {
    const endpoint = await store.createEndpoint({
      name: "CI receiver",
      ingestKey: `ci_${randomUUID()}`,
      destinationUrl: "https://example.com/webhooks",
      signingSecret: "integration-secret-value",
      signatureProfile: "generic",
      maxAttempts: 4,
    });
    const input = {
      endpointId: endpoint.id,
      idempotencyKey: "invoice-2042",
      headers: { "content-type": "application/json" },
      payload: { type: "invoice.paid", invoiceId: "inv_2042" },
      payloadSha256: "a".repeat(64),
    };

    const first = await store.createEvent(input);
    const duplicate = await store.createEvent(input);
    expect(first.duplicate).toBe(false);
    expect(duplicate).toMatchObject({ duplicate: true, event: { id: first.event.id } });

    await store.updateEvent(first.event.id, { status: "delivered", attemptCount: 1, lastError: null });
    await store.addAttempt({
      eventId: first.event.id,
      mode: "live",
      destinationUrl: endpoint.destinationUrl,
      statusCode: 202,
      responseBody: "accepted",
      error: null,
      durationMs: 42,
    });
    await store.addRehearsal({
      eventId: first.event.id,
      payloadSha256: input.payloadSha256,
      destinationUrl: endpoint.destinationUrl,
      passed: true,
      statusCode: 202,
      notes: "CI contract rehearsal",
    });
    await store.addAudit({
      eventId: first.event.id,
      action: "event.received",
      actor: "integration-test",
      reason: null,
      metadata: { fixture: "invoice-paid" },
    });

    const detail = await store.getEvent(first.event.id);
    expect(detail).toMatchObject({
      id: first.event.id,
      status: "delivered",
      attemptCount: 1,
      endpoint: { name: "CI receiver" },
      attempts: [{ statusCode: 202, durationMs: 42 }],
      rehearsals: [{ passed: true }],
      audit: [{ actor: "integration-test" }],
    });
    expect(await store.endpointReliability(24)).toMatchObject([{
      total: 1,
      delivered: 1,
      deliveryRate: 100,
      p95LatencyMs: 42,
      state: "healthy",
    }]);
  });

  it("uses Redis atomically for shared ingest limits and dependency health", async () => {
    const key = `integration-${randomUUID()}`;
    const first = await queue.consumeRateLimit(key, 2, 60);
    const second = await queue.consumeRateLimit(key, 2, 60);
    const third = await queue.consumeRateLimit(key, 2, 60);

    expect(first).toMatchObject({ allowed: true, remaining: 1 });
    expect(second).toMatchObject({ allowed: true, remaining: 0 });
    expect(third).toMatchObject({ allowed: false, remaining: 0 });
    expect((await queue.health()).latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("deduplicates, claims, and completes a durable delivery intent", async () => {
    const endpoint = await store.createEndpoint({
      name: "Intent receiver",
      ingestKey: `intent_${randomUUID()}`,
      destinationUrl: "https://example.com/intents",
      signingSecret: null,
      signatureProfile: "none",
      maxAttempts: 3,
    });
    const created = await store.createEvent({
      endpointId: endpoint.id,
      idempotencyKey: "intent-event-1",
      headers: {},
      payload: { type: "intent.test" },
      payloadSha256: "c".repeat(64),
    });
    const job = { eventId: created.event.id, mode: "live" as const, cycleId: "live", attemptNumber: 1 };
    const first = await store.createDeliveryIntent(`live-${created.event.id}-attempt-1`, job, { availableAt: "2026-09-27T11:59:00.000Z" });
    const duplicate = await store.createDeliveryIntent(`live-${created.event.id}-attempt-1`, job, { availableAt: "2026-09-27T11:59:00.000Z" });

    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({ created: false, intent: { id: first.intent.id } });
    const initialDispatch = await store.prepareDeliveryIntentDispatch(first.intent.id);
    expect(initialDispatch).toMatchObject({ delayMs: 0 });
    if (!initialDispatch) throw new Error("Expected a dispatch lease");
    await store.releaseDeliveryIntent(first.intent.id, initialDispatch.dispatchedAt);
    expect((await store.pool.query("SELECT state FROM delivery_intents WHERE id = $1", [first.intent.id])).rows[0]?.state).toBe("pending");
    expect(await store.prepareDeliveryIntentDispatch(first.intent.id)).toMatchObject({ delayMs: 0 });
    const firstClaim = await store.claimDeliveryIntent(first.intent.id);
    if (firstClaim.status !== "claimed" || !firstClaim.intent.processingAt) throw new Error("Expected claimed intent");
    expect(firstClaim).toMatchObject({ intent: { id: first.intent.id, state: "processing" } });
    expect(await store.claimDeliveryIntent(first.intent.id)).toEqual({ status: "unavailable" });
    expect(await store.deliveryIntentStats()).toEqual({ pending: 0, dispatched: 0, processing: 1, stale: 0 });
    await store.completeDeliveryIntent(first.intent.id, new Date().toISOString(), firstClaim.intent.processingAt);
    expect(await store.deliveryIntentStats()).toEqual({ pending: 0, dispatched: 0, processing: 0, stale: 0 });
    expect(await store.listDispatchableIntents()).toEqual([]);

    const futureJob = { ...job, attemptNumber: 2 };
    const databaseClock = await store.pool.query("SELECT clock_timestamp() AS now");
    const databaseNow = new Date(databaseClock.rows[0]!.now as string | Date).getTime();
    const future = await store.createDeliveryIntent(`live-${created.event.id}-attempt-2`, futureJob, { delayMs: 60_000 });
    expect(Date.parse(future.intent.availableAt)).toBeGreaterThanOrEqual(databaseNow + 59_999);
    expect(await store.prepareDeliveryIntentDispatch(future.intent.id)).toMatchObject({ delayMs: expect.any(Number) });
    expect(await store.claimDeliveryIntent(future.intent.id)).toMatchObject({
      status: "deferred",
      reason: "not-yet-available",
      retryAt: future.intent.availableAt,
      delayMs: expect.any(Number),
    });
  });

  it("samples claim time only after a contended event lock is acquired", async () => {
    const endpoint = await store.createEndpoint({
      name: "Contended claim receiver",
      ingestKey: `contended_${randomUUID()}`,
      destinationUrl: "https://example.com/contended-claim",
      signingSecret: null,
      signatureProfile: "none",
      maxAttempts: 3,
    });
    const created = await store.createEvent({
      endpointId: endpoint.id,
      idempotencyKey: "contended-claim-1",
      headers: {},
      payload: { type: "claim.contended" },
      payloadSha256: "f".repeat(64),
    });
    const job = { eventId: created.event.id, mode: "live" as const, cycleId: "live", attemptNumber: 1 };
    const intent = await store.createDeliveryIntent(`live-${created.event.id}-attempt-1`, job);
    expect(await store.prepareDeliveryIntentDispatch(intent.intent.id)).not.toBeNull();

    const blocker = await store.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM webhook_events WHERE id = $1 FOR UPDATE", [created.event.id]);
      const claimPromise = store.claimDeliveryIntent(intent.intent.id);
      let observedLockWait = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const waiting = await blocker.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE pid <> pg_backend_pid()
             AND datname = current_database()
             AND wait_event_type = 'Lock'
             AND query LIKE 'SELECT id, status FROM webhook_events%'
           LIMIT 1`,
        );
        if (waiting.rowCount) {
          observedLockWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const releasedAt = Date.now();
      await blocker.query("COMMIT");
      const claim = await claimPromise;
      expect(observedLockWait).toBe(true);
      if (claim.status !== "claimed" || !claim.intent.processingAt) throw new Error("Expected a claimed intent");
      expect(Date.parse(claim.intent.processingAt)).toBeGreaterThanOrEqual(releasedAt);
    } finally {
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
      }
    }
  });

  it("plans a retry only after a contended event lock is acquired", async () => {
    const endpoint = await store.createEndpoint({
      name: "Contended retry receiver",
      ingestKey: `retry_lock_${randomUUID()}`,
      destinationUrl: "https://example.com/contended-retry",
      signingSecret: null,
      signatureProfile: "none",
      maxAttempts: 3,
    });
    const created = await store.createEvent({
      endpointId: endpoint.id,
      idempotencyKey: "contended-retry-1",
      headers: {},
      payload: { type: "retry.contended" },
      payloadSha256: "1".repeat(64),
    });
    const retryJob = { eventId: created.event.id, mode: "live" as const, cycleId: "live", attemptNumber: 2 };
    const backoffMs = 2_000;
    const blocker = await store.pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("SELECT id FROM webhook_events WHERE id = $1 FOR UPDATE", [created.event.id]);
      const transitionPromise = store.commitRetryTransition({
        eventId: created.event.id,
        jobKey: `live-${created.event.id}-attempt-2`,
        job: retryJob,
        backoffMs,
        retryAfter: null,
        completedAt: new Date().toISOString(),
        lastError: "Destination returned HTTP 503",
        audit: {
          eventId: created.event.id,
          action: "delivery.retry_scheduled",
          actor: "worker",
          reason: "Destination returned HTTP 503",
          metadata: {},
        },
      });
      let observedLockWait = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const waiting = await blocker.query(
          `SELECT 1 FROM pg_stat_activity
           WHERE pid <> pg_backend_pid()
             AND datname = current_database()
             AND wait_event_type = 'Lock'
             AND query LIKE 'SELECT id, status FROM webhook_events%'
           LIMIT 1`,
        );
        if (waiting.rowCount) {
          observedLockWait = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const releaseClock = await blocker.query("SELECT clock_timestamp() AS now");
      const releasedAt = new Date(releaseClock.rows[0]!.now as string | Date).getTime();
      await blocker.query("COMMIT");
      const transition = await transitionPromise;
      expect(observedLockWait).toBe(true);
      if (!transition.scheduled) throw new Error("Expected a scheduled retry");
      expect(Date.parse(transition.intent.availableAt)).toBeGreaterThanOrEqual(releasedAt + backoffMs);
    } finally {
      try {
        await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
      }
    }
  });

  it("commits a retry intent, audit evidence, event state, and current-intent completion atomically", async () => {
    const endpoint = await store.createEndpoint({
      name: "Retry transition receiver",
      ingestKey: `retry_${randomUUID()}`,
      destinationUrl: "https://example.com/retry-transition",
      signingSecret: null,
      signatureProfile: "none",
      maxAttempts: 3,
    });
    const created = await store.createEvent({
      endpointId: endpoint.id,
      idempotencyKey: "retry-transition-1",
      headers: {},
      payload: { type: "retry.transition" },
      payloadSha256: "d".repeat(64),
    });
    const currentJob = { eventId: created.event.id, mode: "live" as const, cycleId: "live", attemptNumber: 1 };
    const current = await store.createDeliveryIntent(`live-${created.event.id}-attempt-1`, currentJob, { availableAt: "2026-09-30T19:59:00.000Z" });
    expect(await store.prepareDeliveryIntentDispatch(current.intent.id)).toMatchObject({ delayMs: 0 });
    const currentClaim = await store.claimDeliveryIntent(current.intent.id);
    if (currentClaim.status !== "claimed" || !currentClaim.intent.processingAt) throw new Error("Expected claimed intent");
    expect(currentClaim).toMatchObject({ intent: { id: current.intent.id, state: "processing" } });

    const retryJob = { eventId: created.event.id, mode: "live" as const, cycleId: "live", attemptNumber: 2 };
    const transition: RetryTransitionInput = {
      eventId: created.event.id,
      jobKey: `live-${created.event.id}-attempt-2`,
      job: retryJob,
      backoffMs: 60_000,
      retryAfter: "120",
      currentIntentId: current.intent.id,
      currentIntentProcessingAt: currentClaim.intent.processingAt,
      completedAt: "2026-09-30T20:00:02.000Z",
      lastError: "Destination returned HTTP 429",
      audit: {
        eventId: created.event.id,
        action: "delivery.retry_scheduled",
        actor: "worker",
        reason: "Destination returned HTTP 429",
        metadata: {},
      },
    };

    await expect(store.commitRetryTransition({
      ...transition,
      currentIntentProcessingAt: "2026-09-30T20:00:01.500Z",
    })).rejects.toThrow("lost its processing claim");
    expect(await store.getEvent(created.event.id)).toMatchObject({ status: "queued", audit: [] });

    const first = await store.commitRetryTransition(transition);
    const { currentIntentId: _currentIntentId, currentIntentProcessingAt: _currentIntentProcessingAt, ...reconciledTransition } = transition;
    const duplicate = await store.commitRetryTransition(reconciledTransition);
    const detail = await store.getEvent(created.event.id);

    if (!first.scheduled || !duplicate.scheduled) throw new Error("Expected a scheduled retry transition");
    expect(first).toMatchObject({ created: true, delayMs: 120_000 });
    expect(duplicate).toMatchObject({ created: false, intent: { id: first.intent.id } });
    expect(detail).toMatchObject({
      status: "retrying",
      lastError: "Destination returned HTTP 429",
      audit: [{
        action: "delivery.retry_scheduled",
        metadata: {
          jobKey: transition.jobKey,
          intentCreated: true,
          delayMs: 120_000,
          strategy: "retry-after",
          receiverDelayMs: 120_000,
          availableAt: first.intent.availableAt,
        },
      }],
    });
    expect((await store.deliveryIntentStats()).processing).toBe(0);

    await store.updateEvent(created.event.id, { status: "delivered", lastError: null });
    const suppressed = await store.commitDeliveryOutcome({
      eventId: created.event.id,
      status: "dead_letter",
      lastError: "Destination returned HTTP 429",
      completedAt: "2026-09-30T20:00:04.000Z",
      audit: {
        eventId: created.event.id,
        action: "delivery.dead_lettered",
        actor: "worker",
        reason: "Destination returned HTTP 429",
        metadata: {},
      },
    });
    expect(suppressed).toEqual({ applied: false, nextStatus: "delivered" });
    expect(await store.getEvent(created.event.id)).toMatchObject({ status: "delivered", audit: [{ action: "delivery.retry_scheduled" }] });
  });

  it("serializes delivery cycles per event and discards a deferred cycle after delivery wins", async () => {
    const endpoint = await store.createEndpoint({
      name: "Concurrent cycle receiver",
      ingestKey: `cycle_${randomUUID()}`,
      destinationUrl: "https://example.com/concurrent-cycles",
      signingSecret: null,
      signatureProfile: "none",
      maxAttempts: 3,
    });
    const created = await store.createEvent({
      endpointId: endpoint.id,
      idempotencyKey: "concurrent-cycle-1",
      headers: {},
      payload: { type: "cycle.test" },
      payloadSha256: "e".repeat(64),
    });
    const firstJob = { eventId: created.event.id, mode: "live" as const, cycleId: "live-a", attemptNumber: 1 };
    const secondJob = { eventId: created.event.id, mode: "replay" as const, cycleId: "replay-b", attemptNumber: 1 };
    const first = await store.createDeliveryIntent(`live-a-${created.event.id}-attempt-1`, firstJob, { availableAt: "2026-09-30T20:00:00.000Z" });
    const second = await store.createDeliveryIntent(`replay-b-${created.event.id}-attempt-1`, secondJob, { availableAt: "2026-09-30T20:00:00.000Z" });
    await store.prepareDeliveryIntentDispatch(first.intent.id);
    await store.prepareDeliveryIntentDispatch(second.intent.id);

    const firstClaim = await store.claimDeliveryIntent(first.intent.id);
    if (firstClaim.status !== "claimed" || !firstClaim.intent.processingAt) throw new Error("Expected claimed intent");
    expect(firstClaim).toMatchObject({ intent: { id: first.intent.id } });
    expect(await store.claimDeliveryIntent(second.intent.id)).toMatchObject({
      status: "deferred",
      reason: "event-busy",
    });

    await store.commitDeliveryOutcome({
      eventId: created.event.id,
      status: "delivered",
      lastError: null,
      currentIntentId: first.intent.id,
      currentIntentProcessingAt: firstClaim.intent.processingAt,
      completedAt: new Date(Date.parse(firstClaim.intent.processingAt) + 500).toISOString(),
      audit: {
        eventId: created.event.id,
        action: "delivery.succeeded",
        actor: "worker",
        reason: null,
        metadata: { cycleId: "live-a" },
      },
    });

    expect(await store.claimDeliveryIntent(second.intent.id)).toEqual({ status: "unavailable" });
    const secondState = await store.pool.query("SELECT state FROM delivery_intents WHERE id = $1", [second.intent.id]);
    expect(secondState.rows[0]?.state).toBe("completed");
    expect(await store.getEvent(created.event.id)).toMatchObject({
      status: "delivered",
      audit: [{ action: "delivery.succeeded" }],
    });
  });
});
