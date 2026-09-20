# FARM-013 — Benchmark video transport: WDA MJPEG vs qvh/H.264

- Status: **blocked-live**
- Date: 2026-09-13

## Objective

On real iPhones measure latency, CPU, automation contention and reconnect behavior. Adopt qvh only if evidence wins.

## Acceptance / proof

- real device benchmark
- documented measurements
- rollback

## Current state

The benchmark harness is implemented as `npm run benchmark:video`. It records a control baseline, WDA MJPEG throughput/TTFB and screenshot-control p50/p95, plus optional qvh/H.264 measurements. Adoption remains blocked until a physical-device run proves qvh is actually better; MJPEG stays canonical meanwhile.
