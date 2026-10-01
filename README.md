# Replay Room

[![verify](https://github.com/abhid1234/replay-room/actions/workflows/ci.yml/badge.svg)](https://github.com/abhid1234/replay-room/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/abhid1234/replay-room?display_name=tag)](https://github.com/abhid1234/replay-room/releases/latest)

[Live console](https://replay-room-web.onrender.com) · [Interactive drill](https://huggingface.co/spaces/abhid1234/replay-room) · [API health](https://replay-room-api.onrender.com/health) · [OpenAPI](https://replay-room-api.onrender.com/openapi.json)

**Rehearse a failed webhook before you replay it.**

Replay Room is an operator console for the dangerous moment after an event lands in a dead-letter queue. It preserves the original payload, records every delivery attempt, requires a successful rehearsal against the exact destination and payload hash, and only then allows an audited replay.

This is a portfolio project built to exercise Render as a platform, not merely run one process on it.

## Why this project

Recent developer discussions keep converging on the same operational gap: receiving a webhook is easy; proving that a failed event is safe to replay is not. Basic inspectors can capture and resend. Replay Room adds the part an incident operator needs:

- immutable receipt of the original event;
- generic HMAC, GitHub, and timestamp-bound Stripe signature verification;
- idempotency-aware ingestion;
- async delivery with exponential backoff and jitter;
- a dead-letter state with complete attempt history;
- rehearsal against a controlled endpoint;
- a replay guard that binds approval to the rehearsed payload hash and destination;
- operator reason and append-only audit history;
- a Postgres delivery-intent outbox that survives queue loss, suppresses duplicate replay approvals, and lets reconciliation reconstruct exact jobs.

The research and product decisions are captured in [docs/RESEARCH.md](docs/RESEARCH.md). Provider setup and forwarding contracts are in [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md).

The synthetic incident and replay-guard corpus is published as the deterministic, two-configuration [Replay Room fixtures dataset](https://huggingface.co/datasets/abhid1234/replay-room-fixtures). Its generated manifest records record counts, byte lengths, and SHA-256 digests, while the build rejects secret-bearing or non-synthetic inputs. The separate [Replay Room Space](https://huggingface.co/spaces/abhid1234/replay-room) packages the outage drill as a public static demo without operator credentials or admin API capability. See [docs/FIXTURES.md](docs/FIXTURES.md) and [docs/HUGGINGFACE_SPACE.md](docs/HUGGINGFACE_SPACE.md) for the two surfaces and their verification paths.

## The incident flight recorder

The public dashboard opens with an interactive outage drill that follows a payment event through the real lifecycle vocabulary: durable receipt, worker claim, receiver failure, retry exhaustion, rehearsal, replay guard, and production delivery. It is explicitly labeled as a simulation and requires an operator action to run.

For live events, the API computes a deterministic diagnosis from the current state and attempt transcript. It distinguishes receiver outages, rate limiting, contract rejection, network failure, active recovery, and healthy delivery, then gives the operator evidence and a concrete next action. The rules are explainable and tested; no external model or hidden prompt decides whether a replay is safe.

The authenticated console also reads a live runtime snapshot instead of presenting a decorative architecture diagram. Postgres and Key Value latency come from direct dependency checks, BullMQ reports waiting/active/delayed/failed job counts, the durable outbox exposes pending/dispatched/processing/stale intent pressure, and the background worker and cron reconciler publish expiring heartbeats. On Render, the panel includes the service, instance, and Git commit injected into the running API.

Every incident can be downloaded as a signed evidence bundle. The JSON includes the original event identity and payload digest, diagnosis, full attempt transcript, rehearsal records, and audit history. A canonical HMAC-SHA256 seal detects any later modification. Endpoint signing secrets are never returned by the admin API or included in exports; the server reports only whether a secret is configured.

Operators with access to the deployment's evidence key can verify an exported bundle offline:

```bash
EVIDENCE_SIGNING_SECRET="$EVIDENCE_SIGNING_SECRET" npm run evidence:verify -- ./incident.evidence.json
```

The command prints machine-readable JSON and exits non-zero for a modified or malformed bundle.

The same validator is release-built as the publish-ready `@avee1234/replay-room` package. After registry publication is enabled, it will be available through:

```bash
npx @avee1234/replay-room inspect ./incident.evidence.json
EVIDENCE_SIGNING_SECRET="$EVIDENCE_SIGNING_SECRET" npx @avee1234/replay-room verify ./incident.evidence.json
```

The package includes TypeScript exports, the `replay-room.evidence/v1` JSON Schema, synthetic incident and replay-risk fixtures, and the CLI. Exact tarballs are available from [GitHub Releases](https://github.com/abhid1234/replay-room/releases) with CycloneDX SBOMs and signed SLSA and SBOM attestations. npm publication remains human-gated; this repository does not claim that the package is already in the registry.

The endpoint runway turns the durable ledger into a 24-hour reliability view for each destination. It reports event volume, terminal-delivery success rate, retrying and dead-letter counts, and p95 latency from successful live or replay attempts. Queued and in-flight events remain visible without incorrectly lowering the success rate.

Public ingest is protected by an atomic per-endpoint limit in Render Key Value. The default allows 600 requests per minute, works across horizontally scaled API instances, and returns `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` headers. Redis stores only a short hash of the ingest key, not the key itself.

## Render architecture

The default Blueprint is intentionally deployable on Render's free compute plans. The API process embeds the BullMQ worker and ten-minute reconciler so the lab does not quietly create paid background-worker or cron resources.

![Replay Room architecture: free Render lab, portable evidence, and production upgrade](diagrams/replay-room-render-architecture.svg)

The diagram is available as [Mermaid source](diagrams/replay-room-render-architecture.mmd), an [editable Excalidraw scene](diagrams/replay-room-render-architecture.excalidraw), SVG, and PNG.

The root [render.yaml](render.yaml) creates the free lab topology as one Blueprint:

| Render primitive | Replay Room responsibility |
|---|---|
| Static site | Operator dashboard |
| Free web service | Public ingest, admin API, queue consumer, and reconciliation loop |
| Postgres | Durable event, delivery-intent, attempt, rehearsal, and audit ledger |
| Key Value | Disposable BullMQ transport, delayed retries, heartbeats, and rate limits |

The free topology is honest about its constraints: the web service spins down after inactivity, Postgres expires after 30 days, and free Key Value is in-memory. Those failure modes are visible in the live fabric panel. For production, split `npm run start:worker` and `npm run start:cron` into dedicated paid resources so delivery processing is independent of HTTP traffic. See [docs/DEPLOYING.md](docs/DEPLOYING.md) for the upgrade path and cost guardrails.

## The guarded replay invariant

A replay is accepted only when all of these are true:

1. The event is in `dead_letter` state.
2. An operator supplied a meaningful reason and identity.
3. The latest rehearsal succeeded.
4. The event payload hash still matches the rehearsed hash.
5. The production replay destination exactly matches the rehearsed destination.
6. If prior receiver acceptance is ambiguous or no idempotency key exists, the operator explicitly acknowledges the duplicate-side-effect risk.

Every approval and rejection records the risk level and acknowledgement in the audit log. A replay intent is keyed to the passing rehearsal, so repeated approval clicks return the same durable intent instead of sending the event twice. Each replay cycle starts its own bounded retry budget while the cumulative attempt transcript remains intact.

## Quick start

Prerequisites: Node.js 22+, Docker, and Docker Compose.

```bash
cp .env.example .env
docker compose up -d
npm install
npm run db:migrate
npm run db:seed
```

Run the three processes in separate terminals:

```bash
npm run dev
npm run dev:worker
npm run dev:web
```

Open `http://localhost:5173`, enter the `ADMIN_TOKEN` from `.env`, and create an endpoint. For local failure testing, use one of the built-in development sinks:

- `http://localhost:4000/demo/sink/accept`
- `http://localhost:4000/demo/sink/retry`
- `http://localhost:4000/demo/sink/reject`

Send an event:

```bash
curl -X POST http://localhost:4000/ingest/YOUR_INGEST_KEY \
  -H 'content-type: application/json' \
  -H 'idempotency-key: checkout-1042' \
  -d '{"type":"checkout.completed","orderId":"ord_1042","amount":12900}'
```

## API surface

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Database-backed health check |
| `GET` | `/openapi.json` | Versioned OpenAPI 3.1 contract |
| `POST` | `/ingest/:ingestKey` | Accept and deduplicate an event |
| `GET` | `/api/stats` | Dashboard status counts |
| `GET` | `/api/system` | Dependency latency, queue pressure, service heartbeats, and deploy identity |
| `GET/POST` | `/api/endpoints` | List or create ingest endpoints |
| `GET` | `/api/endpoints/reliability` | Per-destination volume, delivery rate, recovery state, and p95 latency |
| `GET` | `/api/events` | List recent events |
| `GET` | `/api/events/:id` | Event, attempts, rehearsals, and audit trail |
| `GET` | `/api/events/:id/evidence` | Download the HMAC-sealed incident evidence bundle |
| `POST` | `/api/events/:id/rehearse` | Queue a safe rehearsal |
| `POST` | `/api/events/:id/replay` | Run the replay guard and queue an approved replay |

Admin routes require `Authorization: Bearer $ADMIN_TOKEN`. Set `x-operator` when taking an operator action.

## Security boundaries

- Sensitive request headers are redacted before storage.
- Endpoint signing secrets remain server-side and are redacted from every API response and evidence export.
- Payloads are capped at 256 KiB by default.
- Per-endpoint ingest limits reject overload before database or queue writes.
- Redis-backed operator limits reject abusive authenticated reads before database work.
- Endpoint-specific signature profiles support Replay Room HMAC (`x-replay-signature`), GitHub (`x-hub-signature-256`), and timestamp-bound Stripe signatures. Signature headers are redacted before storage.
- Literal and DNS-resolved private, loopback, link-local, reserved, credential-bearing, and non-HTTP destinations are blocked in production.
- Network calls time out after 10 seconds.
- Response bodies are truncated before storage.
- Replays cannot bypass rehearsal, payload binding, destination binding, or dead-letter state.
- Postgres-backed delivery-intent claims suppress duplicate queue execution and preserve exact replay metadata through Key Value loss.
- Incident exports use a separately generated evidence-signing secret and disable response caching.

This is an early-stage project. Production hardening would add organization-scoped authorization, encryption for stored payloads and endpoint secrets, DNS pinning to remove the residual lookup-to-connect rebinding window, and configurable retention by tenant.

## Verification

```bash
npm run verify
```

The verification gate type-checks the API/worker/cron code, runs domain, API, delivery-intent race, queue-loss recovery, diagnosis, heartbeat, free-runtime, live-smoke contract, schema-conformance, registry-safety, and package-content tests, and builds the production API and dashboard bundles.

After the public surfaces are live, one command produces machine-readable deployment evidence while tolerating a free-tier cold start. It verifies the Render API and console plus the Hugging Face demo's credential boundary and four proof links:

```bash
npm run smoke:live -- \
  --api https://YOUR-API.onrender.com \
  --site https://YOUR-CONSOLE.onrender.com \
  --space https://YOUR-SPACE.static.hf.space
```

The current public deployment passed this gate on 2026-09-28 against `https://replay-room-api.onrender.com` and `https://replay-room-web.onrender.com`. It verified live Postgres and Key Value health, all nine required OpenAPI paths, the mounted console, and the console's exact CORS policy.

GitHub Actions runs the repository verification gate on every branch push and pull request, exercises the persistence layer against Postgres 17 and Redis 8 service containers, audits production dependencies at high severity, builds the release Docker image, and runs CodeQL. A separate daily and manually dispatchable live-smoke workflow checks Render and Hugging Face for post-deploy drift. The release workflow prepares an attested npm tarball and CycloneDX SBOM; npm publication and GitHub release creation are independent explicit inputs. Each [GitHub release](https://github.com/abhid1234/replay-room/releases) identifies its exact source commit, and both attestations are independently verifiable against the published tarball digest.

## Interview walkthrough

1. Run the public outage drill and narrate how each checkpoint maps to Render.
2. Send a webhook to the `retry` demo sink and show the immediate `202` response.
3. Let the worker exhaust retries into `dead_letter`.
4. Open the flight-recorder diagnosis and complete attempt timeline.
5. Rehearse against the accepting sink.
6. Try to replay to a different destination and show the deterministic guard rejection.
7. Replay to the rehearsed destination with an operator reason.
8. Open `render.yaml` and map each behavior to its Render service.

## Status

Version `0.1.1` is a public, attested GitHub release and the current production-shaped release line. The free Render Blueprint is live and passed the repository's end-to-end deployment gate on commit `43cca36`; the public Hugging Face Space runs the credential-free outage drill from a reproducible, CI-inspected bundle. This remains an evaluation deployment, not a production SLA, and the npm package is not yet published.

## License

MIT
