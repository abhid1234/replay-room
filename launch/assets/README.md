# Launch assets

| File | Size | Status | Source |
|---|---|---|---|
| `social-banner-1100x220.png` | 1100×220, 36 KB | Ready | `social-banner.html` |
| `og-image-1200x630.png` | 1200×630, 87 KB | Ready | `og-image.html` |

These two images are designed graphics, not product screenshots. Every word on them is a claim the product supports today: the nine conditions, rehearsal bound to the exact payload and destination, a second operator for high-risk replays, and durable intents.

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

Product screenshots S01–S12, the hero GIF, and the Product Hunt gallery must be captured from the live product after the release is deployed. File names, sizes, the exact visible state, and alt text for each are in [media-plan.md](../media-plan.md). Save them in this folder with the listed names.
