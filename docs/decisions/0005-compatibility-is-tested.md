# ADR-005: Define Construct compatibility through evidence

## Status
Accepted

## Date
2026-09-28

## Context
Construct behavior spans core events, selection rules, plugins, and runtime details. A broad compatibility claim would hide unsupported behavior and known divergences.

## Decision
Track compatibility per feature as tested, unsupported, untested, or a known divergence. Tests and fixtures support tested claims; the compatibility report states the evidence and current limits.

## Alternatives considered
- Claim compatibility based on successful parsing or rendering. Rejected because display does not prove runtime equivalence.
- Track one global percentage. Rejected because it hides which behaviors are covered.

## Consequences
- Unsupported or untested features remain explicit to callers.
- New Construct behavior needs a fixture or a documented limitation.
- Full Construct compatibility remains an open goal until the feature matrix supports it.
