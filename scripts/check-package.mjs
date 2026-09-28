import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "replay-room-package-"));
const environment = { ...process.env, npm_config_cache: join(tmpdir(), "replay-room-npm-cache") };

try {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  const output = execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryDirectory], {
    encoding: "utf8",
    env: environment,
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
  assert.equal(pack.version, packageJson.version);
  for (const path of required) assert.ok(files.has(path), `package is missing ${path}`);
  for (const path of files) {
    assert.ok(!path.startsWith("tests/"), `package leaked test file ${path}`);
    assert.ok(!path.endsWith(".env"), `package leaked environment file ${path}`);
  }

  const tarball = join(temporaryDirectory, pack.filename);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", temporaryDirectory, tarball], {
    encoding: "utf8",
    env: environment,
  });

  const installRoot = join(temporaryDirectory, "node_modules", "@avee1234", "replay-room");
  const installed = await import(pathToFileURL(join(installRoot, "dist/index.js")).href);
  const fixture = JSON.parse(readFileSync("fixtures/incidents/payment-receiver-outage.json", "utf8"));
  const secret = "synthetic-package-smoke-secret-not-for-production";
  const bundle = installed.createEvidenceBundle(fixture.event, secret, fixture.generatedAt);
  assert.equal(installed.verifyEvidenceBundle(bundle, secret), true, "installed package rejected its own evidence bundle");
  assert.equal(installed.diagnoseEvent(fixture.event).code, "receiver_outage", "installed package diagnosis drifted");

  const evidencePath = join(temporaryDirectory, "incident.evidence.json");
  writeFileSync(evidencePath, JSON.stringify(bundle));
  const cliOutput = execFileSync(process.execPath, [join(installRoot, "dist/cli/verify-evidence.js"), "inspect", evidencePath], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(cliOutput), {
    file: evidencePath,
    validSchema: true,
    schemaVersion: "replay-room.evidence/v1",
    eventId: fixture.event.id,
    status: "dead_letter",
    diagnosis: "receiver_outage",
    replayRisk: "elevated",
    attempts: 3,
    rehearsals: 0,
    auditEntries: 1,
    contentSha256: bundle.integrity.contentSha256,
  });

  console.log(JSON.stringify({ package: "passed", name: pack.name, version: pack.version, files: pack.entryCount, size: pack.size, installSmoke: true }));
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
