# Contributing

1. Create a focused branch from `main`.
2. Keep fixtures synthetic and free of credentials or customer payloads.
3. Run `npm run verify` before opening a pull request.
4. If Postgres and Redis are available, also run `npm run test:integration`.
5. Document behavior, schema, security-boundary, or Blueprint changes in the same pull request.

Pull requests never publish packages or create Render resources. Releases and deployment activation remain explicit maintainer actions.
