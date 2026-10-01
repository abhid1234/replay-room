import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeBaseUrl, parseArgs, runLiveCheck } from './check-live-deployment.mjs';

const REQUIRED_PATHS = [
  '/health',
  '/openapi.json',
  '/ingest/{ingestKey}',
  '/api/stats',
  '/api/system',
  '/api/endpoints',
  '/api/events',
  '/api/events/{eventId}/replay/preflight',
  '/api/events/{eventId}/rehearse',
  '/api/events/{eventId}/replay',
];

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

const SPACE_PROOF_LINKS = [
  'https://replay-room-web.onrender.com',
  'https://replay-room-api.onrender.com/openapi.json',
  'https://github.com/abhid1234/replay-room',
  'https://huggingface.co/datasets/abhid1234/replay-room-fixtures',
];

function fixtureFetch({ healthFailures = 0, missingPath = '', corsOrigin = 'https://console.example.com', spaceCapabilityLeak = '', missingProof = '' } = {}) {
  let healthAttempts = 0;
  return async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url === 'https://api.example.com/health') {
      healthAttempts += 1;
      if (healthAttempts <= healthFailures) return json({ status: 'degraded', error: 'warming' }, 503);
      return json({ status: 'ok', service: 'replay-room-api', dependencies: { databaseLatencyMs: 4, queueLatencyMs: 2 } });
    }
    if (url === 'https://api.example.com/openapi.json') {
      const paths = Object.fromEntries(REQUIRED_PATHS.filter((path) => path !== missingPath).map((path) => [path, {}]));
      return json({ openapi: '3.1.0', info: { title: 'Replay Room API', version: '0.1.2' }, paths });
    }
    if (url === 'https://console.example.com' && method === 'GET') {
      return new Response('<!doctype html><title>Replay Room</title><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url === 'https://space.example.com' && method === 'GET') {
      return new Response('<!doctype html><title>Replay Room</title><script type="module" src="/assets/index.js"></script><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html' } });
    }
    if (url === 'https://space.example.com/assets/index.js' && method === 'GET') {
      const proof = SPACE_PROOF_LINKS.filter((link) => link !== missingProof).join(' ');
      return new Response(`Public simulation No admin token is collected The demo is static. The evidence chain is not. ${proof} ${spaceCapabilityLeak}`, { status: 200, headers: { 'content-type': 'text/javascript' } });
    }
    if (url === 'https://api.example.com/api/stats' && method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': corsOrigin,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'authorization',
      } });
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  };
}

const config = {
  apiUrl: 'https://api.example.com',
  siteUrl: 'https://console.example.com',
  spaceUrl: 'https://space.example.com',
  expectedVersion: '0.1.2',
  timeoutMs: 10_000,
  intervalMs: 1_000,
  requestTimeoutMs: 2_000,
};

test('normalizes service origins and rejects unsafe base URLs', () => {
  assert.equal(normalizeBaseUrl('https://api.example.com/', '--api'), 'https://api.example.com');
  assert.throws(() => normalizeBaseUrl('ftp://api.example.com', '--api'), /http or https/);
  assert.throws(() => normalizeBaseUrl('https://user:secret@api.example.com', '--api'), /credentials/);
  assert.throws(() => normalizeBaseUrl('https://api.example.com/base', '--api'), /without a path/);
});

test('parses required targets and timing overrides', () => {
  assert.deepEqual(parseArgs([
    '--api', 'https://api.example.com/',
    '--site', 'https://console.example.com',
    '--space', 'https://space.example.com/',
    '--timeout-ms', '90000',
    '--interval-ms', '2000',
    '--request-timeout-ms', '7000',
    '--expected-version', '0.1.2',
  ]), {
    apiUrl: 'https://api.example.com', siteUrl: 'https://console.example.com', spaceUrl: 'https://space.example.com', expectedVersion: '0.1.2',
    timeoutMs: 90_000, intervalMs: 2_000, requestTimeoutMs: 7_000,
  });
});

test('waits through a cold start and verifies health, contract, console, and CORS', async () => {
  let now = 0;
  const result = await runLiveCheck(config, {
    fetch: fixtureFetch({ healthFailures: 2 }),
    now: () => now,
    sleep: async (milliseconds) => { now += milliseconds; },
  });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.coldStart, { attempts: 3, warmAfterMs: 2_000 });
  assert.equal(result.checks.health.databaseLatencyMs, 4);
  assert.equal(result.checks.openApi.requiredPaths, 10);
  assert.deepEqual(result.checks.space, {
    demoMode: true,
    credentialSurface: 'none',
    proofLinks: 4,
    scriptUrl: 'https://space.example.com/assets/index.js',
  });
  assert.equal(result.checks.cors.origin, 'https://console.example.com');
});

test('fails closed when the deployed OpenAPI surface is incomplete', async () => {
  await assert.rejects(
    runLiveCheck(config, { fetch: fixtureFetch({ missingPath: '/api/events/{eventId}/replay' }) }),
    /missing required paths.*replay/,
  );
});

test('fails closed when the API does not allow the deployed console origin', async () => {
  await assert.rejects(
    runLiveCheck(config, { fetch: fixtureFetch({ corsOrigin: 'https://wrong.example.com' }) }),
    /CORS origin.*expected/,
  );
});

test('fails closed when the Space bundle exposes operator capability', async () => {
  await assert.rejects(
    runLiveCheck(config, { fetch: fixtureFetch({ spaceCapabilityLeak: '/api/events' }) }),
    /exposes operator-console capability.*api\/events/,
  );
});

test('fails closed when the Space bundle loses a public proof link', async () => {
  await assert.rejects(
    runLiveCheck(config, { fetch: fixtureFetch({ missingProof: SPACE_PROOF_LINKS[3] }) }),
    /missing proof links.*replay-room-fixtures/,
  );
});
