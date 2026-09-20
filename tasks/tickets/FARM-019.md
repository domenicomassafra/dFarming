# FARM-019 — Unified real + virtual iOS/Android runtime layer

- Status: **source-complete / live-matrix-pending**
- Date: 2026-09-13

## Objective

Turn the iPhone-first worker model into a device-runtime model that can host physical iPhones, iOS Simulators, physical Android devices and Android emulators behind one MiniPC control plane.

## Implemented

- `platform`, `kind`, `automationBackend`, `workerId` device metadata with legacy iPhone compatibility.
- Worker host capability API and control-plane host inventory.
- `simctl` iOS Simulator discovery and `adb` Android physical/emulator discovery.
- Dashboard fast-attach flow for non-physical-iPhone runtimes.
- Dedicated Appium 3 sidecar on `:4726`, isolated from the physical-iPhone Appium/WDA lane on `:4725`.
- XCUITest `12.12.3` + UiAutomator2 `8.6.4` isolated in `.appium-runtime`.
- Generic Appium remote screen/input/app-lifecycle adapter.
- Appium XML → canonical semantic stable-ref normalization for Android and iOS Simulator.
- launchd service packaging and device-worker setup install both runtime drivers.
- Old worker compatibility: missing new host/runtime endpoints does not drop legacy device inventory.
- Worker/control-plane virtual-runtime inventory covers **shutdown definitions**, not only already-running devices.
- Dashboard host cards can boot/shutdown iOS Simulators and Android AVDs on the owning execution worker.

## Verification

- Appium 3.7.0 sidecar launched locally on `127.0.0.1:4726` and returned `ready:true` from `/status` with both modern drivers loaded.
- Appium 3 sidecar and isolated drivers remain separate from the physical-iPhone lane; source regression stays green after adding runtime lifecycle management.

## Remaining live proof

- One booted iOS Simulator session through XCUITest 12.x.
- One Android emulator through UiAutomator2.
- One physical Android device through UiAutomator2/ADB.
- Distributed MiniPC → worker proxy receipt for at least one non-iPhone runtime.
