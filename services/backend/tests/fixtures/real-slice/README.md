# Dated real-source replay fixture

These are **historical captures from 2026-10-28 UTC**, not current observations.
`manifest.json` records exact original methods/URLs/parameters, retrieval time,
original response SHA-256 and fixture SHA-256. Weather/air/UBA bodies are exact
small captures. `stationary.json` is one unmodified public GreenCity OpenSpace
outdoor box selected from the captured city bbox array; the manifest records the
selection and both original/full and subset hashes. It is a test subset, not a
complete inventory or a separate live detail-endpoint probe.

Interpretation and provider evidence: `docs/integrations/weather-sources.md`,
`osem-source.md`, `uba-source.md`. Model outputs remain modelled, official station
values remain measured, community observations preserve exposure and QC. The
original full raw captures remain outside Git; no runtime directory is staged.

`test_real_slice_replay.py` replays these through raw landing, adapters, canonical
storage, processing, snapshot persistence and HTTP. It then makes the upstream
unavailable and checks last-success/stale/restart behavior. Its PostgreSQL case
requires the dedicated disposable migrated database from `just test-storage`;
portable tests use their own temporary SQLite file. Fixed test clocks describe
the capture's historical context and never upgrade fixture freshness.
