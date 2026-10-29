# Weather and modelled air inputs — 2026-10-28

Recovered the weather adapter and tests from the preserved weather worktree.
Discovery: endpoint catalog records 80–82 (Bright Sky; reference §11) and 91/93
(Open-Meteo; reference §13). Original snapshot evidence labels remain unchanged.
Current documentation: [weather](https://open-meteo.com/en/docs),
[air quality](https://open-meteo.com/en/docs/air-quality-api), and Bright Sky
[OpenAPI](https://api.brightsky.dev/openapi.json), version 2.2.12.
Documentation reviewed on 2026-10-28; Bright Sky OpenAPI is also landed locally.

[Evidence manifest](weather-live-evidence.json) records exact GET URLs/parameters,
UTC retrieval times, content type, schema/units, hashes, returned points, valid-time
range and replay outcomes. Raw bodies are in the ignored SQLite capture store
named there, separate from the existing evidence PostgreSQL database.

At 22:56:54–55 UTC, both Open-Meteo requests returned HTTP 200 JSON, 48 aligned
UTC Unix hourly slots, no nulls in selected channels and points inside the city
bbox. Actual points were `[9.202922,49.13525]` (weather) and `[9.200001,49.1]`
(air); their original coordinates are retained. These are model grids, never
station measurements. Replay inserted 384 weather and 528 air/pollen/index values;
the second replay of each capture inserted zero. Supported channels projected to
processing retained raw key/value/unit and raw reference. Extra channels remain
stored without inventing processing/scoring support.

Open-Meteo issuance stays null unless an explicit resolver supplies actual provider
issuance. Retrieval and eventual snapshot build time are separate. The response's
`generationtime_ms` is computation duration, never issuance. Unknown-issue builds
use capture identity. Payload-provided units are validated; Greek mu spelling is
retained in originals and normalized only for canonical units. Explicit nulls remain
null observations and count as missing in a partial manifest; zero remains zero.
Axes must be unique, ascending, hourly and at most two days. Weather precipitation
is the preceding hour's amount; its stored interval is 3600 seconds. Wind is stored
in km/h and projected to m/s once. Model air and seasonal pollen retain forecast kind.

The same check's Bright Sky current response for DWD station 15547 contained only
wind channels among requested supported variables; the latest record was
22:30 UTC. Its replay inserted two values, with a partial manifest for missing
channels. Other channels are not filled from dummy values. Fallback fields use
their own source location and out-of-bbox sources are excluded. Station IDs and
raw fields/units survive projection. Sunshine minutes convert to seconds; originals
remain minutes. Optional Bright Sky forecasts require an explicit issue resolver.
Raw job IDs are also observation source IDs (for example `brightsky_current`);
this keeps raw provenance and checkpoints in the same namespace.

Offline tests cover units/nulls/zero, actual returned grid, fallback locations,
source namespaces, malformed axes, partial arrays and replay idempotency. This
bounded live sample does not prove historical coverage or continuous freshness.
Refresh/registry and serving are subsequent branches. Attribution must name
Open-Meteo and CAMS ENSEMBLE for modelled air; dataset/source labels must remain
visible when projected into the frontend.
