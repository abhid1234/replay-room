# Messaging

Single source for Replay Room's launch language. Every other file in `launch/` reuses these lines. If a line changes here, change it everywhere.

## Pitch

**One sentence (canonical):**

> Replay Room turns a failed webhook from a blind resend into a rehearsed, evidence-backed production change.

**Supporting line:**

> Rehearse a failed webhook before you replay it.

**Plain-English line:**

> Replay Room is a safety system for failed webhooks.

**Architecture line:**

> Redis can disappear. The operator should still be able to reconstruct exactly what must happen next.

## Descriptions

### 25 words

Replay Room is a safety system for failed webhooks that records every attempt, rehearses the exact recovery, and blocks replay until nine deterministic conditions pass.

### 50 words

Replay Room is a safety system for failed webhooks. It persists each event, records every delivery attempt, diagnoses the failure, and rehearses the exact payload against a controlled destination. A replay runs only after nine deterministic conditions pass, high-risk replays need a second operator, and incidents export as signed evidence.

### 100 words

When a webhook appears to fail, the receiver may already have charged the card or shipped the order before the connection broke. Blindly retrying can repeat that side effect. Replay Room is a safety system for that moment. It persists the original event before acknowledging it, records every delivery attempt, and gives a deterministic, explainable diagnosis. Recovery starts with a rehearsal bound to the exact payload hash and destination. A side-effect-free preflight checks nine conditions, and high-risk cases need a second operator. The replay runs through a durable Postgres intent, and the whole incident exports as a signed evidence bundle.

### Technical description

Replay Room is an open-source webhook incident console: a Fastify API, a BullMQ delivery engine, and a React operator console. It runs on Render as a static site, a web service, Postgres, and Key Value. Ingest verifies generic HMAC, GitHub, and timestamp-bound Stripe signatures, redacts sensitive headers, and commits the event plus a uniquely keyed delivery intent to Postgres before Key Value sees the job. Workers atomically claim intents, retry with bounded exponential backoff and `Retry-After` support, and preserve the full attempt transcript after dead-lettering.

Recovery is gated. A rehearsal records a pass or fail bound to the payload's SHA-256 digest and the exact destination URL. A read-only preflight evaluates nine conditions: reason, identity, rehearsal existence, rehearsal outcome, payload binding, destination binding, dead-letter state, duplicate-risk acknowledgement, and two-person approval. The replay endpoint re-runs the same guard on the server. Outbound delivery is DNS-pinned, never follows redirects, and blocks private ranges in production. Evidence bundles are versioned JSON whose canonical form is hashed and sealed with HMAC-SHA256. Delivery is at-least-once; the product makes duplicate risk explicit rather than claiming to remove it.

### Nontechnical description

Apps tell each other about payments, orders, and account changes through messages called webhooks. Sometimes a message seems to fail, but the other side may have already acted on it. If someone simply sends it again, a customer can be charged twice. Replay Room is a safety system for that moment. It keeps a complete record of what happened, tests the fix safely first, checks a short list of conditions, and asks a second operator to sign off when the risk is high. Afterwards, it produces a tamper-evident record of the whole incident.

## Three differentiators

1. **Replay is bound to rehearsal evidence.** A passing rehearsal is tied to the exact payload digest and destination. Change either one and the proof no longer applies; the operator must rehearse again. The newest rehearsal is authoritative, so an old pass cannot cover a newer failure.
2. **Ambiguity is made explicit, not hidden.** Replay Room derives a deterministic duplicate-side-effect risk from the attempt transcript. When the risk is high (no idempotency key, no HTTP response, or a prior 2xx), the operator must acknowledge it; one operator records a 30-minute approval bound to the same rehearsal, payload, and destination, and a different operator executes the replay.
3. **Postgres is the source of truth, and the evidence travels.** Every delivery intent is stored in Postgres before the queue sees it, so losing Key Value becomes a recovery step instead of lost work. Every incident exports as a signed, versioned evidence bundle that can be inspected and verified offline.

