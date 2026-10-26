# Demo script

Three cuts of the same story: 60 seconds, 3 minutes, and an 8-minute technical walkthrough. Every on-screen label below is quoted from the console source (`web/src/App.tsx` and `web/src/IncidentDrill.tsx`); the visible text is the same in the deployed `0.3.0` console and on `main`.

Two rules apply to every recording:

1. **Never show a secret.** The admin token field is masked, but do not paste it on camera. Blur every ingest URL: the `Endpoint created. Send webhooks to …/ingest/<key>` message and the Ingest workbench card both show the full capability URL. Never show Render environment pages.
2. **Say what is simulated.** The outage drill is a labeled simulation. Everything after **Open console** is the live product.

## Setup before recording

Do this 10–15 minutes before you start, so the free API is awake and the incidents are staged.

1. Open <https://replay-room-api.onrender.com/health>. Expected: JSON with `"status":"ok"` and two latency values. If it takes longer than a minute, see [Cold-start fallback](#cold-start-fallback).
2. Open <https://replay-room-api.onrender.com/.well-known/replay-room> and note `version` and `deployment.commit`. You will say them on camera.
3. Choose two receivers you control: one that fails and one that succeeds. Public examples: `https://httpbin.org/status/503` always returns 503, and `https://httpbin.org/status/204` always returns 204. Rehearse the whole sequence once before recording; a third-party receiver can change behavior.
4. Use a clean browser profile at 1440×900 and 100% zoom, with notifications and extensions off.
5. Open <https://replay-room-web.onrender.com>. Paste the admin token from the Render dashboard while not recording, leave **Remember on this browser** unchecked, and click **Open console**. Expected message: `Connected to https://replay-room-api.onrender.com`.
6. Under **Create endpoint**, fill in Name `Billing events (demo)`, Receiver URL `https://httpbin.org/status/503`, Signature profile **Unsigned**, and Retry budget `3`, then click **Create ingest URL**.
7. In the **Ingest workbench**, click **Copy ready cURL**. In a terminal, off camera:
   - **Event A (elevated risk):** run the copied command after changing `Idempotency-Key: launch-demo-001` to a fresh value, such as `launch-demo-a-1`. Ingest deduplicates on the key, so reused keys return the existing event.
   - **Event B (high risk):** run the command again with the whole `--header 'Idempotency-Key: …'` line removed. A missing idempotency key makes the replay high risk.
   - Each request returns HTTP 202 immediately.
8. Wait about 10 seconds and click **Refresh**. Both events should show `dead_letter` in the **Event stream**: three attempts with roughly 1- and 2-second backoffs.

## 60-second version

The public story, no token needed. Record it in one take.

| Time | On screen | Narration | Expected visible outcome |
|---|---|---|---|
| 0:00 | Landing page, hero "Every event leaves a flight recorder." | "A webhook times out. Did the receiver charge the card before the connection dropped? The queue can't tell you, and pressing retry can bill the customer twice." | Hero, **Live stack** panel, and the drill standing by with "Outage drill is standing by". |
| 0:10 | Scroll to "Watch one event survive an outage." | "This is a simulation, labeled as one, using the same states as the real worker." | Drill shows "Incident drill / RR-1042" and the **Run outage drill** button. |
| 0:15 | Click **Run outage drill**. | "The event is saved before anything is acknowledged. The receiver fails with a 503, retries run out, and it lands in dead letter." | The button changes to "Drill running". Steps reveal about every 0.8 s: `202` captured, `RUN` claimed, `503` receiver unavailable, `DLQ` retry budget exhausted. |
| 0:25 | Drill continues. | "Instead of a blind resend, the exact payload is rehearsed first, the risk is assessed, and the replay guard checks that the payload and destination still match." | `204` rehearsal accepted, `ELEV` replay risk assessed, `PASS` replay guard sealed. The payload seal changes to `sha256:7f3a…91c2 ✓`. |
| 0:35 | Drill completes. | "Only then does the replay go out, with the operator's reason in the audit trail." | `204` production replay delivered; "Flight recorder 08 / 08"; the button reads "Run it again". |
| 0:42 | Cut to the pre-recorded **Replay guard decision trace** from the 3-minute version (nine PASS rows). | "In the real console, nine conditions have to pass, and a risky replay needs a second operator." | Nine rows, all `PASS`, banner "Preflight passed". |
| 0:52 | End card: repository URL and drill URL. | "Replay Room: rehearse a failed webhook before you replay it. It's open source, and it runs on Render." | End card holds for three seconds. |

