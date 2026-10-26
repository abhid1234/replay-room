# Press kit

## Product summary

Replay Room is an open-source safety system for failed webhooks. When a webhook appears to fail, the receiver may already have completed the real-world action, such as charging a card or shipping an order, before the connection broke. Blindly retrying can repeat that side effect. Replay Room records the original event and every delivery attempt, diagnoses the failure with deterministic rules, rehearses the exact recovery against a controlled destination, checks nine replay conditions, requires two different operators for high-risk replays, executes the replay through a durable Postgres delivery intent, and exports signed incident evidence.

> Replay Room turns a failed webhook from a blind resend into a rehearsed, evidence-backed production change.

## Build story

Replay Room was built by Abhi Das as an independent open-source project. It started from a pattern in public developer discussions about webhooks: capturing and resending events is a solved problem, but deciding whether a failed event is safe to send again is not. The common advice (keep a durable record, process idempotently, add a dead-letter queue, replay carefully) stops right where an operator has to make the call.

The project narrows that gap to one rule: an operator should have to prove a replay is safe, not merely click a resend button. It was also built to exercise Render as a platform rather than to run one process on it. The console, API, ledger, and queue each map to a Render primitive, and the free plans' real constraints (a sleeping web service, an in-memory queue, an expiring database) became test cases for the recovery design instead of footnotes.

The first release, `0.1.0`, shipped on 2026-09-27. Two-person approval for high-risk replays arrived in `0.3.0` on 2026-10-18. The project has no production users yet and is published to get feedback from people who operate webhooks.

## Technical facts

| Fact | Detail |
|---|---|
| License | MIT |
| Runtime | Node.js 22 or later, TypeScript |
| API | Fastify, with an OpenAPI 3.1 contract at `/openapi.json` |
| Queue | BullMQ on Render Key Value (Redis-compatible), used as disposable transport |
| Ledger | Render Postgres: events, delivery intents, attempts, rehearsals, approvals, and the append-only audit log, kept for a 30-day retention window by default |
| Console | React, built with Vite, on a Render static site |
| Delivery | At-least-once; bounded exponential backoff with jitter; `Retry-After` honored up to 15 minutes; default retry budget of 5 attempts |
| Replay guard | Nine conditions, available as a read-only preflight and re-checked on the server |
| Dual control | For high-risk replays, one operator records a 30-minute approval bound to the rehearsal, payload digest, and destination, and a different operator executes the replay. Operator identities are declared names under one shared admin token |
| Signatures | Generic HMAC, GitHub, and timestamp-bound Stripe verification on raw request bytes |
| Egress | DNS-pinned outbound sockets, private and reserved ranges blocked in production, no redirects followed |
| Evidence | `replay-room.evidence/v1`: a versioned JSON bundle whose canonical form carries a SHA-256 digest and an HMAC-SHA256 seal |
| Free topology | Four Render resources from one `render.yaml` Blueprint: static site, web service with embedded worker and reconciler, Postgres, Key Value |
| Hugging Face | A credential-free outage drill (Space) and a synthetic fixture dataset |
| Package | `@avee1234/replay-room`: schema, verifier CLI, fixtures, and deployment doctor. Not yet on npm; release tarballs are on GitHub |

## Verified proof points

Each point was read back on the date shown. Re-verify before quoting; see [README.md](README.md#claims-that-need-fresh-verification).

| Proof point | Evidence | Verified |
|---|---|---|
| 96 automated tests pass; 7 integration tests pass separately against Postgres 17 and Redis 8 | GitHub Actions `verify` run on `main` commit `5bd5af0` | 2026-10-26 |
| 9 deployment-smoke tests and 21 conformance checks (6 incident diagnoses, 6 replay-risk ratings, 9 replay-guard cases, across 15 fixtures) pass | The same CI run, and a local rerun of `npm run test:smoke` and `npm run conformance` | 2026-10-26 |
| CodeQL and the high-severity dependency audit are green on `main` | GitHub Actions on `5bd5af0` | 2026-10-26 |
| The live API is healthy, with Postgres and Key Value answering in 2 ms | `GET https://replay-room-api.onrender.com/health` | 2026-10-26 |
| The live deployment reports version `0.3.0`, commit `26c4cd6`, and the `two-person-approval` capability | `GET /.well-known/replay-room` | 2026-10-26 |
| The three-surface smoke check passed (API, console, CORS, and the credential-free Hugging Face drill), with a 12.5-second cold start | Scheduled `live deployment smoke` workflow | 2026-10-25 |
| The `v0.3.0` release carries the tarball (`sha256:17afb551…fbf95`) and a CycloneDX SBOM (`sha256:d029b0a1…07d67`); SLSA provenance and SBOM attestations exist for the tarball digest | GitHub release and attestations API | 2026-10-26 |

Do not quote these as current until the release train in [release-checklist.md](release-checklist.md) is done: the npm package (returns `E404`), a `v0.4.0` release (does not exist), the Hugging Face Space at the current version (serves a `v0.1.2` build), or the dataset at nine replay-guard cases (the public mirror is `0.2.0` with seven).

## Boilerplate

**Short (25 words):**

> Replay Room is a safety system for failed webhooks that records every attempt, rehearses the exact recovery, and blocks replay until nine deterministic conditions pass.

**Long (about 100 words):**

> Replay Room is an open-source safety system for failed webhooks. When a delivery appears to fail, the receiver may already have acted, so a blind retry can charge a customer twice or ship an order twice. Replay Room preserves the original event and every attempt, diagnoses the failure with deterministic rules, and requires a passing rehearsal bound to the exact payload and destination before any replay. Nine conditions gate each replay, and high-risk cases need a second operator. It runs on Render with Postgres as the source of truth and exports signed, verifiable incident evidence. It is MIT licensed.

## Contact

[[CONTACT]]

Source and issues: <https://github.com/abhid1234/replay-room>

## Asset inventory

| Asset | Path | Status |
|---|---|---|
| Open Graph image, 1200×630 | `launch/assets/og-image-1200x630.png` (source: `og-image.html`) | Ready |
| Social banner, 1100×220 | `launch/assets/social-banner-1100x220.png` (source: `social-banner.html`) | Ready |
| Architecture diagram | `diagrams/replay-room-render-architecture.png` and `.svg` | Ready |
| Architecture diagram, editable | `diagrams/replay-room-render-architecture.excalidraw` and `.mmd` | Ready |
| Product screenshots S01–S12 | `launch/assets/s01-…` to `s12-…` | Must capture from the live product; see [media-plan.md](media-plan.md) |
| Hero GIF and MP4 | `launch/assets/hero-drill-to-guard.gif` and `.mp4` | Must capture |
| Demo video | `[[DEMO_VIDEO_URL]]` | Must record; see [demo-script.md](demo-script.md) |
| Product Hunt gallery | `launch/assets/ph-01-og.png` to `ph-05-live-fabric.png` | Slide 1 can be made from the Open Graph image; the rest must be captured |

Image alt text for every asset is in [media-plan.md](media-plan.md).
