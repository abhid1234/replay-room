# Publishing the synthetic fixture dataset

Replay Room's public fixture mirror is built from the same source cases used by the conformance gate. The Hugging Face bundle lives in `fixtures/huggingface` and is deterministic: generated data files have no current timestamp, random identifier, or machine-specific path.

## Build and verify

```bash
npm run fixtures:build
npm run fixtures:check
npm run conformance
```

The build fails if an incident includes a receiver outside the reserved `.example` domain, a signing secret, a credential-like header, a non-synthetic ingest key, or a duplicate case ID. `dataset-manifest.json` contains byte lengths and SHA-256 digests for both JSONL configurations.

## Publish to Hugging Face

Authenticate with a write-scoped Hugging Face token, then create or reuse the public dataset and upload the prepared directory as one commit:

```bash
hf auth login
hf repos create abhid1234/replay-room-fixtures --repo-type dataset --public --exist-ok
hf upload abhid1234/replay-room-fixtures fixtures/huggingface . \
  --repo-type dataset \
  --commit-message "Publish Replay Room fixture dataset v0.1.0"
```

Do not pass a token on the command line or commit one to the repository. After upload, reopen the public dataset, confirm that both `incidents` and `replay_guard` configurations render, and read back the manifest with a fresh download:

```bash
hf download abhid1234/replay-room-fixtures dataset-manifest.json \
  --repo-type dataset \
  --local-dir /tmp/replay-room-fixtures-readback
```

Compare the downloaded manifest with `fixtures/huggingface/dataset-manifest.json` before marking the mirror live.
