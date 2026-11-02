# Launch assets

| File | Size | Status | Source |
|---|---|---|---|
| `replay-room-demo.mp4` | 1920×1080, 2:05, 9.1 MB | Ready | Recorded with [`../video/`](../video/README.md) |
| `replay-room-demo-cover.png` | 1920×1080 | Ready | Closing frame of the demo video |
| `hero-drill-to-guard.gif` | 960×540, 12 fps, 14 s, 1.3 MB | Ready | Cut from the demo video |
| `hero-drill-to-guard.mp4` | 1280×720, 14 s, 0.3 MB | Ready | Cut from the demo video |
| `s01-landing.png`, `s02-drill-complete.png`, `s04-diagnosis.png` to `s08-dual-control-pass.png` | 1920×1080 each, under 1 MB | Ready | Captured during the recording, without captions or cursor |
| `social-banner-1100x220.png` | 1100×220, 36 KB | Ready | `social-banner.html` |
| `og-image-1200x630.png` | 1200×630, 87 KB | Ready | `og-image.html` |

The video, GIF, and screenshots come from a local run of the deployed `0.3.0` release (commit `26c4cd6`) with synthetic events, recorded on 2026-11-02 while the live API was down. The video labels itself "Local run · Replay Room v0.3.0 · synthetic events" in every frame, and ingest URLs are blurred. Alt text for each file is in [media-plan.md](../media-plan.md).

The banner and Open Graph image are designed graphics, not product screenshots. Every word on them is a claim the product supports today: the nine conditions, rehearsal bound to the exact payload and destination, a second operator for high-risk replays, and durable intents.

The architecture diagram is reused from [`../../diagrams/`](../../diagrams) rather than copied here: `replay-room-render-architecture.png` (1950×592), `.svg`, `.excalidraw` (editable), and `.mmd` (Mermaid source).

## Re-rendering

Edit the HTML, then render from the repository root:

```bash
npx playwright screenshot --viewport-size "1100, 220" launch/assets/social-banner.html launch/assets/social-banner-1100x220.png
npx playwright screenshot --viewport-size "1200, 630" launch/assets/og-image.html launch/assets/og-image-1200x630.png
```

Both pages load Newsreader, Inter, and IBM Plex Mono from Google Fonts, so render with a network connection; otherwise the browser falls back to Georgia and Menlo. The fonts are licensed under the SIL Open Font License and are not stored in this repository. The palette comes from `launch-replay-room.html`. These web fonts stand in for the brief's system fonts so the PNGs render the same everywhere.

Open each PNG after rendering and check that no text wraps unexpectedly and nothing is clipped at the edges.

## Still to capture

Screenshots S03 and S09–S12 and the Product Hunt gallery must come from the live product after the API is restored. File names, the exact visible state, and alt text for each are in [media-plan.md](../media-plan.md). Save them in this folder with the listed names.
