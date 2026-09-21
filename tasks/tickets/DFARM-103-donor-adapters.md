# DFARM-103 — Donor runtime adapters

Status: **complete for the reviewed donor set**.

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

## Closure

`donors.lock.json` remains the immutable upstream authority and
`donor-adapters.json` now records one explicit decision/failure mode for every
approved donor. The suite verifies SHA/license integrity, pinned container
digests, promoted implementation paths and GPL isolation.

Promoted seams are intentionally limited to:

- Google Android emulator containers → pinned Linux/KVM capacity provider;
- scrcpy → optional video-only adapter with Appium still owning control;
- Maestro → bounded, lossless import/export with Portable Flow canonical.

Appium Device Farm and STF are reference-only because importing their farm
authority would duplicate the canonical dFarming registry/scheduler. IDB is
held until a measured Apple transport gap appears. pymobiledevice3 remains
held external-only under the GPL boundary and is not linked into the core.

Adding code for those held donors without a proven seam would violate this
ticket's own "only where they improve a proven seam" requirement; any future
promotion therefore needs a new measured acceptance case rather than dead
adapter scaffolding.
