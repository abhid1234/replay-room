# Architecture and failure model

![Replay Room architecture](../diagrams/replay-room-render-architecture.svg)

## Lifecycle

```text
received -> queued -> delivering -> delivered
                         |
                         +-> retrying -> delivering
                         |
                         +-> dead_letter -> rehearsal -> guarded replay -> delivered
```

The API stores the event and a uniquely keyed delivery intent in Postgres before BullMQ becomes authoritative for transport. Delivery failures never delete or overwrite the received record.

## Delivery semantics

Replay Room provides at-least-once delivery. It does not claim exactly-once side effects. Receivers must deduplicate with the stable event ID or supplied idempotency key. A Postgres intent claim prevents two workers from executing the same queue job concurrently, but it cannot eliminate the classic ambiguity when a receiver accepts a request and the worker crashes before recording the response.

Every live delivery, rehearsal, replay, and application-level retry has a durable intent with a stable job key, exact job payload, availability time, and lifecycle (`pending`, `dispatched`, `processing`, `completed`). The worker atomically claims the intent before making a network call. Duplicate queue deliveries become no-ops, and a guarded replay receives a fresh per-cycle retry ordinal instead of inheriting the exhausted attempt budget that originally created the dead letter.

Retryable outcomes:

- network and timeout failures;
- HTTP 408, 425, and 429;
- HTTP 5xx.

Other HTTP 4xx responses are treated as permanent failures and dead-lettered immediately. Retry delays use bounded exponential backoff with jitter.

## Ingest admission control

After resolving a valid endpoint but before signature verification or database writes, the API consumes a fixed-window counter in Key Value. A Lua script performs `INCR`, first-write expiry, and TTL read atomically, so multiple Render web-service instances share one limit. Counter keys contain a truncated SHA-256 digest of the ingest key.

The default window is 600 requests per minute per endpoint and is configurable with `INGEST_RATE_LIMIT_PER_MINUTE`. Rejected requests return HTTP 429 plus remaining-budget and retry timing headers; they never enter Postgres or BullMQ.

The operator surface has a second Redis-backed limiter applied globally before protected route handlers. It prevents repeated dashboard or API reads from creating unbounded Postgres work. The default is 300 requests per minute per client and is configurable with `OPERATOR_RATE_LIMIT_PER_MINUTE`.

## Inbound authenticity

Each endpoint chooses one explicit signature profile: unsigned, Replay Room HMAC, GitHub, or Stripe. Generic and GitHub profiles verify the exact raw request bytes with HMAC-SHA256 and their native headers. Stripe verification signs `<timestamp>.<raw body>`, accepts any matching `v1` digest, and rejects timestamps outside `SIGNATURE_TOLERANCE_SECONDS` (five minutes by default) to limit replayed requests. Signature headers are redacted before the event is persisted. The worker re-signs the exact outbound JSON for every live delivery, rehearsal, and replay; Stripe receives a fresh timestamp because the original delivery window has expired.

The endpoint schema fails closed on inconsistent configuration: signed profiles require a secret, while unsigned endpoints cannot retain one. Endpoint responses expose only the profile and whether a secret is configured.

## Outbound network boundary

