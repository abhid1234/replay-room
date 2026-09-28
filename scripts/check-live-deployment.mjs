#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const REQUIRED_OPENAPI_PATHS = [
  "/health",
  "/openapi.json",
  "/ingest/{ingestKey}",
  "/api/stats",
  "/api/system",
  "/api/endpoints",
  "/api/events",
  "/api/events/{eventId}/rehearse",
  "/api/events/{eventId}/replay",
];

const DEFAULTS = {
  timeoutMs: 120_000,
  intervalMs: 3_000,
  requestTimeoutMs: 15_000,
};

export function normalizeBaseUrl(value, label) {
  if (!value) throw new Error(`${label} is required`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must use http or https`);
  if (url.username || url.password) throw new Error(`${label} must not contain credentials`);
  if (url.pathname !== '/' && url.pathname !== '') throw new Error(`${label} must be an origin without a path`);
  if (url.search || url.hash) throw new Error(`${label} must not contain a query or fragment`);
  return url.origin;
}

function positiveInteger(value, flag) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer`);
  return parsed;
}

export function parseArgs(args) {
  const options = { ...DEFAULTS, apiUrl: '', siteUrl: '', expectedVersion: '' };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help') return { help: true };
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (flag === '--api') options.apiUrl = normalizeBaseUrl(value, '--api');
    else if (flag === '--site') options.siteUrl = normalizeBaseUrl(value, '--site');
    else if (flag === '--expected-version') options.expectedVersion = value;
    else if (flag === '--timeout-ms') options.timeoutMs = positiveInteger(value, flag);
    else if (flag === '--interval-ms') options.intervalMs = positiveInteger(value, flag);
    else if (flag === '--request-timeout-ms') options.requestTimeoutMs = positiveInteger(value, flag);
    else throw new Error(`Unknown option: ${flag}`);
    index += 1;
  }
  options.apiUrl = normalizeBaseUrl(options.apiUrl, '--api');
  options.siteUrl = normalizeBaseUrl(options.siteUrl, '--site');
  return options;
}

async function fetchWithTimeout(fetchImpl, url, init, requestTimeoutMs) {
  return fetchImpl(url, { ...init, redirect: 'follow', signal: AbortSignal.timeout(requestTimeoutMs) });
}

async function jsonResponse(response, label) {
  try {
    return await response.json();
  } catch {
    throw new Error(`${label} did not return valid JSON`);
  }
}

