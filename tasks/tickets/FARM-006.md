# FARM-006 — Account policy: pause, task allow-list and operator reason

- Status: **done**
- Date: 2026-09-13

## Objective

Add per-account policy independent of device disable state. Policy refusals must be structured and tested; no platform-evasion behavior.

## Acceptance / proof

- account policy schema
- schedule validation
- API/UI

## Evidence

- Per-account pause and task allow-list policy are enforced before scheduling.
- Account API/dashboard surface policy without leaking credentials.
- Covered by account/plugin regression tests in the 98/98 source gate.