Endpoint creation rejects private IP literals, local hostnames, URL credentials, and non-HTTP protocols. Immediately before every live delivery, rehearsal, or replay, the worker resolves the hostname and rejects the entire result set if any answer is loopback, private, carrier-grade NAT, link-local, multicast, reserved, or malformed. IPv6 validation admits global unicast space and excludes the special-purpose ranges maintained in the [IANA IPv6 registry](https://www.iana.org/assignments/iana-ipv6-special-registry/iana-ipv6-special-registry.xhtml). A security rejection is recorded as a terminal attempt and dead-lettered instead of entering a retry loop.

The outbound client races the validated IPv4 and IPv6 answers, connects only to that in-memory set, and retains the original Host header and TLS server name. It never performs a second DNS lookup, never follows redirects, and never pools a socket across validations, closing the lookup-to-connect rebinding window, stale-connection reuse, and redirect-based target switching. One wall-clock deadline covers resolution, connection, and response capture; an expired resolution cancels both in-flight A and AAAA queries. A production tenant deployment should still enforce an external egress allowlist as defense in depth.

## Rehearsal contract

A rehearsal sends the original payload with `x-replay-room-mode: rehearsal` to an operator-selected endpoint. The evidence record binds:

- event ID;
- payload SHA-256;
- exact destination URL;
- response status;
- timestamp and notes.

Production replay requires a passing record with the same payload digest and destination. This intentionally makes target changes force a new rehearsal.

The API evaluates the newest rehearsal, not the newest passing rehearsal. A failed check after an earlier success therefore closes the replay gate until a new rehearsal passes. `POST /api/events/:id/replay/preflight` returns the complete eight-condition decision trace without writing audit rows, creating delivery intents, or enqueueing jobs. The console invalidates that trace whenever the target, reason, or risk acknowledgement changes; the mutation endpoint always reevaluates the guard server-side before approving a replay.

## Duplicate-side-effect risk

Before approval, Replay Room derives a deterministic risk assessment from the production attempt transcript. Missing idempotency evidence, a network attempt with no HTTP response, or a prior 2xx response is high risk because receiver-side acceptance may already have happened. Multiple attempts, throttling, and 5xx responses are elevated risk. A stable idempotency key plus only permanent 4xx rejections is low risk.

High risk does not make replay impossible, because the system cannot know every receiver's side-effect semantics. It makes the uncertainty explicit: the operator must acknowledge it, and the decision, risk level, and acknowledgement are written to the audit trail and signed evidence bundle.

## Recovery

The reconciler runs every ten minutes. It re-dispatches pending or stale delivery intents with the same BullMQ job key, synthesizes a recovery intent only for legacy/orphaned queued records that have no open intent, and deletes event records past the configured retention window. Queue dispatch uses a five-minute lease so concurrent reconcilers cannot independently own the same intent. The Postgres ledger remains authoritative; Redis is disposable transport, not the system of record.

In the free lab topology, the API process embeds both the queue worker and reconciliation loop because Render does not offer free background-worker or cron compute. In the production upgrade, those responsibilities run as separate services. `/api/system` reports `embedded-free` or `split-services` so the dashboard never labels an embedded loop as a dedicated service.

## Runtime telemetry

`GET /api/system` assembles the dashboard's live Render fabric from the services themselves:

- the API measures a real Postgres round trip;
- Postgres reports pending, dispatched, processing, and stale delivery intents;
- Key Value responds to `PING` and BullMQ reports queue counts;
- the worker refreshes an expiring Redis heartbeat every 15 seconds;
- the reconciler refreshes its heartbeat after each successful run;
- Render's service, instance, and Git commit environment values identify the deployed revision.

Heartbeats are deliberately operational hints, not health-check dependencies. API readiness requires Postgres and Key Value, while a missing worker or reconciler heartbeat is exposed as `waiting` or `degraded` for an operator to investigate.

## Endpoint reliability

The reliability query computes a rolling destination view directly in Postgres. One aggregate covers event states and the last event timestamp; a second computes p95 latency from successful non-rehearsal delivery attempts. The success-rate denominator contains only terminal outcomes (`delivered + dead_letter`), so queued, delivering, and retrying work does not create a false SLO failure.

Runway states are intentionally simple and explainable:

- `healthy`: at least one successful delivery, no active recovery, and at least 99% terminal success;
- `at_risk`: recovery is active, a dead letter exists above the breach threshold, or there is not yet a terminal sample;
- `breached`: terminal success is below 95%;
- `idle`: the endpoint received no events in the selected window.

## Incident diagnosis

Event detail responses include a deterministic diagnosis derived from durable state and the delivery-attempt transcript. The classifier intentionally uses transparent rules instead of an opaque model:

- no HTTP response across all attempts indicates DNS, TLS, firewall, or network reachability;
- HTTP 429 indicates receiver throttling;
- HTTP 5xx indicates a receiver outage;
- permanent HTTP 4xx indicates a contract, validation, or authentication rejection;
- queued, delivering, retrying, and delivered states each have non-alarm guidance.

Diagnosis never changes state and never bypasses the replay guard. It is operator context, not replay authority.

## Evidence integrity

The evidence endpoint constructs a versioned document from the durable event record, diagnosis, duplicate-side-effect risk assessment, attempts, rehearsals, and audit entries. It serializes that content with recursively sorted object keys, records a SHA-256 content digest, and seals the same canonical bytes with HMAC-SHA256 using `EVIDENCE_SIGNING_SECRET`.

The signing key is independent of webhook endpoint secrets and the admin token. Render generates it at deployment time. Neither endpoint secrets nor the evidence key are returned to the browser. This proves that a bundle still matches the state exported by this Replay Room deployment; it is not a third-party timestamp or public-key attestation.
