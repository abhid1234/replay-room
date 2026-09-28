import { fileURLToPath } from "node:url";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig } from "./config.js";
import { PostgresStore } from "./db/postgres-store.js";
import { migrate } from "./db/migrate.js";
import { deliver } from "./delivery.js";
import type { DeliveryJob } from "./domain/contracts.js";
import { DELIVERY_QUEUE, RedisDeliveryQueue } from "./queue.js";

export async function startWorker(): Promise<void> {
  const config = loadConfig();
  await migrate(config.DATABASE_URL);
  const store = new PostgresStore(config.DATABASE_URL);
  const queue = new RedisDeliveryQueue(config.REDIS_URL);
  const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const worker = new Worker<DeliveryJob>(
    DELIVERY_QUEUE,
    async (job) => deliver(job.data, { store, queue, allowPrivateTargets: config.ALLOW_PRIVATE_TARGETS }),
    { connection, concurrency: 10, lockDuration: 30_000 },
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
  await publishHeartbeat();
  const heartbeatTimer = setInterval(() => void publishHeartbeat(), 15_000);
  heartbeatTimer.unref();

  const close = async () => {
    clearInterval(heartbeatTimer);
    await worker.close();
    await queue.close();
    await connection.quit();
    await store.close();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());
  console.log(JSON.stringify({ event: "worker.ready", queue: DELIVERY_QUEUE, concurrency: 10 }));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startWorker().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
