# FARM-027 — Prompt-free device naming

## Goal

Remove browser-prompt device renaming and keep dynamic device fragments as pure markup instead of injecting action scripts on every HTMX refresh.

## Shipped

- Overview owns a dedicated device-rename dialog with inline validation and error state.
- Connect/disconnect action handling moved from the repeatedly swapped device fragment to the stable Overview page.
- `/api/fragments/devices` is now pure HTML content with no injected action script.
- Device workspace owns the same rename workflow through a native dialog and refreshes its summary after a successful PATCH.
- No `window.prompt()` remains in dashboard/application source.

## Acceptance

- Overview HTML test asserts the rename dialog.
- Device fragment test rejects inline scripts/prompts after reconnect.
- Device workspace test asserts its rename dialog.
- TypeScript/build/regression/diff/secret gates pass before deployment.

## Live proof

- Deployed to the MiniPC production control plane on `main` at `899e5cd`.
- Live smoke proved the Overview rename dialog, pure device fragment and device-workspace rename dialog are all served by production.
- A temporary Android-emulator registry entry was renamed through the canonical PATCH path, the new name appeared in the live device fragment, then the fixture was deleted with HTTP 204.
- Control-plane and PostgreSQL remained healthy and the MiniPC working tree stayed clean.
