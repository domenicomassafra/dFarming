# DFARM-105 — Per-account execution-profile constraints

Status: **source-complete / live-profile-proof-pending**.

## Contract

Each configured social account may optionally define `executionProfile`:

```json
{
  "id": "owner-primary",
  "dedicatedDeviceUdid": "optional-device-id",
  "requiredTags": ["creator", "production"],
  "networkRouteId": "optional-route-id"
}
```

The profile is dFarming policy, not provider credentials. Profile IDs and route
IDs are bounded identifiers; device tags use the same canonical tag grammar as
allocation pools.

## Enforcement

- The account policy API validates and normalizes the profile.
- The scheduler repository owns the final pre-persistence gate, so direct
  schedule routes, plugin-owned routes and campaign launch cannot bypass it.
- Dedicated-device, required-tag and route-attestation constraints are checked
  before any schedule row is written.
- Resume/update re-resolve the current policy instead of reviving a stale
  profile snapshot blindly.
- Schedule/execution rows retain the resolved profile ID and route ID for
  later receipts; secrets are never copied into PostgreSQL.
- Execution re-checks the worker-local route attestation before automation.

## Remaining live proof

Apply a non-destructive profile to one current test account/runtime, verify a
matching schedule succeeds, then verify one mismatched device/tag/route is
refused before persistence.
