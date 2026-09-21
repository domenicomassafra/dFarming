# FARM-035 — Fleet wall hierarchy and safe operations

Status: **complete — source + production browser acceptance**

## Goal

Bring Fleet to the same operational hierarchy and visual language as Overview, Device List, Automation Studio, Runs and the single-device workspace while preserving one-stream-at-a-time behavior.

## Scope

- Still-preview device wall with exactly one focused live stream at a time.
- Explicit Online / Offline / Disconnected connectivity states.
- Search plus Status / Platform / Kind filters aligned with Device List semantics.
- Grouping by execution host, platform or kind, with host grouping as the default wall hierarchy.
- Safe confirmed bulk Reconnect, Enable, Disconnect/Disable and Clear queue + stop actions.
- Bulk Disable refuses devices with active automation until queue/stop is handled.
- Useful empty/filter-empty states and explicit auto/manual refresh state.
- Black / graphite / white presentation consistent with the converged control plane.

## Acceptance

- Full source gate: 127+ tests, TypeScript, `build:web`, `git diff --check`, gitleaks.
- MiniPC rebuild completes and control-plane/PostgreSQL are healthy; `/health` and doctor are green.
- Production browser acceptance proves grouping/filtering, still previews, one focused live stream with still fallback, distinct connectivity states and confirmed bulk controls against temporary fixtures, followed by complete cleanup.
- Physical-iPhone WDA Add Device acceptance remains separately live-gated and is not claimed by this ticket.

## Production re-proof — 2026-09-21

Re-proven against the real MiniPC control plane with the production Mac Studio
and MateBook Linux workers, after the cross-platform cutover:

- Fleet loaded **2 devices / 2 online**, grouped by `macstudio` and
  `matebooklinux`.
- Platform filter `Android` reduced the wall to **1 shown / 2 total** and kept
  the Google Android Emulator API 30 tile.
- Focus switched Android → iPhone 17 Simulator while keeping exactly **one**
  `.is-focused` tile. The iOS focus obtained the signed `/remote/stream`
  capability and reported `Only this focused device is streaming live`.
- A confirmed bulk **Disable** on the Android emulator changed the production
  UI from Online to **Disconnected** (`1 online / 1 disconnected`); the same
  device was then re-enabled and returned to `2 online / 0 disconnected`.
- Stopping only `dfarming-device-worker.service` on MateBook Linux left Appium
  and the scheduler running but changed the wall to **1 online / 1 offline**.
  Restarting the gateway recovered the wall to **2 online / 0 offline**.
- No temporary device fixture remained after the proof.

The re-proof also exposed a transient Mac worker discovery issue. Commits
`c8c1df7` and `f078bd6` remove redundant per-device runtime discovery, bound
`simctl`, preserve a short last-known-good simulator snapshot on transient
probe failure, and stop treating shutdown Simulator definitions as connected.
After restart, 10 consecutive Mac `/v1/devices` probes completed in roughly
0.19–0.45 s and all reported the iPhone 17 Simulator connected.
