# FARM-018 — Linux MiniPC control plane + macOS physical-device workers

- Status: **blocked-live**
- Date: 2026-09-13

## Objective

Make the Linux MiniPC the authoritative always-on production runtime while keeping Xcode/Appium/WDA and physical USB iPhones on macOS execution nodes. The farm must remain operable from another computer through the dashboard/API/agent surfaces.

## Acceptance / proof

- Linux production Docker Compose for control plane + PostgreSQL with persistent storage and restart policy.
- Role-aware doctor: Linux must not require Xcode; macOS device workers must require Xcode/iPhone and the MiniPC database.
- Authenticated Mac device-worker gateway for inventory, screenshots, accessibility, MJPEG, input, connection health and reconnect.
- WDA/Appium remain local to the Mac rather than being exposed directly to the MiniPC or public network.
- Device/account/policy configuration mirrors from the canonical MiniPC registry to the owning Mac without propagating passcodes.
- Mac execution workers claim only their locally registered iPhone queues from the shared MiniPC PostgreSQL/pg-boss database.
- Canonical uploaded media can be fetched by a Mac worker over an internal authenticated route and is verified by byte size + SHA-256 before use.
- Browser/Hermes/MCP can continue to use the MiniPC API while the actual phone is controlled by the Mac worker.
- Final live receipt on actual MiniPC + Mac + physical iPhone.

## Current state

The source implementation is complete: `Dockerfile.control-plane`, `docker-compose.production.yml`, `.env.minipc.example`, `.env.device-worker.example`, `deploy/setup-minipc.sh`, `deploy/setup-device-worker.sh`, the remote worker client/fleet, Mac gateway, role-aware launchd selection, role-aware doctor, configuration sync and verified media transfer are implemented. The control plane tolerates offline workers and retains canonical mutations for later resynchronization. Remote stream capabilities are forced on in the recommended MiniPC deployment even though the Fastify process itself remains loopback-bound behind the private access layer.

The Linux half is now live-proven on the actual `minipc-ubuntu`: Docker build, PostgreSQL, migrations, container doctor, loopback-only Fastify, dedicated Tailscale Serve endpoint, remote dashboard/health/API access and PostgreSQL reachability all pass. The deployment surfaced and fixed two Linux-only failures (native OCR install/GLIBC and runtime dashboard compilation permissions), so this is real runtime evidence rather than source inference.

The device gateway itself has also been network-smoke-tested on the actual Mac Studio: it bound only to the Tailscale address, was reachable from the MiniPC on port 3010, and rejected an unauthenticated request with HTTP 401. It was then stopped rather than left as a partial production service.

The ticket remains `blocked-live` only for the physical-device half: the current Mac Studio has CommandLineTools rather than full Xcode and no registered `devices.json`, so signed WDA/Appium + physical-iPhone execution cannot yet be claimed. Production worker-secret pairing also remains to be applied on that Mac; the automation tool refused to transfer those existing secret values, and that safeguard was not bypassed.
