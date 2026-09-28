import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { DeliveryJob, DeliveryQueue, QueueHealth, RateLimitDecision } from "./domain/contracts.js";

export const DELIVERY_QUEUE = "replay-room-deliveries";

export class RedisDeliveryQueue implements DeliveryQueue {
  private readonly connection: Redis;
  private readonly queue: Queue<DeliveryJob>;

  constructor(redisUrl: string) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue<DeliveryJob>(DELIVERY_QUEUE, { connection: this.connection });
  }

  async enqueue(job: DeliveryJob, options: { delayMs?: number; jobId?: string } = {}): Promise<void> {
    await this.queue.add(job.mode, job, {
      delay: options.delayMs ?? 0,
      ...(options.jobId ? { jobId: options.jobId } : {}),
      attempts: 3,
      backoff: { type: "exponential", delay: 1_000 },
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  async health(): Promise<QueueHealth> {
    const startedAt = Date.now();
    const [, counts, workerHeartbeat, cronHeartbeat] = await Promise.all([
      this.connection.ping(),
      this.queue.getJobCounts("waiting", "active", "delayed", "failed"),
      this.connection.get(heartbeatKey("worker")),
      this.connection.get(heartbeatKey("cron")),
    ]);
    return {
      latencyMs: Date.now() - startedAt,
      jobs: {
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        delayed: counts.delayed ?? 0,
        failed: counts.failed ?? 0,
      },
      workerHeartbeat,
      cronHeartbeat,
    };
  }

  async heartbeat(component: "worker" | "cron"): Promise<void> {
    const ttlSeconds = component === "worker" ? 90 : 1_200;
    await this.connection.set(heartbeatKey(component), new Date().toISOString(), "EX", ttlSeconds);
  }

  async consumeRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitDecision> {
    const result = await this.connection.eval(
      `local count = redis.call('INCR', KEYS[1])
       if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
       local ttl = redis.call('TTL', KEYS[1])
       return {count, ttl}`,
      1,
      `replay-room:limit:${key}`,
      windowSeconds,
    ) as [number, number];
    const [count, ttl] = result;
    return {
      allowed: count <= limit,
      remaining: Math.max(0, limit - count),
      retryAfterSeconds: Math.max(1, ttl),
    };
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}

function heartbeatKey(component: "worker" | "cron"): string {
  return `replay-room:heartbeat:${component}`;
}
