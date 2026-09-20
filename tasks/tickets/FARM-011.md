# FARM-011 — Campaign/content control plane

- Status: **done**
- Date: 2026-09-13

## Objective

Add campaign records, asset targeting, review state, account targets and immutable execution attribution.

## Acceptance / proof

- campaign model
- materialization
- review/publish states

## Evidence

- Campaign planning validates account/device bindings, rejects duplicate targets and caps fan-out.
- Materialized schedules retain campaign attribution through execution records.
- Public/send actions are classified as high impact and require explicit intent/confirmation.
