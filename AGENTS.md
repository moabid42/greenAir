# greenAir repository instructions

Build from the collected Green City Heilbronn research. Keep data selection,
interpretation, and verification traceable throughout development.

## Start with focused context

- Read [agents/STATE.md](agents/STATE.md) for decisions and reusable findings.
- For data discovery, integrations, analysis, maps, or data-dependent UI, read
  [agents/WORKFLOW.md](agents/WORKFLOW.md) and run
  `python3 agents/context.py overview` once per task. For unrelated changes,
  read only the guidance relevant to the change.
- Search the endpoint catalog with `python3 agents/context.py find roughness`
  or `python3 agents/context.py find --source home`. Use `section 3.2 3.3` to
  read specific reference sections. See [agents/README.md](agents/README.md).
- Load only the rows and sections needed for the task. Widen the search when
  evidence is missing; do not routinely load the entire reference or CSV.

## Evidence and source authority

The canonical research snapshot is:

- [Detailed reference](docs/GREENCITY_HEILBRONN_COMPLETE_DATA_REFERENCE_2026-10-28.md):
  interpretation, field definitions, corrections, limitations, and provenance.
- [Endpoint catalog](data/GREENCITY_HEILBRONN_ENDPOINT_CATALOG_2026-10-28.csv):
  exact candidate URLs, record granularity, fields, cadence, and original
  verification descriptions. Parse with a CSV parser and `utf-8-sig` encoding.

Use the CSV to locate an endpoint and the reference to interpret it. Preserve
the original evidence labels: documented, directly observed, reported,
unverified, unreachable in an environment, and restricted are distinct.
A catalog listing confirms a collection name, not a working items endpoint.
Neither file is a downloaded dataset or proof of current service availability.

Before depending on a source, inspect a small live response and current provider
documentation relevant to the contract. Record method, URL/parameters, UTC check
time, response type, schema, and latest observation time when available. If a
check cannot run, state the limitation and use explicitly labelled fixtures
where useful. Never present fixture values or old counts as current observations.
Keep fresh evidence in `agents/STATE.md` or a linked integration note; preserve
the dated research snapshot and document discrepancies instead of rewriting it.

## Data rules that affect implementation

- Prefer Heilbronn-specific layers. Global `tracks` and `osem_bike_data` require
  a checked city filter (`groupTags` contains `heilbronn`); `statistics` uses
  `tag`. Inspect `track_points` and its join keys before choosing its filter.
  `campaign=heilbronn` is documented as ineffective; `bbox` and `datetime`
  support must be tested before relying on them (reference §3).
- `osem_home_data_heilbronn` contains stationary measurements; bike measurements
  are separate. Sensor fields can be absent or null. Preserve original keys,
  units, device identity, and raw values before normalizing (§3, §5).
- GeoJSON uses WGS84 `[longitude, latitude]`; Heilbronn center is approximately
  `[9.2109, 49.1427]`. Store machine timestamps in UTC; use `Europe/Berlin` for
  local display and handle DST explicitly (§1.4).
- Keep observations, derived street scores, weather models, catalog metadata,
  static archives, and dashboard metadata distinguishable. Dashboard refresh
  is not measurement cadence. Record observation time separately from retrieval
  and generation/ingestion times when supplied (§16).
- Probe small pages, then paginate and checkpoint exports. Avoid `limit=0` or
  million-row requests for raw ATRAI collections. Use timeouts, bounded retries,
  backoff for rate limits/server errors, and stable-ID deduplication (§3.4).
- Inspect content type and payload before parsing or extracting. A portal's
  HTTP 200 or Grafana dashboard JSON does not prove raw-data access. Discover
  real distribution URLs; use the documented HTTP method (§7–15, §18).
- Never use `eval` for ATRAI `statistics`. Keep opaque text unless needed;
  otherwise use a bounded safe literal parser and validate the result (§19.2).

## Carry knowledge through development

For each data feature, follow **discover → contract/probe → implement → validate
→ retain findings** in `agents/WORKFLOW.md`. Cite catalog rows and reference
sections in integration notes. Update `agents/STATE.md` when a material decision,
contract, failed route, or next step would otherwise need rediscovery. Read the
relevant entry when resuming and recheck time-sensitive assumptions.

Use the existing application stack and checks once established; do not infer a
framework from the research examples. Keep downloads, credentials, and large
responses out of agent instructions. After changing this workflow or its source
routing, run:

```sh
python3 agents/context.py check
python3 -m unittest discover -s agents/tests -v
```

Report what changed, relevant checks, and unresolved data assumptions. Offline
context checks validate local research structure; they do not verify live APIs.
