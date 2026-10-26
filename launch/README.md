# Replay Room launch kit

Everything needed to announce Replay Room, checked against the repository and the live surfaces on **2026-10-26**. Nothing here has been posted, published, deployed, or released. Those steps are listed in [release-checklist.md](release-checklist.md) and need your explicit go-ahead.

> Replay Room turns a failed webhook from a blind resend into a rehearsed, evidence-backed production change.

## Current readiness

**Not ready to post.** The copy is ready, but the public surfaces still serve older releases than `main`, the npm package is unpublished, and the free database may expire inside the launch window. Finish the release train first.

### Verified state on 2026-10-26

| Surface | State | How it was verified |
|---|---|---|
| `main` | Commit `5bd5af0`. `verify` (quality, production-audit, managed-services, container) and CodeQL are green | GitHub Actions runs on that commit |
| Unit and API tests | 96 passed in CI; 7 integration tests pass in the separate Postgres 17 and Redis 8 job | CI log for `5bd5af0`. A local rerun passed 95 of 96; the remaining test needs IPv6 loopback, which the audit sandbox lacks |
| Deployment-smoke tests | 9 of 9 | CI log and a local `npm run test:smoke` |
| Conformance | 21 cases: 6 incident, 6 replay-risk, 9 replay-guard | CI log and a local `npm run conformance` |
| Builds and package | Production build, fixtures check, Space build (`credentialSurface: none`), and package check (7 version surfaces, 107 files, 101,921 bytes, clean-install smoke) pass | CI log and a local rerun |
| Render API | `/health` `ok`; launch proof `0.3.0` at commit `26c4cd6`, topology `embedded-free` | Live readback at 03:30 UTC |
| Render console | Live; serves the console built from the `0.3.0` source | Its bundle `index-BnJwpKZq.js` exists; `main`'s `index-C0_XG9Uy.js` does not |
| Three-surface smoke | Passed: 12 required API paths, CORS, console, and the credential-free Space, with a 12.5-second cold start | Scheduled `live deployment smoke`, 2026-10-25 18:27 UTC |
| Hugging Face Space | Running; serves the **`v0.1.2`** build | Its script `index-BMQjeDzn.js` matches a rebuild of commit `af3592b`; `0.2.0` and `0.3.0` builds produce other hashes |
| Hugging Face dataset | Public; manifest **`0.2.0`**: 6 incidents and 7 replay-guard records | Anonymous manifest readback. The repository corpus is `0.3.0` with 9 |
| GitHub release | `v0.3.0` from `26c4cd6`, with tarball, SBOM, SLSA provenance, and SBOM attestations | Releases API and attestations API |
| `v0.4.0` | Does not exist | The tag URL returns 404 |
| npm | **Not published** | `npm view @avee1234/replay-room` returns `E404` |
| Hugging Face trusted publishing | Never run | The workflow has zero runs |

### Blockers

