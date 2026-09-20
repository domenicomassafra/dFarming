# ADR-0001: Layered fleet core with external semantic-agent adapters

- Status: Accepted
- Date: 2026-09-13

## Context

The repository already has a credible physical-iPhone lifecycle and scheduler. Research found richer AI-agent projects (Ghost), stronger semantic iPhone tools (Hermes iPhone plugin, iphone-mcp), stronger WDA lifecycle/security examples (DSH iOS), and an alternative qvh video path. Merging any one wholesale would duplicate authoritative device state, queues, dashboards and WDA lifecycle.

## Decision

1. `dFarming` remains authoritative for registered devices, schedules, executions, assets and plugin task versions.
2. Canonical account inventory/policy belongs in the fleet core because scheduling needs it before persistence.
3. Semantic UI primitives will be a narrow device bridge: snapshot/tree, stable refs, find/tap/wait/type, screenshot and trace. They may reuse donor algorithms but not donor schedulers.
4. Hermes is the preferred first owner-facing agent adapter; generic MCP is optional and should expose the same bridge rather than own devices.
5. Ghost is a design donor for skills, batching and agent workflows, not the production scheduler.
6. Video transport remains WDA MJPEG until real-device benchmarks justify qvh/H.264. Control and video should be separable.

## Consequences

- One queue/state authority; fewer split-brain failures.
- Known workflows remain deterministic and zero-LLM.
- New agents/models can be swapped without migrations in scheduler data.
- Live-device work still requires a Mac with full Xcode and signing.
- Some desirable donor features are deferred until a bounded adapter exists.
