# FARM-033 — Single-device workspace hierarchy and resilient preview

Status: production complete; MiniPC/browser live proof passed.

## Goal

Bring the Open-device workspace up to the same black/graphite/white interaction hierarchy as Overview and Device List without changing device-control authority.

## Scope

- Status-first device summary with runtime/backend/tags and enabled state.
- Local command bar: reconnect, enable/disable, tasks/runs, grouped management actions.
- Live stream controls separated from device lifecycle actions.
- Automatic live-stream → still-screenshot fallback and explicit still refresh.
- Group system controls and reduce visible action noise.
- Capability-gate WDA/iPhone-only configuration on Appium runtimes.
- Keep queue clear / stop controls inside the Tasks & runs workspace.
- Preserve the physical-iPhone WDA Add Device acceptance as live-gated until full Xcode + a real iPhone are available.

## Acceptance

- Full source gate passes.
- MiniPC rebuild is healthy on the exact application commit.
- Production browser proof covers an Appium fixture and a WDA fixture, capability gating, lifecycle controls and live→still fallback.
- All fixtures/browser profiles/temp files are removed before closeout.

## Production acceptance

- Application feature commit: `d1a84c3` (`feat: modernize device workspace`).
- Responsive/density fix from live screenshot review: `3cd7f42` (`fix: keep device screen primary`).
- Full final source gate on `3cd7f42`: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green and gitleaks reported no leaks.
- MiniPC rebuilt from `3cd7f42` through `Successfully built`; PostgreSQL and control-plane were healthy, `/health` returned `ok=true`, and the production-container doctor reported `Source readiness: ready` / `Runtime readiness: ready`.
- Production browser acceptance used two explicit contract fixtures from the configured `macstudio` worker path: an Android emulator/Appium fixture and an iOS physical/WDA fixture. These are UI/runtime-contract fixtures, not real-hardware Add Device acceptance.
- Appium proof: status-first summary and local command bar rendered on the live MiniPC page, WDA-only controls were hidden, Tasks & runs exposed queue controls, Disable → reload → Enable worked through the real PATCH endpoint, and the intentionally failed MJPEG stream fell back automatically to `/remote/screenshot` with `Still preview` state.
- WDA proof: iPhone/WDA-only management controls were visible only for the WDA backend; stream fallback also reached Still preview. The final responsive browser proof at 820px verified the screen panel precedes the action stack and `iPhone / WDA automations` is collapsed by default rather than flooding the workspace.
- Full-page production screenshots were inspected before cleanup and confirmed the black/graphite/white hierarchy: status → command bar → screen → workflows/activity.
- Cleanup passed: both temporary devices deleted with HTTP 204, `/api/devices` returned `[]`, fixture worker port 3010 and CDP port 9333 had zero listeners, the temporary Chrome profile was absent, no `/tmp/farm33-*` files remained, and FARM33 Preview windows were closed.
- The physical-iPhone WDA Add Device flow is still explicitly **live-gated**. FARM-033 fixture proof does not close it. It remains pending `acceptance:live` with full Xcode + a real iPhone.
