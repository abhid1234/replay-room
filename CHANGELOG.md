# Changelog

All notable changes to Replay Room are documented here.

## Unreleased

### Changed

- collapsed the operator console's five-request polling cycle into one versioned dashboard snapshot while retaining concurrent Postgres and Key Value reads;
- ran queue health and database/outbox health concurrently for lower system-snapshot latency;
- made console polling completion-paced, visibility-aware, and exponentially backed off after transient failures;
- patched direct and transitive runtime dependencies flagged by the npm security audit.

## 0.3.0 - 2026-10-18

### Added

- high-risk replay dual control with 30-minute approvals bound to the exact rehearsal, payload digest, and destination;
- an audited replay-approval API and explicit operator identity in the console;
- a ninth preflight condition that rejects missing, expired, drifted, or self-executed approvals.

### Changed

- the deployment doctor now requires the replay-approval OpenAPI path and `two-person-approval` launch capability.

## 0.2.0 - 2026-10-11

### Added

- a packaged `replay-room doctor` command that verifies the Render API, operator console, CORS contract, and credential-free Hugging Face demo as one launch surface;
- a public `replay-room.launch-proof/v1` manifest that binds a deployment's version, Render commit, console origin, capabilities, and safety posture;
- an operator ingest workbench with copy-ready idempotent cURL recipes and explicit provider-signature placeholders;
- regression coverage for release workflow security, credential storage, ingest recipes, launch proof, and deployment drift.

### Changed

- operator tokens are session-scoped by default, browser persistence requires explicit opt-in, and **Disconnect** clears credentials plus loaded incident state;
- legacy always-persistent browser tokens are automatically downgraded to the current session;
- release provenance and CycloneDX SBOMs use the unified `actions/attest@v4` path, with artifact downloads on `actions/download-artifact@v8`;
- Vite and its React plugin are classified as build-time dependencies, while Fastify integrations, BullMQ, Postgres, Zod, Vite, and Vitest are pinned to current compatible patch releases.

### Security

- upgraded `source-map-js` to `1.2.2` through the Vite/PostCSS toolchain to remediate GHSA-68fv-2mgg-jv7q;
- CI now audits the complete dependency graph, including build tooling, for high-severity advisories.

## 0.1.2 - 2026-10-01

### Added

- a public, credential-free Hugging Face outage drill built from the same inspected console bundle and linked to its live proof surfaces;
- a scheduled three-surface smoke check that verifies the Render API, Render console, and Hugging Face demo together;
- a side-effect-free replay preflight with an eight-condition operator decision trace;
- a DNS-pinned, dual-stack outbound HTTP client that preserves the original Host and TLS identity without following redirects or reusing a connection across validations;
- receiver-aware retry planning with bounded `Retry-After` support, database-enforced availability, per-event send serialization, and atomic audit evidence.

### Changed

- the newest rehearsal result is authoritative, so an older passing rehearsal cannot bypass a later failure;
- one delivery deadline now covers cancellable DNS resolution and the HTTP exchange, and outbound response capture is bounded to 4 KiB before it enters the incident ledger;
- the Render Blueprint now uses only Hobby-compatible service configuration;
- release verification now rejects version drift across the package, lockfile, OpenAPI contract, console workspace, and fixture corpus.

### Fixed

- the operator console stops authenticated polling after a rejected token instead of producing a stream of unauthorized requests.

## 0.1.1 - 2026-09-27

### Added

- cold-start-aware live deployment acceptance CLI and manual GitHub smoke workflow;
- machine-readable checks for dependency health, OpenAPI surface, console shell, and CORS wiring;
- deterministic Hugging Face dataset bundle with incident and replay-guard configurations;
- fixture safety gates, byte counts, SHA-256 manifests, and upload/readback documentation.

### Changed

- package verification now follows the version declared in `package.json` to prevent release-check drift;
- the full quality gate verifies live-smoke behavior and generated fixture freshness.

## 0.1.0 - 2026-09-27

### Added

- durable webhook receipt, idempotent ingest, retries, dead-letter state, and reconciliation;
- deterministic incident diagnosis and endpoint reliability runway;
- rehearsal-bound replay guard with append-only operator audit history;
- signed `replay-room.evidence/v1` bundles and offline verification CLI;
- free Render lab Blueprint with embedded worker and reconciler;
- Postgres and Redis integration CI, CodeQL, dependency audit, and container build;
- synthetic conformance fixtures, JSON Schema, package-content checks, and an attested release workflow;
- Postgres-backed delivery intents with queue-loss recovery, worker claims, stable job identities, duplicate replay suppression, and per-replay retry budgets;
- deterministic duplicate-side-effect risk assessment with explicit acknowledgement for ambiguous replays and portable evidence fixtures;
- endpoint-specific generic, GitHub, and timestamp-bound Stripe signature verification, outbound re-signing, and secret/header redaction.
