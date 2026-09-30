# ADR-003: Keep the schema independent of Vue

## Status
Accepted

## Date
2026-09-28

## Context
Consumers need to parse, validate, serialize, and analyze event sheets without installing the visual editor. Vue reactivity is a view implementation detail and is not a stable interchange format.

## Decision
`@project/schema` owns plain TypeScript document contracts and generic serialization, validation, and migration behavior. It has no Vue dependency and no editor state.

## Alternatives considered
- Export Vue reactive objects as the public document model. Rejected because it couples headless consumers to a UI framework.
- Put engine-specific behavior in the schema. Rejected because it would make the shared contract a Construct-only model.

## Consequences
- Headless tools can use the schema package independently.
- The visual package adapts document snapshots for rendering and editing.
- Engine behavior belongs to engine packages, recorded separately in ADR-004.
