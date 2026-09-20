# FARM-035 — Fleet wall hierarchy and safe operations

Status: source implementation complete; production/live acceptance must be
re-proven after the dFarming cross-platform cutover.

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
