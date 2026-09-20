# FARM-010 — Generic MCP adapter

- Status: **done**
- Date: 2026-09-13

## Objective

Expose the same semantic bridge to MCP clients as an optional adapter. Do not duplicate fleet state.

## Acceptance / proof

- MCP surface
- bounded tool catalog
- auth/local transport

## Evidence

- MCP server exposes a bounded catalog backed by the same semantic/client primitives.
- Non-loopback agent access requires authentication; no parallel fleet state is introduced.
