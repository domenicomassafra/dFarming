# FARM-030 — Device inventory command bar

Status: DONE — source + MiniPC production + browser acceptance.

## Goal

Keep the Overview device inventory usable as the farm grows without duplicating the richer Fleet wall.

## Scope

- Search across device name, UDID, tags, worker, platform/kind and configured account handles.
- Filter by online, offline or disconnected/disabled state.
- Filter by iOS or Android.
- Show a visible shown/total count and one-click reset.
- Preserve filters across HTMX device-fragment refreshes.
- Move Overview rename/connect/disconnect behavior into a dedicated versioned `overview.js` bundle instead of inline page script.
- Surface connect/disconnect failures inline in the command bar.

## Acceptance

- TypeScript and `build:web` green.
- Full source regression gate green.
- `git diff --check` and secret scan green.
- MiniPC rebuilt/healthy with the versioned Overview bundle served in production.
- Live smoke proves filter metadata and command-bar behavior with temporary devices, then removes all fixtures.

## Production proof — 2026-09-14

- Feature commit: `390f211`; production asset-loader fix: `aeb17b2`.
- Full gate passed after the fix: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green and `gitleaks` reported no leaks.
- The first browser smoke caught a real deployment defect: the template referenced `overview.js`, but the dashboard theme loader had not whitelisted/hashed/served the new bundle, so production returned HTTP 404. The loader now includes the bundle in preload, content hashing and the `/assets/overview.js` route, with an integration regression test that requires HTTP 200 + JavaScript content type.
- MiniPC rebuilt completely on `aeb17b2`; control-plane and PostgreSQL returned healthy and `/health` returned `ok=true`.
- Production browser smoke with two temporary devices proved:
  - initial `2 devices` count;
  - tag search `staging` → `1 shown · 2 total` and only Alpha;
  - disconnected filter → only Beta and the disabled panel opens;
  - Android filter → zero-result empty state;
  - Reset restores all devices and clears controls;
  - an `alpha` search remains applied after an HTMX device-fragment refresh.
- Both temporary devices were removed with HTTP 204 and `/api/devices` returned `[]`. The temporary headless browser/profile were terminated and deleted.
