# FARM-023 — Device pools, tags and execution-host observability

- Status: **source-complete**
- Date: 2026-09-14

## Objective

Make a growing real/virtual device farm operable without hand-maintaining UDID lists or losing configured workers from view when a host is asleep/offline.

## Implemented

- Canonical normalized device tags in `devices.json`, synchronized from the MiniPC control plane to the owning worker without transmitting passcodes or local WDA/MJPEG ports.
- Fleet search matches device name, UDID, worker, platform/kind and tags; device workspaces expose a Tags editor.
- `scheduler.device_pools` stores named reusable allocation selectors in PostgreSQL.
- Pool selectors support platform, kind, worker, tags, explicit device bounds and idle-only placement.
- Automation Studio can save/update/delete a pool and schedule against its canonical `poolId`; allocation still resolves immediately to a concrete UDID before creating the normal schedule.
- Configured execution workers remain visible when offline instead of disappearing from host inventory.
- Online workers report bounded host telemetry (load, CPU count, RAM and uptime); offline cards show the connection failure without dropping registered devices.

## Safety / determinism

- Tags are operational metadata only, never credentials.
- Pool names are unique case-insensitively at the API boundary.
- A schedule never retains a floating pool reference: the selected concrete device is written into the schedule for auditability and recurring stability.
- Bulk social/send/touch actions remain excluded from fleet operations.

## Verification

- Additive migration only: creates `scheduler.device_pools` plus indexes; no destructive table changes.
- Unit/API coverage verifies tag normalization, tag-constrained allocation, pool selector normalization/duplicates and offline worker visibility.
