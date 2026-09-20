# MiniPC control-plane deployment receipt — 2026-09-13/14

## Deployed host

- Host: `minipc-ubuntu` / Linux x86_64
- Docker: 29.1.3
- Docker Compose: 5.3.0
- Source branch: `main`
- Current production source: `4155cfa` (`main`), after the completed control-plane feature line was fast-forwarded and the merged feature branch removed.
- Production source lineage includes `a666806` (distributed topology), `95295f7` (dedicated MiniPC ports), `5de126a` (Linux native-install isolation), `c7004c2` (immutable dashboard assets), `c6e6797` (versioned flow library/fleet operations), `fce3b06` (capability-aware flow scheduling), and `362bf13` (device pools/tags/host observability).

## Runtime proof

- Dedicated PostgreSQL container: healthy.
- Dedicated control-plane container: healthy.
- Database migrations: current.
- Linux control-plane import smoke: `control-plane import OK` during Docker build.
- Container doctor: `sourceReady=true`, `runtimeReady=true`.
- Fastify bind: `127.0.0.1:4050` only.
- PostgreSQL bind: `127.0.0.1:55432` plus the MiniPC Tailscale address, not a wildcard public/LAN bind.
- Tailnet HTTPS: `https://minipc-ubuntu.garibaldi-atlas.ts.net:18443` → `127.0.0.1:4050` through Tailscale Serve.
- Health requested from the Mac over tailnet HTTPS: HTTP 200 with `ok=true`.
- Dashboard requested from the Mac over tailnet HTTPS: HTTP 200 (`Devices · IOS AGENTS`).
- `/api/devices` requested from the Mac: reachable and currently empty because no Mac device worker is installed yet.
- `scheduler.device_pools` migration applied on the real PostgreSQL instance.
- Live CRUD smoke for a temporary device + normalized tags and a named device pool passed over tailnet HTTPS; the smoke pool/device were both deleted and production returned to zero temporary fixtures.
- Configured worker `macstudio` remains visible as `offline` instead of disappearing when its gateway is unavailable.
- PostgreSQL TCP `55432` requested from the Mac over Tailscale: reachable.
- Mac gateway network smoke: a temporary non-production gateway bound only to the Mac Studio Tailscale address on port `3010`; the MiniPC reached that TCP listener successfully.
- Gateway auth smoke: an unauthenticated HTTP request was rejected with `401`. Production shared-token pairing was not copied by the automation tool and remains a protected deployment step.

## Live issues found and fixed during deployment

1. `node-native-ocr`'s Linux x64 prebuild required GLIBC 2.38 and failed on the stable Bookworm image. The control plane does not execute OCR/iPhone automation, so its image now installs dependencies with lifecycle scripts disabled and smoke-imports the actual API server.
2. The initial container attempted `npm run web`, whose `preweb` rebuilt dashboard assets as the unprivileged runtime UID and failed on the immutable application tree. Dashboard assets are now built into the image and runtime starts the server directly.
3. Existing MiniPC services already occupied Tailscale port 3000 and local PostgreSQL 5432. Phone Farm uses dedicated ports 4050, 55432 and tailnet HTTPS 18443 without disturbing existing CreatorOS/Buzz containers.

## Remaining physical-device proof

The current Mac Studio is reachable over Tailscale and the gateway network/auth boundary has been smoke-tested, but at this checkpoint it has no full `Xcode.app` selected (only CommandLineTools) and no `devices.json` exists in the searched project/checkouts. Therefore Appium/XCUITest/WDA signing and the physical-iPhone acceptance receipt remain intentionally unclaimed. Production pairing still requires applying the worker/internal tokens to the Mac after full Xcode/signing is ready.

## Control Center UX cutover — 2026-09-14

- Production source advanced to `8fc37e9` on `main`.
- Full source gate before deployment: 127/127 tests, TypeScript green, dashboard build green, diff/secret checks clean.
- Docker rebuild smoke again printed `control-plane import OK`; PostgreSQL stayed healthy and the recreated control-plane returned healthy.
- Tailnet HTTPS smoke confirmed `/api/fragments/control-center` exposes attention state + recent runs, `/automations` exposes the staged Portable Flow workspace and editable saved-pool name, `/fleet` exposes the fleet state notice, and `/tasks` exposes the Mobile Farm Runs/search UI.
- This cutover carried no database migration and did not change device/scheduler contracts.

## Scheduler operations UX cutover — 2026-09-14

- Production source advanced to `c793d46` on `main`.
- Full source gate before deployment remained 127/127 tests with TypeScript/dashboard build green and clean diff/secret scans.
- Runs now serves a visual schedule editor and execution detail/log viewer over the existing canonical schedule/execution APIs.
- Tailnet smoke confirmed both dialogs in `/tasks` and the editor/detail logic in the versioned tasks bundle.
- No database migration or scheduler contract change was required.

