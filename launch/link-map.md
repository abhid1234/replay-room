# Link map

Canonical URLs for every public Replay Room surface, with the state each one returned on 2026-10-26. Copy in `launch/` uses only these URLs. Do not shorten them with a third-party shortener; the domain itself is part of the proof.

## Canonical surfaces

| Surface | Canonical URL | State on 2026-10-26 |
|---|---|---|
| Live console and public drill (Render static site) | <https://replay-room-web.onrender.com> | Live; serves the console built from the `0.3.0` source |
| API health | <https://replay-room-api.onrender.com/health> | `ok`; Postgres and Key Value both answered in 2 ms |
| OpenAPI contract | <https://replay-room-api.onrender.com/openapi.json> | OpenAPI 3.1, `info.version` `0.3.0` |
| Launch-proof manifest | <https://replay-room-api.onrender.com/.well-known/replay-room> | Version `0.3.0`, commit `26c4cd6`, topology `embedded-free` |
| Hugging Face Space (interactive drill) | <https://huggingface.co/spaces/abhid1234/replay-room> | Running; bundle matches the `v0.1.2` build |
| Hugging Face Space, direct origin | <https://abhid1234-replay-room.static.hf.space> | Same Space; the origin the smoke check reads |
| Hugging Face fixture dataset | <https://huggingface.co/datasets/abhid1234/replay-room-fixtures> | Public; manifest version `0.2.0` (6 incidents, 7 replay-guard records) |
| Source repository | <https://github.com/abhid1234/replay-room> | Public; Verify and CodeQL green on `main` |
| Current release | <https://github.com/abhid1234/replay-room/releases/tag/v0.3.0> | Published from `26c4cd6` with tarball, SBOM, and attestations |
| Latest release (moves with each release) | <https://github.com/abhid1234/replay-room/releases/latest> | Resolves to `v0.3.0` today |
| Architecture and failure model | <https://github.com/abhid1234/replay-room/blob/main/docs/ARCHITECTURE.md> | In repository |
| Deployment guide | <https://github.com/abhid1234/replay-room/blob/main/docs/DEPLOYING.md> | In repository |
| Long-form essay source | <https://github.com/abhid1234/replay-room/blob/main/docs/LAUNCH.md> | In repository; not yet published as a post |
| Changelog | <https://github.com/abhid1234/replay-room/blob/main/CHANGELOG.md> | In repository |
| npm package | `[[NPM_URL]]` | **Not published.** `npm view @avee1234/replay-room` returned `E404` |
| Substack essay | `[[SUBSTACK_URL]]` | **Not published** |

Use `/releases/latest` in social copy so links stay correct after the next release. Use the exact tag URL in the press kit and release notes.

## Placeholders

| Placeholder | Replace with | Only after |
|---|---|---|
| `[[NPM_URL]]` | `https://www.npmjs.com/package/@avee1234/replay-room` | `npm view @avee1234/replay-room version` prints the release version |
| `[[NPM_LINE]]` | `npm: https://www.npmjs.com/package/@avee1234/replay-room`, or delete the whole line | Same readback; if it still returns `E404`, delete the line |
| `[[SUBSTACK_URL]]` | The published essay URL | The essay loads while signed out |
| `[[DEMO_VIDEO_URL]]` | The uploaded demo video URL | The video plays while signed out |
| `[[CONTACT]]` | A public contact address or form | You decide which address is public |

Before posting anything, `grep -rn "\[\[" launch/` must return nothing in the copy you are about to paste.

## UTM convention

```text
?utm_source=<source>&utm_medium=<medium>&utm_campaign=replay-room-launch&utm_content=<variant>
```

- `utm_campaign` is always `replay-room-launch`.
- `utm_content` names the post variant, for example `x-option-a` or `linkedin-variant-1`.
- Add UTM parameters to the Render console, GitHub, and Hugging Face links only. Never add them to the API, OpenAPI, or launch-proof URLs; those are evidence, not landing pages.

## UTM variants

### X