## 3-minute version

The core recovery on the live console with **Event A** (elevated risk, single operator).

| Time | On screen | Narration | Expected visible outcome |
|---|---|---|---|
| 0:00 | Run the 60-second drill sequence, sped up 2× in editing. | "This drill is a simulation. Now the real thing." | As in the 60-second version. |
| 0:25 | Console already open. Point at the **Live Render fabric** panel. | "This console reads the live stack: Postgres and Key Value latency, queue counts, the intent outbox, and worker heartbeats." | Postgres and Key Value latencies in ms; BullMQ counts (Waiting, Active, Delayed, Failed); the Intent outbox; Worker and Reconciler heartbeats; the topology line ending `embedded-free`. |
| 0:40 | Click **Event A** in the **Event stream**. | "This payment event failed three times against a receiver that returns 503." | The **Replay inspector** opens. **Flight recorder diagnosis** reads `receiver outage`, with the attempt evidence and a next action. |
| 0:55 | Point at **Duplicate-side-effect risk**. | "It had an idempotency key, so the risk is elevated, not high. One operator can handle it." | Risk level `elevated`, with its signals listed and no acknowledgement checkbox. |
| 1:05 | Type `incident-commander` in **Operator identity**. Change **Rehearsal / replay target** to `https://httpbin.org/status/204`. Click **Run rehearsal**. | "First, rehearse the exact payload against the fixed receiver." | Message: "Rehearsal queued. Refresh in a moment to inspect the result." |
| 1:20 | Click **Refresh**. | "The rehearsal passed, and it's bound to this payload's hash and this exact URL." | The timeline shows `rehearsal.passed`. |
| 1:30 | Click **Check replay**. | "Preflight runs all nine checks without changing anything." | Banner "Preflight passed"; nine `PASS` rows, including "Two-person approval: Replay risk does not require a second operator"; message "Replay preflight passed. No state was changed." |
| 1:50 | Edit one character of the target URL. | "If I change the destination, the proof no longer applies." | The trace disappears and **Approve replay** is disabled. Restore the URL. |
| 2:05 | Click **Check replay**, then **Approve replay**. | "Now the replay goes through a durable intent in Postgres." | Message: "Guard approved the replay and queued it for delivery." After **Refresh**, the event shows `delivered`. |
| 2:25 | Click **Download bundle**. | "The whole incident exports as signed evidence: attempts, rehearsal, decision, and audit trail." | Message: "Signed incident evidence downloaded." |
| 2:40 | End card. | "Before you press replay, what can you prove?" | Repository URL and drill URL. |

## 8-minute technical walkthrough

For engineers and interviewers. Use **Event B** (high risk) and show the system around it.

