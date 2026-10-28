# Stationary openSenseMap source — 2026-10-28

Recovered the stationary adapter/tests without changing the original worktree.
Discovery uses catalog records 97–101 and reference §15 (home context §5).
The original snapshot's documented/reported evidence labels are unchanged.
Current [API documentation](https://docs.opensensemap.org/api_data.js) was fetched,
landed and inspected: bbox order is west,south,east,north; full=true populates
lastMeasurement; this is an expensive latest snapshot, not historical coverage.

[Live evidence](osem-live-evidence.json) records exact method/URL/parameters, UTC,
content type, raw IDs/hashes and replay results. Raw bodies live only in the ignored
capture store. The city-bounded GET `/boxes?bbox=9.05,49.05,9.35,49.25&limit=20&full=true`
returned HTTP 200 JSON with 81 boxes. Thus limit=20 is not a verified snapshot cap;
HTTP transport bounds bytes/time and there is no invented offset pagination.
The historical draft's 82-box count is not current. Provider bbox filtering does
not replace local geometry checks; currentLocation must be an in-bbox WGS84 Point.
Altitude is retained in raw bytes while canonical geometry uses lon/lat.

Only explicit indoor/outdoor exposure is interpreted as stationary. Mobile and
unknown exposure cannot feed stationary values. Each stored value retains box ID,
sensor ID, provider title/unit/value, station name and exposure. Indoor readings
remain indoor and must be excluded from outdoor condition calculations. Temperature,
humidity, supported PM channels, verified sea-level pressure, wind and UV title/unit
pairs are mapped; ambiguous pressure reference and rain interval stay unresolved.
Missing readings are counted and mark the manifest partial, never become zero.
Device timestamp stays separate from retrieval. Old readings remain dated; no
successful fetch implies recent measurements.

The bounded captured snapshot replay inserted 91 values (81 outdoor, 10 indoor);
replay of the same capture inserted zero. There were missing and unresolved channels,
so the manifest is partial. Sensor IDs prevent parallel same-phenomenon sensors
from collapsing. This proves latest-snapshot decoding/replay, not campaign history,
outdoor siting quality, calibration or continuous coverage. See the evidence file
for exact latest measurement time and stationary inventory count.

Offline tests cover zero/nulls, units, unknown exposure, altitude/coordinate order,
mobile/out-of-bbox exclusion, parallel sensor identity, metadata-only/failure paths
and replay. Licence and per-device calibration/siting remain unresolved; retain
openSenseMap source attribution and avoid claiming these as official reference data.
