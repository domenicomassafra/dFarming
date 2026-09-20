# FARM-028 — Inline operational feedback

## Goal

Remove blocking browser alerts from ordinary operational failures while preserving confirmation dialogs for destructive or public actions.

## Shipped

- Runs actions report pending/success/error state through an accessible inline live region instead of `window.alert()`.
- Per-device schedule/execution actions reuse the existing queue-status live region for the same feedback.
- The non-themed fallback renderer reports request failures inline as well.
- Destructive/public `confirm()` gates remain intentionally unchanged.

## Acceptance

- Runs page exposes `runs-action-status` as an `aria-live` region.
- No `window.alert()` / `alert()` remains in dashboard TypeScript or the API-rendered dashboard scripts.
- Full regression/build/diff/secret gates pass before deployment.

## Live proof

- Deployed to the MiniPC production control plane on `main` at `0c33968`.
- Tailnet Runs HTML serves the inline action live-region.
- Production `tasks.js` and `device.js` bundles contain no browser `alert()` calls.
- Control-plane and PostgreSQL containers remained healthy after rebuild.