## Five headline options

1. Rehearse a failed webhook before you replay it
2. The replay button is a production change
3. A timeout doesn't prove the receiver did nothing
4. Before you press replay, what can you prove?
5. Your dead-letter queue can't tell you whether the card was charged

## Five subtitle options

1. Replay Room turns a failed webhook from a blind resend into a rehearsed, evidence-backed production change.
2. An open-source flight recorder and rehearsal room for webhooks, built on Render.
3. Nine deterministic checks, a second operator for high-risk cases, and signed evidence for every incident.
4. Queues preserve work. They don't prove a replay is safe.
5. Redis can disappear. Postgres still knows exactly what must happen next.

## Proof points safe to cite

Re-verify each one with the command in [README.md](README.md#claims-that-need-fresh-verification) on the day you post.

- Nine replay-guard conditions, evaluated identically in a read-only preflight and again on the server before any replay.
- High-risk replays need a 30-minute approval bound to the exact rehearsal, payload digest, and destination, and a different operator must execute them.
- 96 automated tests, 9 deployment-smoke tests, and 21 conformance checks (6 incident diagnoses, 6 replay-risk ratings, 9 replay-guard cases) pass in CI on `main`.
- Integration tests run in CI against real Postgres 17 and Redis 8 service containers.
- The live Render API reports its version and Git commit at `/.well-known/replay-room`.

## Language to avoid

| Avoid | Why | Say instead |
|---|---|---|
| "exactly-once delivery" | Delivery is at-least-once; a receiver can act and the worker can crash before recording the response. | "at-least-once delivery that makes duplicate risk explicit" |
| "prevents duplicate charges" / "eliminates duplicates" | Replay Room cannot know every receiver's side effects. | "makes duplicate-side-effect risk visible and gates the replay on it" |
| "production-ready" / "enterprise-grade" | The public deployment is a free evaluation topology with one shared admin token. | "an evaluation deployment with a documented production upgrade" |
| "AI-powered", "smart", "intelligent diagnosis" | No model is involved. The diagnosis is a set of deterministic rules. | "deterministic, explainable diagnosis" |
| "live incident data" / "real outage" for the drill | The public outage drill is a labeled simulation. | "a simulated outage drill that uses the real lifecycle vocabulary" |
| "install it from npm" before readback | `@avee1234/replay-room` returned E404 on 2026-10-26. | Use the `[[NPM_LINE]]` placeholder until `npm view` returns the version. |
| "v0.4.0 is live" | No v0.4.0 release, deployment, or package exists yet. | Name a version only after public readback. |
| "unlimited free hosting" / "Render free tier is enough for production" | Free services spin down, free Postgres expires after 30 days, free Key Value is in-memory. | "runs on Render's free plans for evaluation" |
| "two-factor approval" / "authenticated dual control" | Operators share one admin token; identities are declared labels. | "two-person approval enforced on distinct operator identities" |
| "a second person" / "two people" | One person could declare two operator names. | "a second, distinct operator identity" |
| "when the outcome is ambiguous" as the dual-control trigger | Dual control triggers on high risk, which includes a missing idempotency key with a clean transcript. | "for high-risk replays (no idempotency key, no HTTP response, or a prior 2xx)" |
| "a duplicate queue message can never send twice" | A worker that crashes mid-send is re-dispatched after its lease expires. | "a duplicate message for an already-claimed intent is a no-op" |
| "21 conformance cases" | The six incident fixtures are checked twice, for diagnosis and for risk. | "21 conformance checks across 15 fixtures" |
| "signed by a third party" / "tamper-proof" | Bundles are sealed with a deployment-held HMAC key. | "tamper-evident, HMAC-sealed evidence" |
| Employer names, private repositories, or confidential work | Not part of this project. | The builder story in [press-kit.md](press-kit.md). |
