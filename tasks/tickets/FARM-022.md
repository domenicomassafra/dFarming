# FARM-022 — Capability-aware allocation + semantic flow authoring

- Status: **source-complete / live-device-matrix-pending**
- Date: 2026-09-14

## Objective

Make a multi-host mobile farm usable without forcing operators to memorize UDIDs or hand-type accessibility selectors, while preserving one scheduler and concrete device attribution.

## Implemented

- Capability-aware allocator filters the canonical registry by online/enabled state plus optional `platform`, `kind`, `workerId` and explicit device-id bounds.
- Default allocation requires an idle device; ranked candidates prefer fewer active schedules and never silently select disabled/disconnected runtimes.
- `/api/allocation/preview` exposes the current ranked candidates before enqueue.
- `/api/schedules/allocate` chooses one concrete device, then materializes an ordinary pg-boss schedule using the existing task contract. The chosen UDID remains auditable in schedules/executions.
- Automation Studio target mode supports **Specific device** or **Any matching idle device**, with live allocation preview.
- Portable flows can now run immediately or be scheduled once/daily/weekly/on an interval using the existing scheduler timing model.
- When a saved Flow Library revision is scheduled, its `sourceFlowId` + `sourceFlowVersion` are copied into the immutable task payload for later provenance.
- Semantic Inspector reads the selected/current allocation candidate's live accessibility snapshot and can append `tapText`, `waitVisible`, `assertVisible` or `inputText` steps directly from visible elements.

## Safety / semantics

- Allocation picks the device when the schedule is created. Recurring schedules intentionally remain bound to that concrete audited device; this is not a hidden roaming queue.
- Bulk/public/send automation is not introduced by the allocator. Existing high-impact confirmation policy remains unchanged.
- Semantic Inspector authors selectors only; it does not tap the live device merely because an element was inspected.

## Verification

- Pure allocation ranking/filtering tests cover load, worker/platform/kind filtering and disconnected/disabled exclusion.
- Portable-flow validation tests cover complete saved-revision attribution and reject partial provenance.
- TypeScript, dashboard build and the full repository suite are green at 122/122 tests.

## Live proof remaining

- Run allocation against a worker exposing at least two matching live runtimes and verify least-loaded selection.
- Run a Semantic Inspector-authored flow on one iOS Simulator and one Android runtime after the live matrix is available.
