# ADR-006: Preserve unknown imported information

## Status
Accepted

## Date
2026-09-28

## Context
Construct projects can contain newer fields and third-party ACEs that the current registry does not understand. Dropping them during import would make a later export destructive.

## Decision
Retain raw data for unknown or unsupported nodes and opaque metadata where possible, represent unknown nodes in the schema, and attach diagnostics when interpretation or export is limited.

## Alternatives considered
- Discard unknown fields and ACEs. Rejected because it loses project content silently.
- Refuse to import any file containing unknown data. Rejected because it prevents viewing and editing known portions.

## Consequences
- Consumers can inspect unknown content and decide whether to edit or export it.
- Export analysis reports supported, lossless, and potentially lossy cases.
- Preservation is bounded by the raw data available to the importer.
