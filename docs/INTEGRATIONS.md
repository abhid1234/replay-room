# Provider integration recipes

Replay Room can sit between a webhook provider and an application receiver. It verifies the provider-facing request before durable receipt, redacts the signature header, and re-signs the exact JSON bytes sent by each live delivery, rehearsal, or replay.

## Signature profiles

| Profile | Inbound header | Outbound behavior |
|---|---|---|
| `none` | None | Sends no provider signature |
| `generic` | `x-replay-signature: sha256=<hex>` | Recomputes the same HMAC-SHA256 header |
| `github` | `x-hub-signature-256: sha256=<hex>` | Recomputes GitHub's SHA-256 HMAC header |
| `stripe` | `stripe-signature: t=<unix>,v1=<hex>` | Creates a fresh timestamp-bound `v1` signature |

The selected signed profiles require a secret of at least 16 characters. Unsigned endpoints reject secret storage. The Stripe verification window defaults to five minutes and is controlled by `SIGNATURE_TOLERANCE_SECONDS`.

## Create a signed endpoint

The dashboard exposes the same fields as the API. This example creates a GitHub-compatible ingest endpoint:

```bash
curl -X POST "$REPLAY_ROOM_API/api/endpoints" \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "name": "Repository events",
    "destinationUrl": "https://receiver.example/webhooks/github",
    "signatureProfile": "github",
    "signingSecret": "replace-with-a-long-random-secret",
    "maxAttempts": 5
  }'
```

Use the returned `/ingest/<key>` URL as the provider's webhook URL. Configure the same secret at the provider and at the receiving application. Replay Room never returns that secret after creation.

## GitHub

Choose `github`, set the GitHub webhook content type to JSON, and use the generated ingest URL and shared secret. Replay Room verifies the raw request body using `x-hub-signature-256` before persisting it. Delivery to the receiver carries a newly computed `x-hub-signature-256` over the delivered JSON bytes.

GitHub's validation contract is documented in [Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

## Stripe

Choose `stripe`, set the generated ingest URL as the Stripe endpoint, and use that endpoint's signing secret. Replay Room rejects an invalid digest or a timestamp outside the configured tolerance. Because replays happen later, outbound delivery receives a fresh Stripe timestamp and `v1` signature over `<timestamp>.<payload>`.

The receiver must trust Replay Room as the forwarding signer and use the same configured secret. Stripe's signature contract and raw-body requirement are documented in [Resolve webhook signature verification errors](https://docs.stripe.com/webhooks/signature).

## Generic HMAC

The npm package exports the same signing and verification contract:

```ts
import { signWebhookPayload, verifyWebhookSignature } from "@avee1234/replay-room";

const body = JSON.stringify({ type: "invoice.paid", invoiceId: "inv_42" });
const headers = signWebhookPayload("generic", process.env.WEBHOOK_SECRET!, body);

verifyWebhookSignature("generic", process.env.WEBHOOK_SECRET!, body, headers);
```

## Forwarded delivery headers

Every receiver request also includes:

- `x-replay-room-event`: the stable event UUID;
- `x-replay-room-mode`: `live`, `rehearsal`, or `replay`;
- `idempotency-key`: the original key when one was supplied;
- `user-agent: Replay-Room/0.1`.

Receivers should deduplicate on the idempotency key or stable event ID. Provider signatures authenticate bytes and a shared secret; they do not provide exactly-once side effects.
