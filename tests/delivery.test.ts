import { describe, expect, it, vi } from "vitest";
import { deliver } from "../src/delivery.js";
import type { DeliveryJob, DeliveryQueue } from "../src/domain/contracts.js";
import { sha256 } from "../src/domain/security.js";
import { FakeStore } from "./fake-store.js";

class FakeQueue implements DeliveryQueue {
  jobs: Array<{ job: DeliveryJob; delayMs: number }> = [];
  async enqueue(job: DeliveryJob, options: { delayMs?: number } = {}) { this.jobs.push({ job, delayMs: options.delayMs ?? 0 }); }
  async health() { return { latencyMs: 0, jobs: { waiting: 0, active: 0, delayed: 0, failed: 0 }, workerHeartbeat: null, cronHeartbeat: null }; }
  async heartbeat() {}
  async consumeRateLimit(_key: string, limit: number, windowSeconds: number) { return { allowed: true, remaining: limit - 1, retryAfterSeconds: windowSeconds }; }
  async close() {}
}

async function setup(status: "queued" | "dead_letter" = "queued") {
  const store = new FakeStore(); const queue = new FakeQueue();
  const created = await store.createEvent({ endpointId: store.endpoint.id, idempotencyKey: "evt-1", headers: {}, payload: { type: "invoice.paid" }, payloadSha256: sha256("payload") });
  await store.updateEvent(created.event.id, { status });
  return { store, queue, eventId: created.event.id };
}

describe("delivery processor", () => {
  it("records a successful live delivery", async () => {
    const { store, queue, eventId } = await setup();
    const fetchFn = vi.fn(async () => new Response(null, { status: 204 }));
    const result = await deliver({ eventId, mode: "live" }, { store, queue, allowPrivateTargets: false, fetchFn, now: (() => { let n = 100; return () => n += 20; })() });
    expect(result.nextStatus).toBe("delivered");
    expect((await store.getEvent(eventId))?.status).toBe("delivered");
    expect(store.attempts[0]?.statusCode).toBe(204);
  });

  it("schedules retry for a transient failure", async () => {
    const { store, queue, eventId } = await setup();
    await deliver({ eventId, mode: "live" }, { store, queue, allowPrivateTargets: false, fetchFn: async () => new Response("down", { status: 503 }) });
    expect((await store.getEvent(eventId))?.status).toBe("retrying");
    expect(queue.jobs).toHaveLength(1);
    expect(queue.jobs[0]!.delayMs).toBeGreaterThan(0);
  });

  it("stores rehearsal evidence without changing dead-letter state", async () => {
    const { store, queue, eventId } = await setup("dead_letter");
    await deliver({ eventId, mode: "rehearsal", destinationUrl: "https://example.com/hook", actor: "abhi" }, { store, queue, allowPrivateTargets: false, fetchFn: async () => new Response("accepted", { status: 202 }) });
    expect(store.rehearsals[0]?.passed).toBe(true);
    expect((await store.getEvent(eventId))?.status).toBe("dead_letter");
    expect(store.audit[0]?.action).toBe("rehearsal.passed");
  });
});
