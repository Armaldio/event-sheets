# ADR-002: Partial documents are parser results

## Status
Accepted

## Date
2026-09-28

## Context
Construct files can be malformed or truncated, and streamed input is incomplete until later chunks arrive. A fail-fast parser would discard useful structure and prevent the viewer from showing recognized events.

## Decision
Parsers return a `ParseResult` with a document, diagnostics, and completion status. The schema represents unknown, invalid, and incomplete nodes so callers can render recoverable structure without first proving the whole document valid.

## Alternatives considered
- Throw on the first parse error. Rejected because it hides valid neighboring content.
- Return only a best-effort document with no diagnostics. Rejected because callers could not distinguish unsupported, invalid, and incomplete content.

## Consequences
- Consumers handle partial status and recovery nodes explicitly.
- The editor can display incomplete events and ACEs while retaining diagnostics.
- Recovery behavior is tested against malformed and streamed input.
