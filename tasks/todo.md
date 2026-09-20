# dFarming task board

## Recovered and source-complete

The original FARM-001…FARM-035 cross-platform line was recovered from Git
history and reconciled with the later iOS hardening rather than resurrected as
an old branch.

- [x] One MiniPC control plane, PostgreSQL/pg-boss scheduler and authenticated workers.
- [x] Physical iOS + iOS Simulator runtime lanes.
- [x] Physical Android + Android Emulator runtime lanes.
- [x] Platform-aware worker handshake, discovery, registry and host capabilities.
- [x] Linux Android worker doctor and systemd-user packaging.
- [x] Stable semantic accessibility model for XCUITest + UiAutomator2.
- [x] Portable versioned flows and bounded Maestro interoperability.
- [x] Capability-aware allocation, tags and persistent device pools.
- [x] Fleet wall grouping/filtering, Online/Offline/Disconnected state, safe
  confirmed bulk operations and exactly one focused live stream.
- [x] Optional Android scrcpy H.264 video adapter behind signed capabilities.
- [x] Account-to-device binding, account pause/task policy and execution evidence.
- [x] Current clean source gate: TypeScript + **147/147 tests** + web build.
- [x] Production dependency audit: **0 vulnerabilities** with `npm audit --omit=dev`.
- [x] Approved donor forks created and pinned in `donors.lock.json`.

Historical FARM ticket files remain for provenance; they are not active WIP.

## Live acceptance — environment dependent

- [ ] DFARM-LIVE-01 — Cut dFarming over on the MiniPC while preserving the
  existing `kevs-ios-agents_phone-farm-postgres` volume; prove exact main SHA,
  Compose health, migrations and rollback seam.
- [ ] DFARM-LIVE-02 — Reinstall/prove the Mac Studio worker from
  `~/Code/dFarming`; prove simulator lane and, when attached, physical
  iPhone/WDA read-only acceptance.
- [ ] DFARM-LIVE-03 — Deploy at least one Linux Android worker and prove ADB,
  UiAutomator2, physical Android, Android Emulator, stream/screenshot and a
  harmless Portable Flow.
- [ ] DFARM-LIVE-04 — Run the cross-platform video benchmark on real hardware;
  keep scrcpy optional until measurements justify a default.

## New feature tickets

- [ ] DFARM-101 — Named network-route isolation for account/device profiles.
  Route IDs must resolve on the owning worker, be observable in receipts and
  support privacy/testing/operational segmentation without bypassing provider
  enforcement.
- [ ] DFARM-102 — dCreator bridge. Accept approved asset/job envelopes and emit
  receipts/results while keeping credentials, cookies, sessions, scheduler and
  device registry isolated.
- [ ] DFARM-103 — Donor runtime adapters. Add narrow, versioned adapters where
  they improve the current native seam: Appium Device Farm, IDB,
  pymobiledevice3 external service, Google Android emulator containers and
  optional STF views.
- [ ] DFARM-104 — Worker packaging for Windows Android hosts, preserving the
  same authenticated worker protocol and MiniPC authority.
- [ ] DFARM-105 — Per-account execution-profile constraints (dedicated device,
  required tags, route ID and explicit profile identity) enforced before
  schedule persistence.

## Definition of clean

No active feature branch/worktree/stash is required for the canonical repo.
Source gates must be green. Runtime claims require live receipts; unavailable
hardware is reported as live-gated rather than called complete.
