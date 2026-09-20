# FARM-026 — Connected device and flow actions

## Goal

Reduce navigation friction between the device inventory, Flow Studio and Flow Library so the features added in earlier waves behave like one product workflow.

## Shipped

- Active device cards now expose normalized device tags directly in Overview.
- Every active device has a first-class **Automate** action that opens Portable Flow Studio with that device preselected.
- Flow duplication no longer relies on a browser `prompt()`; a dedicated dialog explains the operation and validates the new flow name inline.
- Duplicate results load the new independent flow identity immediately in the Library workspace.

## Acceptance

- Device fragment tests prove tag visibility and direct device → Automation Studio linking.
- Automation page tests prove the duplicate-flow dialog is present.
- No `window.prompt('Name for the duplicate'...)` remains in Automation Studio source.
- Full regression/build/diff/secret gates pass before MiniPC deployment.

## Live proof

- Deployed to the MiniPC production control plane on `main` at `d575c09`.
- Control-plane and PostgreSQL containers healthy after rebuild; build smoke passed `control-plane import OK`.
- Tailnet Automation Studio serves the duplicate-flow dialog and matching bundle logic.
- A temporary tagged Android-emulator registry entry proved the live Overview card renders `Automate`, tag chips and the preselected Flow Studio device link; the fixture was deleted immediately with HTTP 204 and no residue.
