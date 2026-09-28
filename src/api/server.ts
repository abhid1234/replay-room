import { fileURLToPath } from "node:url";
import { loadConfig } from "../config.js";
import { PostgresStore } from "../db/postgres-store.js";
import { migrate } from "../db/migrate.js";
import { RedisDeliveryQueue } from "../queue.js";
import { buildApp } from "./app.js";

export async function start(): Promise<void> {
  const config = loadConfig();
  await migrate(config.DATABASE_URL);
  const store = new PostgresStore(config.DATABASE_URL);
  const queue = new RedisDeliveryQueue(config.REDIS_URL);
  const app = await buildApp({ config, store, queue });

  const close = async () => {
    await app.close();
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