## Connected actions cutover — 2026-09-14

- Production source advanced to `d575c09` on `main` with the full 127/127 regression gate green.
- Overview device cards now expose tags and direct device → Portable Flow Studio links.
- Automation Studio serves a prompt-free duplicate-flow dialog.
- Live API smoke used a temporary tagged Android-emulator registry entry to verify the rendered Overview tags/Automate link, then deleted the fixture with HTTP 204; no smoke device remained.

## Prompt-free device naming cutover — 2026-09-14

- Production source advanced to `899e5cd` on `main`; full regression gate remained 127/127 tests with build/diff/secret checks green.
- Overview and per-device workspaces now use first-class rename dialogs; the HTMX device fragment no longer injects action scripts.
- Live fixture smoke verified Overview dialog, pure fragment markup, device dialog and successful rename propagation, then removed the fixture with HTTP 204.

## Inline operational feedback cutover — 2026-09-14

- Production source advanced to `0c33968` on `main`; full regression gate remained 127/127 tests.
- Runs and per-device task actions now report ordinary operational failures inline rather than using blocking browser alerts.
- Tailnet smoke confirmed the Runs live-region and production `tasks.js` / `device.js` bundles contain no `alert()` calls.

## Add Device operational onboarding cutover — 2026-09-14

- Production application source advanced to `642c587` on `main`.
- Full source gate before deployment: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green, targeted secret scan green and `gitleaks 8.30.1` reported no leaks.
- The MiniPC completed the full Docker image build through `Successfully built`; PostgreSQL and the recreated control-plane both returned `healthy`, `/health` returned `ok=true`, and the production-container doctor reported source/runtime readiness ready.
- Add Device now exposes explicit Appium 3 (iOS Simulator / Android) and isolated physical-iPhone WDA lanes plus live host/runtime/iPhone readiness counters.
- Browser acceptance exercised the real MiniPC page and API chain. A temporary contract-compatible worker supplied one Appium simulator candidate; the page reported `1/1 online` and `1 attachable`, `Scan hosts` exposed the candidate, and `Attach to farm` navigated to `/devices/FARM029-SIM-001`.
- The worker fixture and temporary browser profile were stopped/deleted; the smoke device was removed with HTTP 204, `/api/devices` returned `[]`, and the configured `macstudio` worker returned to its expected offline state. No production fixture remains.

## Overview device inventory command bar cutover — 2026-09-14

- Feature source advanced to `390f211`; browser acceptance discovered that the new `overview.js` bundle was not registered in the themed static-asset loader, and `aeb17b2` fixed preload/content-hash/route serving plus added a regression test for the asset endpoint.
- The full gate after the fix remained 127/127 tests with TypeScript, `build:web`, `git diff --check` and gitleaks green.
- MiniPC completed a second full Docker rebuild on `aeb17b2`; `overview.js` returned HTTP 200 as `text/javascript`, control-plane/PostgreSQL were healthy and `/health` returned `ok=true`.
- Production browser smoke created two temporary iOS registry entries (one active/offline with `staging` tag, one disconnected) and verified shown/total counts, tag search, disconnected filtering, platform zero-state, reset and HTMX filter persistence.
- Both temporary devices were deleted with HTTP 204, `/api/devices` returned `[]`, and the temporary headless Chrome process/profile were removed. No smoke fixture remains.


## Device inventory hierarchy/density cutover — 2026-09-14

- Final production application commit: `eed219b` on `main` (feature lineage `15d413a` → `1641503` → `eed219b`).
- Final source gate on the exact runtime code: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green, and gitleaks reported no leaks.
- The MiniPC completed the Docker build through `Successfully built`; the recreated control-plane and PostgreSQL both reported `healthy`, `/health` returned `ok=true`, and the production-container doctor reported `Source readiness: ready` and `Runtime readiness: ready`.
- The actually served Tailnet Overview exposed the new sort selector, Grid/Compact controls, tighter name/status/runtime hierarchy, primary `Open`, secondary `Automate`, and `•••` maintenance menu containing Rename/Disconnect.
- Production browser acceptance used three temporary fixtures created in non-sorted registry order (Zulu, Alpha, Mike). The live page rendered Alpha → Mike → Zulu, proving the client sort rather than repo-only markup.
- Compact mode remained active after a periodic `#device-list` HTMX outerHTML refresh and, critically, after a full browser reload followed by the next HTMX settle (`compact=true`, `localStorage=compact`). The live acceptance exposed an `afterSwap` timing issue; final commit `eed219b` re-applies view/filter state on `htmx:afterSettle`.
- Cleanup completed: Alpha/Mike/Zulu each returned HTTP 204 on delete, `/api/devices` returned `[]`, CDP port 9331 was closed, and the temporary headless-Chrome profile plus FARM-031 scripts/screenshots were removed.


