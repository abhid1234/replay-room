# Release checklist

The release train that has to finish before any launch post goes out. It takes `main` from "newer code than what is deployed" to one reviewed version, `0.4.0`, served by every public surface. Check each box only after the readback in that step passes. A green build is not a deployment, a tarball is not a published package, and an upload is not a public dataset until it can be read back.

Nothing in this checklist has been done yet. As of 2026-10-26 the public surfaces serve `0.3.0` (API and console), a `v0.1.2` build (Hugging Face Space), and a `0.2.0` dataset, and npm returns `E404`.

## 0. Platform expiry check (do this first)

- [ ] In the Render dashboard, open `replay-room-db` and read its expiry date. The free Blueprint went live on 2026-09-28, and free Render Postgres expires 30 days after creation, so this database probably expires on or about **2026-10-28**. After expiry the API's `/health` fails and the live console stops working.
- [ ] If the expiry date is before launch day plus two weeks, either upgrade the database to a paid plan, or delete it and create a new free one (a workspace can have only one free Postgres database), then redeploy. The data is synthetic demo data, so recreating is acceptable, but it starts a new 30-day clock.
- [ ] Record the new expiry date in [README.md](README.md#current-readiness).

## 1. Scope freeze

- [ ] Freeze `main`: no merges except the release PR until step 8 is done. The npm package includes `docs/` and `README.md`, so any merge before npm publishes could make its tarball differ from the GitHub release.
- [ ] Confirm the release scope is exactly the product changes after `26c4cd6`:
  - `e0d1a3a`: collapse dashboard polling into one snapshot (`GET /api/dashboard`)
  - `14e6300`: adaptive, completion-paced polling with hidden-tab pause and transient backoff
  - `5bc33ed`: cancel stale operator requests
  - `f3908ee`: Hugging Face trusted publishing
  - `fastify` `5.12.5` → `5.12.7` and the other dependency patches in `CHANGELOG.md`
- [ ] Confirm the version. `/api/dashboard` is an additive API change, so a minor bump to `0.4.0` fits semantic versioning before 1.0.
- [ ] Before merging anything in step 4, confirm Render auto-deploy is off for `replay-room-api` and `replay-room-web`. `render.yaml` declares `autoDeployTrigger: checksPass` for both, so if the dashboard follows the Blueprint, merging the release PR deploys both services at once, console included; that is blocker B3. The API stayed on `26c4cd6` through seven later merges, which suggests it is off in practice, but check the dashboard.
- [ ] Decide the fix for the `doctor` separator defect: the README tells consumers to run `npx @avee1234/replay-room doctor -- ...`, but npx passes the `--` through and the CLI fails with `"error": "-- requires a value"`. Either drop the `--` from the README (a documentation fix), or make the CLI ignore a leading `--` (a product change). Include the chosen fix in the release PR.
- [ ] Decide the repository README fixes in blocker B9 (the launch landing page) and include them in the release PR.
- [ ] Optional product change: add `og:image` and `twitter:card` meta tags to `web/index.html` that point at a hosted copy of `launch/assets/og-image-1200x630.png`, so links to the console show the Open Graph image.

## 2. Version-surface bump

`npm run test:package` requires these seven surfaces to match `package.json`.

- [ ] `npm version 0.4.0 --no-git-tag-version` updates `package.json` and the `package-lock.json` root and `packages[""]` versions.
- [ ] `npm version 0.4.0 --no-git-tag-version --workspace web` updates `web/package.json` and `packages["web"]` in the lockfile.
- [ ] `src/api/openapi.ts`: set `info.version` to `"0.4.0"`. The launch proof reports this value.
- [ ] `fixtures/manifest.json`: set `version` to `"0.4.0"`.
- [ ] `npm run fixtures:build` regenerates `fixtures/huggingface/dataset-manifest.json` at `0.4.0`.
- [ ] `CHANGELOG.md`: rename `## Unreleased` to `## 0.4.0 - <release date>`, and add an `### Added` entry for `GET /api/dashboard` and the Hugging Face trusted-publishing workflow.
- [ ] `npm install` to refresh the lockfile, then `npm run build && npm run test:package`. The package check reads the OpenAPI version from the compiled `dist/`, so it needs a fresh build. Expect `"versionSurfaces":7` at `0.4.0`.
- [ ] Open the release PR with only these changes and the separator fix.

## 3. Full local gate

- [ ] `npm ci`
- [ ] `npm run verify` passes: typecheck, 96+ unit and API tests, 9 deployment-smoke tests, the production build, 21 conformance checks, the fixtures check, the Space build, and the package check with 7 version surfaces.
- [ ] The integration tests pass against throwaway Postgres 17 and Redis 8 containers that match CI. They truncate their tables, so never point them at the development database from `docker-compose.yml`:

  ```bash
  docker run -d --rm --name rr-it-pg -p 55432:5432 -e POSTGRES_USER=replay_room -e POSTGRES_PASSWORD=replay_room -e POSTGRES_DB=replay_room_test postgres:17-alpine
  docker run -d --rm --name rr-it-redis -p 56379:6379 redis:8-alpine
  DATABASE_URL=postgresql://replay_room:replay_room@127.0.0.1:55432/replay_room_test REDIS_URL=redis://127.0.0.1:56379/15 npm run test:integration
  docker stop rr-it-pg rr-it-redis
  ```

- [ ] Record the test counts. If they changed, update the numbers in `launch/` before posting.

## 4. GitHub checks

- [ ] The release PR shows green `verify` (jobs `quality`, `production-audit`, `managed-services`, `container`) and `CodeQL`.
- [ ] Merge the PR. Note the merge commit SHA; this is the **release SHA**.
- [ ] `verify` and `CodeQL` are green on the release SHA on `main`.

## 5. GitHub release

The workflow builds from the commit at the head of `main` when you dispatch it, so dispatch it while `main` still equals the release SHA.

- [ ] Actions → **Prepare and optionally publish release** → Run workflow on `main` with `version` `0.4.0` and `create_github_release` `true`. Set `publish_npm` to `true` only if step 8's one-time setup is complete. Publishing npm and the GitHub release in the same run guarantees both carry the identical tarball.
- [ ] Readback: <https://github.com/abhid1234/replay-room/releases/tag/v0.4.0> exists, its target is the release SHA, and it lists `avee1234-replay-room-0.4.0.tgz` and `sbom.cdx.json`.

## 6. SBOM and provenance verification

- [ ] `gh release download v0.4.0 --repo abhid1234/replay-room --dir ./rr-0.4.0`
- [ ] `shasum -a 256 ./rr-0.4.0/*` matches the digests GitHub shows on the release assets.
- [ ] `gh attestation verify ./rr-0.4.0/avee1234-replay-room-0.4.0.tgz --repo abhid1234/replay-room` passes (SLSA provenance).
- [ ] `gh attestation verify ./rr-0.4.0/avee1234-replay-room-0.4.0.tgz --repo abhid1234/replay-room --predicate-type https://cyclonedx.org/bom` passes (SBOM attestation).
- [ ] The SBOM lists `@avee1234/replay-room` at `0.4.0`.

## 7. Exact-SHA Render deployment

**Order matters.** The `0.4.0` console polls only `GET /api/dashboard`, which the `0.3.0` API does not have. Deploy the API first; if the console deploys first, the authenticated console breaks until the API catches up.

- [ ] Auto-deploy was confirmed off in step 1. If either service deployed on its own after the merge, check which commit each one runs before going further.
- [ ] Deploy `replay-room-api` at the release SHA: Manual Deploy → deploy a specific commit.
- [ ] Readback: `curl -s https://replay-room-api.onrender.com/.well-known/replay-room` shows `"version":"0.4.0"` and `deployment.commit` equal to the first seven characters of the release SHA.
- [ ] Readback: `curl -s https://replay-room-api.onrender.com/openapi.json` shows `info.version` `0.4.0` and includes `/api/dashboard`.
- [ ] Deploy `replay-room-web` at the same SHA.
- [ ] Readback: <https://replay-room-web.onrender.com> loads, **Open console** connects, and the Event stream refreshes without errors. The static site exposes no commit marker, so record its deploy ID and commit from the Render dashboard.

## 8. npm trusted publication

One-time setup, before the first publish:

- [ ] On npmjs.com, configure a trusted publisher for `@avee1234/replay-room`: GitHub Actions, repository `abhid1234/replay-room`, workflow `release.yml`, environment `npm-publish`. The workflow publishes with `--provenance` and `id-token: write` and stores no npm token. Follow npm's current documentation for a package's first publish, and never commit a long-lived token.
- [ ] In GitHub, confirm the `npm-publish` environment exists and requires your approval.

Publish:

- [ ] If step 5 ran with `publish_npm` `false`, re-run the workflow with `publish_npm` `true` and `create_github_release` `false`, dispatched on the `v0.4.0` tag rather than `main`, so the package is rebuilt from the released commit. Its registry check refuses to republish an existing version and verifies integrity.
- [ ] Readback: `npm view @avee1234/replay-room@0.4.0 version dist.integrity` prints `0.4.0`.
- [ ] The registry tarball is identical to the release asset: `openssl dgst -sha512 -binary ./rr-0.4.0/avee1234-replay-room-0.4.0.tgz | openssl base64 -A` equals the base64 part of `dist.integrity`.
- [ ] The npm package page shows a provenance statement linked to this repository.

## 9. Hugging Face publication and readback

The **publish Hugging Face assets** workflow has never run. Its first run is also the first test of trusted publishing.

- [ ] One-time: on both Hugging Face repositories, under **Settings → Trusted Publishers**, add GitHub repository `abhid1234/replay-room`, branch `main`, workflow `publish-huggingface.yml` (see `docs/FIXTURES.md`).
- [ ] Actions → **publish Hugging Face assets** → `version` `0.4.0`, `publish_dataset` `true`, `publish_space` `true`.
- [ ] Readback, dataset: `curl -sL https://huggingface.co/datasets/abhid1234/replay-room-fixtures/resolve/main/dataset-manifest.json | diff - fixtures/huggingface/dataset-manifest.json` prints nothing, and the manifest shows `0.4.0` with 6 incidents and 9 replay-guard records.
- [ ] Readback, Space: the script loaded by <https://abhid1234-replay-room.static.hf.space> has the same file name as `.artifacts/huggingface-space/assets/index-*.js` from a local `npm run space:build` at the release SHA.
- [ ] If OIDC publishing fails, use the documented local fallback in `docs/FIXTURES.md` and `docs/HUGGINGFACE_SPACE.md`, then repeat both readbacks.

## 10. Clean-install test

Run in an empty directory, not in the repository:

- [ ] `npm init -y && npm install @avee1234/replay-room@0.4.0`
- [ ] `npx replay-room inspect ./<downloaded>.evidence.json` prints a summary for a bundle downloaded from the live console.
- [ ] `EVIDENCE_SIGNING_SECRET=… npx replay-room verify ./<downloaded>.evidence.json` exits 0. Set the secret in your shell from the Render dashboard; never paste it into chat or a recording.

## 11. Public doctor and smoke verification

- [ ] `npx @avee1234/replay-room@0.4.0 doctor --api https://replay-room-api.onrender.com --site https://replay-room-web.onrender.com --space https://abhid1234-replay-room.static.hf.space --expected-version 0.4.0` prints `"status": "passed"`.
- [ ] Actions → **live deployment smoke** → Run workflow (leave `expected_version` empty; it defaults to `package.json`) passes.
- [ ] Save both JSON outputs as launch evidence.
- [ ] Docs PR: update the proof sections in `README.md` (the "passed this gate" paragraph), `docs/DEPLOYING.md` ("Verified public deployment"), `docs/PROJECT_STANDARD.md`, and `docs/FIXTURES.md` with the new commit, deploy IDs, dataset commit, and dates.

## 12. Link audit

From a normal network connection, not a restricted sandbox:

- [ ] Every URL in [link-map.md](link-map.md) returns 200, including the UTM variants. The npm URL counts only after step 8.
- [ ] `/releases/latest` resolves to `v0.4.0`.
- [ ] Every relative link in `launch/` resolves on GitHub.

## 13. Final copy substitution

- [ ] Resolve every placeholder using [link-map.md](link-map.md#placeholders): `[[NPM_LINE]]`, `[[NPM_URL]]`, `[[SUBSTACK_URL]]`, `[[DEMO_VIDEO_URL]]`, `[[CONTACT]]`, and the `[[IMAGE: …]]` markers.
- [ ] `grep -rn "\[\[" launch/` returns nothing in the copy you are about to post.
- [ ] Re-run the checks in [README.md](README.md#claims-that-need-fresh-verification) and update any number that moved.
- [ ] `node launch/check-launch-kit.mjs --final` passes. It fails while any post still contains a placeholder.
- [ ] Capture the media in [media-plan.md](media-plan.md) from the deployed release.

## 14. Launch-day monitoring

- [ ] Ten minutes before each post, open `/health` so the free API is awake.
- [ ] Keep the Render dashboard open on `replay-room-api`: watch logs for 5xx bursts, memory, and the free instance-hour budget.
- [ ] Dispatch the **live deployment smoke** workflow after each major post. It also runs daily at 15:23 UTC.
- [ ] Watch the rate limits. Ingest allows 600 requests per minute per endpoint. The 300-per-minute limit covers every other API route, including the public `/health`, `/openapi.json`, and `/.well-known/replay-room`, and Fastify runs without `trustProxy`, so behind Render's proxy many visitors may share one budget (blocker B10). Keep those URLs out of high-traffic posts; the static console and the drill do not touch the API until someone connects.
- [ ] Stay in each thread for the first two to three hours. Answer with [faq.md](faq.md) in your own words.
- [ ] If anyone posts an ingest URL, stop using that endpoint for demos. The API cannot delete endpoints, so create a new one; the leaked endpoint forwards only to its configured demo receiver.

## 15. Rollback and correction

- **API or console regression:** in the Render dashboard, roll back `replay-room-web` first, then `replay-room-api`: the reverse of the deploy order. The `0.3.0` console works against the `0.4.0` API, but the `0.4.0` console needs `/api/dashboard`, which the `0.3.0` API lacks. Re-run the doctor with `--expected-version` set to the rolled-back version.
- **Bad npm release:** you cannot reuse a version number. Run `npm deprecate @avee1234/replay-room@0.4.0 "<reason>; use 0.4.1"` and publish `0.4.1` through the same workflow. Unpublishing is limited and breaks installs; prefer deprecation.
- **Bad GitHub release:** edit the release notes to state the problem, mark it as a pre-release if needed, and cut `0.4.1`. Keep the original assets; their attestations are evidence.
- **Bad Hugging Face publish:** revert the dataset or Space repository to the previous commit through its Files and versions history, then repeat the step 9 readbacks.
- **Copy error after posting:** correct it in the same channel. On X, reply with the correction; on LinkedIn and Reddit, edit the post and add "Edit: …"; on Hacker News, add a comment, because submissions cannot be edited after a short window. Never quietly change a number that people have already quoted.
