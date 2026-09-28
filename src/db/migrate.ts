import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadConfig } from "../config.js";

const { Client } = pg;

export async function migrate(connectionString = loadConfig().DATABASE_URL): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('replay-room-migrations'))");
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const migrationsDirectory = fileURLToPath(new URL("./migrations/", import.meta.url));
    const names = (await readdir(migrationsDirectory)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    for (const name of names) {
      const existing = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [name]);
      if (existing.rowCount) continue;
      const sql = await readFile(fileURLToPath(new URL(`./migrations/${name}`, import.meta.url)), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations(name) VALUES($1)", [name]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('replay-room-migrations'))").catch(() => undefined);
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  migrate().then(() => console.log("Database migrations are current."));
}
