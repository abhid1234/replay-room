import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/api/app.js";
import type { AppConfig } from "../src/config.js";
import type { DeliveryJob, DeliveryQueue } from "../src/domain/contracts.js";
import { FakeStore } from "./fake-store.js";

class FakeQueue implements DeliveryQueue {
  jobs: Array<{ job: DeliveryJob; options?: { delayMs?: number; jobId?: string } }> = [];

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
  RETENTION_DAYS: 30,
};

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("webhook API", () => {
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

    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
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
    const app = await buildApp({ config, store, queue: new FakeQueue() });
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
  });

  it("reports the live service fabric without exposing it publicly", async () => {
    const queue = new FakeQueue();
    await queue.enqueue({ eventId: "e7c33ce4-1ed2-475b-8941-383b37ea4690", mode: "live" });
    const app = await buildApp({ config, store: new FakeStore(), queue });
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
      deploy: { service: "replay-room-api", environment: "test" },
      components: {
        api: { state: "online" },
        database: { state: "online" },
        queue: { state: "online", jobs: { waiting: 1 } },
        worker: { state: "online" },
        cron: { state: "online" },
      },
    });
  });
});
