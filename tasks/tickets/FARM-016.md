# FARM-016 — Physical-iPhone end-to-end acceptance matrix

- Status: **blocked-live**
- Date: 2026-09-13

## Objective

Prove discover → registration → WDA → video → input → app/account switch → scheduled workflow → evidence on a real owner device.

## Acceptance / proof

- full Xcode
- signed WDA
- physical iPhone
- PostgreSQL

## Current state

`npm run acceptance:live -- --udid <UDID>` is implemented and writes a receipt covering farm health, screenshot hash, semantic snapshot, stream bytes, optional input and optional scheduled-task terminal result. The command refuses to run when `doctor` reports the real-device prerequisites as unavailable.
