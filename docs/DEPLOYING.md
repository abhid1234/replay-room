# Deploying Replay Room on Render

Replay Room has two intentional operating profiles: a zero-dollar evaluation lab and a separated production topology. The root `render.yaml` is the lab profile.

## Free lab profile

The Blueprint creates:

- one free Docker web service for the Fastify API, BullMQ consumer, and reconciliation loop;
- one free static site for the operator console;
- one free Render Postgres database;
- one free Render Key Value instance.

The web process runs database migrations on startup. `EMBEDDED_WORKER=true` starts the queue consumer and runs reconciliation at `RECONCILE_INTERVAL_SECONDS`. The default interval is ten minutes and values below one minute are rejected.

## Current free-tier constraints

Render's free resources are suitable for evaluation, not production:

- a free web service spins down after 15 minutes without inbound traffic;
- a cold start can take about one minute;
- free Postgres is limited to one database per workspace, 1 GB, and expires after 30 days;
- free Postgres has no backups or managed connection pooling;
- free Key Value is limited to one instance per workspace and loses data on restart;
- a free web service has an ephemeral filesystem and no shell access;
- monthly instance-hour, bandwidth, and build-minute limits still apply.

The durable source of truth is Postgres. Every exact queue payload is first stored as a delivery intent. Losing the free Key Value instance can strand transport work, so the embedded reconciler re-dispatches pending or stale intents with stable job keys and only synthesizes a job for an orphaned event with no open intent. That makes the platform limitation a tested recovery story instead of a hidden assumption.

## Blueprint activation

1. Sign in to Render with the GitHub account that can access `abhid1234/replay-room`.
2. Create a new Blueprint and select the repository and `render.yaml`.
3. Confirm every compute selector says **Free** before applying it.
4. Set `WEB_ORIGIN` to the final static-site origin.
5. Set `VITE_API_BASE` to the final API origin.
6. Apply the Blueprint and wait for Postgres, Key Value, API, and static site to become healthy.
7. Run the live acceptance gate, then open the dashboard's live fabric panel.

```bash
npm run smoke:live -- \
  --api https://YOUR-API.onrender.com \
  --site https://YOUR-CONSOLE.onrender.com \
  --space https://YOUR-SPACE.static.hf.space
```

The gate allows up to two minutes for a free web service cold start, then verifies the database- and queue-backed health response, the versioned OpenAPI surface, the static console shell, the exact cross-origin policy needed by that console, and the Hugging Face demo's credential boundary and proof links. It prints `replay-room.live-check/v1` JSON so the result can be retained as launch evidence. The same check is available as the manually dispatched **live deployment smoke** GitHub workflow.

The Blueprint generates `ADMIN_TOKEN` and `EVIDENCE_SIGNING_SECRET`. Do not copy either value into Git, logs, fixtures, or screenshots.

Both public ingest and operator routes use Redis-backed distributed limits. `INGEST_RATE_LIMIT_PER_MINUTE` applies per endpoint key; `OPERATOR_RATE_LIMIT_PER_MINUTE` applies at the HTTP boundary before protected routes reach Postgres.

`SIGNATURE_TOLERANCE_SECONDS` controls the allowed Stripe webhook timestamp skew and defaults to 300 seconds. Keep host time synchronized; do not increase this window merely to work around clock drift.

## Verified public deployment

The free Blueprint instance `exs-datkjh7avr4c73du67c0` is live from commit `43cca36`:

- console: <https://replay-room-web.onrender.com>
- API: <https://replay-room-api.onrender.com>

On 2026-09-30, `npm run smoke:live` passed across the Render API, Render console, and Hugging Face demo. The readback confirmed healthy Postgres and Key Value dependencies, OpenAPI version `0.1.1` with all ten required routes, a mounted console, the exact cross-origin policy required by that console, and a credential-free Space bundle with its four proof links.

## Production upgrade

For continuous delivery processing, move the queue consumer and reconciler out of the web service:

- API: `node dist/api/server.js` with `EMBEDDED_WORKER=false`;
- background worker: `node dist/worker.js`;
- cron job: `node dist/cron.js` every ten minutes;
- paid Postgres with backups and an explicit retention policy;
- persistent paid Key Value;
- organization-scoped authentication and secret management;
- external egress allowlists as defense in depth around the application-level DNS pinning boundary.

This split is deliberately not the default Blueprint because Render background workers and cron jobs do not have a free compute plan.

## Post-deploy evidence

Record the deployed commit, service URLs, `replay-room.live-check/v1` output, live fabric screenshot, one synthetic outage drill, one exported evidence bundle, and the CLI verification result. Never use customer payloads in public proof.
