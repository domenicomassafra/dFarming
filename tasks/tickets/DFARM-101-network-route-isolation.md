# DFARM-101 — Named network-route isolation

Status: feature backlog.

Implement worker-local named network routes bound to execution profiles.
Credentials/endpoints remain worker secrets; the MiniPC stores only route IDs
and policy. Scheduling must refuse a requested route that the selected worker
cannot attest. Execution receipts record the route ID, never proxy secrets.

Use cases are privacy, testing, geographic test environments and operational
segmentation. Do not implement rotation or fallback intended to bypass bans,
rate limits, CAPTCHA, provider enforcement or other safeguards.
