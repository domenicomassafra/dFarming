# DFARM-103 — Donor runtime adapters

Status: feature backlog.

Use `donors.lock.json` as the approved source set. Add adapters only where
they improve a proven seam:

- Appium Device Farm: concrete-device/session integration without surrendering
  dFarming scheduler authority.
- IDB: Apple companion/transport adapter.
- pymobiledevice3: external process/service adapter only.
- Google Android emulator containers: capacity provider surfaced as normal
  Android workers/runtimes.
- STF: optional Android lab/device-wall view, never canonical registry.
- scrcpy: keep video-only unless an explicit reviewed design changes control.
- Maestro: keep bounded import/export and evaluate runner delegation separately.

Each adapter needs a pinned donor SHA, license check, contract tests and a
failure mode that leaves the core usable.
