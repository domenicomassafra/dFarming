# DFARM-104 — Windows Android worker packaging

Status: **source-complete / Windows-live-pending**.

## Implemented

- `.env.windows-android-worker.example` uses the same authenticated worker,
  internal-token and PostgreSQL/MiniPC contracts as Linux/macOS workers.
- `deploy/setup-windows-android-worker.ps1` validates Node 22+, ADB, Java and a
  complete Android SDK before installation.
- It installs the same Appium 3 + UiAutomator2 runtime used by the Linux Android
  worker; no Windows-only scheduler or registry is introduced.
- Three current-user Task Scheduler jobs supervise the canonical Appium runtime,
  `src/scheduler/worker.ts` and `src/device-worker-server.ts` processes.
- Generated runtime wrappers parse `.env` as data and do not use
  `Invoke-Expression` or execute environment-file contents as PowerShell.
- Appium and gateway health are checked before the installer reports success.
- Named network-route attestations use the same optional
  `PHONE_FARM_NETWORK_ROUTES` policy as every other worker.

## Authority

The Windows host is an execution worker only. The MiniPC remains the sole web
control plane, canonical scheduler/database authority and device registry
aggregator.

## Remaining live proof

Run the installer on the actual Windows MateBook when it is online, register a
real/emulated Android runtime, and execute the same screenshot/semantic/stream
and harmless Portable Flow acceptance matrix. No Linux host substitutes for
that Windows proof.
