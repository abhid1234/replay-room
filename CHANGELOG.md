# Changelog

All notable changes to Replay Room are documented here.

## Unreleased

### Added

- a side-effect-free replay preflight with an eight-condition operator decision trace;
- a DNS-pinned, dual-stack outbound HTTP client that preserves the original Host and TLS identity without following redirects or reusing a connection across validations.

### Changed

- the newest rehearsal result is authoritative, so an older passing rehearsal cannot bypass a later failure;
- one delivery deadline now covers cancellable DNS resolution and the HTTP exchange, and outbound response capture is bounded to 4 KiB before it enters the incident ledger.

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
