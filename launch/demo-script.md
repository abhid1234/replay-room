# Demo script

Three cuts of the same story: 60 seconds, 3 minutes, and an 8-minute technical walkthrough. Bold labels are the console's visible text, taken from `web/src/App.tsx` and `web/src/IncidentDrill.tsx`; that text is the same in the deployed `0.3.0` console and on `main`.

Two rules apply to every recording:

1. **Never show a secret.** The admin token field is masked, but do not paste it on camera. Blur every ingest URL: the `Endpoint created. Send webhooks to …/ingest/<key>` message and the Ingest workbench card both show the full capability URL. Never show Render environment pages.
2. **Say what is simulated.** The outage drill is a labeled simulation. Everything after **Open console** is the live product.

Three console behaviors shape the scripts:

- **Status messages are brief and far from the action.** Messages such as "Rehearsal queued…" appear in the **Live stack** panel at the top of the page, and the next successful poll (every 5 seconds) replaces them with `Connected to …`. The scripts rely on what changes in the inspector. To show a message on camera, cut to the top panel right after the click.
- **Refresh does not reload the inspector.** **Refresh** updates counters, the Event stream, and the fabric panel. To see new rehearsals or audit entries in the **Replay inspector**, click the event's row in the **Event stream** again. The inspector keeps the operator, target, and reason you typed.
- **Rows are identified by ID and time.** Event stream rows show the status, the first eight characters of the event ID, and the received time. Note which row is Event A and which is Event B during setup.

## Setup before recording

Do this 10–15 minutes before you start, so the free API is awake and the incidents are staged.

1. Open <https://replay-room-api.onrender.com/health>. Expected: JSON with `"status":"ok"` and two latency values. If it takes longer than a minute, see [Cold-start fallback](#cold-start-fallback).
2. Open <https://replay-room-api.onrender.com/.well-known/replay-room> and note `version` and `deployment.commit`. You will say them on camera.
3. Choose two receivers you control: one that fails and one that succeeds. Public examples: `https://httpbin.org/status/503` always returns 503, and `https://httpbin.org/status/204` always returns 204. Rehearse the whole sequence once before recording; a third-party receiver can change behavior.
4. Use a clean browser profile at 1440×900 and 100% zoom, with notifications and extensions off.
5. Open <https://replay-room-web.onrender.com>. Paste the admin token from the Render dashboard while not recording, leave **Remember on this browser** unchecked, and click **Open console**. The Live stack panel shows `Connected to https://replay-room-api.onrender.com`.
6. Under **Create endpoint**, fill in Name `Billing events (demo)`, Receiver URL `https://httpbin.org/status/503`, Signature profile **Unsigned**, and Retry budget `3`, then click **Create ingest URL**.
7. In the **Ingest workbench**, click **Copy ready cURL**. In a terminal, off camera:
   - **Event A (elevated risk):** run the copied command after changing `Idempotency-Key: launch-demo-001` to a fresh value, such as `launch-demo-a-1`. A new key returns HTTP 202; a reused key returns 200 and the existing event, because ingest deduplicates on the key.
   - **Event B (high risk):** run the command again with the whole `--header 'Idempotency-Key: …'` line removed. A missing idempotency key makes the replay high risk.
8. Wait about 10 seconds and click **Refresh**. Both events show `dead letter` in the **Event stream** after three attempts with roughly 1- and 2-second backoffs. Note their IDs and times; Event A is the earlier one.

## 60-second version

The public story, no token needed. The drill runs in about six seconds, so the narration runs over the completed flight recorder.

| Time | On screen | Narration | Expected visible outcome |
|---|---|---|---|
| 0:00 | Landing page, hero "Every event leaves a flight recorder." | "A webhook times out. Did the receiver charge the card before the connection dropped? The queue can't tell you, and pressing retry can bill the customer twice." | Hero, **Live stack** panel, and the drill reading "Outage drill is standing by". |
| 0:08 | Scroll to "Watch one event survive an outage." | "This is a simulation, labeled as one, using the same states as the real worker." | "Incident drill / RR-1042" and the **Run outage drill** button. |
| 0:12 | Click **Run outage drill**. | "Watch one event go through it." | The button reads **Drill running**. Eight steps reveal about every 0.8 seconds and finish around 0:18. |
| 0:18 | Hold on the completed flight recorder. Point at the first four rows. | "The event is saved before anything is acknowledged. The receiver fails with a 503, retries run out, and it lands in dead letter." | "Payment event captured" `202`, "Worker claimed intent" `RUN`, "Receiver unavailable" `503`, "Retry budget exhausted" `DLQ`. |
| 0:28 | Point at the last four rows and the payload seal. | "Instead of a blind resend, the exact payload is rehearsed first, the risk is assessed, and the guard checks that the payload and destination still match. Only then does the replay go out." | "Rehearsal accepted" `204`, "Replay risk assessed" `ELEV`, "Replay guard sealed" `PASS`, "Production replay delivered" `204`; "Flight recorder 08 / 08"; the payload seal reads `sha256:7f3a…91c2 ✓`; the button reads **Run it again**. |
| 0:40 | Cut to the pre-recorded nine-row guard trace from the 3-minute version. | "In the real console, nine conditions have to pass, and a high-risk replay needs a second operator." | The **Replay guard** banner reads "Preflight passed" above nine `PASS` rows. |
| 0:50 | End card: repository URL and drill URL. | "Replay Room: rehearse a failed webhook before you replay it. It's open source, and it runs on Render." | End card holds for three seconds. |

