# dFarming cross-platform closure — 2026-09-21

## Functional revision

`9b6a558` (`fix(dfarming): share executable plugin registry`) is the functional
revision that closed the scheduler regression found during this acceptance run.
The later closure commit only updates task and deployment evidence.

## Production topology proved

- MiniPC is the only control plane and keeps the existing
  `kevs-ios-agents_phone-farm-postgres` Docker volume.
- Mac Studio is the iOS execution worker. Its physical-iPhone lane is disabled;
  Appium 3/XCUITest serves the booted iPhone 17 Simulator.
- MateBook Linux is the Android execution worker. ADB + Appium 3/UiAutomator2
  serve the Google Android Emulator API 30 lane.
- Both workers and the control plane were on `9b6a558` before the live
  acceptance below.

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

## Intentionally open hardware gates

- Signed physical iPhone/WDA/Appium regression and modern-Appium migration.
- Physical Android UiAutomator2 acceptance.
- Cross-platform video benchmark on real hardware.

Those rows require hardware that is not currently attached; they are not
represented as completed runtime proof.
