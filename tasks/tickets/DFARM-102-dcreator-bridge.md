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
- Asset attachment and schedule creation are transactional.
- Existing plugin validation, public-action confirmation, account policy,
  execution-profile and network-route checks remain authoritative.
- Receipts expose schedule/execution IDs and status, not cookies, browser
  profiles or provider credentials.

## Remaining live proof

Wire the dCreator-side caller to these endpoints and run an approved harmless
asset/job through the MiniPC. That caller lives in the dCreator project and is
not replaced by a fake producer inside dFarming.
