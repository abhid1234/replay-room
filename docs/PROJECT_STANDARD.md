# AgentRoute-standard launch matrix

AgentRoute is the benchmark for launch completeness: product, public proof, package, release, fixtures, and an explanation that makes the architecture legible. Replay Room applies the same standard without pretending that unfinished surfaces are live.

| Surface | Replay Room artifact | Current state | Exit evidence |
|---|---|---|---|
| Product | Fastify API, BullMQ delivery engine, Postgres ledger, React operator console | Implemented and locally verified | `npm run verify` |
| Playground | Public outage drill and live incident console on Render | Build-ready; public URL pending | Public URL plus cold-start and drill smoke test |
| GitHub | `abhid1234/replay-room` | Public repository; feature PR open | Reviewed merge to `main` and required checks |
| Product site | Render static site | Blueprint-ready; public URL pending | Public landing page with architecture and links |
| npm | `@avee1234/replay-room` library and CLI | Name unclaimed; package gate passes; not published | Provenance-bearing registry version and install smoke test |
| Release | Manual attested release workflow | Implemented; not run | GitHub release with tarball and CycloneDX SBOM |
| Fixtures | Synthetic incident corpus and conformance runner | One deterministic outage case implemented | Versioned manifest, expanded case coverage, optional public dataset mirror |
| Schema | `replay-room.evidence/v1` Zod and JSON Schema contracts | Implemented | Valid, malformed, and tampered conformance cases |
| Security | HMAC evidence, SSRF controls, redaction, CodeQL, dependency audit | Implemented with documented DNS TOCTOU limitation | Clean automated gates and release review |
| Launch essay | Draft narrative | Pending | Reviewed public essay linked from repository |

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