| Time | On screen | Narration | Expected visible outcome |
|---|---|---|---|
| 0:00 | The architecture diagram (`diagrams/replay-room-render-architecture.png`). | "Four Render primitives: a static site for the console, a web service for the API with the worker and reconciler embedded on the free plan, Postgres as the ledger, and Key Value as transport." | Full diagram, including the free lab, portable proof, and production upgrade boxes. |
| 0:45 | `render.yaml` in the repository. | "One Blueprint creates the whole stack. Every plan is free, which is why the worker is embedded; Render has no free background-worker or cron plan." | `replay-room-api` (plan `free`, Docker), `replay-room-web` (static), `replay-room-queue` (Key Value), and `replay-room-db`. |
| 1:30 | Browser: `/.well-known/replay-room`. | "The live deployment states its version, commit, topology, and capabilities. The release checks verify this file rather than trusting a green badge." | JSON with `version`, `deployment.commit`, `"topology":"embedded-free"`, and the `two-person-approval` capability. |
| 2:00 | Console: click **Event B**. | "This event had no idempotency key." | The diagnosis reads `receiver outage`. **Duplicate-side-effect risk** is `high`, with the acknowledgement checkbox: "I reviewed the ambiguous outcome and accept the duplicate-side-effect risk." |
| 2:30 | Operator identity `safety-reviewer`, target `https://httpbin.org/status/204`, then **Run rehearsal** and **Refresh**. | "Same rehearsal step, bound to the hash and the URL." | `rehearsal.passed` in the timeline. |
| 3:00 | Tick the checkbox. Click **Record approval**. | "High risk means acknowledgement plus dual control. This approval lasts 30 minutes and is bound to this rehearsal, payload, and destination." | Message: "safety-reviewer approved this high-risk replay until [time]. A different operator must execute it." |
| 3:20 | Click **Check replay** as `safety-reviewer`. | "The approver can't execute their own approval." | Banner "1 blocker". The **Two-person approval** row reads `FAIL`: "A different operator must execute the approved replay." |
| 3:45 | Change **Operator identity** to `incident-commander`. | "Changing the operator clears the old decision. The console never reuses a stale check." | The trace disappears and **Approve replay** is disabled. |
| 4:00 | Tick the checkbox again if cleared. Click **Check replay**. | "A different operator, the same bound evidence." | Banner "Preflight passed". The **Active approval** card shows `safety-reviewer`, "Bound to this rehearsal until [time]". |
| 4:20 | Change the target to `https://httpbin.org/status/200` and click **Check replay**. | "Drift closes the gate. The approval and the rehearsal both point at the old URL." | **Destination binding** `FAIL`: "The destination changed after rehearsal". **Two-person approval** `FAIL`. Restore the target. |
| 4:50 | Click **Check replay**, then **Approve replay**. | "The server re-runs the same nine checks before it accepts the replay. The UI is guidance; the API is the authority." | Message: "Guard approved the replay and queued it for delivery." |
| 5:10 | Point at the inspector timeline. | "Every decision is in the append-only audit trail. The replay intent is keyed to the passing rehearsal, so a repeated request returns the same intent instead of sending twice; the delivery-intent race tests cover that." | Audit entries including `replay.approval_recorded` and `replay.approved`, with each operator's reason. |
| 5:30 | Point at the **Intent outbox** and **BullMQ transport** in **Live Render fabric**. | "Every job is committed to Postgres before Key Value sees it. If Redis disappears, the reconciler rebuilds the jobs from Postgres every ten minutes." | Outbox counts and queue counts. |
| 6:15 | Editor: `tests/runtime.test.ts`, the test "recovers stranded deliveries, applies retention, and publishes a cron heartbeat". | "This is the recovery path under test: stranded deliveries are recovered and re-dispatched." | The test source; optionally the passing `npm test` output. |
| 6:45 | Click **Download bundle**. In a terminal in the repository, run `npm run evidence:inspect -- ./<bundle>.json`. | "The bundle is canonical JSON with a SHA-256 digest and an HMAC seal. Anyone can inspect it; the deployment's key verifies it." | The JSON summary prints. Do not run `verify` on camera, because it needs the evidence secret in the environment. |
| 7:20 | Browser: `/openapi.json`. | "The contract is versioned OpenAPI 3.1." | `"openapi":"3.1.0"` and `info.version`. |
| 7:40 | End card. | "At-least-once delivery, made explicit. Replay Room: rehearse a failed webhook before you replay it." | Repository URL, drill URL, and the docs link. |

## Cold-start fallback

The free Render web service sleeps after about 15 minutes without traffic, and waking takes from a few seconds to about a minute. The scheduled smoke check on 2026-10-25 saw a 12.5-second wake. The static console and the drill do not sleep; only the API does.

If `/health` or **Open console** hangs while you are recording, say:

> "This is Render's free tier doing what it says: the API sleeps when idle and takes a moment to wake. Replay Room shows that constraint instead of hiding it. While it wakes, here's the public drill, which is static and doesn't need the API."

Then:

1. Run the drill from the 60-second version.
2. Retry **Open console** after 30 seconds. If it still fails, switch to the pre-recorded authenticated segments.
3. If the console loads but a message reads "Could not load Replay Room", click **Refresh** once.

Always keep pre-recorded copies of the 3-minute and 8-minute segments, so a live talk never depends on a cold start.

## After recording

- Delete or blur any frame that shows an ingest URL, a token, or a Render dashboard page.
- Note the deployed version and commit you read in setup step 2 in the video description.
- Upload the video and resolve `[[DEMO_VIDEO_URL]]` in [link-map.md](link-map.md).