## Automation Studio hierarchy cutover — 2026-09-14

- Portable Flow Studio application source advanced to `9c6bf21`, with the live density fix at `f273e43`.
- Full final source gate on `f273e43`: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green and gitleaks `no leaks found`.
- MiniPC completed the full Docker rebuild through `Successfully built`; PostgreSQL and control-plane were healthy, `/health` returned `ok=true`, and the production-container doctor reported `Source readiness: ready` / `Runtime readiness: ready`.
- The production Tailnet page served the explicit Target → Flow → Schedule → Run journey. `Alpha Automation` and `Beta Automation` temporary devices appeared in the real Target selector. Allocation, Semantic Inspector, import and Flow actions were collapsed by default; Restore/Duplicate/Export/Delete stayed grouped behind Flow actions. Schedule no longer owned the Run button; the final action lived only in stage 4.
- Full-page production screenshot review exposed conditional Schedule fields being rendered despite their `hidden` state. `f273e43` added explicit hidden-state CSS. Browser retest proved: Run now → all conditional fields hidden; Once → Run at only; Daily → Local time + Timezone only.
- Cleanup completed: both temporary devices deleted with HTTP 204, `/api/devices` returned `[]`, CDP port 9332 had zero listeners, temporary Chrome profile was absent and no `/tmp/farm32-*` artifacts remained.


## Single-device workspace cutover — 2026-09-14

- Single-device workspace application source advanced to `d1a84c3`, with responsive/density correction at `3cd7f42`.
- Full final source gate on `3cd7f42`: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green and gitleaks `no leaks found`.
- MiniPC completed the full Docker rebuild through `Successfully built`; PostgreSQL and control-plane were healthy, `/health` returned `ok=true`, and the production-container doctor reported `Source readiness: ready` / `Runtime readiness: ready`.
- The production page now presents status → local lifecycle command bar → live/still screen → workflows/activity. Device actions no longer pollute the global navigation. Reconnect, Enable/Disable and Tasks & runs stay primary; Rename, Tags and destructive/configuration operations are grouped under Manage.
- A contract-compatible Android/Appium fixture proved capability gating (zero WDA-only controls visible), real registry Disable/Enable PATCH behavior, Tasks & runs access, and automatic failed-stream → still-screenshot fallback. A contract-compatible iOS/WDA fixture proved the WDA-specific controls appear only on the supported backend.
- Production screenshot review caught two visual regressions before closeout: narrow layouts placed the screen after actions, and WDA social workflows were still too dense. `3cd7f42` keeps the screen primary at narrow widths and collapses iPhone/WDA automations behind a secondary section. Final browser acceptance at 820px passed for both fixtures.
- Cleanup completed: both temporary devices returned HTTP 204 on delete, `/api/devices` returned `[]`, worker port 3010 and CDP 9333 were zero, the temporary browser profile was absent, no `/tmp/farm33-*` artifacts remained, and temporary Preview windows were closed.
- This does **not** close physical-iPhone Add Device acceptance. Full Xcode + a real iPhone are still required for the separate `acceptance:live` WDA onboarding proof.

## Runs workspace hierarchy cutover — 2026-09-14

- Runs application source advanced to `73b3a4e`, with final dialog-feedback cleanup at `0d2575e`.
- Full final source gate on `0d2575e`: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green, and gitleaks `no leaks found`.
- MiniPC completed the full Docker rebuild through `Successfully built`; PostgreSQL and control-plane were healthy, `/health` returned `ok=true`, and the production-container doctor reported `Source readiness: ready` / `Runtime readiness: ready`.
- Production browser acceptance used `Farm34 Alpha` / `Farm34 Beta`, two saved flow fixtures, two schedules and two execution fixtures. The real Tailnet page rendered Recent runs ahead of schedules, showed Device/Flow/Status filters and flow-name search, exposed live refresh plus manual refresh timing, and kept the converged black/graphite/white surface (`rgb(5,5,5)` body, `rgb(8,8,10)` toolbar).
- The failed-run detail showed status, run id, schedule id, Scheduled/Started/Finished timestamps, exit code 17, explicit error text, four evidence-log lines, a device link and an exact saved-flow source link. Final `0d2575e` browser retest proved dialog opens no longer leave persistent “Details complete.” feedback.
- Cleanup completed: both device fixtures returned HTTP 204 on delete, `/api/devices` returned `[]`, PostgreSQL reported 0 FARM-034 executions, 0 schedules and 0 flow definitions, CDP 9334 was closed, the temporary Chrome profile was absent, and no `/tmp/farm034-*` artifacts remained locally or remotely.
- This does **not** close physical-iPhone Add Device acceptance. Full Xcode + a real iPhone are still required for the separate `acceptance:live` WDA onboarding proof.
