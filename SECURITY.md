# Security policy

## Reporting a vulnerability

Please use GitHub private vulnerability reporting for `abhid1234/replay-room`. Do not open a public issue containing secrets, payloads, exploit details, or customer data.

## Supported versions

No public production release is supported yet. Security fixes target the latest commit on `main` until the first tagged release.

## Boundaries

Replay Room redacts sensitive headers, validates webhook signatures, limits payload size and ingest rate, blocks private or reserved outbound destinations, and seals evidence bundles. The current outbound check still has a DNS lookup-to-connect rebinding window; hardened multi-tenant deployments require DNS pinning or an egress proxy. Stored payload encryption and organization-scoped authorization are also required before handling third-party production traffic.