## 3-minute version

The core recovery on the live console with **Event A** (elevated risk, single operator).

| Time | On screen | Narration | Expected visible outcome |
|---|---|---|---|
| 0:00 | The 60-second drill sequence, sped up 2× in editing. | "This drill is a simulation. Now the real thing." | As in the 60-second version. |
| 0:25 | Console already open. Point at **Live Render fabric**. | "This console reads the live stack: Postgres and Key Value latency, queue counts, the intent outbox, and worker heartbeats." | Postgres and Key Value latencies in ms; BullMQ counts (Waiting, Active, Delayed, Failed); the Intent outbox; Worker and Reconciler heartbeats; a deploy line reading `replay-room-api / <instance> / embedded-free / observed <time>`. |
| 0:40 | Click **Event A** in the **Event stream**. | "This demo event failed three times against a receiver that returns 503." | The **Replay inspector** opens. **Flight recorder diagnosis** reads `receiver outage`, with the attempt evidence and a next action. The payload panel shows the staged `launch.demo` JSON. |
| 0:55 | Point at **Duplicate-side-effect risk**. | "It carried an idempotency key, so the risk is elevated, not high. One operator can handle it." | Risk `elevated`, with its signals listed and no acknowledgement checkbox. |
| 1:05 | Type `incident-commander` in **Operator identity**. Change **Rehearsal / replay target** to `https://httpbin.org/status/204`. Click **Run rehearsal**. | "First, rehearse the exact payload against the fixed receiver." | The Live stack panel briefly shows "Rehearsal queued. Refresh in a moment to inspect the result." |
| 1:20 | After a few seconds, click **Event A** in the Event stream again. | "The rehearsal passed, and it's bound to this payload's hash and this exact URL." | The inspector timeline shows `rehearsal.passed`; the operator, target, and reason are still filled in. |
| 1:30 | Click **Check replay**. | "Preflight runs all nine checks without changing anything." | The **Replay guard** banner reads "Preflight passed" above nine `PASS` rows, including **Two-person approval** with "Replay risk does not require a second operator". |
| 1:50 | Edit one character of the target URL. | "If I change the destination, the proof no longer applies." | The trace disappears and **Approve replay** is disabled. Restore the URL. |
| 2:05 | Click **Check replay**, then **Approve replay**. | "Now the replay goes through a durable intent in Postgres." | **Approve replay** disables itself. The Live stack panel briefly shows "Guard approved the replay and queued it for delivery." Within one poll, the Event A row reads `delivered`. |
| 2:25 | Click **Download bundle**. | "The whole incident exports as signed evidence: attempts, rehearsal, decision, and audit trail." | The browser downloads `replay-room-<event id>.evidence.json`. |
| 2:40 | End card. | "Before you press replay, what can you prove?" | Repository URL and drill URL. |

## 8-minute technical walkthrough

For engineers and interviewers. Use **Event B** (high risk) and show the system around it.

