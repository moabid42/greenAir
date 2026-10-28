# Data development workflow

Use this for work that selects, fetches, transforms, analyzes, or presents data.
Read the relevant entry in [STATE.md](STATE.md) first. The steps are a working
loop within an authorized task; they do not add approval gates or require
separate agents.

## 1. Discover only what the feature needs

Run `python3 agents/context.py overview`, then `find` with a source or a few
keywords. Each result includes its exact CSV citation and reference section.
Read those sections with `section`; consult §18 for known failures, §19.2 for
conflicting claims, and §16 for freshness. Do not repeat the whole research pass.

Specify the feature's required place, period, variables, units, resolution, and
acceptable age. Select raw observations or derived layers to match the use
case. Prefer an existing connector/contract when the repository has one.
If discovery misses, list the source without search terms or inspect the
relevant reference section; CSV example fields are not an exhaustive schema.

## 2. Establish the smallest useful contract

For a new connector or a material contract change, create a short integration
note under `docs/integrations/<source-or-feature>.md` using
[the template](templates/integration.md). Update an existing note when possible.
Keep the full note out of startup context; link it from `STATE.md`.

- Cite exact catalog URL/row, reference section, research date, and input hashes
  from `check` where reproducibility matters. Original verification wording
  remains attached to the endpoint; a successful probe is separate dated evidence.
- Probe with an explicit method, small limit/bounded period, and timeout.
  Inspect status, content type, actual schema, geometry, units, nulls, timestamps,
  and pagination. Check current provider documentation for parameters you use.
- Identify geographic filtering, stable identifiers, join keys, expected volume,
  and access/license metadata. Mark unknowns explicitly. Do not invent fields
  from the CSV's illustrative list or treat a missing channel as zero.
- Distinguish a confirmed empty result from a failed, restricted, partial, stale,
  or geographically irrelevant result. If live checking is unavailable, record
  that fact and keep the integration's live status unverified.

## 3. Implement against that contract

Keep provider parsing and normalization in an adapter suited to the actual
application stack. Preserve provenance and units with normalized values.
Make geographic/time filters explicit, retain nulls, and keep event times
separate from upload/model/retrieval times. Label modeled and derived values.

Use pagination, checkpoints, bounded concurrency, timeouts and bounded retries.
Respect advertised feed TTLs. Record partial runs instead of returning them as
complete; account for moving offset windows and deduplicate by stable identity.
For exports, save a manifest with at least source/URL/parameters, retrieval UTC,
HTTP result, saved-row count, completeness/status, observed time range, and
SHA-256 of saved bytes; include reported total, license, and HTTP cache metadata
when available (reference §20.3). Link to large manifests rather than copying
them into agent files. Never store credentials in notes.

## 4. Validate behavior that can change the result

Use a small captured response or explicitly synthetic fixture. Check applicable
failure cases: missing fields/nulls, empty data, wrong payload type, pagination
boundaries, global-to-Heilbronn filtering, coordinate order, timezone/DST,
duplicate records, and partial/unavailable responses. Verify unit conversions
and normalization against actual provider fields. Exercise end-to-end behavior
with a small live sample when available. Record local tests and live checks
separately; sample success does not prove historical coverage or completeness.

For visualizations, show the source type, coverage, units, and latest observation
time when they affect interpretation. Distinguish absent coverage from a value
of zero; make stale and partial data visible where relevant to the feature.

## 5. Retain material findings and resume cheaply

Update `STATE.md` with the decision, integration note/code path, dated evidence,
remaining uncertainty, and next useful action. Promote recurring failures or
new field semantics only with evidence; preserve earlier results as history
when a new result changes them. Keep entries concise and consolidate outdated
task chatter. On resumption, load the relevant note and code; re-probe when the
task depends on present availability or freshness. Do not redownload a dataset
solely to recover a decision already recorded.

## Source-specific routing and traps

These are pointers into the snapshot, not newly verified service claims.

| Lookup source | Read | Implementation consequence |
|---|---|---|
| `bike` | §3.2–3.5 | Use local derived layers where suitable; filter global rides/samples using inspected fields. `track_points` schema is not fully documented. `statistics` filters on `tag`, not the CSV's generic `groupTags` note. `traffic_flow` is a normalized proxy, not a traffic counter. |
| `home` | §5, §15 | Fixed stations; per-device schemas/units and freshness. Join openSenseMap metadata by checked identifiers. |
| `heat` | §4 | Static logged walks. `/download` is a candidate; validate ZIP and inventory/CSV headers before assuming contents. |
| `birds` | §6 | Filter station coordinates first; local coverage is disputed. Prefer the bounded station/movement view initially; global movement/environment exports may be large. AI species confidence is not confirmed identity. |
| `hive` | §7 | Dashboard definitions contain metadata. Raw Grafana queries are not established as public; UI refresh is 15 minutes, sample cadence unknown. Video-share inventory is reported. |
| `city` | §8 | Discover DCAT distributions via candidate `data.json`/`catalog.xml`; do not assume CKAN routes work on Heilbronn's portal. |
| `library` | §9 | No anonymous raw endpoint confirmed. Select an actual product and its access process before implementation. |
| `mobility` | §10 | CKAN is discovery, GBFS is provider-specific current status, GTFS is a timetable, counters are aggregates. Read advertised resources and TTLs; GraphQL requires a checked POST contract. |
| `brightsky` | §11 | Inspect returned weather station, timestamps, units, and missing hours. Use `/sources` for stations; `/dwd_stations` is reported invalid. |
| `dwd` | §12 | Discover actual ZIP filenames and station metadata; handle semicolon files, sentinels/quality flags, and overlapping historical/recent archives. |
| `open-meteo` | §13 | Model output, distinct from sensor measurements. Historical weather uses `archive-api.open-meteo.com`; air quality uses another host and model-specific coverage. |
| `govdata` | §14 | Metadata aggregator; follow publisher distributions and deduplicate overlap. Reported CKAN backend is separate from the frontend host. |
| `opensensemap` | §15 | Inspect per-sensor metadata and bounded histories. Full-box `/data` GET is not established; ATRAI mirror completeness is not guaranteed. |
