---
license: mit
language:
- en
pretty_name: Replay Room Incident and Replay Guard Fixtures
size_categories:
- n<1K
tags:
- synthetic
- webhooks
- incident-response
- reliability-engineering
- dead-letter-queue
configs:
- config_name: incidents
  data_files:
  - split: train
    path: data/incidents.jsonl
- config_name: replay_guard
  data_files:
  - split: train
    path: data/replay-guard.jsonl
---

# Replay Room incident and replay guard fixtures

This dataset contains deterministic, entirely synthetic webhook incident transcripts and replay-guard decisions from [Replay Room](https://github.com/abhid1234/replay-room). It is designed for conformance testing, reliability demonstrations, and tooling examples—not model benchmarking or production incident analysis.

## Configurations

- `incidents`: six event transcripts with the expected deterministic diagnosis and duplicate-side-effect risk level.
- `replay_guard`: seven approval and rejection cases covering missing or failed rehearsal, payload drift, destination drift, operator context, and event state.

Every destination uses the IANA-reserved `.example` domain. The build rejects signing secrets, credential-like headers, non-synthetic ingest keys, duplicate case IDs, and non-reserved receiver hosts. No customer traffic, real provider event, personal data, or production secret is included.

`dataset-manifest.json` records the corpus version, record counts, byte lengths, and SHA-256 digest for every JSONL file. Regenerate it from the source fixtures with `npm run fixtures:build`; verify a checkout with `npm run fixtures:check`.

## License

MIT. See the source repository's `LICENSE` file.
