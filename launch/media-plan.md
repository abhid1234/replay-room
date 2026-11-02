# Media plan

Every image and video the launch needs, where it comes from, and its alt text. Status values:

- **Ready**: exists in the repository today.
- **Must capture**: has to be captured from the live product. Do not substitute mockups or generated images.

The demo video, hero GIF, and seven screenshots were recorded on 2026-11-02 on a local run of the deployed `0.3.0` release (commit `26c4cd6`), because the live API was down (blocker B1) and the recording environment cannot reach Render. The console, API, worker, and guard are the same code as the live deployment. The incidents are synthetic, and the receivers are the API's built-in development sinks. The video carries a visible "Local run · Replay Room v0.3.0 · synthetic events" label throughout. Shots that need Render-specific values or surfaces outside the console (S03 and S09–S12) still have to be captured from the live product. [video/README.md](video/README.md) explains how to re-record.

## Capture rules

- Browser: a clean profile, 1440×900 viewport or larger, 100% zoom, device pixel ratio 2. Hide bookmarks and extensions.
- Export PNG at the listed size. Keep each file under 1 MB; compress with a lossless optimizer if needed.
- Use the staged incidents from the setup in [demo-script.md](demo-script.md): `Billing events (demo)`, Event A (elevated risk), and Event B (high risk).
- **Blur before saving:** every ingest URL (the Ingest workbench card and the "Endpoint created" message), the admin token field if it has focus, and any Render dashboard page. Ingest URLs are capabilities; anyone holding one can send events.
- Never capture real customer data. All staged payloads must be synthetic.
- Label anything recorded outside the live deployment, in the frame or in the caption, and never present it as the live service.

## Ready assets

| File | Size | Use | Alt text |
|---|---|---|---|
| `launch/assets/replay-room-demo.mp4` | 1920×1080, 2:05, H.264 with a silent AAC track, 9.1 MB | LinkedIn and X native video, Substack, Show HN replies | A captioned walkthrough recorded on a local run of Replay Room v0.3.0 with synthetic events. The public outage drill runs first, labeled as a simulation. In the operator console, a payment webhook with an idempotency key is rated elevated risk, rehearsed against a fixed receiver, passes all nine replay conditions, and is replayed. A second webhook without an idempotency key is rated high risk; after an acknowledgement and an approval by safety-reviewer, the approver's own execution is blocked, and a second operator, incident-commander, passes the guard and replays it. |
| `launch/assets/replay-room-demo-cover.png` | 1920×1080 | Video thumbnail | Replay Room: "Rehearse a failed webhook before you replay it." with the repository URL. |
| `launch/assets/hero-drill-to-guard.gif` | 960×540, 12 fps, 14 s, 1.3 MB | X, README, Product Hunt | A labeled simulation steps a payment webhook through capture, receiver failure, dead letter, rehearsal, guard, and replay. Then the console, on a local run, blocks a high-risk replay its own approver tries to execute and passes it once a different operator checks the same bound evidence. |
| `launch/assets/hero-drill-to-guard.mp4` | 1280×720, 14 s, 0.3 MB | Platforms that prefer video to GIF | Same as the GIF. |
| `diagrams/replay-room-render-architecture.png` | 1950×592 | Substack, Show HN replies, press kit, the 8-minute demo | Replay Room architecture. A webhook provider posts to a Render web service that runs the API, worker, and reconciler. The web service commits to a Postgres durable ledger first, then enqueues to Key Value. An incident operator uses a React console on a Render static site. The worker delivers or rehearses to the customer receiver. Postgres exports signed evidence that a CLI verifies offline. A production upgrade splits the API, background worker, and cron reconciler over backed-up Postgres and persistent Key Value. |
| `diagrams/replay-room-render-architecture.svg` | Vector | Embedding where SVG is supported | Same as the PNG. |
| `launch/assets/social-banner-1100x220.png` | 1100×220 | Substack header, newsletter banner, profile featured section | Replay Room banner: "Rehearse a failed webhook before you replay it." beside four steps: dead letter, rehearse, guard with nine conditions, and replay through a durable intent. |
| `launch/assets/og-image-1200x630.png` | 1200×630 | Link previews, Product Hunt gallery slide 1, press kit | "A replay is a production change." Replay Room rehearses a failed webhook before replay: exact payload, exact destination, nine checks, and a second operator for high-risk replays. A seven-step rail reads Receive, Deliver, Dead letter, Diagnose, Rehearse, Guard, Replay. |

