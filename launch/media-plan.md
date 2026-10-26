# Media plan

Every image the launch needs, where it comes from, and its alt text. Status values:

- **Ready**: exists in the repository today.
- **Must capture**: has to be captured from the live product after the release is deployed. Do not substitute mockups, generated images, or screenshots of a local build.

No product screenshots exist in this kit. Capture them after the release train in [release-checklist.md](release-checklist.md) has deployed the release commit, so the screenshots match what visitors will see.

## Capture rules

- Browser: a clean profile, 1440×900 viewport, 100% zoom, device pixel ratio 2. Hide bookmarks and extensions.
- Export PNG at the listed size. Keep each file under 1 MB; compress with a lossless optimizer if needed.
- Use the staged incidents from the setup in [demo-script.md](demo-script.md): `Billing events (demo)`, Event A (elevated risk), and Event B (high risk).
- **Blur before saving:** every ingest URL (the Ingest workbench card and the "Endpoint created" message), the admin token field if it has focus, and any Render dashboard page. Ingest URLs are capabilities; anyone holding one can send events.
- Never capture real customer data. All staged payloads must be synthetic.

## Ready assets

| File | Size | Use | Alt text |
|---|---|---|---|
| `diagrams/replay-room-render-architecture.png` | 1950×592 | Substack, Show HN replies, press kit, the 8-minute demo | Replay Room architecture. A webhook provider posts to a Render web service that runs the API, worker, and reconciler. The web service commits to a Postgres durable ledger first, then enqueues to Key Value. An incident operator uses a React console on a Render static site. The worker delivers or rehearses to the customer receiver. Postgres exports signed evidence that a CLI verifies offline. A production upgrade splits the API, background worker, and cron reconciler over backed-up Postgres and persistent Key Value. |
| `diagrams/replay-room-render-architecture.svg` | Vector | Embedding where SVG is supported | Same as the PNG. |
| `launch/assets/social-banner-1100x220.png` | 1100×220 | Substack header, newsletter banner, profile featured section | Replay Room banner: "Rehearse a failed webhook before you replay it." beside four steps: dead letter, rehearse, guard with nine conditions, and replay through a durable intent. |
| `launch/assets/og-image-1200x630.png` | 1200×630 | Link previews, Product Hunt gallery slide 1, press kit | "A replay is a production change." Replay Room rehearses a failed webhook before replay: exact payload, exact destination, nine checks, and a second operator for high-risk replays. A seven-step rail reads Receive, Deliver, Dead letter, Diagnose, Rehearse, Guard, Replay. |

The banner and Open Graph image are designed graphics, not product screenshots. Their editable sources are `launch/assets/social-banner.html` and `launch/assets/og-image.html`.

## Screenshot shot list (must capture)

