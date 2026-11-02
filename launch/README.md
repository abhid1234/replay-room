# Replay Room launch kit

Everything needed to announce Replay Room, checked against the repository and the live surfaces on **2026-11-02** (UTC), the evening of Sunday 2026-11-01 in Pacific time. Nothing here has been posted, published, deployed, or released. Those steps need your explicit go-ahead.

> Replay Room turns a failed webhook from a blind resend into a rehearsed, evidence-backed production change.

## Current readiness

**Ready to post once the live API is back.** The copy, demo video, and images are final for a launch on the deployed `0.3.0` release without npm. The live API has been down since 2026-10-29, most likely because the free Render Postgres expired (B1). Restore it before posting: the repository README links its health, OpenAPI, and launch-proof URLs, and the Hugging Face drill links its OpenAPI contract. The release train to `v0.4.0` (B2–B5) is no longer a launch prerequisite, because no post mentions `0.4.0` or npm.

### Verified state on 2026-11-02

| Surface | State | How it was verified |
|---|---|---|
| `main` | Commit `dea98d6`: the `5bd5af0` product code plus this kit. `verify` (quality, production-audit, managed-services, container) and CodeQL are green | GitHub Actions runs on that commit |
| Local gate on `dea98d6` | Typecheck, build, 9 of 9 deployment-smoke tests, 21 conformance checks (6/6/9 across 15 fixtures), fixtures check, Space build, and package check (7 version surfaces, 107 files, 101,921 bytes, clean-install smoke) pass; with this change's README fixes the package is 102,148 bytes. The 7 integration tests pass against Postgres 16 and Redis 7. `npm audit --omit=dev --audit-level=high` finds 0 vulnerabilities | Local run on 2026-11-02. Unit tests pass 95 of 96 locally; the remaining test needs IPv6 loopback, which the sandbox lacks, and CI passes all 96 |
| Render API | **Down.** `/health` and `/.well-known/replay-room` return 503 | Readback at 02:40 UTC |
| Three-surface smoke | **Failing since 2026-10-29**: "/health did not become ready within 120000ms". Last pass 2026-10-28 at 20:22 UTC | Scheduled `live deployment smoke` runs on 2026-10-29, 10-30, 10-31, and 11-01 |
| Render console | Up. The landing page and the outage drill load; the drill runs entirely in the browser | Readback. Its `0.3.0` bundle was confirmed by hash on 2026-10-26 |
| Hugging Face Space | Running; serves the `v0.1.2` build | Bundle-hash comparison on 2026-10-26 |
| Hugging Face dataset | Public; manifest `0.2.0`: 6 incidents and 7 replay-guard records | Readback. The repository corpus is `0.3.0` with 9 |
| GitHub release | `v0.3.0` from `26c4cd6` is the latest, with tarball, SBOM, SLSA provenance, and SBOM attestations. `v0.4.0` does not exist | Releases API |
| npm | **Not published** | `npm view @avee1234/replay-room` returns `E404` |
| Dependency updates | Six open Dependabot pull requests (#38–#43) | Not needed for the launch; review after it |

### Blockers

| # | Blocker | Why it matters | Status |
|---|---|---|---|
| B1 | **The live API is down.** The free Render Postgres was due to expire around 2026-10-28, and the daily smoke has failed since 2026-10-29. The API runs migrations before it listens (`src/api/server.ts`), so without a database it cannot start | Every API URL returns 503, including the README's health, OpenAPI, and launch-proof links | **Open. Fix before posting:** see [Restore the API](#restore-the-api) |
| B2 | `main` contains unreleased product changes but still declares `0.3.0` | `main`'s OpenAPI and README describe `/api/dashboard` and adaptive polling, which the deployed `0.3.0` lacks | Open. Cut `v0.4.0` after the launch; no post depends on it |
| B3 | Deploy-order hazard | A console built from `main` polls only `/api/dashboard`, which the `0.3.0` API lacks | Open. Only matters when a newer console deploys; keep the console on `0.3.0` until the API is newer |
| B4 | The Hugging Face Space serves a `v0.1.2` build and the dataset is `0.2.0` | The public drill and dataset trail the repository | Open. Not launch-blocking; the drill works |
| B5 | The npm package is unpublished | An npm line in the copy would be false | **Resolved in the copy:** every `[[NPM_LINE]]` was deleted, as [link-map.md](link-map.md) prescribes while npm returns `E404` |
| B6 | The README's `doctor -- ...` command failed | npx passes the `--` through, and the CLI rejects it | **Fixed** in the README on 2026-11-02 |
| B7 | No product media existed | Posts need a video and images | **Resolved:** demo video, hero GIF and MP4, cover frame, and seven screenshots are in [assets/](assets/README.md). They were recorded on a local run of the deployed `0.3.0` release and are labeled that way. The live-only shots (S03, S09–S12) wait for the restored API |
| B8 | Press contact undecided | `[[CONTACT]]` remained | **Resolved:** GitHub issues, until you choose an address |
| B9 | The repository README needed fixes | It is the landing page for every post | **Fixed** on 2026-11-02: the banned word on line 87, the internal brief link on line 6, the Quick start's missing `.env` export, and a fourth found today: the local demo receivers used `localhost`, which the delivery client's direct DNS lookup cannot resolve, so they now use `127.0.0.1`. The guarded-replay list also gained its missing two-person rule |
| B10 | The 300-per-minute operator rate limit covers `/health`, `/openapi.json`, and `/.well-known/replay-room`, and Fastify runs without `trustProxy` | Behind Render's proxy, visitors may share one budget | Open; a product change. The posts keep API URLs out |

### Restore the API

About 15 minutes in the Render dashboard:

1. Open `replay-room-db`. If it shows as expired or suspended, either upgrade it to a paid instance type, which keeps the data, or delete it and create a new free database named `replay-room-db` (a workspace can have only one free Postgres database). The data is synthetic demo data, and a new free database starts a new 30-day clock; set a reminder for its expiry.
2. Make sure `replay-room-api`'s `DATABASE_URL` points at the database. A Blueprint sync rewires it from `render.yaml`; otherwise paste the new internal connection string.
3. Redeploy only the API. Prefer **Manual Deploy → Deploy a specific commit → `26c4cd6`** so the live version stays `0.3.0`. Leave the console alone: it already serves `0.3.0`, and a console built from `main` would need a newer API.
4. Confirm the fix: `/health` returns `"status":"ok"`, `/.well-known/replay-room` shows the commit you deployed, and **Open console** connects with the admin token. Then run **Actions → live deployment smoke → Run workflow** on GitHub.

If the API instead deploys from `main`, that works with the `0.3.0` console, because `main`'s API keeps the older endpoints. It will report version `0.3.0` with a newer commit until `v0.4.0` is cut.

## Files

| File | Contents | Status |
|---|---|---|
| [messaging.md](messaging.md) | Pitch, 25/50/100-word descriptions, technical and nontechnical versions, differentiators, headlines, subtitles, language to avoid | Final |
| [x.md](x.md) | Three single-post options under 280 characters, plus an optional proof reply | Final |
| [linkedin.md](linkedin.md) | Two variants | Final |
| [show-hn.md](show-hn.md) | Title, URL, first comment with limitations and questions | Final; post on a weekday morning |
| [reddit.md](reddit.md) | r/SideProject and r/devops posts, with an r/node fallback | Final; check subreddit rules on the day |
| [product-hunt.md](product-hunt.md) | Listing fields, maker comment, features, reply templates | Final; the gallery can use the new screenshots |
| [substack.md](substack.md) | About 1,180-word essay with the architecture diagram | Final |
| [demo-script.md](demo-script.md) | 60-second, 3-minute, and 8-minute scripts for live recordings, with the cold-start fallback | Ready for a live recording after B1 |
| [faq.md](faq.md) | 23 questions with source links | Final |
| [media-plan.md](media-plan.md) | Shot list, video, hero GIF, alt text, banner and Open Graph specs | Updated with the recorded media |
| [release-checklist.md](release-checklist.md) | The release train to `v0.4.0`, steps 0–15 | Ready to execute after the launch |
| [link-map.md](link-map.md) | Canonical URLs, placeholders, UTM variants | Final |
| [press-kit.md](press-kit.md) | Summary, build story, facts, proof points, boilerplate, assets | Final |
| [assets/](assets/README.md) | Demo video, hero GIF and MP4, cover, screenshots, banner, and Open Graph image | Ready |
| [video/](video/README.md) | The scripts that staged and recorded the demo, to re-record after a release | Ready |
| [check-launch-kit.mjs](check-launch-kit.mjs) | Consistency checks for this folder; `--final` also fails on unresolved placeholders in post copy | Passes, including `--final` |

## Canonical links

| Surface | URL |
|---|---|
| Live console and public drill | <https://replay-room-web.onrender.com> |
| Source | <https://github.com/abhid1234/replay-room> |
| Interactive drill on Hugging Face | <https://huggingface.co/spaces/abhid1234/replay-room> |
| Fixture dataset | <https://huggingface.co/datasets/abhid1234/replay-room-fixtures> |
| API health | <https://replay-room-api.onrender.com/health> |
| OpenAPI | <https://replay-room-api.onrender.com/openapi.json> |
| Launch proof | <https://replay-room-api.onrender.com/.well-known/replay-room> |
| Latest release | <https://github.com/abhid1234/replay-room/releases/latest> |
| npm | `[[NPM_URL]]`, not published and not used in the posts |

UTM variants and placeholder rules are in [link-map.md](link-map.md).

## Claims that need fresh verification

Re-run each check on the day you post. If a number moved, update every file that uses it; `grep -rn "<number>" launch/` finds them.

| Claim | Used in | Check |
|---|---|---|
| 96 automated tests | messaging, LinkedIn, Show HN, press kit | The `quality` job log on the latest `main` run ("Tests N passed"), or `npm test` |
| 9 deployment-smoke tests | messaging, Show HN, press kit | `npm run test:smoke` |
| 21 conformance checks (6/6/9 across 15 fixtures) | messaging, LinkedIn, Show HN, press kit, release checklist | `npm run conformance` |
| Nine replay conditions | all copy | Count the checks in `src/domain/replay-guard.ts` |
| 30-minute approval window | messaging, FAQ, Show HN, Reddit, essay, press kit, Product Hunt, demo script, video | `REPLAY_APPROVAL_TTL_MS` in `src/api/app.ts` |
| Postgres 17 and Redis 8 in CI | messaging, Show HN, press kit | The service images in `.github/workflows/ci.yml` |
| Default retry budget of 5 | press kit (the demo script and the video use 3 on purpose) | The `maxAttempts` default in `src/api/app.ts` |
| `Retry-After` clamp of 15 minutes | Show HN, press kit | `MAX_RETRY_AFTER_MS` in `src/domain/retry.ts` |
| Live version and commit | demo script, press kit | `curl -s https://replay-room-api.onrender.com/.well-known/replay-room` |
| npm availability | none while it returns `E404` | `npm view @avee1234/replay-room version` |
| Dataset version and case counts | press kit, FAQ, this README | `curl -sL https://huggingface.co/datasets/abhid1234/replay-room-fixtures/resolve/main/dataset-manifest.json` |
| Cold-start duration | demo script, press kit | `coldStart.warmAfterMs` in the latest `live deployment smoke` log |

## Recommended publishing order

1. **Restore the API** ([steps above](#restore-the-api)) and confirm `/health` returns `ok`. Do not post before this.
2. **Tonight, Sunday 2026-11-01 (Pacific):** publish the Substack essay first, so replies can link to it. Then LinkedIn variant 1 with the demo video, then X option A with the hero MP4 or the full video, plus the proof reply.
3. **Monday 2026-11-02, 8–10 a.m. Pacific:** Show HN. A Sunday-night submission reaches far fewer readers. Stay in the thread for three hours.
4. **Tuesday 2026-11-03:** r/SideProject. **Wednesday 2026-11-04:** r/devops, or r/node if the r/devops rules forbid it.
5. **Tuesday 2026-11-10:** Product Hunt on its own day, plus LinkedIn variant 2 and a second X option.
6. **After the launch:** the release train to `v0.4.0` ([release-checklist.md](release-checklist.md)), then the live-only screenshots.
