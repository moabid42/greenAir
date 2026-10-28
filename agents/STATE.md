# Durable development context

Keep this file short. Read relevant entries on task start and update them when
omitting a finding would cause repeated discovery or change a later decision.
Link detailed contracts, code, fixtures, and manifests rather than copying them.
Dates describe when evidence was obtained; recheck time-sensitive assumptions.

## Current foundation — 2026-10-28

- The repository currently contains research and agent tooling; no application
  stack, product scope, data adapter, or downloaded measurement archive has been
  established. Choose implementation details from subsequent development tasks.
- The canonical research files are the 2026-10-28 detailed reference and endpoint
  CSV linked in [AGENTS.md](../AGENTS.md). The initial catalog has 101 endpoints
  across 13 source cards, including 45 ATRAI collection URLs across all cities.
  These are snapshot counts; use `context.py overview` for the current files.
- [The workflow](WORKFLOW.md) uses offline focused lookup and dated live evidence.
  `context.py` reads the original files directly; no generated index needs
  refreshing. [sources.json](sources.json) owns source routing.
- No live Green City endpoint was checked while establishing this workflow.
  Availability, complete schemas, local coverage, and current counts remain
  subject to integration-specific probes. The original reference contains its
  own historical evidence; offline tool checks do not upgrade those claims.

## Active integrations and decisions

None recorded yet. When work begins, replace this sentence with short entries:

```text
### <source/feature> — <YYYY-MM-DD>
Decision and reason: <one or two sentences>
Contract / implementation: <relative links>
Evidence: <UTC check time; method/URL or manifest link; result; local tests>
Still uncertain: <coverage/schema/access/freshness questions, or none>
Next action: <concrete next step, or complete>
```

Keep reported research claims distinct from new observations. If a probe fails,
record the environment and response/error; do not conclude the entire source is
offline. Record a later successful check alongside the earlier failure.
