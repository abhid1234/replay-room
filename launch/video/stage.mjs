// Stages the demo incidents on the local v0.3.0 stack: one endpoint whose receiver is down,
// Event A with an idempotency key (elevated risk) and Event B without one (high risk).
// Usage: ADMIN_TOKEN=... node launch/video/stage.mjs  (see launch/video/README.md)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const API = process.env.RR_API ?? "http://localhost:4000";
const out = process.env.RR_VIDEO_OUT ?? path.join(os.tmpdir(), "replay-room-video");
const token = process.env.ADMIN_TOKEN;
if (!token) throw new Error("Set ADMIN_TOKEN to the local API's admin token");
fs.mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(route, { method = "GET", body, headers = {}, auth = true } = {}) {
  const response = await fetch(`${API}${route}`, {
    method,
    headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

for (let i = 0; i < 60; i++) {
  try {
    const health = await call("/health", { auth: false });
    if (health.status === 200) { console.log("health", JSON.stringify(health.body)); break; }
  } catch { /* API still starting */ }
  await wait(1000);
}

const endpoint = await call("/api/endpoints", {
  method: "POST",
  body: { name: "Billing events (demo)", destinationUrl: "http://127.0.0.1:4000/demo/sink/retry", signatureProfile: "none", maxAttempts: 3 },
});
console.log("endpoint", endpoint.status, endpoint.body.id);
const ingest = (payload, key) => call(`/ingest/${endpoint.body.ingestKey}`, {
  method: "POST", auth: false, body: payload, headers: key ? { "Idempotency-Key": key } : {},
});

const a = await ingest({ type: "payment.captured", paymentId: "pay_demo_1042", amount: 4900, currency: "usd", customer: "cus_demo_77" }, "pay-1042-capture");
console.log("event A", a.status, JSON.stringify(a.body));
await wait(2500);
const b = await ingest({ type: "payment.captured", paymentId: "pay_demo_1043", amount: 12900, currency: "usd", customer: "cus_demo_81" });
console.log("event B", b.status, JSON.stringify(b.body));

let events = [];
for (let i = 0; i < 45; i++) {
  await wait(1000);
  events = (await call("/api/events?limit=10")).body;
  if (events.length >= 2 && events.every((event) => event.status === "dead_letter")) break;
}
for (const event of events) console.log(event.id.slice(0, 8), event.status, `${event.attemptCount} tries`, event.receivedAt);
const byTime = [...events].sort((x, y) => Date.parse(x.receivedAt) - Date.parse(y.receivedAt));
fs.writeFileSync(path.join(out, "staged.json"), JSON.stringify({ endpointId: endpoint.body.id, eventA: byTime[0]?.id, eventB: byTime[1]?.id }, null, 2));
console.log("staged", JSON.stringify({ eventA: byTime[0]?.id, eventB: byTime[1]?.id }));
