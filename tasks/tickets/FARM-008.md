# FARM-008 — Semantic actions and redacted traces

- Status: **done**
- Date: 2026-09-13

## Objective

Add find/tap/wait/type primitives, action logs and bounded failure traces. Sensitive typed text must be redacted.

## Acceptance / proof

- semantic actions
- trace store
- tests

## Evidence

- Semantic controller implements ref-based tap, text wait and typing primitives.
- Typed values are redacted from action traces.
- Ref resolution and redaction tests are green in the 98/98 source gate.
