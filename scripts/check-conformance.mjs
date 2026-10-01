import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEvidenceBundle,
  evaluateReplay,
  parseEvidenceBundle,
  verifyEvidenceBundle,
} from "../dist/index.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "fixtures/manifest.json"), "utf8"));
const fixtureSecret = "synthetic-fixture-secret-not-for-production-use";

assert.equal(manifest.synthetic, true, "fixture manifest must identify synthetic data");
assert.ok(manifest.cases.length > 0, "fixture manifest must contain at least one case");

for (const fixtureCase of manifest.cases) {
  const fixture = JSON.parse(await readFile(resolve(root, "fixtures", fixtureCase.file), "utf8"));
  const bundle = createEvidenceBundle(fixture.event, fixtureSecret, fixture.generatedAt);
  const parsed = parseEvidenceBundle(bundle);

  assert.equal(parsed.diagnosis.code, fixtureCase.expectedDiagnosis, `${fixtureCase.id}: diagnosis drifted`);
  assert.equal(parsed.replayRisk.level, fixtureCase.expectedRisk, `${fixtureCase.id}: replay risk drifted`);
  assert.equal(verifyEvidenceBundle(parsed, fixtureSecret), true, `${fixtureCase.id}: valid seal rejected`);

  const tampered = structuredClone(parsed);
  tampered.event.payload = { changed: true };
  assert.equal(verifyEvidenceBundle(tampered, fixtureSecret), false, `${fixtureCase.id}: tampering was not detected`);

  const malformed = structuredClone(parsed);
  delete malformed.integrity;
  assert.throws(() => parseEvidenceBundle(malformed), `${fixtureCase.id}: malformed bundle passed schema validation`);
}

const guardFixture = JSON.parse(await readFile(resolve(root, "fixtures", manifest.replayGuardFile), "utf8"));
for (const guardCase of guardFixture.cases) {
  const event = { ...guardFixture.event, ...(guardCase.eventPatch ?? {}) };
  const decision = evaluateReplay(event, guardCase.rehearsal, guardCase.request);
  const actual = {
    allowed: decision.allowed,
    reasons: decision.reasons,
    checks: Object.fromEntries(decision.checks.map((check) => [check.code, check.status])),
  };
  assert.deepEqual(actual, guardCase.expected, `${guardCase.id}: replay guard decision drifted`);
}

console.log(JSON.stringify({
  conformance: "passed",
  incidentCases: manifest.cases.length,
  replayRiskCases: manifest.cases.length,
  replayGuardCases: guardFixture.cases.length,
  schemaVersion: "replay-room.evidence/v1",
}));