| ID | File name | Size | What to capture | Expected visible state | Alt text |
|---|---|---|---|---|---|
| S01 | `launch/assets/s01-landing.png` | 1600×1000 | The console landing page before connecting | Hero "Every event leaves a flight recorder.", the **Live stack** panel with an empty token field, and the drill standing by | The Replay Room landing page with the headline "Every event leaves a flight recorder", an admin-token sign-in panel, and a simulated outage drill ready to run. |
| S02 | `launch/assets/s02-drill-complete.png` | 1600×1000 | The outage drill after it finishes | "Flight recorder 08 / 08", final step `204` "Production replay delivered", payload seal `sha256:7f3a…91c2 ✓` | A completed, clearly labeled simulation: eight steps from payment captured through receiver failure, dead letter, rehearsal, risk assessment, guard, and replay delivered. |
| S03 | `launch/assets/s03-live-fabric.png` | 1600×1000 | **Live Render fabric** after **Open console** | Postgres and Key Value latency, BullMQ counts, Intent outbox, Worker and Reconciler heartbeats, topology `embedded-free` | The live Render fabric panel showing Postgres and Key Value latency, queue counts, the delivery-intent outbox, and worker and reconciler heartbeats. |
| S04 | `launch/assets/s04-diagnosis.png` | 1600×1000 | **Replay inspector** for Event A | **Flight recorder diagnosis** `receiver outage` with evidence and next action; risk `elevated` | A dead-lettered webhook diagnosed as a receiver outage, with the attempt evidence, a recommended next action, and an elevated duplicate-side-effect risk. |
| S05 | `launch/assets/s05-guard-pass.png` | 1600×1000 | Event A after rehearsal and **Check replay** | Banner "Preflight passed"; nine `PASS` rows | The replay guard decision trace with all nine conditions passing, from operator reason to two-person approval. |
| S06 | `launch/assets/s06-high-risk.png` | 1600×1000 | Event B's risk card before acknowledgement | Risk `high`, its signals, and the checkbox "I reviewed the ambiguous outcome and accept the duplicate-side-effect risk." | A high duplicate-side-effect risk for a webhook sent without an idempotency key, with an explicit acknowledgement checkbox. |
| S07 | `launch/assets/s07-self-approval-blocked.png` | 1600×1000 | Event B after the approver runs **Check replay** | Banner "1 blocker"; the **Two-person approval** row reads `FAIL` "A different operator must execute the approved replay" | The replay guard blocking a high-risk replay because the operator who approved it is the one trying to execute it. |
| S08 | `launch/assets/s08-dual-control-pass.png` | 1600×1000 | Event B after switching to `incident-commander` and **Check replay** | Banner "Preflight passed"; the **Active approval** card shows `safety-reviewer` | A high-risk replay passing all nine conditions with a time-bound approval from a different operator. |
| S09 | `launch/assets/s09-destination-drift.png` | 1600×1000 | Event B with the target changed after rehearsal | **Destination binding** `FAIL` "The destination changed after rehearsal" | The replay guard rejecting a replay because the destination no longer matches the rehearsed destination. |
| S10 | `launch/assets/s10-evidence-inspect.png` | 1600×900 | Terminal running `npm run evidence:inspect -- ./<bundle>.json` | The JSON summary of the downloaded bundle | A terminal inspecting a downloaded Replay Room evidence bundle and printing its summary. |
| S11 | `launch/assets/s11-launch-proof.png` | 1600×900 | Browser showing `/.well-known/replay-room` | `version`, `deployment.commit`, `topology`, and the capabilities list | The live launch-proof manifest reporting the deployed version, Git commit, topology, and capabilities, including two-person approval. |
| S12 | `launch/assets/s12-hf-space.png` | 1600×1000 | The Hugging Face Space after the drill runs | The completed drill and the "One incident, five safety boundaries" proof links | The credential-free Hugging Face drill with links to the live Render console, OpenAPI contract, GitHub source, and fixture dataset. |

Capture S12 only after the Space is republished. Today it serves the `v0.1.2` build.

## Hero GIF (must capture)

- **File:** `launch/assets/hero-drill-to-guard.gif`, plus `launch/assets/hero-drill-to-guard.mp4` for platforms that prefer video.
- **Size:** 1200×750 at 12 fps. Keep the GIF under 8 MB; the MP4 can be H.264 at about 2 Mbps.
- **Length:** 12–14 seconds, looping.

| Segment | Duration | Content |
|---|---|---|
| 1 | 0.0–1.5 s | Drill standing by: "Outage drill is standing by" and the **Run outage drill** button |
| 2 | 1.5–8.5 s | Click **Run outage drill**; the eight steps reveal at about 0.8 s each, from `202` to `204` |
| 3 | 8.5–10.5 s | Hold on "Flight recorder 08 / 08" and the sealed payload |
| 4 | 10.5–12.5 s | Cut to the live console: the nine-row trace with the **Two-person approval** row turning from `FAIL` to `PASS` (from S07 to S08) |
| 5 | 12.5–14.0 s | End frame: "Rehearse a failed webhook before you replay it." over a still of S08 |

Alt text: "A simulated outage drill steps a payment webhook through capture, receiver failure, dead letter, rehearsal, and guarded replay, then cuts to the live console, where a high-risk replay passes once a different operator executes the approved replay."

Label segment 2 as a simulation in any caption. The drill animates every 120 ms instead of 820 ms when the operating system requests reduced motion, so turn that setting off while capturing.

## Architecture figure placement

- **Substack:** after the "Built on Render, constraints included" heading, full width, with the alt text above.
- **Show HN:** link to `docs/ARCHITECTURE.md` in the first comment; Hacker News does not render images.
- **LinkedIn:** attach it only if the hero GIF is not ready; one image per post.
- **Press kit:** list it in the asset inventory with both the PNG and SVG paths.
- **8-minute demo:** opening frame.

## Product Hunt gallery (must capture, except slide 1)

Product Hunt recommends 1270×760 gallery images. Export each from the matching capture:

| Slide | Source | File name |
|---|---|---|
| 1 | Open Graph image, letterboxed to 1270×760 on `#f4f0e7` | `launch/assets/ph-01-og.png` |
| 2 | S02 | `launch/assets/ph-02-drill.png` |
| 3 | S04 | `launch/assets/ph-03-diagnosis.png` |
| 4 | S08 | `launch/assets/ph-04-dual-control.png` |
| 5 | S03 | `launch/assets/ph-05-live-fabric.png` |

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
