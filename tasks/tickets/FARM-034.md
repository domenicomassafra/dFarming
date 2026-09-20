# FARM-034 — Runs workspace hierarchy and evidence UX

Status: production complete; MiniPC/browser live proof passed.

## Goal

Bring Runs to the same operational hierarchy as Overview, Device List, Automation Studio and the device workspace without changing scheduler semantics.

## Scope

- Recent execution history is the primary surface; schedules are secondary.
- Dedicated search plus Device, Flow and Status filters.
- Explicit live-refresh control, manual refresh and last-updated feedback.
- Run-level status summary for recent, in-flight, succeeded and attention-needed executions.
- Readable run cards with device/flow context and bounded error preview.
- Execution details expose status, run id, device, schedule, timestamps, exit code, error and evidence logs.
- Exact device links and exact saved-flow source links when `sourceFlowId` exists.
- Black / graphite / white presentation consistent with the other converged surfaces.
- Preserve all existing stop/retry/schedule-edit safety behavior.

## Acceptance

- Full source gate: 127+ tests, TypeScript, `build:web`, `git diff --check`, gitleaks.
- MiniPC rebuild completes and control-plane/PostgreSQL are healthy; `/health` and doctor are green.
- Production browser acceptance proves filtering and a populated execution detail against temporary fixtures, followed by complete cleanup.
- Physical-iPhone WDA Add Device acceptance remains live-gated and is not claimed by this ticket.

## Production acceptance

- Feature commit: `73b3a4e` (`feat: clarify runs workspace`), followed by production-UX cleanup `0d2575e` (`fix: quiet runs dialog actions`).
- Full final gate on the exact application source: 127/127 tests, TypeScript green, `build:web` green, `git diff --check` green, and gitleaks reported no leaks.
- MiniPC rebuilt from `0d2575e` through `Successfully built`; PostgreSQL and control-plane both reported healthy, `/health` returned `ok=true`, and the production-container doctor reported `Source readiness: ready` / `Runtime readiness: ready`.
- Production Tailnet browser acceptance used two temporary devices (`Farm34 Alpha`, `Farm34 Beta`), two saved Portable Flows, two schedules and two executions (one succeeded with exit code 0, one failed with exit code 17) plus seven execution-log lines.
- The live Runs page proved Recent runs above schedules, dedicated Device/Flow/Status filters, search by flow name, live-refresh enabled, manual refresh timestamp feedback, and black/graphite/white computed colors.
- The failed execution detail proved readable status, run id, schedule id, Scheduled/Started/Finished timestamps, exit code 17, explicit error text, four evidence-log lines, exact device link, and exact saved-flow source link. The final `0d2575e` retest also proved dialog actions leave no persistent “Details complete.” noise.
- Cleanup passed completely: both temporary devices deleted with HTTP 204, `/api/devices` returned `[]`, temporary execution/schedule/flow rows all counted 0 in PostgreSQL, CDP port 9334 was closed, the headless-Chrome profile was absent, and no `/tmp/farm034-*` artifacts remained locally or remotely.
- Physical-iPhone WDA Add Device remains explicitly live-gated until full Xcode + a real iPhone are available for `acceptance:live`.
