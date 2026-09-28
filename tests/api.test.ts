import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import type { AppConfig } from "../src/config.js";
import type { DeliveryJob, DeliveryQueue } from "../src/domain/contracts.js";
import { FakeStore } from "./fake-store.js";
import { signPayload } from "../src/domain/security.js";

class FakeQueue implements DeliveryQueue {
  jobs: Array<{ job: DeliveryJob; options?: { delayMs?: number; jobId?: string } }> = [];
  rateLimits = new Map<string, number>();

  async enqueue(job: DeliveryJob, options?: { delayMs?: number; jobId?: string }) {
    this.jobs.push({ job, ...(options ? { options } : {}) });
  }

  async health() {
    return {
      latencyMs: 2,
      jobs: { waiting: this.jobs.length, active: 0, delayed: 0, failed: 0 },
      workerHeartbeat: new Date().toISOString(),
      cronHeartbeat: new Date().toISOString(),
    };
  }

  async heartbeat() {}

  async consumeRateLimit(key: string, limit: number, windowSeconds: number) {
    const count = (this.rateLimits.get(key) ?? 0) + 1;
    this.rateLimits.set(key, count);
    return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfterSeconds: windowSeconds };
  }

  async close() {}
}

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_TOKEN: "test-admin-token",
  EVIDENCE_SIGNING_SECRET: "test-evidence-secret-at-least-32-characters",
  WEB_ORIGIN: "http://localhost:5173",
  ALLOW_PRIVATE_TARGETS: true,
  MAX_PAYLOAD_BYTES: 262_144,
  INGEST_RATE_LIMIT_PER_MINUTE: 2,
  OPERATOR_RATE_LIMIT_PER_MINUTE: 300,
  SIGNATURE_TOLERANCE_SECONDS: 300,
  RETENTION_DAYS: 30,
  EMBEDDED_WORKER: false,
  RECONCILE_INTERVAL_SECONDS: 600,
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("webhook API", () => {
  it("rate limits authenticated operator reads before repeated database work", async () => {
    const app = await buildApp({
      config: { ...config, OPERATOR_RATE_LIMIT_PER_MINUTE: 2 },
      store: new FakeStore(),
      queue: new FakeQueue(),
    });
    apps.push(app);
    const request = { method: "GET" as const, url: "/api/stats", headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` } };

    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(200);
    const limited = await app.inject(request);
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.json()).toMatchObject({ error: "API rate limit exceeded" });
  });

  it("publishes a versioned OpenAPI contract without authentication", async () => {
    const app = await buildApp({ config, store: new FakeStore(), queue: new FakeQueue() });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=300");
    expect(response.json()).toMatchObject({
      openapi: "3.1.0",
      info: { title: "Replay Room API", version: "0.1.0" },
      paths: { "/ingest/{ingestKey}": {}, "/api/events/{eventId}/replay": {} },
      components: { securitySchemes: { bearerAuth: { scheme: "bearer" } } },
    });
  });

  it("accepts once, persists before enqueue, and deduplicates retries", async () => {
    const store = new FakeStore();
    const queue = new FakeQueue();
    const app = await buildApp({ config, store, queue });
    apps.push(app);

    const request = {
      method: "POST" as const,
      url: `/ingest/${store.endpoint.ingestKey}`,
      headers: { "content-type": "application/json", "idempotency-key": "checkout-1042" },
      payload: JSON.stringify({ type: "checkout.completed", orderId: "ord_1042" }),
    };
    const first = await app.inject(request);
    const second = await app.inject(request);
    const throttled = await app.inject(request);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers["retry-after"]).toBe("60");
    expect(first.headers["x-ratelimit-remaining"]).toBe("1");
    expect(first.json()).toMatchObject({ accepted: true, duplicate: false, status: "queued" });
    expect(second.json()).toMatchObject({ accepted: true, duplicate: true });
    expect(store.events).toHaveLength(1);
    expect(store.audit.map((entry) => entry.action)).toEqual(["event.received"]);
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]?.options?.jobId).toMatch(/^live-/);

    const detail = await app.inject({
      method: "GET",
      url: `/api/events/${first.json<{ eventId: string }>().eventId}`,
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ diagnosis: { code: "queued", severity: "info" } });
    expect(detail.json().endpoint).toMatchObject({ signingSecretConfigured: false });
    expect(detail.json().endpoint).not.toHaveProperty("signingSecret");

    const evidence = await app.inject({
      method: "GET",
      url: `/api/events/${first.json<{ eventId: string }>().eventId}/evidence`,
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` },
    });
    expect(evidence.statusCode).toBe(200);
    expect(evidence.headers["cache-control"]).toBe("no-store");
    expect(evidence.headers["content-disposition"]).toContain(".evidence.json");
    expect(evidence.json()).toMatchObject({
      schemaVersion: "replay-room.evidence/v1",
      integrity: { algorithm: "HMAC-SHA256" },
    });

    const reliability = await app.inject({
      method: "GET",
      url: "/api/endpoints/reliability?windowHours=24",
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` },
    });
    expect(reliability.json()[0]).toMatchObject({
      name: "Test",
      windowHours: 24,
      total: 1,
      deliveryRate: 100,
      state: "at_risk",
    });
  });

  it("keeps admin data behind bearer authentication", async () => {
    const store = new FakeStore();
    store.endpoint.signingSecret = "webhook-secret-that-must-stay-server-side";
    const app = await buildApp({ config: { ...config, ALLOW_PRIVATE_TARGETS: false }, store, queue: new FakeQueue() });
    apps.push(app);

    const denied = await app.inject({ method: "GET", url: "/api/events" });
    const allowed = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` },
    });

    expect(denied.statusCode).toBe(401);
    expect(allowed.statusCode).toBe(200);

    const endpoints = await app.inject({
      method: "GET",
      url: "/api/endpoints",
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` },
    });
    expect(endpoints.json()[0]).toMatchObject({ signingSecretConfigured: true });
    expect(endpoints.json()[0]).not.toHaveProperty("signingSecret");

    const unsafeEndpoint = await app.inject({
      method: "POST",
      url: "/api/endpoints",
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}`, "content-type": "application/json" },
      payload: { name: "Unsafe", destinationUrl: "http://127.0.0.1/internal", maxAttempts: 3 },
    });
    expect(unsafeEndpoint.statusCode).toBe(400);
    expect(unsafeEndpoint.json()).toEqual({ error: "Private-network destinations are disabled" });
  });

  it("accepts provider-native GitHub signatures and rejects invalid payloads", async () => {
    const store = new FakeStore();
    const queue = new FakeQueue();
    const app = await buildApp({ config, store, queue });
    apps.push(app);
    const secret = "github-webhook-secret-value";
    const created = await app.inject({
      method: "POST",
      url: "/api/endpoints",
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}`, "content-type": "application/json" },
      payload: { name: "GitHub events", destinationUrl: "https://example.com/github", signatureProfile: "github", signingSecret: secret },
    });
    const rawPayload = JSON.stringify({ action: "opened", pull_request: { id: 42 } });
    const headers = {
      "content-type": "application/json",
      "x-hub-signature-256": signPayload(secret, rawPayload),
      "idempotency-key": "github-delivery-42",
    };

    const accepted = await app.inject({ method: "POST", url: `/ingest/${created.json().ingestKey}`, headers, payload: rawPayload });
    const rejected = await app.inject({ method: "POST", url: `/ingest/${created.json().ingestKey}`, headers: { ...headers, "x-hub-signature-256": signPayload(secret, "tampered") }, payload: rawPayload });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ signatureProfile: "github", signingSecretConfigured: true });
    expect(accepted.statusCode).toBe(202);
    expect(rejected.statusCode).toBe(401);
    expect(store.events).toHaveLength(1);
    expect((await store.getEvent(accepted.json().eventId))?.headers["x-hub-signature-256"]).toBe("[REDACTED]");
  });

  it("persists one replay intent and suppresses duplicate operator approvals", async () => {
    const store = new FakeStore();
    const queue = new FakeQueue();
    const created = await store.createEvent({
      endpointId: store.endpoint.id,
      idempotencyKey: "failed-payment-42",
      headers: {},
      payload: { type: "payment.failed", paymentId: "pay_42" },
      payloadSha256: "a".repeat(64),
    });
    await store.updateEvent(created.event.id, { status: "dead_letter", attemptCount: 3 });
    const rehearsal = await store.addRehearsal({
      eventId: created.event.id,
      payloadSha256: "a".repeat(64),
      destinationUrl: "https://example.com/hook",
      passed: true,
      statusCode: 202,
      notes: "receiver repaired",
    });
    const app = await buildApp({ config, store, queue });
    apps.push(app);
    const request = {
      method: "POST" as const,
      url: `/api/events/${created.event.id}/replay`,
      headers: {
        authorization: `Bearer ${config.ADMIN_TOKEN}`,
        "content-type": "application/json",
        "x-operator": "incident-commander",
      },
      payload: { destinationUrl: rehearsal.destinationUrl, reason: "Receiver repair verified in rehearsal" },
    };

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(first.json().deliveryIntentId).toBe(second.json().deliveryIntentId);
    expect(first.json()).toMatchObject({ duplicate: false });
    expect(second.json()).toMatchObject({ duplicate: true });
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]).toMatchObject({
      job: { mode: "replay", attemptNumber: 1, cycleId: `replay-${rehearsal.id}` },
      options: { jobId: expect.stringContaining(`replay-${rehearsal.id}`) },
    });
    expect(store.audit.map((entry) => entry.action)).toEqual(["replay.approved", "replay.duplicate_suppressed"]);
  });

  it("blocks ambiguous replay until the operator acknowledges duplicate-side-effect risk", async () => {
    const store = new FakeStore();
    const queue = new FakeQueue();
    const created = await store.createEvent({
      endpointId: store.endpoint.id,
      idempotencyKey: null,
      headers: {},
      payload: { type: "transfer.created", transferId: "tr_ambiguous" },
      payloadSha256: "e".repeat(64),
    });
    await store.updateEvent(created.event.id, { status: "dead_letter", attemptCount: 1 });
    await store.addAttempt({
      eventId: created.event.id,
      mode: "live",
      destinationUrl: "https://example.com/hook",
      statusCode: null,
      responseBody: null,
      error: "connection reset after request write",
      durationMs: 800,
    });
    await store.addRehearsal({
      eventId: created.event.id,
      payloadSha256: "e".repeat(64),
      destinationUrl: "https://example.com/hook",
      passed: true,
      statusCode: 204,
      notes: "receiver repaired",
    });
    const app = await buildApp({ config, store, queue });
    apps.push(app);
    const base = {
      method: "POST" as const,
      url: `/api/events/${created.event.id}/replay`,
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}`, "content-type": "application/json", "x-operator": "commander" },
    };
    const payload = { destinationUrl: "https://example.com/hook", reason: "Receiver owner confirmed the repair" };

    const blocked = await app.inject({ ...base, payload });
    const approved = await app.inject({ ...base, payload: { ...payload, acknowledgeRisk: true } });

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().reasons).toContain("Explicitly acknowledge the duplicate-side-effect risk before replaying");
    expect(approved.statusCode).toBe(202);
    expect(queue.jobs).toHaveLength(1);
    expect(store.audit).toMatchObject([
      { action: "replay.blocked", metadata: { riskLevel: "high", riskAcknowledged: false } },
      { action: "replay.approved", metadata: { riskLevel: "high", riskAcknowledged: true } },
    ]);

    const detail = await app.inject({ method: "GET", url: `/api/events/${created.event.id}`, headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` } });
    expect(detail.json().replayRisk).toMatchObject({ level: "high", requiresAcknowledgement: true });
  });

  it("reports the live service fabric without exposing it publicly", async () => {
    const queue = new FakeQueue();
    const store = new FakeStore();
    await queue.enqueue({ eventId: "e7c33ce4-1ed2-475b-8941-383b37ea4690", mode: "live" });
    const created = await store.createEvent({
      endpointId: store.endpoint.id,
      idempotencyKey: "stale-intent",
      headers: {},
      payload: { type: "fabric.test" },
      payloadSha256: "d".repeat(64),
    });
    await store.createDeliveryIntent("stale-fabric-intent", { eventId: created.event.id, mode: "live" }, "2020-01-01T00:00:00.000Z");
    const app = await buildApp({ config, store, queue });
    apps.push(app);

    const denied = await app.inject({ method: "GET", url: "/api/system" });
    const health = await app.inject({ method: "GET", url: "/health" });
    const allowed = await app.inject({
      method: "GET",
      url: "/api/system",
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` },
    });

    expect(denied.statusCode).toBe(401);
    expect(health.json()).toMatchObject({ status: "ok", dependencies: { queueLatencyMs: 2 } });
    expect(allowed.json()).toMatchObject({
      deploy: { service: "replay-room-api", environment: "test", topology: "split-services" },
      components: {
        api: { state: "online" },
        database: { state: "online" },
        outbox: { state: "degraded", pending: 1, dispatched: 0, processing: 0, stale: 1 },
        queue: { state: "online", jobs: { waiting: 1 } },
        worker: { state: "online" },
        cron: { state: "online" },
      },
    });
  });
});
