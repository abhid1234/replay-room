#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixturesRoot = resolve(root, 'fixtures');
const outputRoot = resolve(fixturesRoot, 'huggingface');
const dataRoot = resolve(outputRoot, 'data');

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

function jsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function assertSyntheticIncident(id, fixture) {
  const endpoint = fixture.event?.endpoint;
  assert.ok(endpoint, `${id}: endpoint is missing`);
  const destination = new URL(endpoint.destinationUrl);
  assert.ok(destination.hostname.endsWith('.example'), `${id}: destination must use the reserved .example domain`);
  assert.equal(endpoint.signingSecret, null, `${id}: signing secrets must not enter the public fixture corpus`);
  assert.ok(endpoint.ingestKey.startsWith('fixture_'), `${id}: ingest key must be visibly synthetic`);
  const sensitiveHeaders = Object.keys(fixture.event.headers ?? {}).filter((header) => /authorization|cookie|signature|token/i.test(header));
  assert.deepEqual(sensitiveHeaders, [], `${id}: sensitive-looking headers are not allowed`);
}

async function buildDataset() {
  const manifest = await readJson(resolve(fixturesRoot, 'manifest.json'));
  assert.equal(manifest.synthetic, true, 'source fixture manifest must be explicitly synthetic');
  assert.equal(manifest.license, 'MIT', 'source fixture license must stay MIT');

  const incidentRecords = [];
  const incidentIds = new Set();
  for (const fixtureCase of manifest.cases) {
    assert.ok(!incidentIds.has(fixtureCase.id), `duplicate incident id: ${fixtureCase.id}`);
    incidentIds.add(fixtureCase.id);
    const fixture = await readJson(resolve(fixturesRoot, fixtureCase.file));
    assertSyntheticIncident(fixtureCase.id, fixture);
    incidentRecords.push({
      id: fixtureCase.id,
      expectedDiagnosis: fixtureCase.expectedDiagnosis,
      expectedRisk: fixtureCase.expectedRisk,
      generatedAt: fixture.generatedAt,
      event: fixture.event,
    });
  }

  const replayGuard = await readJson(resolve(fixturesRoot, manifest.replayGuardFile));
  const guardIds = new Set();
  const replayGuardRecords = replayGuard.cases.map((guardCase) => {
    assert.ok(!guardIds.has(guardCase.id), `duplicate replay guard id: ${guardCase.id}`);
    guardIds.add(guardCase.id);
    if (guardCase.rehearsal) {
      const destination = new URL(guardCase.rehearsal.destinationUrl);
      assert.ok(destination.hostname.endsWith('.example'), `${guardCase.id}: rehearsal destination must use .example`);
    }
    const requestDestination = new URL(guardCase.request.destinationUrl);
    assert.ok(requestDestination.hostname.endsWith('.example'), `${guardCase.id}: request destination must use .example`);
    return {
      id: guardCase.id,
      event: { ...replayGuard.event, ...(guardCase.eventPatch ?? {}) },
      rehearsal: guardCase.rehearsal,
      request: guardCase.request,
      expected: guardCase.expected,
    };
  });

  const files = {
    'data/incidents.jsonl': jsonLines(incidentRecords),
    'data/replay-guard.jsonl': jsonLines(replayGuardRecords),
  };
  const datasetManifest = {
    schemaVersion: 'replay-room.fixture-dataset/v1',
    name: 'Replay Room incident and replay guard fixtures',
    version: manifest.version,
    license: manifest.license,
    synthetic: true,
    source: 'https://github.com/abhid1234/replay-room',
    recordCounts: { incidents: incidentRecords.length, replayGuard: replayGuardRecords.length },
    files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, { bytes: Buffer.byteLength(content), sha256: sha256(content) }])),
  };
  files['dataset-manifest.json'] = `${JSON.stringify(datasetManifest, null, 2)}\n`;
  return { files, datasetManifest };
}

async function main() {
  const checkOnly = process.argv.slice(2).includes('--check');
  const unknown = process.argv.slice(2).filter((argument) => argument !== '--check');
  assert.deepEqual(unknown, [], `unknown arguments: ${unknown.join(', ')}`);
  const { files, datasetManifest } = await buildDataset();

  if (checkOnly) {
    for (const [relativePath, expected] of Object.entries(files)) {
      const actual = await readFile(resolve(outputRoot, relativePath), 'utf8');
      assert.equal(actual, expected, `${relativePath} is stale; run npm run fixtures:build`);
    }
    const card = await readFile(resolve(outputRoot, 'README.md'), 'utf8');
    assert.match(card, /synthetic/i, 'dataset card must disclose that every record is synthetic');
  } else {
    await mkdir(dataRoot, { recursive: true });
    await Promise.all(Object.entries(files).map(([relativePath, content]) => writeFile(resolve(outputRoot, relativePath), content)));
  }

  console.log(JSON.stringify({
    fixtureDataset: checkOnly ? 'verified' : 'built',
    schemaVersion: datasetManifest.schemaVersion,
    version: datasetManifest.version,
    records: datasetManifest.recordCounts,
    files: Object.keys(files).length,
  }));
}

await main();
