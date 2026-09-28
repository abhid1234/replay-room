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

  async close() {}
}

const config: AppConfig = {
  NODE_ENV: "test",
  PORT: 4000,
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_TOKEN: "test-admin-token",
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
  });

  it("keeps admin data behind bearer authentication", async () => {
    const app = await buildApp({ config, store: new FakeStore(), queue: new FakeQueue() });
    apps.push(app);

    const denied = await app.inject({ method: "GET", url: "/api/events" });
    const allowed = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: { authorization: `Bearer ${config.ADMIN_TOKEN}` },
    });

    expect(denied.statusCode).toBe(401);
    expect(allowed.statusCode).toBe(200);
  });
});