async function waitForHealth(config, dependencies) {
  const startedAt = dependencies.now();
  const deadline = startedAt + config.timeoutMs;
  const attempts = [];
  let lastFailure = 'no response';

  while (dependencies.now() <= deadline) {
    const attemptStartedAt = dependencies.now();
    try {
      const response = await fetchWithTimeout(
        dependencies.fetch,
        `${config.apiUrl}/health`,
        { headers: { accept: 'application/json', 'user-agent': 'replay-room-live-check/1' } },
        config.requestTimeoutMs,
      );
      const body = await jsonResponse(response, '/health');
      const durationMs = dependencies.now() - attemptStartedAt;
      if (response.ok && body.status === 'ok' && body.service === 'replay-room-api') {
        attempts.push({ status: response.status, durationMs, result: 'healthy' });
        return { body, attempts, warmAfterMs: dependencies.now() - startedAt };
      }
      lastFailure = `HTTP ${response.status}: ${body.status ?? body.error ?? 'unexpected health response'}`;
      attempts.push({ status: response.status, durationMs, result: 'retry' });
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      attempts.push({ status: null, durationMs: dependencies.now() - attemptStartedAt, result: 'retry' });
    }

    const remainingMs = deadline - dependencies.now();
    if (remainingMs <= 0) break;
    await dependencies.sleep(Math.min(config.intervalMs, remainingMs));
  }

  throw new Error(`/health did not become ready within ${config.timeoutMs}ms (${lastFailure})`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export async function runLiveCheck(config, overrides = {}) {
  const dependencies = {
    fetch: overrides.fetch ?? globalThis.fetch,
    sleep: overrides.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))),
    now: overrides.now ?? (() => Date.now()),
  };
  const startedAt = dependencies.now();
  const health = await waitForHealth(config, dependencies);

  const openApiResponse = await fetchWithTimeout(
    dependencies.fetch,
    `${config.apiUrl}/openapi.json`,
    { headers: { accept: 'application/json', 'user-agent': 'replay-room-live-check/1' } },
    config.requestTimeoutMs,
  );
  assert(openApiResponse.ok, `/openapi.json returned HTTP ${openApiResponse.status}`);
  const openApi = await jsonResponse(openApiResponse, '/openapi.json');
  assert(openApi.openapi === '3.1.0', 'OpenAPI document is not version 3.1.0');
  assert(openApi.info?.title === 'Replay Room API', 'OpenAPI title does not identify Replay Room');
  assert(openApi.info?.version === config.expectedVersion, `OpenAPI version ${openApi.info?.version ?? 'missing'} does not match ${config.expectedVersion}`);
  const missingPaths = REQUIRED_OPENAPI_PATHS.filter((path) => !openApi.paths?.[path]);
  assert(missingPaths.length === 0, `OpenAPI document is missing required paths: ${missingPaths.join(', ')}`);

  const siteResponse = await fetchWithTimeout(
    dependencies.fetch,
    config.siteUrl,
    { headers: { accept: 'text/html', 'user-agent': 'replay-room-live-check/1' } },
    config.requestTimeoutMs,
  );
  assert(siteResponse.ok, `operator console returned HTTP ${siteResponse.status}`);
  const siteHtml = await siteResponse.text();
  assert(siteHtml.includes('<title>Replay Room</title>'), 'operator console title is missing');
  assert(/<div\s+id=["']root["']/.test(siteHtml), 'operator console root element is missing');

  const siteOrigin = new URL(config.siteUrl).origin;
  const corsResponse = await fetchWithTimeout(
    dependencies.fetch,
    `${config.apiUrl}/api/stats`,
    {
      method: 'OPTIONS',
      headers: {
        origin: siteOrigin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
        'user-agent': 'replay-room-live-check/1',
      },
    },
    config.requestTimeoutMs,
  );
  assert(corsResponse.ok, `CORS preflight returned HTTP ${corsResponse.status}`);
  const allowOrigin = corsResponse.headers.get('access-control-allow-origin');
  const allowMethods = corsResponse.headers.get('access-control-allow-methods') ?? '';
  const allowHeaders = corsResponse.headers.get('access-control-allow-headers') ?? '';
  assert(allowOrigin === siteOrigin, `CORS origin is ${allowOrigin ?? 'missing'}, expected ${siteOrigin}`);
  assert(allowMethods.toUpperCase().split(/\s*,\s*/).includes('GET'), 'CORS methods do not allow GET');
  assert(allowHeaders.toLowerCase().split(/\s*,\s*/).includes('authorization'), 'CORS headers do not allow authorization');

  return {
    schemaVersion: 'replay-room.live-check/v1',
    status: 'passed',
    checkedAt: new Date(dependencies.now()).toISOString(),
    durationMs: dependencies.now() - startedAt,
    targets: { api: config.apiUrl, site: config.siteUrl },
    coldStart: { attempts: health.attempts.length, warmAfterMs: health.warmAfterMs },
    checks: {
      health: {
        status: health.body.status,
        databaseLatencyMs: health.body.dependencies?.databaseLatencyMs,
        queueLatencyMs: health.body.dependencies?.queueLatencyMs,
      },
      openApi: { version: openApi.info.version, requiredPaths: REQUIRED_OPENAPI_PATHS.length },
      console: { title: 'Replay Room', rootMounted: true },
      cors: { origin: allowOrigin, allowsGet: true, allowsAuthorization: true },
    },
  };
}

function usage() {
  return `Usage: npm run smoke:live -- --api https://api.example.com --site https://app.example.com [options]\n\nOptions:\n  --expected-version <version>  Expected OpenAPI version (defaults to package version)\n  --timeout-ms <milliseconds>   Total cold-start allowance (default: 120000)\n  --interval-ms <milliseconds>  Delay between health attempts (default: 3000)\n  --request-timeout-ms <ms>     Timeout for each HTTP request (default: 15000)`;
}

export async function main(args = process.argv.slice(2)) {
  try {
    const options = parseArgs(args);
    if (options.help) {
      console.log(usage());
      return;
    }
    if (!options.expectedVersion) {
      const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
      options.expectedVersion = packageJson.version;
    }
    console.log(JSON.stringify(await runLiveCheck(options), null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      schemaVersion: 'replay-room.live-check/v1',
      status: 'failed',
      checkedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
