# ADR-007: The host adapter owns external runtime state

## Status
Accepted

## Date
2026-09-28

## Context
The engine can evaluate event logic, but only the embedding game or host knows how to enumerate, inspect, or mutate its actual runtime instances.

## Decision
Construct execution interacts with external objects through a host adapter. The host remains authoritative for its instances and capabilities; the engine owns execution context, variable state, and trace data for a run.

## Alternatives considered
- Let the event-sheet engine create or own game objects directly. Rejected because it would couple the package to one runtime.
- Put host instances in `EventDocument`. Rejected because document data must remain serializable and free of mutable runtime state.

## Consequences
- Hosts implement the adapter contract for their runtime.
- The same compiled document can be exercised against different test hosts.
- Runtime traces can report host operations without owning host objects.
