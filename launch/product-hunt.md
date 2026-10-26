# Product Hunt

Launch on Product Hunt on a different day from Hacker News, so you can answer both audiences properly. A Product Hunt day starts at 12:01 a.m. US Pacific.

## Listing fields

### Name

```text
Replay Room
```

### Tagline (46 characters; limit 60)

```text
Rehearse a failed webhook before you replay it
```

### Short description (222 characters; limit 260)

```text
A safety system for failed webhooks. Replay Room records every delivery attempt, explains the failure, rehearses the exact recovery, checks nine conditions, and asks a second operator to approve risky replays. Open source.
```

### Website

```text
https://replay-room-web.onrender.com/?utm_source=producthunt&utm_medium=launch&utm_campaign=replay-room-launch&utm_content=listing
```

**Links:** GitHub repository (UTM variant in [link-map.md](link-map.md)) and the Hugging Face drill. Add the npm package only after `[[NPM_URL]]` is resolved.

**Topics:** Developer Tools, Open Source, and one more that fits on the day (for example, a DevOps or API category).

**Pricing:** Free and open source (MIT).

**Gallery:** see [media-plan.md](media-plan.md). Product Hunt galleries need captured product screenshots; do not substitute mockups.

## Maker comment

```text
Hi Product Hunt. I'm Abhi, and I built Replay Room.

It comes from one uncomfortable moment in webhook operations: an event is sitting in the dead-letter queue, and someone has to decide whether to send it again. The sender timed out, but the receiver may already have charged the card or shipped the order before the connection broke. "Retry" looks harmless and can do the same thing twice.

Replay Room treats that replay as a production change:
- it keeps the original event and every delivery attempt
- it explains the failure with deterministic rules (no model decides anything)
- it makes you rehearse the exact payload against a controlled destination
- it checks nine conditions before the real replay
- it asks a second operator to approve when the outcome is ambiguous
- it exports the incident as a signed evidence bundle

It runs on Render: a static site, a web service, Postgres as the source of truth, and Key Value as disposable queue transport. The public drill on the website is a labeled simulation; the operator console runs on the live stack and needs your own deployment's token.

It's early and open source, and the public deployment is an evaluation setup, not a hosted service. I'd love feedback on where the safety checks are too strict, too loose, or missing something you'd need.
```

## Feature list

- **Flight recorder:** the original payload, redacted headers, and every delivery attempt, kept after dead-lettering.
- **Deterministic diagnosis:** receiver outage, throttling, contract rejection, network failure, and active recovery, each with evidence and a next action.
- **Rehearsal:** the exact payload sent to a controlled destination, bound to its SHA-256 digest and destination URL.
- **Nine-condition replay guard:** a read-only preflight shows every condition; the server re-checks them before replaying.
- **Two-person approval:** high-risk replays need a 30-minute approval from a different operator.
- **Durable intents:** every delivery intent is stored in Postgres before the queue, so a lost queue is recoverable.
- **Signed evidence:** incidents export as HMAC-sealed JSON that can be inspected and verified offline.
- **Provider signatures:** generic HMAC, GitHub, and timestamp-bound Stripe verification on raw request bytes.
- **Safe egress:** DNS-pinned outbound delivery that refuses private ranges and never follows redirects.
- **Render-native:** one Blueprint (`render.yaml`) creates the whole free evaluation stack.

## First-response templates

Rewrite each in your own words when you reply; do not paste them verbatim.

### "How is this different from a webhook gateway or inspector?"

> Most tools make capture and resend easy. Replay Room focuses on the decision before the resend: was the original delivery ambiguous, did a rehearsal against the same payload and destination pass, and did a second person sign off? It's narrower than a gateway, and it's meant to sit beside your existing delivery path.

### "Does it guarantee exactly-once delivery?"

> No. It's at-least-once, like almost every webhook system. If a receiver processes a request and the connection drops before the response is recorded, nobody can know for sure. Replay Room makes that ambiguity explicit and requires acknowledgement and a second approver instead of hiding it.

### "Is there AI in it?"

> No. The diagnosis and the replay risk are deterministic rules over the delivery transcript, and they're tested. I didn't want a model deciding whether production traffic gets replayed.

### "Can I try it without deploying anything?"

> Yes: the drill on the website and on Hugging Face walks through a simulated incident. The real console needs a deployment's admin token, so the full flow means deploying your own copy from the repo's Render Blueprint or running it locally with Docker Compose.

### "Is it production-ready?"

> Not yet. The public deployment runs on Render's free plans for evaluation. Production use needs per-user authentication, encryption at rest for stored payloads, an egress allowlist, and paid Postgres and Key Value. The deployment guide documents that upgrade.

### "Why Render?"

> The architecture maps directly onto Render's primitives: a static site for the console, a web service for ingest and the API, Postgres as the durable ledger, and Key Value for the queue. The free topology also exposes real constraints, like a sleeping web service and an in-memory queue, which made a good test of the recovery design.

### "Is it on npm?"

> Use one of these, depending on the registry readback on the day:
>
> - Not yet published: "The verifier and schema are packaged as `@avee1234/replay-room`; release tarballs with an SBOM and provenance are on GitHub Releases today, and npm publication is the next release step."
> - Published and verified: "Yes: `npx @avee1234/replay-room inspect <bundle.json>`."

### "Which webhook providers does it support?"

> Any sender that can POST JSON. Signature verification is built in for a generic HMAC profile, GitHub, and Stripe; other providers can use the unsigned or generic profile.
