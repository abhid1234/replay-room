# LinkedIn launch posts

Two variants. Both follow the same arc: problem, insight, product, proof, and a request for feedback. Post one; the other works as a follow-up a week later. LinkedIn shows roughly the first 210 characters before "see more", so the opening lines carry the post.

Attach the demo video, [`assets/replay-room-demo.mp4`](assets/replay-room-demo.mp4) (2:05, captioned, so it works muted), and set [`assets/replay-room-demo-cover.png`](assets/replay-room-demo-cover.png) as its thumbnail. For an image instead, use the hero GIF or the architecture diagram, with the alt text from [media-plan.md](media-plan.md).

## Variant 1: the 2 a.m. question

```text
A payment webhook times out at 2 a.m. The sender marks it failed. But the receiver may have charged the card before the connection dropped.

So, was the customer charged?

A dead-letter queue can't answer that, and it's the question an operator has to answer before pressing "retry". Get it wrong and the customer pays twice.

I built Replay Room to make that moment safer. It keeps the original webhook and every delivery attempt, explains why delivery failed, and makes you rehearse the exact payload against a controlled destination before anything goes back to production. The replay runs only after nine deterministic checks pass. When a replay is high risk, a second operator has to sign off. Afterwards, the whole incident exports as a signed evidence bundle.

It runs on Render: a static site for the console, a web service for the API and worker, Postgres as the source of truth, and Key Value as disposable queue transport.

The public drill is a labeled simulation; the console behind it runs on the live stack. 96 automated tests and 21 conformance checks run in CI on every change.

If you operate webhooks or dead-letter queues, I'd like to hear what's missing.

Try the drill: https://replay-room-web.onrender.com/?utm_source=linkedin&utm_medium=social&utm_campaign=replay-room-launch&utm_content=linkedin-variant-1
Source: https://github.com/abhid1234/replay-room?utm_source=linkedin&utm_medium=social&utm_campaign=replay-room-launch&utm_content=linkedin-variant-1
```

## Variant 2: what a timeout doesn't prove

```text
A timeout doesn't prove the receiver did nothing.

I kept coming back to that while building webhook tooling. Queues are good at preserving work. They can't tell you whether a failed delivery already charged a card or shipped an order before the connection broke. So "retry" quietly becomes a production change that nobody reviews.

Replay Room treats it like one:
• the original event and every delivery attempt are kept
• the failure gets a deterministic diagnosis, with no model deciding anything
• recovery is rehearsed against a controlled destination, bound to the exact payload hash and URL
• nine conditions are checked before the replay runs
• high-risk replays need a second operator's approval
• the incident exports as signed evidence

Under the hood it's Fastify, BullMQ, Postgres, and React, deployed as a Render static site, web service, Postgres database, and Key Value instance. Postgres is the source of truth, so Redis can disappear without losing track of what must happen next.

It's open source and early: the public deployment is an evaluation setup on free plans, not a production service. I'd value feedback from anyone who has had to decide whether to replay a failed webhook.

Drill: https://replay-room-web.onrender.com/?utm_source=linkedin&utm_medium=social&utm_campaign=replay-room-launch&utm_content=linkedin-variant-2
Code: https://github.com/abhid1234/replay-room?utm_source=linkedin&utm_medium=social&utm_campaign=replay-room-launch&utm_content=linkedin-variant-2
```

## Before posting

- Restore the live API first; see [README.md](README.md#restore-the-api).
- Tag the platforms it is built on, as credit rather than comparison: Render (static site, web service, Postgres, Key Value) and Hugging Face (the drill and the dataset). Type @ and pick each company page from LinkedIn's list.
- Do not add an npm line. The package is not on npm yet.
- Re-verify "96 automated tests and 21 conformance checks" against the latest `main` run; see [README.md](README.md#claims-that-need-fresh-verification).
- Put links in the post body, not the first comment. The post is short enough that the link does not bury the hook.
- Answer comments within the first two hours. Use [faq.md](faq.md) for the substance, in your own words.