| Time | On screen | Narration | Expected visible outcome |
|---|---|---|---|
| 0:00 | The architecture diagram (`diagrams/replay-room-render-architecture.png`). | "Four Render primitives: a static site for the console, a web service for the API with the worker and reconciler embedded on the free plan, Postgres as the ledger, and Key Value as transport." | The full diagram, including the free lab, portable proof, and production upgrade boxes. |
| 0:45 | `render.yaml` in the repository. | "One Blueprint creates the whole stack. Every plan is free, which is why the worker is embedded; Render has no free background-worker or cron plan." | `replay-room-api` (plan `free`, Docker), `replay-room-web` (static), `replay-room-queue` (Key Value), and `replay-room-db`. |
| 1:30 | Browser: `/.well-known/replay-room`. | "The live deployment states its version, commit, topology, and capabilities. The release checks verify this file rather than trusting a green badge." | JSON with `version`, `deployment.commit`, `"topology":"embedded-free"`, and the `two-person-approval` capability. |
| 2:00 | Console: click **Event B**. | "This event had no idempotency key." | The diagnosis reads `receiver outage`. **Duplicate-side-effect risk** reads `high`, with the checkbox "I reviewed the ambiguous outcome and accept the duplicate-side-effect risk." |
| 2:30 | **Operator identity** `safety-reviewer`, target `https://httpbin.org/status/204`, then **Run rehearsal**. After a few seconds, click **Event B** again. | "Same rehearsal step, bound to the hash and the URL." | `rehearsal.passed` in the inspector timeline. |
| 3:00 | Tick the checkbox. Click **Record approval**. | "High risk means acknowledgement plus dual control. This approval lasts 30 minutes and is bound to this rehearsal, payload, and destination." | The inspector reloads by itself. The Live stack panel briefly shows "safety-reviewer approved this high-risk replay until [time]. A different operator must execute it." |
| 3:20 | Click **Check replay** as `safety-reviewer`. | "The approver can't execute their own approval." | The banner reads "1 blocker". The **Two-person approval** row reads `FAIL`: "A different operator must execute the approved replay". |
| 3:45 | Change **Operator identity** to `incident-commander`. | "Changing the operator clears the old decision. The console never reuses a stale check." | The trace disappears and **Approve replay** is disabled. The risk checkbox stays ticked. |
| 4:00 | Click **Check replay**. | "A different operator, the same bound evidence." | The banner reads "Preflight passed". The **Active approval** card shows `safety-reviewer`, "Bound to this rehearsal until [time]". |
| 4:20 | Change the target to `https://httpbin.org/status/200` and click **Check replay**. | "Drift closes the gate. The approval and the rehearsal both point at the old URL." | The banner reads "2 blockers". **Destination binding** reads `FAIL`: "The destination changed after rehearsal"; **Two-person approval** reads `FAIL`. Restore the target. |
| 4:50 | Click **Check replay**, then **Approve replay**. | "The server re-runs the same nine checks before it accepts the replay. The UI is guidance; the API is the authority." | **Approve replay** disables itself, and the Event B row reads `delivered` within one poll. |
| 5:10 | Click **Event B** in the Event stream again, and point at the timeline. | "Every decision is in the audit trail. The replay intent is keyed to the passing rehearsal, so a repeated request returns the same intent instead of sending twice; the delivery-intent race tests cover that." | Audit entries including `replay.approval_recorded` and `replay.approved`, each with the submitted reason. Edit the prefilled reason for each operator if you want the entries to differ. |
| 5:30 | Point at the **Intent outbox** and **BullMQ transport** in **Live Render fabric**. | "Every job is committed to Postgres before Key Value sees it. If Redis disappears, the reconciler rebuilds the jobs from Postgres every ten minutes." | Outbox counts and queue counts. |
| 6:15 | Editor: `tests/runtime.test.ts`, the test "recovers stranded deliveries, applies retention, and publishes a cron heartbeat". | "This is the recovery path under test: stranded deliveries are recovered and re-dispatched." | The test source; optionally, a passing `npm test` run. |
| 6:45 | Click **Download bundle**. In a terminal in the repository, run `npm run evidence:inspect -- ./replay-room-<event id>.evidence.json`. | "The bundle is versioned JSON. Its canonical form is hashed and sealed with an HMAC. Anyone can inspect it; the deployment's key verifies it." | The JSON summary prints. Do not run `verify` on camera; it needs the evidence secret in the environment. |
| 7:20 | Browser: `/openapi.json`. | "The contract is versioned OpenAPI 3.1." | `"openapi":"3.1.0"` and `info.version`. |
| 7:40 | End card. | "At-least-once delivery, made explicit. Replay Room: rehearse a failed webhook before you replay it." | Repository URL, drill URL, and the docs link. |

## Cold-start fallback

The free Render web service sleeps after about 15 minutes without traffic, and waking takes from a few seconds to about a minute. The scheduled smoke check on 2026-10-25 saw a 12.5-second wake. The static console and the drill do not sleep; only the API does.

If `/health` or **Open console** hangs while you are recording, say:

> "This is Render's free tier doing what it says: the API sleeps when idle and takes a moment to wake. Replay Room shows that constraint instead of hiding it. While it wakes, here's the public drill, which is static and doesn't need the API."

Then:

1. Run the drill from the 60-second version.
2. Retry **Open console** after 30 seconds. While the API is waking, the Live stack panel shows the raw error: `Failed to fetch`, `HTTP 502` or `HTTP 503`, or a JSON parse error if the platform answers with an HTML page. If it still fails after a minute, switch to the pre-recorded authenticated segments.

Always keep pre-recorded copies of the 3-minute and 8-minute segments, so a live talk never depends on a cold start.

## After recording

- Delete or blur any frame that shows an ingest URL, a token, or a Render dashboard page.
- Note the deployed version and commit you read in setup step 2 in the video description.
- Upload the video and resolve `[[DEMO_VIDEO_URL]]` in [link-map.md](link-map.md).
