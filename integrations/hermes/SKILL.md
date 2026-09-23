---
name: dfarming
description: Control owner-managed iOS and Android devices through the dFarming control plane without starting another device supervisor or scheduler.
---

# dFarming for Hermes

Use the repository's `npm run agent:client -- ...` adapter. The dFarming web/API process remains the single authority for registered devices, account policy, WDA/Appium access and scheduler conflicts.

## Contract

- Never start WebDriverAgent, Appium or a second scheduler from this skill.
- Start with `devices` and `accounts`, then use `observe` on the intended device. It returns runtime/screen/lock/scheduler state and a compact semantic UI in one bounded call.
- Prefer `tap-text`, `input`, semantic refs and waits over raw coordinates. This adapter deliberately has no raw-coordinate command.
- A ref belongs to exactly one snapshot generation; take a new snapshot after meaningful UI transitions.
- Mutating commands can return 409 while scheduled automation owns the device. Treat that as a control-plane refusal, not a reason to bypass it.
- Sensitive typed text goes through stdin so it is not exposed in process arguments. The dFarming trace records text length only.
- Do not create accounts, discover credentials, bypass login/CAPTCHA walls, evade platform enforcement or automate accounts the owner has not configured.

## Commands

```bash
npm run -s agent:client -- health
npm run -s agent:client -- devices
npm run -s agent:client -- accounts
npm run -s agent:client -- observe --udid '<udid>' --query 'Continue'
npm run -s agent:client -- snapshot --udid '<udid>' --query 'Continue'
npm run -s agent:client -- tap-text --udid '<udid>' --text 'continue_button' --exact
npm run -s agent:client -- tap --udid '<udid>' --generation 3 --ref e2
npm run -s agent:client -- wait --udid '<udid>' --text 'Home' --timeout-ms 10000
printf '%s' "$SENSITIVE_TEXT" | npm run -s agent:client -- type --udid '<udid>'
printf '%s' "$SENSITIVE_TEXT" | npm run -s agent:client -- input --udid '<udid>' --target 'Email'
npm run -s agent:client -- system --udid '<udid>' --action home
npm run -s agent:client -- app --udid '<udid>' --action launch --app-id com.example.app
```

By default the adapter uses `http://127.0.0.1:3000`. For a non-loopback `DFARMING_URL`, `DFARMING_TOKEN` is mandatory. The legacy `PHONE_FARM_*` names are accepted only during migration.
