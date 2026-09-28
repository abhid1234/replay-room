# Architecture and failure model

## Lifecycle

```text
received -> queued -> delivering -> delivered
                         |
                         +-> retrying -> delivering
                         |
                         +-> dead_letter -> rehearsal -> guarded replay -> delivered
```

The API acknowledges only after Postgres stores the event and BullMQ accepts the delivery job. Delivery failures never delete or overwrite the received record.

## Delivery semantics

Replay Room provides at-least-once delivery. It does not claim exactly-once side effects. Receivers must deduplicate with the stable event ID or supplied idempotency key.

Retryable outcomes:

- network and timeout failures;
- HTTP 408, 425, and 429;
- HTTP 5xx.

Other HTTP 4xx responses are treated as permanent failures and dead-lettered immediately. Retry delays use bounded exponential backoff with jitter.

## Rehearsal contract

A rehearsal sends the original payload with `x-replay-room-mode: rehearsal` to an operator-selected endpoint. The evidence record binds:

- event ID;
- payload SHA-256;
- exact destination URL;
- response status;
- timestamp and notes.

Production replay requires a passing record with the same payload digest and destination. This intentionally makes target changes force a new rehearsal.

## Recovery

The Render cron service runs every ten minutes. It returns deliveries stuck in `delivering` for more than five minutes to the queue, recovers queued or retrying records stranded by a temporary Redis failure, and deletes event records past the configured retention window. The Postgres ledger remains authoritative; Redis is transport, not system of record.

## Runtime telemetry

`GET /api/system` assembles the dashboard's live Render fabric from the services themselves:

- the API measures a real Postgres round trip;
- Key Value responds to `PING` and BullMQ reports queue counts;
- the worker refreshes an expiring Redis heartbeat every 15 seconds;
- the cron reconciler refreshes its heartbeat after each successful run;
- Render's service, instance, and Git commit environment values identify the deployed revision.

Heartbeats are deliberately operational hints, not health-check dependencies. API readiness requires Postgres and Key Value, while a missing worker or cron heartbeat is exposed as `waiting` or `degraded` for an operator to investigate.

## Incident diagnosis

Event detail responses include a deterministic diagnosis derived from durable state and the delivery-attempt transcript. The classifier intentionally uses transparent rules instead of an opaque model:

- no HTTP response across all attempts indicates DNS, TLS, firewall, or network reachability;
- HTTP 429 indicates receiver throttling;
- HTTP 5xx indicates a receiver outage;
- permanent HTTP 4xx indicates a contract, validation, or authentication rejection;
- queued, delivering, retrying, and delivered states each have non-alarm guidance.

Diagnosis never changes state and never bypasses the replay guard. It is operator context, not replay authority.

## Evidence integrity

The evidence endpoint constructs a versioned document from the durable event record, diagnosis, attempts, rehearsals, and audit entries. It serializes that content with recursively sorted object keys, records a SHA-256 content digest, and seals the same canonical bytes with HMAC-SHA256 using `EVIDENCE_SIGNING_SECRET`.

The signing key is independent of webhook endpoint secrets and the admin token. Render generates it at deployment time. Neither endpoint secrets nor the evidence key are returned to the browser. This proves that a bundle still matches the state exported by this Replay Room deployment; it is not a third-party timestamp or public-key attestation.