The banner and Open Graph image are designed graphics, not product screenshots. Their editable sources are `launch/assets/social-banner.html` and `launch/assets/og-image.html`.

## Screenshot shot list

Ready shots are 1920×1080 and were recorded on the local run described above. Must-capture shots come from the live product after B1 is fixed.

| ID | File name | Status | What to capture | Expected visible state | Alt text |
|---|---|---|---|---|---|
| S01 | `launch/assets/s01-landing.png` | Ready | The console landing page before connecting | Hero "Every event leaves a flight recorder.", the **Live stack** panel with an empty token field, and the drill standing by | The Replay Room landing page with the headline "Every event leaves a flight recorder", an admin-token sign-in panel, and a simulated outage drill ready to run. |
| S02 | `launch/assets/s02-drill-complete.png` | Ready | The outage drill after it finishes | "Flight recorder 08 / 08", final step `204` "Production replay delivered", payload seal `sha256:7f3a…91c2 ✓` | A completed, clearly labeled simulation: eight steps from payment captured through receiver failure, dead letter, rehearsal, risk assessment, guard, and replay delivered. |
| S03 | `launch/assets/s03-live-fabric.png` | Must capture | **Live Render fabric** after **Open console** | Postgres and Key Value latency, BullMQ counts, Intent outbox, Worker and Reconciler heartbeats, topology `embedded-free` | The live Render fabric panel showing Postgres and Key Value latency, queue counts, the delivery-intent outbox, and worker and reconciler heartbeats. |
| S04 | `launch/assets/s04-diagnosis.png` | Ready | **Replay inspector** for Event A | **Flight recorder diagnosis** `receiver outage` with evidence and next action; risk `elevated` | A dead-lettered webhook diagnosed as a receiver outage, with the attempt evidence, a recommended next action, and an elevated duplicate-side-effect risk. |
| S05 | `launch/assets/s05-guard-pass.png` | Ready | Event A after rehearsal and **Check replay** | Banner "Preflight passed"; nine `PASS` rows | The replay guard decision trace with all nine conditions passing, from operator reason to two-person approval. |
| S06 | `launch/assets/s06-high-risk.png` | Ready | Event B's risk card before acknowledgement | Risk `high`, its signals, and the checkbox "I reviewed the ambiguous outcome and accept the duplicate-side-effect risk." | A high duplicate-side-effect risk for a webhook sent without an idempotency key, with an explicit acknowledgement checkbox. |
| S07 | `launch/assets/s07-self-approval-blocked.png` | Ready | Event B after the approver runs **Check replay** | Banner "1 blocker"; the **Two-person approval** row reads `FAIL` "A different operator must execute the approved replay" | The replay guard blocking a high-risk replay because the operator who approved it is the one trying to execute it. |
| S08 | `launch/assets/s08-dual-control-pass.png` | Ready | Event B after switching to `incident-commander` and **Check replay** | Banner "Preflight passed"; the **Active approval** card shows `safety-reviewer` | A high-risk replay passing all nine conditions with a time-bound approval from a different operator. |
| S09 | `launch/assets/s09-destination-drift.png` | Must capture | Event B with the target changed after rehearsal | **Destination binding** `FAIL` "The destination changed after rehearsal" | The replay guard rejecting a replay because the destination no longer matches the rehearsed destination. |
| S10 | `launch/assets/s10-evidence-inspect.png` | Must capture | Terminal running `npm run evidence:inspect -- ./<bundle>.json` | The JSON summary of the downloaded bundle | A terminal inspecting a downloaded Replay Room evidence bundle and printing its summary. |
| S11 | `launch/assets/s11-launch-proof.png` | Must capture | Browser showing `/.well-known/replay-room` | `version`, `deployment.commit`, `topology`, and the capabilities list | The live launch-proof manifest reporting the deployed version, Git commit, topology, and capabilities, including two-person approval. |
| S12 | `launch/assets/s12-hf-space.png` | Must capture | The Hugging Face Space after the drill runs | The completed drill and the "One incident, five safety boundaries" proof links | The credential-free Hugging Face drill with links to the live Render console, OpenAPI contract, GitHub source, and fixture dataset. |

