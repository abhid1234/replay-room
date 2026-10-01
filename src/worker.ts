import { fileURLToPath } from "node:url";
import { DelayedError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { PostgresStore } from "./db/postgres-store.js";
import { migrate } from "./db/migrate.js";
import { deliver } from "./delivery.js";
import type { DeliveryJob, DeliveryQueue, Store } from "./domain/contracts.js";
import { DELIVERY_QUEUE, RedisDeliveryQueue } from "./queue.js";

interface DeliveryWorkerOptions {
  redisUrl: string;
  store: Store;
  queue: DeliveryQueue;
  allowPrivateTargets: boolean;
  concurrency?: number;
}

export interface DeliveryWorkerHandle {
  close(): Promise<void>;
}

export function createDeliveryWorker({
  redisUrl,
  store,
  queue,
  allowPrivateTargets,
  concurrency = 10,
}: DeliveryWorkerOptions): DeliveryWorkerHandle {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const worker = new Worker<DeliveryJob>(
    DELIVERY_QUEUE,
    async (job) => {
      const result = await deliver(job.data, { store, queue, allowPrivateTargets, requireIntent: true });
      if (result.deferredUntil) {
        await job.moveToDelayed(Date.now() + Math.max(1, result.retryDelayMs ?? 0), job.token);
        throw new DelayedError();
      }
      return result;
    },
    { connection, concurrency, lockDuration: 30_000 },
  );

  worker.on("completed", (job, result) => console.log(JSON.stringify({ event: "job.completed", jobId: job.id, result })));
  worker.on("failed", (job, error) => console.error(JSON.stringify({ event: "job.failed", jobId: job?.id, error: error.message })));

  const publishHeartbeat = async () => {
    try {
      await queue.heartbeat("worker");
    } catch (error) {
      console.error(JSON.stringify({ event: "worker.heartbeat_failed", error: error instanceof Error ? error.message : "Unknown error" }));
    }
  };
  void publishHeartbeat();
  const heartbeatTimer = setInterval(() => void publishHeartbeat(), 15_000);
  heartbeatTimer.unref();

  console.log(JSON.stringify({ event: "worker.ready", queue: DELIVERY_QUEUE, concurrency }));
  return {
    async close() {
      clearInterval(heartbeatTimer);
      await worker.close();
      await connection.quit();
    },
  };
}

export async function startWorker(): Promise<void> {
  const config = loadConfig();
  await migrate(config.DATABASE_URL);
  const store = new PostgresStore(config.DATABASE_URL);
  const queue = new RedisDeliveryQueue(config.REDIS_URL);
  const worker = createDeliveryWorker({
    redisUrl: config.REDIS_URL,
    store,
    queue,
    allowPrivateTargets: config.ALLOW_PRIVATE_TARGETS,
  });

  const close = async () => {
    await worker.close();
    await queue.close();
    await store.close();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
