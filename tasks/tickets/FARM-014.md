# FARM-014 — Harden remote stream/session security

- Status: **done**
- Date: 2026-09-13

## Objective

If remote access is enabled, add signed expiring stream capabilities and origin/loopback fences inspired by DSH iOS.

## Acceptance / proof

- threat model
- signed token routes
- negative tests

## Evidence

- Stream capabilities are signed, expiring and device-bound.
- Agent client refuses unauthenticated non-loopback farm URLs.
- Tamper/expiry/auth negative tests are green in the 98/98 source gate.
