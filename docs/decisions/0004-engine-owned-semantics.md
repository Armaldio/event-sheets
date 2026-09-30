# ADR-004: Engine packages own engine semantics

## Status
Accepted

## Date
2026-09-28

## Context
Construct-specific ACE definitions, picking, event ordering, and runtime behavior do not apply to Native. Sharing them through the schema or visual package would couple engines that should evolve independently.

## Decision
`@project/engine-construct` and `@project/engine-native` depend on `@project/schema` and own their definitions and runtime behavior. `@project/visual` renders the shared schema and uses engine-neutral definitions only where required for editing.

## Alternatives considered
- Put Construct rules in shared schema or visual components. Rejected because Native would inherit Construct assumptions.
- Make Native depend on Construct. Rejected because Native has cleaner semantics and must remain independently usable.

## Consequences
- Engine packages may have different capabilities and compatibility states.
- Shared types stay generic; runtime state remains outside the schema.
- Adding an engine should not require restructuring another engine package.
