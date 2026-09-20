# FARM-009 — Hermes adapter on the shared semantic bridge

- Status: **done**
- Date: 2026-09-13

## Objective

Integrate Hermes as the preferred owner-facing agent consumer without starting a second WDA supervisor or scheduler.

## Acceptance / proof

- adapter package/config
- consumer proof
- no core fork of Hermes

## Evidence

- Hermes integration is an adapter over the shared farm/semantic API rather than a second WDA or scheduler owner.
- Adapter/client behavior is covered by source tests and preserves farm-side refusals.
