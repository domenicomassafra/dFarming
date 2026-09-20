# FARM-024 — Control Center UX convergence

## Goal

Make the distributed mobile farm read like one coherent product instead of a collection of technical pages, while keeping the existing scheduler/device architecture unchanged.

## Shipped

- Overview exposes the main product surfaces directly and now reports actionable control-plane attention state plus recent executions.
- Automation Studio opens the Portable Flow workspace by default, uses a compact mode switch, and separates Target → Author → Schedule & run.
- Saved device pools have an explicit editable name and correct dirty/update semantics; unsaved edits are previewed but cannot be scheduled as a stale saved pool.
- Fleet reports empty/offline/online state directly, keeps search/group/bulk controls, and uses a neutral black/graphite/white interaction palette.
- Runs is branded Mobile Farm, understands Portable Flow tasks, supports search/status filters, and resolves device names instead of leading with raw UDIDs.
- Empty states on device/host/fleet surfaces offer a concrete next action.
- Old mock/demo CSS and remaining stale IOS AGENTS title mutation were removed.

## Acceptance

- Dashboard TypeScript and generated assets build from source.
- Overview tests assert Control Center, recent runs and primary product surfaces.
- Fleet page test asserts the live fleet status notice.
- Automation page test asserts the staged workspace and pool-name editor.
- Runs page test rejects the old IOS AGENTS branding.
- Full `npm run check`, `npm run build:web`, `git diff --check` and secret scan must pass before deployment.

## Live proof

- Deployed to the MiniPC production control plane on `main` at `8fc37e9`.
- Control-plane and PostgreSQL containers healthy after rebuild.
- Tailnet smoke confirmed the live Control Center fragment, staged Automation Studio + pool-name editor, Fleet status notice and cross-platform Runs page.
