# Admin environmental conditions — 2026-10-29

The dedicated `/environment` sidebar tab includes the station selector,
measurement table, exposure/provider filters, and hourly city forecast with an
accessible values table. Overview and Source data retain their monitoring roles. Components reuse the admin's existing
EcoMAB cards, colors, type, controls, and responsive layout.

## Contracts and interpretation

- `GET /api/v1/sensors`: stored measured stations; `latest` values and
  `channelProvenance` supply original channel units, measurement times, provider
  identity and QC flags. Official UBA/LUBW and community openSenseMap readings
  remain distinct. Indoor stations are explicitly labelled and the detailed
  table defaults to outdoor exposure. Coordinates are visible; the inventory
  includes surrounding locations and must not be described as a city-only sample.
- `GET /v1/days/{Berlin date}`: hourly model PM2.5, NO2, temperature, humidity,
  and wind. Forecast retrieval time and attribution stay visible. Source data's
  chart switches variables and leaves gaps blank. No measurement history is
  invented. DST instants select the current hour; the values table exposes actual
  UTC instants, including folds and gaps. O3 and PM10 are available as station
  measurements but are not part of this hourly serving contract.
- `GET /stations/status`: live GreenCityHN-tagged network counts, including online,
  stale and no-data boxes. This is a different population from the stored station
  inventory; both populations are labelled separately.

Individual measurement channels become stale after 30 minutes for community
stations or 3 hours for UBA, matching existing backend policy. Unknown/future
measurement times are treated as stale. A new upload cannot make an old channel
fresh. Missing/quality-filtered values remain unavailable and zero stays zero.
Model data ages against retrieval time independently of forecast valid time.
Mock data is rejected by these panels. Failed resources clear their displayed
values independently; changing the backend invalidates pending older requests.
Refresh runs once per minute while visible, with a manual refresh button and
15-second rerender of channel ages. A date change is picked up by the next refresh.

Discovery: catalog records 91/93 and reference §13 (weather/model air), home
record and reference §5/15 (community measurements), reference §16 (freshness).
See [weather contract](weather-sources.md), [UBA contract](uba-source.md),
[station status](opensensemap-stations.md), and [runtime](real-data-runtime.md).
The dated research files are unchanged. UBA is an additional verified integration
outside the original endpoint catalog. Open-Meteo's official air-quality docs
were rechecked during the audit; model concentrations remain distinct from
measurements and street-level estimates.

## Evidence and limits

Read-only local API checks on 2026-10-29 at 10:27:45–10:28:08 UTC returned HTTP
200 application/json for data-status, sensors, the current day and station status.
The sensor response contained 22 stored stations, including two official NO2
stations with measurement time 06:00 UTC. The 24-hour day response had source
`forecast`, per-channel provenance/units and retrieval at approximately 09:42 UTC.
The tagged network reported 6 online, 7 stale and 1 no-data station at that check.
These are dated samples, not fixed UI values or ongoing availability claims.
Local stored API checks do not independently re-verify every upstream service.

Validation: admin lint, unit tests and production build; targeted production
Chrome checks with the running real backend, station filters, hourly chart/table,
mobile overflow and independent station/forecast failure states. Artifacts remain
ignored under `data/runtime/admin-environment-20261029/`.
