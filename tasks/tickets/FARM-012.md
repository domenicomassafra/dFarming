# FARM-012 — Account/device health and execution analytics

- Status: **done**
- Date: 2026-09-13

## Objective

Aggregate readiness, queue latency, workflow outcomes and account execution facts into operator-facing health.

## Acceptance / proof

- health model
- metrics API
- dashboard

## Evidence

- Fleet health aggregates readiness, queue latency and account outcomes without secrets.
- Health/control-plane data is exposed to the operator dashboard/API.
- Analytics coverage is green in the 98/98 source gate.
