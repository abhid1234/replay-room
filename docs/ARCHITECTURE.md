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

The Render cron service runs every ten minutes. It returns deliveries stuck in `delivering` for more than five minutes to the queue and deletes event records past the configured retention window. The Postgres ledger remains authoritative; Redis is transport, not system of record.
