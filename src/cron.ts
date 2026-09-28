import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { PostgresStore } from "./db/postgres-store.js";
import { migrate } from "./db/migrate.js";
import type { DeliveryQueue, Store } from "./domain/contracts.js";
import { RedisDeliveryQueue } from "./queue.js";

interface ReconcileDependencies {
  store: Store;
  queue: DeliveryQueue;
  retentionDays: number;
  now?: Date;
}

export async function reconcileOnce({ store, queue, retentionDays, now = new Date() }: ReconcileDependencies): Promise<{
  recovered: number;
  deleted: number;
}> {
  const pendingBefore = new Date(now.getTime() - 5 * 60_000).toISOString();
  const eventIds = await store.recoverPending(pendingBefore);
  for (const eventId of eventIds) {
    await queue.enqueue({ eventId, mode: "live", reason: "reconciled-pending-delivery" });
  }

  const retentionBefore = new Date(now.getTime() - retentionDays * 86_400_000).toISOString();
  const deleted = await store.deleteOlderThan(retentionBefore);
  await queue.heartbeat("cron");
  console.log(JSON.stringify({ event: "reconcile.completed", recovered: eventIds.length, deleted, at: now.toISOString() }));
  return { recovered: eventIds.length, deleted };
}

export async function reconcile(): Promise<void> {
  const config = loadConfig();
  await migrate(config.DATABASE_URL);
  const store = new PostgresStore(config.DATABASE_URL);
  const queue = new RedisDeliveryQueue(config.REDIS_URL);
  try {
    await reconcileOnce({ store, queue, retentionDays: config.RETENTION_DAYS });
  } finally {
    await queue.close();
    await store.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  reconcile().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
