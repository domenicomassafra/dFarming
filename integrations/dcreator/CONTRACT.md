# dCreator ↔ dFarming integration contract

This bridge is optional. It connects content-production intent to device
execution without merging the two products' authority.

## Ownership

- dCreator owns creator/content planning, provenance, assets and publish intent.
- dFarming owns device/account binding, device allocation, scheduler state,
  execution policy and execution evidence.
- Neither side imports the other's cookies, browser profiles, login sessions
  or raw credentials.

## Transport and authentication

The bridge is an internal service-to-service API on the MiniPC control plane:

- `POST /api/internal/integrations/dcreator/assets` — multipart upload of
  approved bytes; returns dFarming `assetRefs`.
- `POST /api/internal/integrations/dcreator/jobs` — submit one versioned job.
- `GET /api/internal/integrations/dcreator/jobs/:externalId` — read the current
  execution receipt.

Every request uses `Authorization: Bearer <DFARMING_INTERNAL_TOKEN>`. The
bridge does not accept dCreator cookies, browser profiles or provider tokens.

## Job envelope

```json
{
  "schema": "dfarming.dcreator-job/v1",
  "externalId": "creator-job-id",
  "assetRefs": ["dFarming-asset-uuid"],
  "intent": "publish|draft|inspect",
  "accountRef": "account-execution-profile-id",
  "task": {
    "pluginId": "com.dfarming.tiktok",
    "taskType": "post",
    "taskVersion": 1,
    "payload": {}
  },
  "timing": { "kind": "now" },
  "runWindowMinutes": 30,
  "constraints": {
    "platform": "ios|android",
    "devicePool": "optional-dfarming-pool",
    "executionProfile": "optional-profile-id",
    "networkRoute": "optional-route-id"
  }
}
```

References are opaque identifiers, not secrets. `accountRef` resolves only
against dFarming's account execution-profile IDs. The bridge injects the actual
configured account handle into the validated task; dCreator cannot select an
unrelated account by putting a different handle in the payload.

`assetRefs` are produced by the internal asset endpoint above. Raw filesystem
paths and remote URLs are not accepted in the job envelope. Asset attachment
and schedule creation are one database transaction, so missing/already-attached
media cannot leave a partially created schedule.

`externalId` is the idempotency key. The normalized request is SHA-256 hashed
and the database enforces uniqueness on `(external_source, external_id)`. A
retry of identical content returns the existing schedule/receipt; reuse of the
same ID for different content is refused.

## Receipt

```json
{
  "schema": "dfarming.execution-receipt/v1",
  "externalId": "creator-job-id",
  "scheduleId": "dfarming-schedule-id (omitted when refused before persistence)",
  "executionId": "dfarming-execution-id (once materialized)",
  "deviceUdid": "owner-visible device id",
  "status": "queued|running|completed|failed|refused",
  "evidenceRefs": []
}
```

High-impact public actions keep dFarming's existing confirmation/policy gates.
The bridge cannot turn dCreator into a bypass around them.

`constraints.platform`, `devicePool`, `executionProfile` and `networkRoute` are
additional assertions, not routing overrides. They must agree with the account
profile/device owned by dFarming. The repository still performs the final
execution-profile/network-route check immediately before persistence.
