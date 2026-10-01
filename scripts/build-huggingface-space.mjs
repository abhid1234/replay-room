#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const webRoot = resolve(root, 'web');
const outputRoot = resolve(root, '.artifacts', 'huggingface-space');

const spaceCard = `---
title: Replay Room
emoji: 🎛️
colorFrom: blue
colorTo: green
sdk: static
app_file: index.html
pinned: false
license: mit
short_description: Rehearse a webhook outage before production replay.
datasets:
  - abhid1234/replay-room-fixtures
---

# Replay Room

This public, static incident drill shows how Replay Room moves one webhook through durable receipt, bounded retries, dead-letter diagnosis, rehearsal, and a guarded production replay.

The operational stack runs on Render; this Space does not collect an admin token or expose operator controls.

- [Open the live Render console](https://replay-room-web.onrender.com)
- [Inspect the OpenAPI contract](https://replay-room-api.onrender.com/openapi.json)
- [Read the source](https://github.com/abhid1234/replay-room)
- [Explore the synthetic fixture dataset](https://huggingface.co/datasets/abhid1234/replay-room-fixtures)
`;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? collectFiles(path) : [path];
  }));
  return nested.flat().sort();
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

async function main() {
  process.env.VITE_DEMO_MODE = 'true';
  process.env.VITE_API_BASE = 'https://replay-room-api.onrender.com';

  await build({
    root: webRoot,
    configFile: resolve(webRoot, 'vite.config.ts'),
    build: { outDir: outputRoot, emptyOutDir: true },
  });
  await writeFile(resolve(outputRoot, 'README.md'), spaceCard);

  const files = await collectFiles(outputRoot);
  const relativeFiles = files.map((path) => relative(outputRoot, path));
  assert.ok(relativeFiles.includes('index.html'), 'Space bundle must include index.html');
  assert.ok(relativeFiles.includes('README.md'), 'Space bundle must include its metadata card');
  assert.ok(relativeFiles.some((path) => /^assets\/index-.*\.js$/.test(path)), 'Space bundle must include its JavaScript asset');
  assert.ok(relativeFiles.some((path) => /^assets\/index-.*\.css$/.test(path)), 'Space bundle must include its CSS asset');

  const textFiles = await Promise.all(files.filter((path) => /\.(?:html|js|css|md)$/.test(path)).map((path) => readFile(path, 'utf8')));
  const bundleText = textFiles.join('\n');
  for (const forbidden of [
    'replay-room-token',
    'Render-generated admin token',
    '/api/stats',
    '/api/events',
    'Authorization: Bearer',
  ]) {
    assert.ok(!bundleText.includes(forbidden), `Space bundle must not contain operator-console capability: ${forbidden}`);
  }
  assert.match(bundleText, /Public simulation/, 'Space bundle must be built in public demo mode');
  assert.match(bundleText, /No admin token is collected/, 'Space bundle must disclose its credential boundary');

  const bytes = (await Promise.all(files.map((path) => stat(path)))).reduce((sum, entry) => sum + entry.size, 0);
  const index = await readFile(resolve(outputRoot, 'index.html'));
  console.log(JSON.stringify({
    huggingFaceSpace: 'built',
    output: relative(root, outputRoot),
    files: relativeFiles.length,
    bytes,
    indexSha256: sha256(index),
    credentialSurface: 'none',
  }));
}

await main();
