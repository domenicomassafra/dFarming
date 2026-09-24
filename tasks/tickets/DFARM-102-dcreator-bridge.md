# DFARM-102 — dCreator bridge

Status: **source-complete / dCreator-counterpart-live-pending**.

Implement the versioned contract in `integrations/dcreator/CONTRACT.md`.
dCreator may submit approved asset/job references and receive execution
receipts. dFarming remains the device/scheduler authority. No cookie jar,
browser profile, provider credential or raw secret is shared between products.

## Implemented in dFarming

- Internal bearer-authenticated asset intake returns opaque dFarming asset
  UUIDs; jobs never accept arbitrary paths/URLs.
- Versioned `dfarming.dcreator-job/v1` submission and receipt lookup endpoints.
- `accountRef` resolves to a unique dFarming execution profile and therefore to
  the configured account/device; conflicting account payloads are refused.
- Optional platform/device-pool/profile/network-route constraints can only
  narrow that binding, never override it.
- Database-backed idempotency uses `externalId` + canonical request SHA-256;
  retries converge to one schedule and conflicting reuse is refused.
- dCreator `intent` is cross-checked with the task side effect: `publish` and
  `draft` require a matching post destination. `inspect` is not accepted by
  the current job envelope because no plugin task is certified read-only.
- Asset attachment and schedule creation are transactional.
- dCreator asset intake is limited to 10 files, 250 MiB per file and the
  supported image/video MIME allowlist; paths and URLs remain invalid. Jobs can
  attach only assets created by the dCreator intake path.
- Existing plugin validation, public-action confirmation, account policy,
  execution-profile and network-route checks remain authoritative.
- Receipts expose schedule/execution IDs and stable status/failure categories,
  not cookies, browser profiles, provider credentials, paths or raw internal
  execution errors.

## Remaining live proof

Wire the dCreator-side caller to these endpoints and run an approved harmless
asset/job through the MiniPC. That caller lives in the dCreator project and is
not replaced by a fake producer inside dFarming.
