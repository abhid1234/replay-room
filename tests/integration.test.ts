import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../src/db/migrate.js";
import { PostgresStore } from "../src/db/postgres-store.js";
import { RedisDeliveryQueue } from "../src/queue.js";

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
    const first = await store.createDeliveryIntent(`live-${created.event.id}-attempt-1`, job);
    const duplicate = await store.createDeliveryIntent(`live-${created.event.id}-attempt-1`, job);

    expect(first.created).toBe(true);
    expect(duplicate).toMatchObject({ created: false, intent: { id: first.intent.id } });
    expect(await store.prepareDeliveryIntentDispatch(first.intent.id, "2026-09-27T12:00:00.000Z", "2026-09-27T11:55:00.000Z")).toBe(true);
    expect(await store.claimDeliveryIntent(first.intent.id, "2026-09-27T12:00:01.000Z")).toBe(true);
    expect(await store.claimDeliveryIntent(first.intent.id, "2026-09-27T12:00:02.000Z")).toBe(false);
    expect(await store.deliveryIntentStats("2026-09-27T12:00:02.000Z")).toEqual({ pending: 0, dispatched: 0, processing: 1, stale: 1 });
    await store.completeDeliveryIntent(first.intent.id, "2026-09-27T12:00:03.000Z");
    expect(await store.deliveryIntentStats("2026-09-27T12:00:04.000Z")).toEqual({ pending: 0, dispatched: 0, processing: 0, stale: 0 });
    expect(await store.listDispatchableIntents("2026-09-27T13:00:00.000Z", "2026-09-27T12:55:00.000Z")).toEqual([]);
  });
});
