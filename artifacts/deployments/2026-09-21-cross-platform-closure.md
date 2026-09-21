# dFarming cross-platform closure — 2026-09-21

## Functional revisions

The closure produced three functional fixes before the final evidence-only
commit:

- `9b6a558` — share the executable plugin registry between control plane and
  scheduler workers;
- `c8c1df7` — bound worker runtime discovery and remove redundant per-device
  rediscovery;
- `f078bd6` — stabilize iOS Simulator discovery with boot-state filtering and a
  short last-known-good grace on transient probe failure.

## Production topology proved

- MiniPC is the only control plane and keeps the existing
  `kevs-ios-agents_phone-farm-postgres` Docker volume.
- Mac Studio is the iOS execution worker. Its physical-iPhone lane is disabled;
  Appium 3/XCUITest serves the booted iPhone 17 Simulator.
- MateBook Linux is the Android execution worker. ADB + Appium 3/UiAutomator2
  serve the Google Android Emulator API 30 lane.
- Both workers and the control plane were on `9b6a558` for the Portable Flow
  acceptance receipts below. The later Fleet browser re-proof exercised the
  worker-discovery fixes through `f078bd6`.

## Acceptance receipts

### Android Emulator

- Device: `127.0.0.1:5555` — Google Android Emulator API 30
- Screenshot: 547395 bytes
- Semantic snapshot: 7 elements
- MJPEG first chunk: 964 bytes
- Portable Flow execution: `succeeded`
- Receipt: `/data/scheduler/acceptance/2026-09-21T11-11-56-028Z-127.0.0.1_5555.json`

### iOS Simulator

- Device: `A49A8F25-0C31-4231-B431-470200691A96` — iPhone 17 Simulator
- Screenshot: 3248294 bytes
- Semantic snapshot: 14 elements
- MJPEG first chunk: 963 bytes
- Portable Flow execution: `succeeded`
- Receipt: `/data/scheduler/acceptance/2026-09-21T11-12-13-302Z-A49A8F25-0C31-4231-B431-470200691A96.json`

## Regression found and fixed

The first harmless Android Portable Flow reached pg-boss but failed because
the control plane loaded `com.phone-farm.flow` while the scheduler worker built
a different default plugin registry and omitted that executable plugin.

`src/default-plugins.ts` now owns the executable plugin set shared by both
processes. A regression test asserts that Flow, TikTok and Instagram are
present. Source verification is 176/176 tests, TypeScript clean, web build clean
and root `npm audit` clean.

## Fleet browser re-proof and worker-discovery hardening

The production Fleet wall was then exercised with a real headless Chromium
session against the MiniPC tailnet endpoint, without mock devices:

- initial state: 2 devices, 2 online, grouped by `macstudio` and
  `matebooklinux`;
- Android filter: 1 shown / 2 total;
- focus Android → iPhone 17 Simulator: exactly one focused tile at a time, with
  the iOS tile obtaining the signed live-stream URL;
- confirmed Android bulk Disable: 1 online / 1 disconnected;
- restore: 2 online / 0 disconnected;
- MateBook gateway-only stop: 1 online / 1 offline while scheduler + Appium
  remained active;
- gateway restart: 2 online / 0 offline.

During that proof, Mac `/v1/devices` occasionally stalled and made the control
plane transiently mark the Simulator offline. `c8c1df7` removes redundant
runtime rediscovery from the per-device status path and bounds `simctl`.
`f078bd6` adds a 30-second last-known-good grace for transient Simulator probe
failures and only treats `Booted` Simulator definitions as connected. After
restart, ten consecutive `/v1/devices` probes completed in roughly 0.19–0.45 s
and all returned the iPhone 17 Simulator connected.

## Intentionally open hardware gates

- Signed physical iPhone/WDA/Appium regression and modern-Appium migration.
- Physical Android UiAutomator2 acceptance.
- Cross-platform video benchmark on real hardware.

Those rows require hardware that is not currently attached; they are not
represented as completed runtime proof.
