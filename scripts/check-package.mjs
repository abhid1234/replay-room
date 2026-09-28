import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const output = execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
  env: { ...process.env, npm_config_cache: join(tmpdir(), "replay-room-npm-cache") },
});
const [pack] = JSON.parse(output);
const files = new Set(pack.files.map((entry) => entry.path));
const required = [
  "dist/index.js",
  "dist/index.d.ts",
  "dist/cli/verify-evidence.js",
  "schema/replay-room-evidence-v1.schema.json",
  "fixtures/manifest.json",
  "fixtures/incidents/payment-receiver-outage.json",
  "README.md",
  "LICENSE",
];

assert.equal(pack.name, "@avee1234/replay-room");
assert.equal(pack.version, "0.1.0");
for (const path of required) assert.ok(files.has(path), `package is missing ${path}`);
for (const path of files) {
  assert.ok(!path.startsWith("tests/"), `package leaked test file ${path}`);
  assert.ok(!path.endsWith(".env"), `package leaked environment file ${path}`);
}

console.log(JSON.stringify({ package: "passed", name: pack.name, version: pack.version, files: pack.entryCount, size: pack.size }));
