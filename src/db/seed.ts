import { randomBytes } from "node:crypto";
import { loadConfig } from "../config.js";
import { PostgresStore } from "./postgres-store.js";

const config = loadConfig();
const store = new PostgresStore(config.DATABASE_URL);

try {
  const endpoints = await store.listEndpoints();
  if (endpoints.length === 0) {
    const endpoint = await store.createEndpoint({
      name: "Demo checkout",
      ingestKey: `demo_${randomBytes(8).toString("hex")}`,
      destinationUrl: "https://httpbin.org/status/200",
      signingSecret: null,
      maxAttempts: 5,
    });
    console.log(`Seeded endpoint ${endpoint.name} with ingest key ${endpoint.ingestKey}`);
  } else {
    console.log("Seed skipped: at least one endpoint already exists.");
  }
} finally {
  await store.close();
}
