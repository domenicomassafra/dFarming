# FARM-021 — Cross-platform video transport bake-off

- Status: **adapter-source-complete / live-benchmark-pending**
- Date: 2026-09-13

## Objective

Replace the generic Appium screenshot-loop preview only when a measured transport is materially better, without coupling automation correctness to video.

## Candidates

- Android: `scrcpy` video/control transport, keeping Appium/UiAutomator2 as the deterministic automation API.
- iOS Simulator: Baguette H.264/MJPEG/WebSocket streaming and headless farm UX patterns.
- Physical iPhone: existing WDA MJPEG versus the separate qvh/H.264 benchmark already covered by FARM-013.

## Acceptance

- Measure first-frame time, fps, control latency, CPU, bandwidth and automation interference.
- Video failure must not take down scheduling/control.
- Dashboard uses one transport abstraction regardless of selected backend.
- Keep the screenshot-loop fallback for runtimes where no optimized video adapter exists.

## UI work already landed

- The old 20-seat mock demo has been replaced by a real `/fleet` device wall.
- All tiles use low-cost still previews; filtering supports online/iOS/Android/physical/virtual/running.
- Only the selected/focused device upgrades to the live stream capability, following the Baguette/STF pattern and avoiding N simultaneous high-rate streams.
- Stream failure falls back to a still screenshot without taking down control or scheduling.
- Fleet view now supports multi-select, grouping by host/platform/kind and safe bulk operational actions (reconnect, enable/disable, clear queue/stop automation); no bulk social/send/tap primitive is exposed.

## Android scrcpy adapter landed

- Optional worker-side raw-H.264 source using the official scrcpy server protocol in video-only mode (`control=false`, `audio=false`, `raw_stream=true`).
- No automatic binary/JAR download: the operator supplies an explicitly version-matched server artifact, and host capability `android.h264` appears only when ADB + that artifact are present.
- H.264 is proxied worker → MiniPC behind the same signed expiring stream capability model as existing video.
- `benchmark:video` can now collect scrcpy bytes/TTFB/control-latency overhead beside the existing baseline/WDA/qvh results.
- Appium/UiAutomator2 remains the action authority. scrcpy is not selected as the dashboard default until real-device measurements prove it wins.

FARM-021 remains live-gated for the actual Android measurements and for the iOS-Simulator Baguette-style candidate.
