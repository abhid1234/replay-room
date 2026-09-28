# The replay button is a production change

Webhook systems usually look reliable from the sender's side. Accept a request, put work on a queue, retry failures, and move exhausted work to a dead-letter queue. The architecture diagram is tidy.

The hard part starts when a real event is already in that dead-letter queue.

An operator sees a failed payment, shipment, or account update and has to answer questions the queue cannot answer: Did the receiver process the request before the timeout? Is the payload still valid? Has the destination changed? Will replaying it duplicate a side effect? Who approved the retry, and what evidence did they see?

Most webhook inspectors can resend. Replay Room is built around a stricter idea: **replay is a production change, so it should require evidence.**

## A flight recorder for every event

Replay Room persists the original webhook before acknowledging it. The durable record includes an idempotency key, redacted headers, the payload, and a SHA-256 digest. Every delivery attempt is appended with its mode, destination, response, error, and duration.

That transcript drives a deterministic diagnosis. A sequence of 5xx responses is a receiver outage. A 429 is throttling. A 4xx response is a contract or authentication rejection. Attempts that never receive HTTP responses point to DNS, TLS, firewall, or network reachability. The rules are small enough to explain during an incident and specific enough to recommend the next action.

No model gets to decide whether production traffic can be replayed.

## Rehearse the exact recovery

A dead-letter event cannot go directly back to production. The operator first runs a rehearsal against a controlled destination. Replay Room records whether that request passed and binds the evidence to two exact values:

- the original payload digest;
- the exact destination URL.

The replay guard then checks dead-letter state, operator identity, a meaningful reason, a passing rehearsal, payload equality, and destination equality. Any drift blocks the action and writes the rejection to the audit trail.

The result is intentionally inconvenient in one useful way: changing the target or payload invalidates the previous proof. The operator must rehearse again.

## Portable incident evidence

An incident should remain understandable after the dashboard closes. Replay Room exports a versioned JSON bundle containing the event identity, diagnosis, attempts, rehearsals, and audit history. The server canonicalizes that content, records its SHA-256 digest, and seals it with HMAC-SHA256.

The `@avee1234/replay-room` package exposes the schema and verifier:

```bash
npx @avee1234/replay-room inspect incident.evidence.json
EVIDENCE_SIGNING_SECRET=... npx @avee1234/replay-room verify incident.evidence.json
```

The CLI exits non-zero when the document is malformed, the content changes, or the seal does not match. It is deployment evidence, not a public timestamp or third-party attestation, and the distinction is documented.

## Built for Render's failure modes

The free evaluation topology uses four Render primitives: a static site, a free Docker web service, free Postgres, and free Key Value. To keep the deployment truly free, the web process embeds the BullMQ worker and ten-minute reconciler. The dashboard reports that topology explicitly.

This design also makes the limitations visible:

- the free web service spins down when idle;
- free Postgres expires after 30 days;
- free Key Value is in-memory and can lose queued work on restart.

Postgres is therefore the source of truth. Before a job reaches Key Value, Replay Room persists its exact delivery intent, stable queue key, retry ordinal, replay target, actor, and reason. The worker atomically claims that intent, so duplicate queue delivery cannot send it twice. The reconciler can later reconstruct pending or interrupted work from Postgres after queue loss. The free tier is not presented as production infrastructure; it is a concrete recovery test.

The production upgrade separates the API, worker, and cron responsibilities, uses backed-up Postgres and persistent Key Value, and adds stronger tenant authentication, secret encryption, and egress enforcement.

## Proof beyond the demo

The repository ships more than a UI:

- a versioned OpenAPI 3.1 contract;
- a strict runtime schema and public JSON Schema for evidence bundles;
- five synthetic incident fixtures covering outages, throttling, contract rejection, network failure, and active recovery;
- seven replay-guard conformance cases, including payload and destination drift;
- unit and API tests, plus CI against real Postgres 17 and Redis 8 service containers;
- dependency audit, CodeQL, a clean container build, package-content checks, registry integrity checks, a CycloneDX SBOM, and provenance-ready release automation;
- Mermaid, SVG, PNG, and editable Excalidraw architecture assets.

The public outage drill is still a simulation. The managed-service proof is still CI until the Render Blueprint is activated and its live URLs are reopened. Replay Room says those things plainly because operational software should be most precise when the demo is easiest to oversell.

The project starts with one question: before you press replay, what can you prove?
