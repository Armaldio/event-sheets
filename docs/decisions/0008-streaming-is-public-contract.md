# ADR-008: Streaming is part of the parser contract

## Status
Accepted

## Date
2026-09-28

## Context
LLM and network input arrives in chunks. Consumers need to render stable recognized structure before the final source is available.

## Decision
The public parser supports `push()`, `snapshot()`, and `finish()`. The current implementation may reparse accumulated source, retains recoverable structure across malformed chunks, and uses stable Construct SIDs where available.

## Alternatives considered
- Expose only a batch `parse()` function. Rejected because consumers would need to buffer the whole source before displaying anything.
- Promise true incremental parsing in the first implementation. Rejected because the current workload does not justify that complexity.

## Consequences
- Consumers can progressively update the viewer from snapshots.
- Snapshots may be partial and include diagnostics.
- Reparse performance will be measured before replacing the implementation with a truly incremental parser.
