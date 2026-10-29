# UBA official hourly station measurements — 2026-10-28

Recovered the UBA adapter/tests from the preserved weather worktree. UBA is named
in the architecture but absent from the endpoint catalog; no catalog verification
label is inferred. Current [official OpenAPI v4.0.0](https://luftdaten.umweltbundesamt.de/modules/custom/w21_uba_air_data_api_v4/assets/uba_api_v4.yml)
was retrieved and inspected alongside live stations/components/scopes metadata.

[Evidence manifest](uba-live-evidence.json) records every exact GET URL/parameter,
UTC check time, HTTP/content type, SHA-256, raw reference and replay outcome.
Raw bodies remain in the ignored local capture store, not committed fixtures.
Selected metadata confirms DEBW015 (ID 226, Heilbronn, `[9.2248,49.1655]`),
DEBW152 (ID 353, Weinsberger Straße-Ost, `[9.2259,49.1460]`), components
1=PM10, 3=O3, 5=NO2, 9=PM2.5 in µg/m³ and scope 2=one-hour average (3600s).
The adapter accepts these verified combinations; DEBW152 only NO2.

Five bounded one-day requests for 2026-10-27 returned HTTP 200 JSON, 24 records
each, using `time_from=1,time_to=24,scope=2`. Replay inserted 120 measurements
in total; second replay inserted zero. Projected values retained observation kind,
station/sensor identity, raw component ID/value/unit, raw linkage and actual interval
end. Valid UTC endings span 2026-10-27T00:00Z through 23:00Z. This is a dated daily
sample, not a statement about today's latest values or full history.

The response indices define each record as component/scope/value/date-end/index;
both filtered request and returned station/component/scope are checked. Current
metadata explicitly describes times as the local CET/CEST applicable at observation.
The adapter resolves Berlin local times only when unique, validates the one-hour
interval, and supports exact 24:00 midnight notation. Ambiguous/nonexistent DST
hours become unresolved receipts and partial manifests; it never guesses a fold.
Missing values remain recorded in raw/manifest as gaps, rather than zero.

Source namespaces are job-specific (for example uba_226_1); raw requests, canonical
rows, receipts and watermarks use the same ID. The station code and component/scope
sensor ID preserve provider identity independently. Each request covers at most one
local day, and page checkpoints persist the next boundary for restart.

UBA's current-year data are not finally audited and may contain transmission gaps.
Raw QC flags remain empty; downstream checks are separate. The declared licence is
Data licence Germany attribution 2.0; attribution is “Umweltbundesamt mit Daten der
Messnetze der Länder und des Bundes”. These observations must remain distinguishable
from modelled air and community sensors in API/frontend projections.

Offline tests cover station/scope mismatches, null/zero, 24:00, summer/winter offsets,
DST ambiguity/gaps, source namespacing, originals/projection and replay. Live evidence
proves only the selected bounded samples and metadata at the recorded UTC times.