- Option A, console: <https://replay-room-web.onrender.com/?utm_source=x&utm_medium=social&utm_campaign=replay-room-launch&utm_content=x-option-a>
- Option B, GitHub: <https://github.com/abhid1234/replay-room?utm_source=x&utm_medium=social&utm_campaign=replay-room-launch&utm_content=x-option-b>
- Option C, console: <https://replay-room-web.onrender.com/?utm_source=x&utm_medium=social&utm_campaign=replay-room-launch&utm_content=x-option-c>
- Drill on Hugging Face, any option: <https://huggingface.co/spaces/abhid1234/replay-room?utm_source=x&utm_medium=social&utm_campaign=replay-room-launch&utm_content=x-drill>

### LinkedIn

- Variant 1, console: <https://replay-room-web.onrender.com/?utm_source=linkedin&utm_medium=social&utm_campaign=replay-room-launch&utm_content=linkedin-variant-1>
- Variant 1, GitHub: <https://github.com/abhid1234/replay-room?utm_source=linkedin&utm_medium=social&utm_campaign=replay-room-launch&utm_content=linkedin-variant-1>
- Variant 2, console: <https://replay-room-web.onrender.com/?utm_source=linkedin&utm_medium=social&utm_campaign=replay-room-launch&utm_content=linkedin-variant-2>
- Variant 2, GitHub: <https://github.com/abhid1234/replay-room?utm_source=linkedin&utm_medium=social&utm_campaign=replay-room-launch&utm_content=linkedin-variant-2>

### Substack

- Console: <https://replay-room-web.onrender.com/?utm_source=substack&utm_medium=newsletter&utm_campaign=replay-room-launch&utm_content=essay>
- GitHub: <https://github.com/abhid1234/replay-room?utm_source=substack&utm_medium=newsletter&utm_campaign=replay-room-launch&utm_content=essay>
- Drill on Hugging Face: <https://huggingface.co/spaces/abhid1234/replay-room?utm_source=substack&utm_medium=newsletter&utm_campaign=replay-room-launch&utm_content=essay>

### Reddit

- Console, r/SideProject: <https://replay-room-web.onrender.com/?utm_source=reddit&utm_medium=community&utm_campaign=replay-room-launch&utm_content=r-sideproject>
- GitHub, r/SideProject: <https://github.com/abhid1234/replay-room?utm_source=reddit&utm_medium=community&utm_campaign=replay-room-launch&utm_content=r-sideproject>
- Console, r/devops: <https://replay-room-web.onrender.com/?utm_source=reddit&utm_medium=community&utm_campaign=replay-room-launch&utm_content=r-devops>
- GitHub, r/devops: <https://github.com/abhid1234/replay-room?utm_source=reddit&utm_medium=community&utm_campaign=replay-room-launch&utm_content=r-devops>

### Hacker News

Submit the clean GitHub URL, <https://github.com/abhid1234/replay-room>. Hacker News readers treat tracking parameters as noise, and the submission URL is permanent. If you need attribution, use these only inside the post body:

- Console: <https://replay-room-web.onrender.com/?utm_source=hackernews&utm_medium=community&utm_campaign=replay-room-launch&utm_content=show-hn>
- Drill on Hugging Face: <https://huggingface.co/spaces/abhid1234/replay-room?utm_source=hackernews&utm_medium=community&utm_campaign=replay-room-launch&utm_content=show-hn>

### Product Hunt

- Website field: <https://replay-room-web.onrender.com/?utm_source=producthunt&utm_medium=launch&utm_campaign=replay-room-launch&utm_content=listing>
- GitHub: <https://github.com/abhid1234/replay-room?utm_source=producthunt&utm_medium=launch&utm_campaign=replay-room-launch&utm_content=listing>

## Links that must not appear in launch copy

- Any URL containing an ingest key (`/ingest/<key>`). Ingest URLs are capabilities; anyone holding one can send events.
- Render dashboard URLs, deploy IDs, or environment pages. They are private.
- The repository's `launch-replay-room.html`. GitHub shows it as source, not as a page, and it carries dated internal decisions.
