# FARM-025 — Scheduler and execution operations UX

## Goal

Remove the last raw/prototype interactions from the Runs surface and make schedule maintenance plus execution diagnosis usable without editing JSON or leaving the dashboard.

## Shipped

- Replaced the schedule `prompt(JSON)` editor with a native visual editor for `now`, `once`, `daily`, `weekly` and `interval` timing.
- The editor exposes run window, local time/timezone, weekdays, interval cadence and optional start offset with bounded client validation.
- Existing recurring public-publish confirmation remains mandatory when an edited schedule becomes recurring publish work.
- Every execution now has a Details action backed by the canonical `/api/executions/:id` endpoint.
- Execution details show status, device, timestamps, exit code, error and persisted scheduler logs in one modal.
- Runs continues to resolve device display names while preserving the short UDID as metadata.

## Acceptance

- No `Edit timing JSON` / raw schedule prompt remains in dashboard source.
- Runs HTML contains both schedule-editor and execution-detail dialogs.
- Dashboard TypeScript and generated assets build from source.
- Full source regression gate, diff check and secret scan pass before production deployment.

## Live proof

- Deployed to the MiniPC production control plane on `main` at `c793d46`.
- Control-plane and PostgreSQL containers healthy after rebuild; Docker build again passed `control-plane import OK`.
- Tailnet `/tasks` serves the visual schedule editor and execution-detail dialogs.
- Tailnet `tasks.js` contains the live `openScheduleEditor`, `openExecutionDetail` and schedule-save logic.
