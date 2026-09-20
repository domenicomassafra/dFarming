# FARM-007 — Semantic WDA snapshot and stable element references

- Status: **done**
- Date: 2026-09-13

## Objective

Implement token-efficient accessibility snapshots and stable refs inspired by iphone-mcp/Hermes, behind a core interface with fixture tests.

## Acceptance / proof

- tree snapshot
- find element
- stable refs
- no LLM dependency

## Evidence

- Compact accessibility snapshots emit generation-scoped stable refs (`e1`, `e2`, ...).
- Snapshot/ref resolution is device-scoped and invalidates stale generations.
- Fixture/unit coverage is green in the 98/98 source gate.
