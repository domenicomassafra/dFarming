# FARM-029 — Add Device operational onboarding

Status: DONE — source + MiniPC production + browser acceptance.

## Goal

Make Add Device reflect the real production topology instead of presenting two disconnected setup panels.

## Source scope

- Keep the two execution lanes explicit:
  - Appium 3 for iOS Simulator, Android Emulator and authorized physical Android.
  - isolated physical-iPhone WDA/MJPEG lane for real iPhones.
- Show live onboarding readiness from existing APIs:
  - online / configured execution hosts;
  - attachable Appium runtimes;
  - unregistered physical iPhones detected over USB.
- Make `Scan hosts` refresh both worker readiness and runtime discovery.
- Give empty states a next action instead of leaving the operator at a dead end.
- Keep runtime attach on the existing `/api/runtime-devices` contract and WDA registration on the existing registration contract.

## Acceptance

- TypeScript and web build green.
- Full repository regression gate green.
- `git diff --check` and secret scan green.
- Production MiniPC rebuilt to healthy on the exact commit.
- Browser acceptance proves Add Device loads both lanes and `Scan hosts → Attach` against the live MiniPC path, with any temporary fixture removed afterwards.

## Production proof — 2026-09-14

- Source commit: `642c587` on `main`.
- Full gate: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green.
- Secret checks: targeted diff scan green and `gitleaks 8.30.1` reported no leaks across the working tree.
- MiniPC pulled the exact source commit and completed the Docker rebuild through `Successfully built`; control-plane and PostgreSQL both returned `healthy`.
- `/health` returned `ok=true`; the control-plane doctor inside the production container reported source/runtime readiness ready.
- Browser acceptance used a temporary contract-compatible execution-worker fixture because the real Mac Studio has no usable `simctl`/full Xcode runtime at this checkpoint. The live Add Device page reported `1/1 online` and `1 attachable`; `Scan hosts` exposed the Appium simulator candidate and `Attach to farm` navigated to `/devices/FARM029-SIM-001` through the production API path.
- Fixture worker/browser profile were stopped and deleted. The temporary device was removed with HTTP 204; `/api/devices` returned `[]` and `macstudio` returned to the expected offline state.
