# Substack launch essay

Adapted from [docs/LAUNCH.md](../docs/LAUNCH.md) for a general engineering audience. Body length is about 1,180 words. Replace every `[[...]]` marker before publishing, including the image markers, which tell you where to insert each image.

---

**Title:** The replay button is a production change

**Subtitle:** Replay Room turns a failed webhook from a blind resend into a rehearsed, evidence-backed production change.

---

It's 2:07 a.m. and a payment event is sitting in the dead-letter queue.

The sender's log is short. It opened a connection to the receiver, wrote the full request body, and waited. After 1.2 seconds the connection was reset. No status code came back. The event had no idempotency key, and the endpoint allowed one attempt, so it went straight to dead letter.

The on-call engineer has a button labeled "Replay."

Here is what the queue cannot tell them: did the receiver capture that payment before the connection broke? A reset after the body was written is exactly the case where the receiver may have done the work and simply never answered. If it did, pressing the button charges the customer a second time. If it didn't, not pressing it means a payment that never completes.

That is the moment Replay Room is built for.

## A replay is a production change

Most webhook tooling treats resend as a convenience: capture the request, show it, offer a button. That works when failures are clean: a 400 because the payload was malformed, a 503 while the receiver was down. It breaks down in the ambiguous cases, and the ambiguous cases are the expensive ones.

Replay Room starts from a stricter idea. Sending a failed event again changes production state, so it should need the same things any production change needs: evidence that it will work, a record of who decided, and a second person when the risk is real.

## A flight recorder for every event

Replay Room persists the original webhook before acknowledging it: the payload, its SHA-256 digest, the idempotency key if there is one, and the headers with secrets redacted. Supported provider signatures (generic HMAC, GitHub, and Stripe's timestamp-bound scheme) are verified on the raw bytes first. Every delivery attempt is appended to the record with its destination, status, error, and duration, and that transcript survives dead-lettering.

The transcript drives a diagnosis built from a few deterministic rules. Repeated 5xx responses mean a receiver outage. A 429 means throttling. Other 4xx responses mean a contract or authentication rejection. No HTTP response at all points at DNS, TLS, or the network. The 2:07 a.m. event lands in that last bucket, and Replay Room says so, with the evidence and a next step. No model decides anything.

## Ambiguity, made explicit

The same transcript produces a duplicate-side-effect risk rating. Three signals make it high: no idempotency key, an attempt that got no HTTP response, or a prior success response. Our payment event has the first two. It's one of the six synthetic incident fixtures in the repository, so you can run the same diagnosis yourself.

High risk doesn't make replay impossible; Replay Room can't know every receiver's side effects, and sometimes resending is right. It refuses to let anyone treat ambiguity as certainty. The operator has to tick a box that reads "I reviewed the ambiguous outcome and accept the duplicate-side-effect risk." Then a second person gets involved.

## Rehearse the exact recovery

A dead-lettered event can't go straight back to production. First, the operator runs a rehearsal: the original payload is sent to a controlled destination, marked as a rehearsal, and the result is recorded against two exact values, the payload digest and the destination URL.

That binding is deliberately inconvenient. Change the target or the payload and the rehearsal no longer counts; the operator has to rehearse again. The newest rehearsal is the one that matters, so an old pass can't cover a newer failure.

Then comes the guard. Before replay, Replay Room checks nine conditions: an operator reason, an operator identity, a rehearsal exists, it passed, the payload is unchanged, the destination is unchanged, the event is in dead letter, the duplicate risk was acknowledged, and two-person approval is in place. The console can run all nine as a read-only preflight and shows each one as pass, fail, or pending. Changing any input clears the result until it's checked again. The replay endpoint re-checks everything on the server, so the checklist explains the decision but never replaces it.

## Two people for the risky ones

For a high-risk event, one operator records an approval. It expires after 30 minutes and is bound to the current rehearsal, payload digest, and destination. A different operator must then run the preflight and execute the replay. If the approver tries to execute it, the ninth check fails. So do a newer rehearsal, an expired approval, or any drift in payload or target.

One limitation deserves to be stated plainly. Today the console uses one shared admin token, and operator identities are declared names. Two-person approval enforces two distinct identities, not two authenticated people. Per-user authentication is the first item on the production list.

After the replay, the whole incident exports as a versioned JSON bundle: event identity, diagnosis, risk, attempts, rehearsals, and the audit history, canonicalized and sealed with HMAC-SHA256. A small CLI inspects and verifies it offline. It's tamper-evident to whoever holds the deployment's evidence key; it isn't a public timestamp or third-party attestation.

## Built on Render, constraints included

[[IMAGE: diagrams/replay-room-render-architecture.png, with the architecture alt text from launch/media-plan.md]]

Replay Room runs on four Render primitives. A static site serves the React console. A web service runs the Fastify API, and on the free plan it also embeds the BullMQ worker and a ten-minute reconciler, because Render has no free background-worker or cron compute. Render Postgres holds the events, delivery intents, attempts, rehearsals, approvals, and audit records. Render Key Value is the queue transport.

The design rule is simple: Redis can disappear, and the operator should still be able to reconstruct exactly what must happen next. Before any job reaches Key Value, its exact delivery intent is committed to Postgres. Workers claim intents atomically, so a duplicate queue message can't send twice, and the reconciler rebuilds pending or interrupted work from Postgres after the queue is lost.

The free topology doesn't hide its limits. The API sleeps after inactivity and takes a moment to wake, free Postgres expires after 30 days, and free Key Value is in-memory. That makes it an evaluation deployment, not a production service, and the deployment guide documents the production split into separate API, worker, and cron services.

Delivery is at-least-once. Replay Room doesn't make duplicate side effects impossible. It makes the risk visible and puts evidence and a second person in front of the decision.

## Try it

- **The outage drill:** a labeled simulation of one event surviving an outage, at <https://replay-room-web.onrender.com/?utm_source=substack&utm_medium=newsletter&utm_campaign=replay-room-launch&utm_content=essay>. It's also on [Hugging Face](https://huggingface.co/spaces/abhid1234/replay-room?utm_source=substack&utm_medium=newsletter&utm_campaign=replay-room-launch&utm_content=essay). The live console behind it needs a deployment's admin token.
- **The source:** MIT licensed, with a Render Blueprint (`render.yaml`) and a Docker Compose setup, at <https://github.com/abhid1234/replay-room?utm_source=substack&utm_medium=newsletter&utm_campaign=replay-room-launch&utm_content=essay>.
- **The release:** package tarball, CycloneDX SBOM, and provenance attestations at <https://github.com/abhid1234/replay-room/releases/latest>.
- [[NPM_LINE]]
- **The fixtures:** synthetic incident cases on [Hugging Face](https://huggingface.co/datasets/abhid1234/replay-room-fixtures).

I'd like to hear from anyone who has had to decide whether to press that button. Which checks are missing? Which would you drop? And would you trust two-person approval before per-user authentication exists?

Before you press replay, what can you prove?
