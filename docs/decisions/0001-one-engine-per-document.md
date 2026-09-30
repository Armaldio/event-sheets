# ADR-001: One engine per document

## Status
Accepted

## Date
2026-09-28

## Context
Construct and Native have different execution rules, registries, and selection semantics. Mixing them inside one document would make validation, editing, and runtime ownership ambiguous.

## Decision
Each `EventDocument` names exactly one engine in its `engine` descriptor. The initial architecture has no engine-switching workflow and does not mix engine semantics within a document.

## Alternatives considered
- Assign an engine per sheet or event. Rejected because nested events and shared variables would have unclear semantics.
- Add engine conversion to the editor. Deferred until a concrete conversion can preserve behavior.

## Consequences
- The schema stays engine-neutral while each engine interprets the same document contract.
- Consumers choose the engine before parsing or executing a document.
- Cross-engine conversion remains future work.
