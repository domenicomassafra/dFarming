# FARM-032 — Automation Studio workflow hierarchy

Status: production complete; MiniPC/browser live proof passed.

## Goal

Make Portable Flow Studio read as one calm operator path instead of a dense wall of equally weighted controls.

## Scope

- Present the primary workflow as Target → Flow → Schedule → Run.
- Remove duplicated capability/promotional chrome from the working surface.
- Keep target selection primary while grouping allocation-pool management as secondary.
- Keep flow name, steps and Save primary; group version/restore/duplicate/export/delete actions behind one secondary surface.
- Separate timing configuration from the final Run/Schedule action.
- Keep Semantic Inspector available but collapsed by default.
- Preserve all existing APIs, IDs, versioning, pool allocation and scheduler behavior.
- Match the existing black / graphite / white Overview and Device List visual system.

## Acceptance

- Full source gate (127+ tests + TypeScript) green.
- `build:web`, `git diff --check` and gitleaks green.
- MiniPC rebuilt from the exact application commit; PostgreSQL/control-plane healthy, `/health` ok and doctor ready.
- Production browser proves the four-stage hierarchy, grouped secondary actions and populated target selector using temporary devices.
- All smoke fixtures and temporary browser/profile artifacts removed before closeout.

## Production acceptance

- Application feature commit: `9c6bf21` (`feat: clarify automation studio workflow`).
- Production-density fix: `f273e43` (`fix: hide inactive automation schedule fields`).
- Full final gate on application source: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green and gitleaks reported no leaks.
- MiniPC rebuilt from `f273e43` through `Successfully built`; PostgreSQL and control-plane returned healthy, `/health` returned `ok=true`, and the production-container doctor reported source/runtime readiness ready.
- Tailnet browser acceptance used temporary `Alpha Automation` and `Beta Automation` device fixtures. The live page showed the four-stage Target → Flow → Schedule → Run journey, both fixtures in the Target selector, Flow actions grouped behind a closed secondary panel, and Schedule separated from the final Run action.
- Visual inspection of a full-page production screenshot exposed a density defect: conditional timing fields were visible during `Run now`. The CSS fix in `f273e43` now preserves `hidden` for schedule/version controls. Browser retest proved `Run now` hides every conditional field, `Once` reveals only Run at, and `Daily` reveals only Local time + Timezone.
- Cleanup passed: both device fixtures deleted with HTTP 204, `/api/devices` returned `[]`, CDP port 9332 had zero listeners, the temporary Chrome profile was absent, and no `/tmp/farm32-*` artifacts remained.
