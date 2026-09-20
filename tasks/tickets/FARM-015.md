# FARM-015 — launchd production supervision and one-command lifecycle

- Status: **blocked-live**
- Date: 2026-09-13

## Objective

After live acceptance, supervise the processes appropriate to each runtime role with deterministic startup/shutdown and health checks.

## Acceptance / proof

- launchd units
- start/stop/status command
- restart proof

## Current state

Source work is implemented and role-aware. Standalone macOS retains Appium + WDA service + worker + web; a distributed `device-worker` Mac gets Appium + WDA service + pg-boss worker + authenticated device gateway and deliberately omits the web server. The Linux control plane is supervised by Docker Compose rather than launchd. Actual Mac installation/restart proof intentionally remains blocked until a live-ready host is available so `KeepAlive` does not create crash loops against missing Xcode/device prerequisites.
