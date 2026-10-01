# Hugging Face Space

Replay Room has two public Hugging Face surfaces with deliberately different responsibilities:

- the [fixture dataset](https://huggingface.co/datasets/abhid1234/replay-room-fixtures) is a versioned synthetic corpus for diagnosis and replay-guard conformance;
- the [Replay Room Space](https://huggingface.co/spaces/abhid1234/replay-room) is a static, interactive outage drill that links the product story to the live Render deployment.

The Space is not a second backend. Render remains the system of record for the API, Postgres ledger, BullMQ transport, background worker, reconciler, and authenticated operator console. The static Space neither asks for nor stores an admin token.

## Build

```bash
npm run space:build
```

The command creates `.artifacts/huggingface-space`, injects the public demo build flag, generates the required Space metadata card, and fails if the output contains token storage, authorization, or admin API capability. The output directory is ignored by Git because it is a reproducible deployment artifact.

## Publish

The public Static HTML Space uses the repository id `abhid1234/replay-room`. Upload the contents of `.artifacts/huggingface-space` to the Space root. The generated `README.md` declares `sdk: static` and `app_file: index.html`.

## Verify

After publication:

1. confirm the Space reports a running state;
2. open it anonymously and run the complete eight-step outage drill;
3. verify there is no token field or request to an authenticated API route;
4. open each proof link: Render console, OpenAPI, GitHub source, and fixture dataset;
5. check desktop and 375-pixel layouts for overflow and console errors.

The repository's `npm run verify` gate rebuilds and inspects the Space artifact on every pull request. The scheduled public smoke gate also downloads the live Space entrypoint and JavaScript, verifies all demo markers and proof links, and fails if token storage or authenticated operator routes appear:

```bash
npm run smoke:live -- \
  --api https://replay-room-api.onrender.com \
  --site https://replay-room-web.onrender.com \
  --space https://abhid1234-replay-room.static.hf.space
```
