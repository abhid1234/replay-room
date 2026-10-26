# Reddit

Two posts, written as a builder sharing work and asking for critique. Read each subreddit's current rules on the day you post. Self-promotion rules change, and some subreddits require a flair or a minimum account history. Space the two posts at least a day apart, and never cross-post the same text.

## r/SideProject

### r/SideProject title

```text
I built a tool that makes you rehearse a failed webhook before you replay it
```

### r/SideProject body

```text
Webhook failures have an annoying property: a timeout doesn't tell you whether the receiver already did the thing. The payment may have gone through before the connection dropped. If you hit "retry", the customer can get charged twice.

Replay Room is my attempt at a safer replay button. It's open source and runs on Render's free plans.

What it does:
- keeps the original webhook and every delivery attempt
- explains why delivery failed (deterministic rules, no AI)
- makes you rehearse the exact payload against a controlled destination first
- checks nine conditions before the real replay, and wants a second operator's sign-off when the replay is high risk
- exports the incident as a signed evidence file

Stack: Fastify, BullMQ, Postgres, React. Postgres is the source of truth and Redis is just transport, so losing the queue doesn't lose track of what must happen next.

The demo on the landing page is a labeled simulation. The real operator console needs a deployment token, so to try the full flow you'd deploy your own copy from the repo.

Things I know are missing: proper per-user auth (it's one shared admin token today), encryption at rest for stored payloads, and multi-tenancy.

I'd love blunt feedback, especially from anyone who has had to clean up after a double-sent webhook.

Drill: https://replay-room-web.onrender.com/?utm_source=reddit&utm_medium=community&utm_campaign=replay-room-launch&utm_content=r-sideproject
Code: https://github.com/abhid1234/replay-room?utm_source=reddit&utm_medium=community&utm_campaign=replay-room-launch&utm_content=r-sideproject
```

## r/devops

r/devops has strict rules about self-promotion; confirm on the day that a project post with a discussion question is allowed. If it is not, post the same body to r/node with this title: `Built with Fastify and BullMQ: a guard that decides whether a failed webhook is safe to replay`.

### r/devops title

```text
How do you decide whether a dead-lettered webhook is safe to replay? I built a guard for it
```

### r/devops body

```text
I've been working on a narrow problem: a webhook lands in a dead-letter queue, and someone has to decide whether to replay it. The hard case is ambiguity. The sender timed out, but the receiver may have processed the request before the connection broke. A blind replay can repeat a payment or a shipment.

I built an open-source console, Replay Room, that turns that decision into a checklist with evidence behind it:

- every event and delivery intent is committed to Postgres before BullMQ sees the job; Redis is treated as disposable transport, and a reconciler rebuilds jobs from Postgres after queue loss
- the failure gets a deterministic diagnosis from the attempt transcript (5xx, 429, 4xx, no response)
- recovery is rehearsed against a controlled destination, and the result is bound to the payload's SHA-256 and the exact destination URL
- replay requires nine conditions to pass; a read-only preflight shows each one, and the server re-checks them
- if the replay is high risk (no idempotency key, no HTTP response, or a prior 2xx), the operator has to acknowledge it; one operator records a 30-minute approval and a different operator executes the replay
- outbound delivery is DNS-pinned, refuses private ranges, and never follows redirects

Delivery is at-least-once. This doesn't make duplicate side effects impossible; it makes the risk explicit and puts a second operator on the decision.

It runs on Render's free plans as an evaluation setup: one web service with an embedded worker and reconciler, a static site, Postgres, and Key Value. The production split into separate worker and cron services is documented.

Two questions for people who run this kind of system:
1. Would you trust two-person approval with declared operator names, or does it need SSO-backed identities to be worth anything?
2. Do you treat a delivery timeout as "the receiver may have acted" by default?

Source: https://github.com/abhid1234/replay-room?utm_source=reddit&utm_medium=community&utm_campaign=replay-room-launch&utm_content=r-devops
Public drill (simulation): https://replay-room-web.onrender.com/?utm_source=reddit&utm_medium=community&utm_campaign=replay-room-launch&utm_content=r-devops
```

## Commenting

- Reply in the thread for the first few hours. Thank people for criticism and answer it on substance.
- If someone asks why not just use idempotency keys: agree that receivers should, and explain that Replay Room is for the cases where the key is missing or the receiver's behavior is unknown. See [faq.md](faq.md).
- Do not post the npm install command until `[[NPM_LINE]]` is resolved in [link-map.md](link-map.md).
