# dCreator ↔ dFarming integration contract

This bridge is optional. It connects content-production intent to device
execution without merging the two products' authority.

## Ownership

- dCreator owns creator/content planning, provenance, assets and publish intent.
- dFarming owns device/account binding, device allocation, scheduler state,
  execution policy and execution evidence.
- Neither side imports the other's cookies, browser profiles, login sessions
  or raw credentials.

## Proposed job envelope

```json
{
  "schema": "dfarming.dcreator-job/v1",
  "externalId": "creator-job-id",
  "assetRefs": ["opaque-dcreator-asset-ref"],
  "intent": "publish|draft|inspect",
  "accountRef": "opaque-account-reference",
  "constraints": {
    "platform": "ios|android",
    "devicePool": "optional-dfarming-pool",
    "executionProfile": "optional-profile-id",
    "networkRoute": "optional-route-id"
  }
}
```

References are opaque identifiers, not secrets. dFarming resolves them against
its own configured account/device policy and may refuse the job.

## Receipt

```json
{
  "schema": "dfarming.execution-receipt/v1",
  "externalId": "creator-job-id",
  "scheduleId": "dfarming-schedule-id",
  "executionId": "dfarming-execution-id",
  "deviceUdid": "redacted-or-owner-visible-id",
  "status": "queued|running|completed|failed|refused",
  "evidenceRefs": []
}
```

High-impact public actions keep dFarming's existing confirmation/policy gates.
The bridge cannot turn dCreator into a bypass around them.
