# Security policy

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for `abhid1234/replay-room`. Do not open a public issue containing secrets, payloads, exploit details, or customer data.

## Supported versions

No public production release is supported yet. Security fixes target the latest commit on `main` until the first tagged release.

## Boundaries

Replay Room redacts sensitive headers, validates webhook signatures, limits payload size and ingest rate, blocks private or reserved outbound destinations, pins each outbound socket to the address that passed validation, refuses redirect following, and seals evidence bundles. Stored payload encryption, organization-scoped authorization, explicit egress policy, and tenant retention controls are still required before handling third-party production traffic.
