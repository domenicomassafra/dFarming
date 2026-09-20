# FARM-031 — Device inventory hierarchy, density and view controls

Status: production complete — MiniPC and browser acceptance live.

## Goal

Make the Overview inventory calm and scannable as the farm grows, without turning it into a second Fleet wall.

## Scope

- Add semantic sorting by status, name, platform/kind and execution host.
- Add persistent Grid / Compact views.
- Tighten card hierarchy: name + status first, runtime/host metadata second, tags/accounts tertiary.
- Make `Open` the primary inventory action and keep `Automate` secondary.
- Move Rename / Disconnect into a compact secondary-actions menu.
- Keep disconnected-device recovery obvious while moving Rename behind the same secondary menu.
- Preserve search/filter/sort/view behavior across HTMX fragment refreshes.

## Acceptance

- Full repository tests + TypeScript green.
- `build:web`, `git diff --check` and gitleaks green.
- Production MiniPC rebuilt to healthy on the exact application commit.
- The actually served Overview page exposes the sort selector, Grid/Compact controls, compact rendering, quiet action menu and stable sorting.
- Any production smoke fixtures are removed before closeout.

## Live acceptance

- Application lineage: `15d413a` (inventory hierarchy/views), `1641503` (view persistence across swaps), final runtime fix `eed219b` (reapply after HTMX settle).
- Final source gate: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green, gitleaks reported no leaks.
- Production MiniPC rebuilt from `eed219b`; control-plane and PostgreSQL both healthy, `/health` returned `ok=true`, and the in-container doctor reported source/runtime readiness ready.
- Browser acceptance used the actually served Tailnet Overview with temporary Alpha/Mike/Zulu inventory fixtures. Server insertion order was Zulu/Alpha/Mike; the live UI sorted them Alpha/Mike/Zulu.
- The live card exposed primary `Open`, secondary `Automate`, and the `•••` menu with `Rename` / `Disconnect`.
- Compact view remained active after the periodic `#device-list` HTMX swap and, after a full reload plus subsequent HTMX settle, remained `compact=true` with `localStorage=compact`.
- Alpha/Mike/Zulu were removed with HTTP 204, `/api/devices` returned `[]`, CDP port 9331 was closed, and the temporary Chrome profile/scripts/screenshots were deleted.
