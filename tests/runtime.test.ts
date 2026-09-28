import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { reconcileOnce } from "../src/cron.js";
import type { DeliveryJob, DeliveryQueue } from "../src/domain/contracts.js";
import { FakeStore } from "./fake-store.js";

class RecordingQueue implements DeliveryQueue {
  readonly jobs: DeliveryJob[] = [];
  readonly heartbeats: string[] = [];

  async enqueue(job: DeliveryJob) { this.jobs.push(job); }
  async health() {
    return {
      latencyMs: 0,
      jobs: { waiting: this.jobs.length, active: 0, delayed: 0, failed: 0 },
      workerHeartbeat: null,
      cronHeartbeat: null,
    };
  }
  async heartbeat(component: "worker" | "cron") { this.heartbeats.push(component); }
  async consumeRateLimit() { return { allowed: true, remaining: 1, retryAfterSeconds: 60 }; }
  async close() {}
}

describe("free-tier runtime", () => {
  it("enables the embedded worker explicitly and defaults to a ten-minute reconcile cadence", () => {
    const config = loadConfig({
      DATABASE_URL: "postgresql://user:pass@example.com/replay_room",
      REDIS_URL: "redis://example.com:6379",
      ADMIN_TOKEN: "test-admin-token",
      EMBEDDED_WORKER: "true",
    });

    expect(config.EMBEDDED_WORKER).toBe(true);
    expect(config.RECONCILE_INTERVAL_SECONDS).toBe(600);
  });

  it("rejects an unsafe reconcile loop frequency", () => {
    expect(() => loadConfig({
      DATABASE_URL: "postgresql://user:pass@example.com/replay_room",
      REDIS_URL: "redis://example.com:6379",
      ADMIN_TOKEN: "test-admin-token",
      RECONCILE_INTERVAL_SECONDS: "5",
    })).toThrow();
  });

  it("recovers stranded deliveries, applies retention, and publishes a cron heartbeat", async () => {
    const store = new FakeStore();
    const queue = new RecordingQueue();
    let pendingBefore = "";
    let retentionBefore = "";
    store.recoverPending = async (beforeIso) => {
      pendingBefore = beforeIso;
      return ["event-a", "event-b"];
    };
    store.deleteOlderThan = async (beforeIso) => {
      retentionBefore = beforeIso;
      return 3;
    };

    const result = await reconcileOnce({
      store,
      queue,
      retentionDays: 30,
      now: new Date("2026-09-27T12:00:00.000Z"),
    });

    expect(result).toEqual({ recovered: 2, deleted: 3 });
    expect(pendingBefore).toBe("2026-09-27T11:55:00.000Z");
    expect(retentionBefore).toBe("2026-08-28T12:00:00.000Z");
    expect(queue.jobs).toEqual([
      { eventId: "event-a", mode: "live", reason: "reconciled-pending-delivery" },
      { eventId: "event-b", mode: "live", reason: "reconciled-pending-delivery" },
    ]);
    expect(queue.heartbeats).toEqual(["cron"]);
  });
});
