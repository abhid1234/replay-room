# AgentRoute-standard launch matrix

AgentRoute is the benchmark for launch completeness: product, public proof, package, release, fixtures, and an explanation that makes the architecture legible. Replay Room applies the same standard without pretending that unfinished surfaces are live.

| Surface | Replay Room artifact | Current state | Exit evidence |
|---|---|---|---|
| Product | Fastify API, BullMQ delivery engine, Postgres ledger, React operator console | Implemented, locally verified, and deployed on Render | `npm run verify` plus the live deployment gate |
| Playground | [Public outage drill and live incident console](https://replay-room-web.onrender.com) on Render | Live; three-surface deployment gate passed on 2026-10-05 with OpenAPI `0.2.0` and launch proof bound to `1748eef` | Public URL, live dependency health, OpenAPI, launch proof, console, CORS, and Hugging Face boundary verification |
| GitHub | `abhid1234/replay-room` | Public `main` at `1748eef`; Verify and CodeQL passed on the exact merge commit | `main` contains the release source and required checks pass |
| Product site | [Render static site](https://replay-room-web.onrender.com) | Live from exact commit `1748eef` in deploy `dep-db209bss728c73ajmoeg` | Public landing page with architecture and links |
| npm | `@avee1234/replay-room` library and CLI | Name unclaimed; package gate passes; not published | Provenance-bearing registry version and install smoke test |
| Release | [v0.1.2](https://github.com/abhid1234/replay-room/releases/tag/v0.1.2) | Published from `af3592b`; tarball `6d0069f…edbb5` and SBOM `96400aa…becf0` match release metadata; SLSA and CycloneDX attestations verify | Public release, tarball, SBOM, and signed attestations |
| Fixtures | Synthetic incident corpus, conformance runner, and [Hugging Face dataset](https://huggingface.co/datasets/abhid1234/replay-room-fixtures) | Public at dataset commit `fc5a295`; the anonymous `0.2.0` manifest readback matches SHA-256 `56a8561…c2c92` | Public dataset mirror with byte-for-byte readback verification |
| Schema | `replay-room.evidence/v1` Zod and JSON Schema contracts | Implemented | Valid, malformed, and tampered conformance cases |
| Security | HMAC evidence, DNS-pinned no-redirect egress, redaction, CodeQL, dependency audit | Implemented; external egress policy remains a production defense-in-depth step | Clean automated gates and release review |
| Launch essay | `docs/LAUNCH.md` | Draft complete; not published | Reviewed public essay linked from repository |

## Release invariant

A launch claim is complete only when the durable external surface is reopened and verified. A successful build is not a deployment; a generated tarball is not a published package; a Render creation form is not a healthy service; and an uploaded fixture set is not a usable public dataset until its files can be read back.

## Next fixture cases

The public corpus should stay synthetic and add:

1. receiver outage (`503 -> 502 -> 503`);
2. rate limiting with `Retry-After`;
3. permanent contract rejection;
4. DNS or TLS network failure;
5. stuck worker claim recovered by reconciliation;
6. passing rehearsal followed by allowed replay;
7. payload drift blocked after rehearsal;
8. destination drift blocked after rehearsal.
