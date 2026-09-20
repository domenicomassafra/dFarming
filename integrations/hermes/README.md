# Hermes adapter

This integration is intentionally a thin skill/CLI bridge, not a fork of Hermes and not a copy of `hermes-iphone-plugin`.

The native Hermes iPhone plugin was used as a research donor for semantic UI and redacted-trace ideas. Production control here stays behind the dFarming API so Hermes and MCP share one device registry, one WDA lifecycle, one account-policy layer and one scheduler conflict guard.

Install/copy `SKILL.md` into the appropriate Hermes skill surface only after the dFarming API is running. Live Hermes consumer proof is tracked separately from source implementation because this host currently lacks full Xcode/physical-iPhone readiness.
