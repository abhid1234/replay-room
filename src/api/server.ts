import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { reconcileOnce } from "../cron.js";
import { PostgresStore } from "../db/postgres-store.js";
import { migrate } from "../db/migrate.js";
import { RedisDeliveryQueue } from "../queue.js";
import { createDeliveryWorker, type DeliveryWorkerHandle } from "../worker.js";
import { buildApp } from "./app.js";

export async function start(): Promise<void> {
  const config = loadConfig();
  await migrate(config.DATABASE_URL);
  const store = new PostgresStore(config.DATABASE_URL);
  const queue = new RedisDeliveryQueue(config.REDIS_URL);
  const app = await buildApp({ config, store, queue });
  let worker: DeliveryWorkerHandle | null = null;
  let reconcileTimer: NodeJS.Timeout | null = null;

  if (config.EMBEDDED_WORKER) {
    worker = createDeliveryWorker({
      redisUrl: config.REDIS_URL,
      store,
      queue,
      allowPrivateTargets: config.ALLOW_PRIVATE_TARGETS,
    });
    const runReconcile = async () => {
      try {
        await reconcileOnce({ store, queue, retentionDays: config.RETENTION_DAYS });
      } catch (error) {
        app.log.error({ err: error }, "embedded reconciliation failed");
      }
    };
    await runReconcile();
    reconcileTimer = setInterval(() => void runReconcile(), config.RECONCILE_INTERVAL_SECONDS * 1_000);
    reconcileTimer.unref();
  }

  const close = async () => {
    if (reconcileTimer) clearInterval(reconcileTimer);
    await app.close();
    await worker?.close();
    await queue.close();
    await store.close();
  };
  process.once("SIGTERM", () => void close());
  process.once("SIGINT", () => void close());

  await app.listen({ port: config.PORT, host: "0.0.0.0" });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  start().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
