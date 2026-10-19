# AgentRoute-standard launch matrix

AgentRoute is the benchmark for launch completeness: product, public proof, package, release, fixtures, and an explanation that makes the architecture legible. Replay Room applies the same standard without pretending that unfinished surfaces are live.

| Surface | Replay Room artifact | Current state | Exit evidence |
|---|---|---|---|
| Product | Fastify API, BullMQ delivery engine, Postgres ledger, React operator console | Implemented, locally verified, and deployed on Render | `npm run verify` plus the live deployment gate |
| Playground | [Public outage drill and live incident console](https://replay-room-web.onrender.com) on Render | Live; three-surface deployment gate passed on 2026-10-18 with OpenAPI `0.3.0`, twelve required paths, and launch proof bound to exact commit `26c4cd648aae0e074767345b8bfa80ce777fa27a` | Public URL, live dependency health, OpenAPI, launch proof, console, CORS, and Hugging Face boundary verification |
| GitHub | `abhid1234/replay-room` | Public `main` contains the `0.3.0` release source at `26c4cd648aae0e074767345b8bfa80ce777fa27a`; Verify and CodeQL passed on that exact merge commit | `main` contains the release source and required checks pass |
| Product site | [Render static site](https://replay-room-web.onrender.com) | Live from exact commit `26c4cd648aae0e074767345b8bfa80ce777fa27a` in deploy `dep-dbap3gui0phs73a1sea0`; API deploy `dep-dbap3gnbtjjs7381qhl0` serves the same commit | Public landing page with architecture and links |
| npm | `@avee1234/replay-room` library and CLI | Version `0.3.0` passes the package gate; a fresh registry readback on 2026-10-18 returned `404`, so it is not yet published | Provenance-bearing registry version and install smoke test |
| Release | [v0.3.0](https://github.com/abhid1234/replay-room/releases/tag/v0.3.0) | Published from exact source `26c4cd648aae0e074767345b8bfa80ce777fa27a`; downloaded tarball `17afb551…fbf95` and SBOM `d029b0a1…07d67` match release metadata; SLSA provenance and the CycloneDX attestation verify | Public release, tarball, SBOM, and signed attestations |
| Fixtures | Synthetic incident corpus, conformance runner, and [Hugging Face dataset](https://huggingface.co/datasets/abhid1234/replay-room-fixtures) | Public at dataset commit `fc5a295`; the anonymous `0.2.0` manifest readback matches SHA-256 `56a8561…c2c92` | Public dataset mirror with byte-for-byte readback verification |
| Schema | `replay-room.evidence/v1` Zod and JSON Schema contracts | Implemented | Valid, malformed, and tampered conformance cases |
| Security | HMAC evidence, DNS-pinned no-redirect egress, redaction, CodeQL, dependency audit | Implemented; external egress policy remains a production defense-in-depth step | Clean automated gates and release review |
| Launch essay | `docs/LAUNCH.md` | Draft complete; not published | Reviewed public essay linked from repository |

## Release invariant

A launch claim is complete only when the durable external surface is reopened and verified. A successful build is not a deployment; a generated tarball is not a published package; a Render creation form is not a healthy service; and an uploaded fixture set is not a usable public dataset until its files can be read back.

## Current replay-guard fixture cases

The deterministic `0.3.0` bundle remains synthetic and covers:

1. receiver outage (`503 -> 502 -> 503`);
2. rate limiting with `Retry-After`;
3. permanent contract rejection;
4. DNS or TLS network failure;
5. stuck worker claim recovered by reconciliation;
6. passing rehearsal followed by allowed replay;
7. payload drift blocked after rehearsal;
8. destination drift blocked after rehearsal;
9. high-risk replay blocked without approval and allowed only after a distinct operator records a bound approval.
