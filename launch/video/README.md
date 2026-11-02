# Demo video tooling

The scripts that made [`../assets/replay-room-demo.mp4`](../assets/replay-room-demo.mp4), the hero GIF, and the screenshots. They run the real console against a real API, Postgres, and Key Value, so the recording shows actual guard decisions rather than a mockup.

- `stage.mjs` creates the `Billing events (demo)` endpoint with a 3-attempt budget, sends Event A (with an idempotency key) and Event B (without one), and waits until both are in dead letter.
- `record.cjs` drives the console with Playwright, records Chrome screencast frames, draws a cursor and captions, saves the screenshots without either, and writes an ffmpeg concat list with each frame's real duration.

## Recording on a local run

The 2026-11-02 recording used the deployed release, `v0.3.0` (commit `26c4cd6`), because the live API was down. Requirements: Node.js 22, Postgres, Redis, Playwright with Chromium, and ffmpeg with libx264.

1. Build the release, and copy the migrations into `dist` as the Dockerfile does:

   ```bash
   git worktree add ../rr-v030 v0.3.0 && cd ../rr-v030
   npm ci
   VITE_API_BASE=http://localhost:4000 npm run build
   cp -r src/db/migrations dist/db/migrations
   ```

2. Start the API and serve the console, with a throwaway admin token:

   ```bash
   export ADMIN_TOKEN=$(openssl rand -hex 24)
   NODE_ENV=development PORT=4000 EMBEDDED_WORKER=true ALLOW_PRIVATE_TARGETS=true \
     DATABASE_URL=postgresql://USER:PASSWORD@127.0.0.1:5432/replay_room_demo \
     REDIS_URL=redis://127.0.0.1:6379/1 WEB_ORIGIN=http://localhost:4173 \
     node dist/api/server.js &
   python3 -m http.server 4173 --bind 127.0.0.1 --directory web/dist &
   ```

3. From this repository, stage the incidents, then record:

   ```bash
   node launch/video/stage.mjs
   NODE_PATH=$(npm root -g) node launch/video/record.cjs
   ```

   Both write to `$RR_VIDEO_OUT`, which defaults to `replay-room-video` in the system temp directory. `RR_API` and `RR_CONSOLE` override the local URLs.

4. Encode from the output directory:

   ```bash
   ffmpeg -f concat -safe 0 -i frames.txt -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=48000 \
     -vf "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -crf 20 \
     -c:a aac -b:a 64k -shortest -movflags +faststart replay-room-demo.mp4
   ```

   `markers.json` gives approximate scene times; check them against the video before cutting the hero GIF, because captions can land a second or two after their marker.

## Why the receivers use 127.0.0.1

The staged endpoint posts to the API's own development sinks: `http://127.0.0.1:4000/demo/sink/retry` returns 503, and the rehearsal target `http://127.0.0.1:4000/demo/sink/accept` returns 200. The delivery client resolves hostnames with direct DNS queries, which do not read `/etc/hosts`. With `localhost`, every attempt fails without an HTTP response, and the guard then rates both events high risk for an ambiguous network outcome.

## Rules the recording follows

- A "Local run · Replay Room v0.3.0 · synthetic events" label stays on screen, and the closing card repeats it. Never present a local recording as the live service.
- The admin token is filled in while the token field is off screen, and the field is masked. Ingest URLs are blurred.
- Captions use only claims from [`../messaging.md`](../messaging.md).

To re-record after a release, build the new tag in step 1 and change the label in `record.cjs`. For a recording of the live deployment, follow [`../demo-script.md`](../demo-script.md) instead.