| # | Blocker | Why it matters | Resolution |
|---|---|---|---|
| B1 | The free Render Postgres probably expires on or about **2026-10-28** (30 days after the 2026-09-28 Blueprint launch) | `/health` and the live console fail once the database expires | [Release checklist](release-checklist.md#0-platform-expiry-check-do-this-first), step 0 |
| B2 | `main` contains unreleased product changes but still declares `0.3.0` | `main`'s OpenAPI says `0.3.0` yet includes `/api/dashboard`, which the deployed `0.3.0` lacks: two contracts claim one version | Cut `v0.4.0` (steps 1–6) |
| B3 | Deploy-order hazard | The `0.4.0` console polls only `/api/dashboard`; deploying the console before the API breaks the authenticated console | Deploy the API first (step 7) |
| B4 | The Hugging Face Space serves a `v0.1.2` build and the dataset is `0.2.0` | The public drill is two releases behind and the dataset one; the dataset lacks the two dual-control cases (`high-risk-missing-approval-blocks` and `high-risk-distinct-operator-allows-replay`) | Publish `0.4.0` (step 9) |
| B5 | The npm package is unpublished | Any npm install line in the copy would be false | Trusted publishing, then registry readback (step 8) |
| B6 | The README's `doctor -- ...` command fails | npx passes the `--` through, and the CLI rejects it with `"error": "-- requires a value"` | Fix in the release PR (step 1) |
| B7 | No product screenshots, GIF, or video exist | Posts and the Product Hunt gallery need captured media | Capture after deploy ([media-plan.md](media-plan.md)) |
| B8 | The essay is not published, and the press contact is undecided | `[[SUBSTACK_URL]]` and `[[CONTACT]]` remain | Publish the essay, then choose a contact |

Not a blocker, but worth knowing: the static console exposes no commit marker, so its deployed version can only be confirmed from the Render dashboard or by comparing bundle hashes.

## Files

| File | Contents | Status |
|---|---|---|
| [messaging.md](messaging.md) | Pitch, 25/50/100-word descriptions, technical and nontechnical versions, differentiators, headlines, subtitles, language to avoid | Ready |
| [x.md](x.md) | Three single-post options under 280 characters, plus an optional proof reply | Ready after placeholder check |
| [linkedin.md](linkedin.md) | Two variants | Ready after resolving `[[NPM_LINE]]` |
| [show-hn.md](show-hn.md) | Title, URL, first comment with limitations and questions | Ready after resolving `[[NPM_LINE]]` |
| [reddit.md](reddit.md) | r/SideProject and r/devops posts, with an r/node fallback | Ready; check subreddit rules on the day |
| [product-hunt.md](product-hunt.md) | Listing fields, maker comment, features, reply templates | Ready; gallery needs captured media |
| [substack.md](substack.md) | About 1,180-word essay | Ready after resolving `[[NPM_LINE]]` and the image marker |
| [demo-script.md](demo-script.md) | 60-second, 3-minute, and 8-minute scripts with the cold-start fallback | Ready to record after deploy |
| [faq.md](faq.md) | 23 questions with source links | Ready |
| [media-plan.md](media-plan.md) | Shot list, hero GIF, alt text, banner and Open Graph specs | Ready; screenshots must be captured |
| [release-checklist.md](release-checklist.md) | The release train, steps 0–15 | Ready to execute |
| [link-map.md](link-map.md) | Canonical URLs, placeholders, UTM variants | Ready |
| [press-kit.md](press-kit.md) | Summary, build story, facts, proof points, boilerplate, assets | Ready after resolving `[[CONTACT]]` |
| [assets/](assets/README.md) | Rendered banner and Open Graph image, with editable sources | Ready |
| [check-launch-kit.mjs](check-launch-kit.mjs) | Consistency checks for this folder; `--final` also fails on unresolved placeholders in post copy | Passes today without `--final` |

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
| npm | `[[NPM_URL]]`, not published |

UTM variants and placeholder rules are in [link-map.md](link-map.md).

## Claims that need fresh verification

Re-run each check on the day you post. If a number moved, update every file that uses it; `grep -rn "<number>" launch/` finds them.

| Claim | Used in | Check |
|---|---|---|
| 96 automated tests | messaging, LinkedIn, Show HN, press kit | The `quality` job log on the latest `main` run ("Tests N passed"), or `npm test` |
| 9 deployment-smoke tests | Show HN, press kit | `npm run test:smoke` |
| 21 conformance cases (6/6/9) | messaging, LinkedIn, Show HN, press kit | `npm run conformance` |
| Nine replay conditions | all copy | Count the checks in `src/domain/replay-guard.ts` |
| 30-minute approval window | messaging, FAQ, Show HN, Reddit, essay | `REPLAY_APPROVAL_TTL_MS` in `src/api/app.ts` |
| Postgres 17 and Redis 8 in CI | messaging, Show HN, press kit | The service images in `.github/workflows/ci.yml` |
| Default retry budget of 5 | press kit, demo script | The `maxAttempts` default in `src/api/app.ts` |
| `Retry-After` clamp of 15 minutes | Show HN, press kit | `MAX_RETRY_AFTER_MS` in `src/domain/retry.ts` |
| Live version and commit | demo script, press kit | `curl -s https://replay-room-api.onrender.com/.well-known/replay-room` |
| npm availability | every `[[NPM_LINE]]` | `npm view @avee1234/replay-room version` |
| Dataset version and case counts | press kit, FAQ | `curl -sL https://huggingface.co/datasets/abhid1234/replay-room-fixtures/resolve/main/dataset-manifest.json` |
| Cold-start duration | demo script | `coldStart.warmAfterMs` in the latest `live deployment smoke` log |

## Recommended publishing order

1. **Release train** ([release-checklist.md](release-checklist.md)), starting with the database expiry check, which is due by 2026-10-28.
2. **Media capture** from the deployed release ([media-plan.md](media-plan.md)) and the demo recording ([demo-script.md](demo-script.md)).
3. **Final copy substitution**, then `node launch/check-launch-kit.mjs --final` must pass.
4. **Launch day, morning US Pacific:** publish the Substack essay first, so everything else can link to it. Then post on LinkedIn, then X (one option, plus the optional proof reply).
5. **Same day, 8–10 a.m. Pacific:** Show HN. Stay in the thread for three hours.
6. **Day 2:** r/SideProject. **Day 3:** r/devops, or r/node if r/devops rules forbid it.
7. **About a week later:** Product Hunt on its own day, with the captured gallery, plus the second LinkedIn variant and a second X option.

Suggested dates, if the release train finishes by Friday 2026-10-30: launch on **Tuesday 2026-11-03**, with Reddit on 2026-11-04 and 2026-11-05 and Product Hunt on Tuesday 2026-11-10. If any blocker is still open on Friday, move everything back a week rather than posting with a gap.
