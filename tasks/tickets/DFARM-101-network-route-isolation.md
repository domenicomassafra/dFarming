# DFARM-101 — Named network-route isolation

Status: **source-complete / live-route-attestation-pending**.

Implement worker-local named network routes bound to execution profiles.
Credentials/endpoints remain worker secrets; the MiniPC stores only route IDs
and policy. Scheduling must refuse a requested route that the selected worker
cannot attest. Execution receipts record the route ID, never proxy secrets.

Use cases are privacy, testing, geographic test environments and operational
segmentation. Do not implement rotation or fallback intended to bypass bans,
rate limits, CAPTCHA, provider enforcement or other safeguards.

## Implemented

- `DFARMING_NETWORK_ROUTES` parses bounded worker-local route attestations as
  route IDs plus optional device scope; no endpoint, username, password or VPN
  material enters the host snapshot.
- `/v1/host` publishes those attestations and the MiniPC sanitizes them before
  using them for policy decisions.
- Account execution profiles can require a `networkRouteId`; schedule creation
  fails before persistence when the owning worker does not attest the route for
  the selected device.
- `scheduler.schedules` and `scheduler.executions` persist only
  `network_route_id` / `execution_profile_id` for receipts.
- The execution worker checks the local route attestation again before device
  access and exposes only the route/profile IDs to plugin subprocesses.
- No automatic rotation or fallback exists.

## Remaining live proof

Configure a harmless named route on a reachable worker and prove successful
schedule persistence/execution plus a refused non-attested route.
