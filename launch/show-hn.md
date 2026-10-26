# Show HN

## Title

```text
Show HN: Replay Room – Rehearse a failed webhook before you replay it
```

69 characters (limit 80).

## URL

```text
https://github.com/abhid1234/replay-room
```

Submit the clean repository URL. Hacker News readers can try the public drill from the README, and the URL stays meaningful if the Render service is asleep.

## Text

Post this as the first comment immediately after submitting.

```text
Hi HN. Replay Room is an open-source console for the moment after a webhook lands in a dead-letter queue.

The problem: a sender times out and marks a delivery failed, but the receiver may already have processed it before the connection broke. Replaying blindly can charge a card twice or ship an order twice. Most webhook tools make resend one click. I wanted the opposite: a replay should require evidence, because it's a production change.

How it works:

- Ingest commits the event and a uniquely keyed delivery intent to Postgres before BullMQ (Redis) sees the job. Generic HMAC, GitHub, and timestamp-bound Stripe signatures are verified on the raw bytes, and signature headers are redacted before storage.
- Workers claim intents atomically, retry with exponential backoff and jitter, honor Retry-After (clamped to 15 minutes), and keep the full attempt transcript after dead-lettering.
- Diagnosis is a handful of deterministic rules over that transcript: 5xx means a receiver outage, 429 means throttling, other 4xx means a contract or auth rejection, no HTTP response means a network problem. No model is involved.
- A rehearsal sends the original payload to an operator-chosen destination and records a pass or fail bound to the payload's SHA-256 and the exact destination URL. The newest rehearsal wins, so an old pass can't cover a newer failure.
- The replay guard checks nine conditions: reason, operator identity, rehearsal exists, rehearsal passed, payload unchanged, destination unchanged, event is dead-lettered, duplicate risk acknowledged, and two-person approval. A read-only preflight returns the whole trace; the replay endpoint re-evaluates it server-side.
- Duplicate-side-effect risk is derived from the transcript. No idempotency key, a network failure with no HTTP response, or a prior 2xx means the receiver may already have acted. That's high risk: the operator must acknowledge it, and a different operator must approve within 30 minutes, bound to the same rehearsal, payload, and destination.
- Postgres is authoritative. A reconciler re-dispatches pending or stale intents with stable job keys every ten minutes, so losing Key Value is a recovery path instead of lost work.
- Outbound requests validate every DNS answer against private and reserved ranges, pin the socket to the validated addresses, never follow redirects, and cap captured responses at 4 KiB.
- Each incident exports as canonical JSON with a SHA-256 digest and an HMAC-SHA256 seal, and a small CLI inspects and verifies bundles offline.

It's built on Render as four free primitives: a static site for the React console, a web service for the Fastify API (with the worker and reconciler embedded, since Render has no free background-worker or cron plan), Postgres, and Key Value. The constraints are visible on purpose: the API sleeps when idle, free Postgres expires after 30 days, and free Key Value is in-memory. The production split into API, worker, and cron services is documented.

What's real and what's simulated: the outage drill on the landing page is a labeled simulation. The operator console behind it needs the deployment's admin token, so to try the real flow you deploy your own copy (the repo has a render.yaml Blueprint and a docker compose setup). The live API reports its version and Git commit at /.well-known/replay-room.

Known limitations:

- Delivery is at-least-once. Replay Room can't remove the classic "receiver accepted, worker crashed before recording it" ambiguity; it surfaces it and makes someone sign off.
- There is one shared admin token, and operator identities are declared names. Two-person approval enforces two distinct identities, not two authenticated people. Org-scoped auth is first on the production list.
- Stored payloads and endpoint secrets aren't encrypted at rest yet, and egress control is application-level only; a real deployment should add an egress allowlist.
- The evidence seal uses a deployment-held HMAC key. It's tamper-evident to whoever holds the key, not a public timestamp or third-party attestation.
- It's single-tenant, early, and has no production users. The public deployment is for evaluation.

CI runs 96 automated tests, 9 deployment-smoke tests, and 21 conformance cases, plus integration tests against real Postgres 17 and Redis 8. Releases carry the package tarball, a CycloneDX SBOM, and SLSA provenance attestations.
[[NPM_LINE]]

Questions I'd value answers to:

1. Is rehearsal against a controlled destination useful for your receivers, or would you rather have a receiver-side dry-run contract?
2. Are the duplicate-risk rules too strict or too loose? Should a timeout always count as "the receiver may have acted"?
3. Would you accept two-person approval without SSO-backed identities, or is that a non-starter?
4. What would you want in an incident evidence bundle that isn't there?
5. If you've built replay tooling, how do you handle receivers that don't support idempotency keys?

Public drill: https://replay-room-web.onrender.com
Architecture: https://github.com/abhid1234/replay-room/blob/main/docs/ARCHITECTURE.md
```

## Before submitting

- Resolve `[[NPM_LINE]]`: delete the line unless the registry readback passes, in which case use the npm line from [link-map.md](link-map.md).
- Wake the API about ten minutes beforehand by opening <https://replay-room-api.onrender.com/health>, so the first commenters do not hit a cold start.
- Post between 8 and 10 a.m. US Pacific, Tuesday to Thursday, and stay in the thread for the first three hours.
- Answer criticism of the limitations directly and briefly. Do not argue with "just use idempotency keys"; agree, and explain that the console exists for receivers that do not have them. See [faq.md](faq.md).
- Do not ask anyone to upvote. Hacker News penalizes coordinated voting.
- If the comment is rejected for length, keep the opening, the first five "How it works" bullets, the real-versus-simulated paragraph, the limitations, and the questions.
