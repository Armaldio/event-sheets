# Event Sheets

Schema-first tooling for Construct event sheets, with a Vue playground for
viewing and editing documents.

## Development

Install the pinned Node.js and pnpm versions, install workspace dependencies,
then start the playground:

```sh
mise install
pnpm install
pnpm dev
```

Repository checks:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Workspace

- `apps/playground` is the Vue application.
- `packages/schema` is the engine-independent document contract.
- `packages/engine-construct` owns Construct parsing, project import, and ACE definitions.
- `packages/visual` provides Vue components for viewing and editing event documents.
- `tooling/typescript` and `tooling/lint` hold shared repository configuration.

## Architecture

Each `EventDocument` targets one engine. The schema is independent of Vue and
owns the shared document contract; Construct and Native engines own their
semantics. Construct compatibility is tracked feature by feature through tests
and an explicit report. Parsers can return partial documents with diagnostics,
and the Construct parser supports chunked `push()`, `snapshot()`, and `finish()`
updates. See [the architecture decisions](docs/decisions/README.md) for the rationale.
