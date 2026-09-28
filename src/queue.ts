import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { DeliveryJob, DeliveryQueue } from "./domain/contracts.js";

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
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