Capture S12 only after the Space is republished. Today it serves the `v0.1.2` build.

## Demo video

`launch/assets/replay-room-demo.mp4` follows the 3-minute and 8-minute scripts in [demo-script.md](demo-script.md), compressed to 2:05 with on-screen captions instead of narration:

| Time | Content |
|---|---|
| 0:00–0:25 | The question a timeout leaves open, then the public drill, labeled as a simulation |
| 0:25–1:05 | Event A: diagnosis `receiver outage`, risk `elevated`, a passing rehearsal against the fixed receiver, all nine conditions passing, and the replay |
| 1:05–2:00 | Event B: risk `high`, the acknowledgement, the approval by `safety-reviewer`, the self-approval block, the pass for `incident-commander`, and the replay |
| 2:00–2:05 | Closing card with the repository URL and the local-run note |

The captions use only claims from [messaging.md](messaging.md): nine conditions, a 30-minute approval bound to the rehearsal, payload, and destination, and a durable delivery intent in Postgres.

## Hero GIF

`launch/assets/hero-drill-to-guard.gif` and `.mp4` cut three moments from the demo video:

| Segment | Duration | Content |
|---|---|---|
| 1 | 0–8 s | The drill, from "Outage drill is standing by" to "Production replay delivered" |
| 2 | 8–10.5 s | The self-approval block on Event B |
| 3 | 10.5–14 s | The dual-control pass with the active approval from `safety-reviewer` |

Label segment 1 as a simulation in any caption; the GIF's own captions already do.

## Architecture figure placement

- **Substack:** under the "Built on Render, constraints included" heading; the essay embeds it.
- **Show HN:** link to `docs/ARCHITECTURE.md` in the first comment; Hacker News does not render images.
- **LinkedIn:** attach the demo video; the diagram is the fallback image.
- **Press kit:** list it in the asset inventory with both the PNG and SVG paths.
- **8-minute demo:** opening frame.

## Product Hunt gallery

Product Hunt recommends 1270×760 gallery images. Export each from the matching capture:

| Slide | Source | File name |
|---|---|---|
| 1 | Open Graph image, letterboxed to 1270×760 on `#f4f0e7` | `launch/assets/ph-01-og.png` |
| 2 | S02 | `launch/assets/ph-02-drill.png` |
| 3 | S04 | `launch/assets/ph-03-diagnosis.png` |
| 4 | S08 | `launch/assets/ph-04-dual-control.png` |
| 5 | S03 (must capture) | `launch/assets/ph-05-live-fabric.png` |

The Product Hunt thumbnail is 240×240. There is no Replay Room logo yet; combine the banner's signal-orange bar with the "RR" monogram from the console masthead, set in IBM Plex Mono on `#fffdf7`, and keep it legible at 48×48.

## Banner and Open Graph specification

| Spec | Social banner | Open Graph image |
|---|---|---|
| Size | 1100×220 | 1200×630 |
| Safe area | 1068×188 (16 px inset) | 1100×580 (centered) |
| Background | `#f4f0e7` with a 22 px grid at 5% opacity | `#f4f0e7` with a 24 px grid at 5% opacity |
| Card | `#fffdf7`, 1 px `#cfc8bb` border | `#fffdf7`, 1 px `#cfc8bb` border, soft shadow |
| Headline | Newsreader 500, 38 px; second line in `#d84f2a` | Newsreader 500, 84 px; second line in `#d84f2a` |
| Labels | IBM Plex Mono 600, 13 px, 0.16 em tracking | IBM Plex Mono 600, 17 px, 0.14 em tracking |
| Body | Inter 500 | Inter 500, 26 px |
| Text | "Rehearse a failed webhook before you replay it." and the repository URL | "A replay is a production change.", the subline, the seven-step rail, and both URLs |
| Format | PNG, under 100 KB | PNG, under 300 KB |

Both palettes come from `launch-replay-room.html`: ink `#151617`, paper `#f4f0e7`, signal `#d84f2a`, safe `#16745d`, warn `#9a6215`, blue `#245f78`.

To use the Open Graph image on the live console, the release would add `og:image` and `twitter:card` meta tags to `web/index.html`. That is a product change, so it is listed as an optional release item rather than done in this kit.
