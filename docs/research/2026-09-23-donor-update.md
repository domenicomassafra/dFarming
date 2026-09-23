# Donor update — 2026-09-23

The dFarming donor set was refreshed against current upstream repositories. dFarming remains the sole fleet, policy, scheduler and receipt authority; these additions are bounded references or benchmark candidates rather than parallel control planes.

| Donor | Pinned upstream revision | License | dFarming use | Decision |
| --- | --- | --- | --- | --- |
| `tddworks/baguette` | `14a3d23a03989dbce9ef0b75a906cb82e96f38aa` | Apache-2.0 | Stable accessibility identifiers and Simulator readiness/farm patterns | Pattern promoted; Baguette runtime/video still benchmark-gated |
| `minitap-ai/mobile-use` | `62913c933e21b27da353a89316a09f60525af496` | Apache-2.0 | Cross-platform structured observe→act agent interaction | Pattern promoted behind dFarming API/MCP/CLI; no external authority |
| `LWHikarik/device-farm-ios` (`fix/restore-ios-support`) | `37a169d88905b59bc998ea5f251dd00e813aa17c` | MIT | Separate control/video transports and qvh benchmark ideas | Capability/benchmark pattern promoted; qvh runtime remains hardware-gated |

Forks are kept in the owner namespace as `dFarming-baguette`, `dFarming-mobile-use`, and `dFarming-device-farm-ios`. The pinned SHA in `donors.lock.json`, not a moving branch name, is the research authority for any future adaptation.

## Implemented in this donor pass

- Agent clients now have one structured observation call plus bounded semantic,
  system and app-lifecycle actions. MCP keeps a deliberately small canonical
  `dfarming_observe` + `dfarming_act` surface.
- Semantic snapshots preserve Android `resource-id` and iOS
  `name`/`identifier`, so agents and imported flows can select stable IDs rather
  than visible copy alone.
- Maestro import/export covers `stopApp`, `assertNotVisible` and ID-backed
  selectors while unsupported/lossy commands still fail closed.
- Video transport is advertised per device. An iOS/Appium device cannot receive
  a false H.264 capability merely because an Android scrcpy adapter exists on
  the fleet proxy.
- Video benchmarks use the actual advertised backend name; optional qvh/H.264
  remains separate from automation control.
- Android emulator state distinguishes `booting` from `booted`, and Boot waits
  for an ADB serial plus `sys.boot_completed=1` before reporting success.
- Google Android Emulator containers labeled
  `com.dfarming.runtime=android-emulator` are discovered as first-class
  virtual runtimes. dFarming can stop/start the container and does not mark a
  restart complete until ADB reconnects and Android finishes booting.
- The mobile-use-style observation seam now degrades section-by-section instead
  of failing the whole observation when lock, scheduler or connection status is
  temporarily unavailable. Screen metadata is obtained once per observation,
  and semantic refs are invalidated immediately after mutating actions so an
  agent cannot reuse coordinates from a pre-transition snapshot.
- Direct remote actions are parsed at runtime on both the control plane and the
  worker. Unknown action types, malformed app identifiers, unbounded text,
  invalid orientations and unreasonable swipe durations fail closed before
  reaching Appium/WDA.
- Baguette's Simulator-native seam was adopted narrowly: iOS Simulator
  screenshots use `simctl io screenshot` first and fall back to Appium only
  when the native probe itself is unavailable. In live testing on the Studio,
  repeated native captures completed in roughly 0.5–0.7 s while the stale
  Appium screenshot path had timed out at 30 s. Control and accessibility stay
  on the canonical Appium/XCUITest path; Baguette runtime/video remains held.
- Read-only diagnostics are exposed as bounded snapshots instead of shell
  access: app/container-filtered `simctl log show` for iOS Simulator and
  `adb logcat` for Android,
  capped at 500 lines / 5 minutes with common credential patterns redacted.
  Physical-iPhone log collection remains explicitly unsupported until a
  similarly bounded native transport is proven.
- Portable flows and Maestro import/export now share portrait/landscape
  orientation steps. Unsupported or lossy Maestro commands still fail closed.
