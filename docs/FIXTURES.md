# Publishing the synthetic fixture dataset

Replay Room's public fixture mirror is built from the same source cases used by the conformance gate. The Hugging Face bundle lives in `fixtures/huggingface` and is deterministic: generated data files have no current timestamp, random identifier, or machine-specific path.

## Build and verify

```bash
npm run fixtures:build
npm run fixtures:check
npm run conformance
```

The build fails if an incident includes a receiver outside the reserved `.example` domain, a signing secret, a credential-like header, a non-synthetic ingest key, or a duplicate case ID. `dataset-manifest.json` contains byte lengths and SHA-256 digests for both JSONL configurations.

The `provider-rate-limit` incident includes two synthetic `429` attempts and the durable `delivery.retry_scheduled` decision derived from `Retry-After: 120`, so consumers can inspect the receiver hint, bounded delay, next attempt, and exact availability time without using real traffic.

## Publish to Hugging Face

Authenticate with a write-scoped Hugging Face token, then create or reuse the public dataset and upload the prepared directory as one commit:

```bash
hf auth login
hf repos create abhid1234/replay-room-fixtures --repo-type dataset --public --exist-ok
hf upload abhid1234/replay-room-fixtures fixtures/huggingface . \
  --repo-type dataset \
  --commit-message "Publish Replay Room fixture dataset v0.1.2"
```

Do not pass a token on the command line or commit one to the repository. After upload, reopen the public dataset, confirm that both `incidents` and `replay_guard` configurations render, and read back the manifest with a fresh download:

```bash
hf download abhid1234/replay-room-fixtures dataset-manifest.json \
  --repo-type dataset \
  --local-dir /tmp/replay-room-fixtures-readback
```

Compare the downloaded manifest with `fixtures/huggingface/dataset-manifest.json` before marking the mirror live.

## Verified public mirror

The public dataset is live at <https://huggingface.co/datasets/abhid1234/replay-room-fixtures>. The initial dataset commit is `9e343c2930f2dd6a3b795cc58df99224c685da23`.

On 2026-09-29, a fresh download reproduced all four prepared files byte-for-byte. An unauthenticated download of `dataset-manifest.json` produced SHA-256 `c37ad0cab7e5dc2d34c6a526cf8fa20acea613640817e756a33108b062a29fac`, matching the checked-in manifest.

Dataset version `0.1.2` was published on 2026-10-01 at commit `dfd09d101e0c4c281d156c395b9b001f9d11fdfe`. A fresh anonymous readback of `dataset-manifest.json` matched the checked-in file byte-for-byte at SHA-256 `fabe8f833b133c9580d822bf8340cceb3b29dadd054acf5b2c8d30e442096e80`.
