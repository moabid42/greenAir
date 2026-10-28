# Green City Heilbronn Hackathon — Comprehensive Data & API Reference

**Version:** 1.0 · **Reviewed:** 2026-10-28 · **Audience:** first-time participants, data scientists, map developers, backend engineers  
**Primary source:** <https://hackathon.greencity.hn/resources> and <https://hackathon.greencity.hn/resources/bike-data>  
**Coverage:** the six Materials data cards, all 13 user-supplied card links, the additional bike-data guide, and supporting openSenseMap/Birdiary services.  
**Nature of this file:** documentation and source reconciliation, **not** a downloaded data archive or a guarantee of ongoing service availability.

> **Read this first.** This guide separates (a) endpoints explicitly documented by their owners, (b) endpoints reported to work by another agent on 2026-10-28, (c) unverified proposed routes, and (d) inaccessible/registration-only data. It does **not** treat a dashboard's refresh setting as a sensor sampling interval, a catalog as one dataset, or a bulk-download URL as an API. API responses can change between requests.

## Contents

1. [Quick start and terminology](#1-quick-start-and-terminology)
2. [At-a-glance source map](#2-at-a-glance-source-map)
3. [senseBox:bike / ATRAI: raw rides and derived geospatial layers](#3-senseboxbike--atrai-raw-rides-and-derived-geospatial-layers)
4. [Mobile Datalogger / Heat-Island Summer School: re:edu files](#4-mobile-datalogger--heat-island-summer-school-reedu-files)
5. [senseBox:home: stationary sensors](#5-senseboxhome-stationary-sensors)
6. [Smart Birdhouses / Birdiary](#6-smart-birdhouses--birdiary)
7. [Smart Beehive: telemetry dashboard and labelled video files](#7-smart-beehive-telemetry-dashboard-and-labelled-video-files)
8. [OpenData Heilbronn municipal portal](#8-opendata-heilbronn-municipal-portal)
9. [Smart City Heilbronn Data Library](#9-smart-city-heilbronn-data-library)
10. [MobiData BW](#10-mobidata-bw)
11. [Bright Sky weather](#11-bright-sky-weather)
12. [DWD Open Data](#12-dwd-open-data)
13. [Open-Meteo weather and air quality](#13-open-meteo-weather-and-air-quality)
14. [GovData Germany](#14-govdata-germany)
15. [Additional openSenseMap direct API](#15-additional-opensensemap-direct-api)
16. [Update-frequency and freshness handbook](#16-update-frequency-and-freshness-handbook)
17. [Copy-and-run recipes](#17-copy-and-run-recipes)
18. [Unreachable, restricted, unverified and known failures](#18-unreachable-restricted-unverified-and-known-failures)
19. [Six-report comparison and corrections](#19-six-report-comparison-and-corrections)
20. [Source provenance and verification methodology](#20-source-provenance-and-verification-methodology)

---

## 1. Quick start and terminology

### 1.1 Choose the right source

- **Where are roads bumpy, cyclists overtaken closely, or exposed to particulate matter?** Start with ATRAI's city-specific **derived GeoJSON collections** (§3).
- **Where did actual senseBox bikes ride and what was measured at each moment?** Use ATRAI `tracks`, `track_points`, and `osem_bike_data` (§3); **filter city** for global collections.
- **How does temperature/humidity/air quality vary around fixed stations?** Use `osem_home_data_heilbronn` (§5); use openSenseMap box metadata if needed (§15).
- **Where did summer-school participants walk with a datalogger?** Download the re:edu share (§4); do **not** expect a continuous live feed.
- **When and what birds visited sensor-equipped feeders?** Use Birdiary's station, movement, statistics, environment, and media routes (§6).
- **What is happening inside three monitored hives?** View BeeHappy Grafana; raw database queries are **not established as public** (§7).
- **Need official city, statewide transport or national administrative data?** Discover individual datasets in OpenData Heilbronn, MobiData BW, GovData (§8, §10, §14).
- **Need weather observations or historical climate?** Bright Sky (DWD-derived), raw DWD files, and Open-Meteo's reanalysis (§11–13).

### 1.2 Important definitions

| Term | Meaning |
|---|---|
| **Live API** | Request returns data from the service at query time; **not necessarily continuously streaming**. |
| **Raw measurement** | Time- and device-specific observation. Useful for high-resolution analyses and QC. |
| **Derived layer** | Aggregated or model-calculated values (e.g. road roughness by street segment), possibly rebuilt periodically. |
| **Static file/share** | Curated CSV, ZIP, GeoJSON, media, etc.; updates require publishing new files. |
| **Catalog / portal** | A search/index of many separate datasets; often supplies metadata and links, **not** one data feed. |
| **OGC API Features / GeoJSON** | Spatial API returning `FeatureCollection` with `features[]`, `geometry` and `properties`. |
| **CKAN action API** | Standard catalog endpoints such as `/api/3/action/package_search` returning datasets and resource URLs. Only use when confirmed for that host. |
| **DKAN / DCAT** | Another catalog family; do not substitute CKAN routes without testing. |
| **Measurement cadence** | How frequently the physical device measures. |
| **Ingestion/update cadence** | When the API receives new readings or recalculates derived values. |
| **UI refresh** | How often a browser dashboard re-fetches data; **not** sensor cadence. |

### 1.3 Source/status key

- **DOCUMENTED:** the official hackathon page, provided notebook, or service documentation specifies this endpoint or behavior.
- **CATALOG VERIFIED:** `https://api.atrai.bike/collections` and `.../campaigns/heilbronn` returned accessible JSON during this documentation pass.
- **REPORTED 2026-10-28:** one or more uploaded agent reports say they successfully fetched or downloaded it; raw evidence/files were **not** attached with those reports.
- **UNVERIFIED:** syntactically plausible; do not treat as successfully checked.
- **UNREACHABLE HERE:** could not retrieve through this environment; may still work for a user in a browser or terminal.
- **ACCESS RESTRICTED:** requires a session/key or the provider does not publish a raw endpoint.

### 1.4 Geographic and time conventions

Example Heilbronn city-center coordinate: **latitude 49.1427, longitude 9.2109 (WGS84)**. **GeoJSON coordinates are `[longitude, latitude]`**, the reverse of typical `lat,lon` API arguments. Prefer UTC (`Z`) for machine processing; local time uses `Europe/Berlin` and daylight-saving transitions. For weather APIs, the returned coordinate may be a *model grid cell or nearest DWD station*, not a sensor exactly at city center.

---

## 2. At-a-glance source map

| Hackathon card / supporting source | Data available | First useful address | Interface | History | How fresh? | Public access assessment |
|---|---|---|---|---|---|---|
| **senseBox:bike / ATRAI** | Bike GPS, speed, PM, overtaking, surface classes; road-level risk/flow layers | `https://api.atrai.bike/collections` | GeoJSON + campaign JSON | All *retained* API data | Raw uploads and periodic derived builds; exact schedule unpublished | DOCUMENTED; catalog reachable |
| **Mobile Datalogger / Heat-Island 2026** | Logged walks / route environmental CSV exports | `https://cloud.reedu.de/s/X9x2XE9a9xCxLm8` | Nextcloud shared folders / ZIP | Fixed uploaded files | Manual/unknown | Share landing accessible; file inventory NOT independently checked |
| **senseBox:home** | Fixed environmental sensor measurements across Heilbronn | `https://api.atrai.bike/collections/osem_home_data_heilbronn/items?f=json&limit=1000` | GeoJSON | All *retained* collection data | Device/ingestion dependent | Collection name confirmed; items fetch not independently verified |
| **Smart Birdhouses** | Bird visits, AI species, weights, weather, videos/audio | `https://wiediversistmeingarten.org/api/station` | JSON + media | Per-station retained history | Device uploads, no guaranteed interval | DOCUMENTED in official starter notebook; responses inaccessible here |
| **Smart Beehive telemetry** | 3 hives, temperature, humidity and environmental indicators | BeeHappy Grafana link, §7 | Grafana visual + dashboard JSON | Panel query range | **15 min UI refresh**, sampling unknown | Dashboard may load; anonymous underlying raw export unverified/restricted |
| **Smart Beehive media** | Labelled hive entrance videos/training bundles | `https://cloud.reedu.de/s/YkHckREGAM89z9m` | Nextcloud ZIP | Uploaded recordings | Manual/unknown | Share landing accessible; contents reported, not verified |
| **OpenData Heilbronn** | Local city tables, geodata, statistics and counters | `https://opendata.heilbronn.de/` | DKAN/DCAT catalog + files | Dataset dependent | Annual/irregular | Portal/catalog routes inconsistent between agents; verify |
| **Smart City Data Library** | Developer API offerings | `https://data-library.smartcity.hn/` | Portal / registration | Per subscribed product | Unknown | No verified anonymous raw dataset |
| **MobiData BW** | Bike counts, transit, bikeshare/scooters, parking, chargers | `https://mobidata-bw.de/dataset/?q=heilbronn` | CKAN + GTFS/GBFS/OGC/etc. | Feed specific | From seconds/minutes to years | Public routes reported; not all tested here |
| **Bright Sky** | DWD-based current, hourly and historical weather, alerts | `https://api.brightsky.dev/openapi.json` | JSON REST | **From 2010 per official docs** | Product/source dependent | DOCUMENTED official OpenAPI accessible |
| **DWD Open Data** | Original German weather station and forecast ZIPs | `https://opendata.dwd.de/` | HTTP directories / files | Long station history | 10-min, hourly, daily etc. by product | Official recent directory accessible |
| **Open-Meteo** | Forecast, reanalysis weather, modeled air quality | `https://open-meteo.com/en/docs` | JSON/CSV APIs | ERA5 from **1940**, model-specific | Model-specific | Official docs accessible |
| **GovData** | Nationwide government dataset catalog | `https://www.govdata.de/` | Portal / reported CKAN backend | Each publisher's archive | Per publisher | Portal accessible; API backend reported |
| **openSenseMap** (supporting) | senseBox station inventory and per-sensor readings | `https://api.opensensemap.org/boxes` | REST JSON | Sensor-dependent | Last measurement timestamp | Documentation known; responses unavailable here |

**Do not count a portal as an individual data source, a Colab notebook as a sensor endpoint, or a Grafana panel as an anonymously queryable database.**

---

## 3. senseBox:bike / ATRAI: raw rides and derived geospatial layers

### 3.1 What the system measures and who should use it

A bicycle-mounted sensor box records location, movement and environmental/safety signals. The official guide lists **GPS coordinates, speed, PM1–PM10, temperature, humidity, overtaking distance/AI overtaking confidence, and AI-estimated road surface**. The ATRAI pipeline turns raw records into **street segments and risk maps**. Campaigns also exist for Münster, Arnsberg, Nancy (`lauds_26`) and São Paulo; **global collections must be filtered** to study Heilbronn alone.

**Official specification:** <https://hackathon.greencity.hn/resources/bike-data>. **Base API:** <https://api.atrai.bike>. **Map:** <https://data.atrai.bike/>. **Build/dataset docs:** <https://data.atrai.bike/docs/built-in-datasets>.

### 3.2 Discovery, campaign and retrieval endpoints

| Method + path | Response / reason to call | Required or useful parameters | Update status |
|---|---|---|---|
| `GET /collections` | JSON `collections[]` with valid collection names | none | Catalog current at request time |
| `GET /campaigns` | City campaign totals, ride/rider/distance/time-span summaries | none | May lag raw ingest |
| `GET /campaigns/heilbronn` | Heilbronn campaign summary | none | Inspect `end_date`; not a streaming clock |
| `GET /collections/{name}/items` | GeoJSON `FeatureCollection` for the requested collection | `limit` (default 100), `offset` (default 0), optional `f=json` | Varies: raw ingested, derived reprocessed |

Examples:

```bash
curl -L 'https://api.atrai.bike/collections'
curl -L 'https://api.atrai.bike/campaigns/heilbronn'
curl -L 'https://api.atrai.bike/collections/bumpy_roads_heilbronn/items?f=json&limit=100'
curl -L 'https://api.atrai.bike/collections/osem_bike_data/items?f=json&limit=1000&offset=0'
```

**`limit=0` means ask for the entire collection**, not zero records, according to the official guide. **Do not use** it for multimillion-row raw layers: requests may time out or exhaust memory. Use `limit=1000` or `10000`, increment `offset`, and write pages as you go. `campaign` is mentioned in the guide but **currently has no effect**; do not rely on `?campaign=heilbronn`. OGC-like `bbox` and `datetime` query parameters were claimed in one agent report but **are not guaranteed by this API's hackathon documentation**; perform filtering client-side until tested.

### 3.3 Exactly which collections exist

The ATRAI catalog returned **45 collection names** on 2026-10-28: **8 per-city derived families × 5 campaign tags = 40**, plus **5 global/special collections**. The catalog names were directly observed; this is not a prediction of all future entries.

| Dataset family (replace `<city>`) | Geometry, one feature means | Important `properties` fields (case and spaces matter) | Interpretation / derivation | Update mode |
|---|---|---|---|---|
| `bumpy_roads_<city>` | LineString street segment | `Roughness`, `Normalized Roughness`, `Number of Boxes`, `name` | Surface-class probabilities weighted asphalt=1, paving=2, compacted=3, sett/cobblestone=4; mean per segment; normalized score 0–1 | Rebuilt from bike samples |
| `danger_zones_<city>` | Point overtaking event | `Risk Index Overtaking`, `lat`, `lng` | If overtaking confidence >5%, index = `0.3 × maneuver_confidence + 0.7 × (1 − overtaking_distance_cm / 400)`; higher = riskier | Rebuilt from bike samples |
| `danger_zones_PM_<city>` | Point composite traffic/pollution risk | `Risk Index`, `lat`, `lng` | Weighted maneuver/closeness and PM1, PM2.5, PM4, PM10; humidity >75% and some outliers excluded | Rebuilt from bike samples |
| `overtaking_distance_<city>` | LineString segment | `Average Overtaking Distance cm`, `Overtaking Distance Counts`, `Number of Points` | Events with confidence >50%, distance >25 cm; histogram bins 0–50/50–100/100–150/150–200/>200 cm | Rebuilt from samples |
| `speed_map_<city>` | LineString segment | `avg_speed[km/h]`, `points_in_segment` | Mean cycling speed on matched segment | Rebuilt from samples |
| `traffic_flow_<city>` | LineString segment | `avg_traffic_flow`, `points_in_segment` | Derived normalized flow proxy from normalized speed and estimated standing; 0=stop/slow, 1=free-moving; **not** vehicles/hour | Rebuilt from samples |
| `road_network_<city>` | LineString OSM street segment | `osmid`, `name`, `surface`, `cycleway`, `oneway` | OSMnx-derived road reference network; serves as spatial join backbone | OSM snapshot / rebuild when processing |
| `bike_road_network_<city>` | LineString segment | `osmid`, `name`, `cycleway`, `oneway` | Slim bike-relevant network, without full surface attributes | OSM snapshot / rebuild |
| `tracks` | LineString **one ride**, all cities | `boxId`, `groupTags`, `startTime`, `distance_meters`, `avg_speed_ms`, `avg_pm25`, `avg_overtaking_distance` + optional fields | Ride geometry and summary; **filter `groupTags`** for `heilbronn` | New rides when ingested |
| `track_points` | Track-location points, all cities | Exact field names **not supplied in official guide**; inspect `features[0].properties` | Underlying route points useful for detailed trajectories; don't invent schema | Raw/processed, retention dependent |
| `statistics` | Polygon **one city** | `tag`, `statistics`; some reports also saw `updatedAt` | Aggregate city and weekly figures; `statistics` stored as **Python-literal-like text**, not JSON | Rebuilt; inspect `updatedAt` if present |
| `osem_bike_data` | Point **one raw sensor observation**, all cities | `boxId`, `groupTags`, `createdAt`, `Speed`, `Finedust PM2.5`, `Overtaking Distance`, `Surface Asphalt` + variable sensor properties | Best for raw sensor time series and your own modeling | Upload/ingestion driven |
| `osem_home_data_heilbronn` | Sensor measurement, stationary Heilbronn network | Actual sensor fields **vary by device**; inspect `properties` per feature | Stationary measurements, **NOT bike rides**; more in §5 | Upload/ingestion driven |

For `danger_zones_PM`, the official documented weights are **0.15 maneuver confidence, 0.35 closeness, 0.20 PM1, 0.15 PM2.5, 0.10 PM4, 0.05 PM10**, with PM components normalized against maxima. The derived street layers match GPS samples to the closest OSM segment within **20 m** and aggregate them. **This is model-derived analysis, not independent ground truth.**

**All 8 family members for Heilbronn:**

```text
bumpy_roads_heilbronn
bike_road_network_heilbronn
danger_zones_heilbronn
danger_zones_PM_heilbronn
overtaking_distance_heilbronn
road_network_heilbronn
speed_map_heilbronn
traffic_flow_heilbronn
```

**Other collection names returned:** the above 8 families also exist with suffixes `arnsberg`, `muenster`, `lauds_26`, `saopaulo`; plus `tracks`, `track_points`, `statistics`, `osem_bike_data`, `osem_home_data_heilbronn`.

### 3.4 Request and parse a GeoJSON response

```python
import requests
base = "https://api.atrai.bike"
r = requests.get(f"{base}/collections/bumpy_roads_heilbronn/items",
                 params={"f": "json", "limit": 100, "offset": 0}, timeout=60)
r.raise_for_status()
payload = r.json()
print(payload.keys())             # Typically type, features, pagination/count metadata
for feature in payload.get("features", [])[:3]:
    print(feature["geometry"]["type"], feature.get("properties", {}))
```

**Pagination example (safe streaming, no `eval`):**

```python
import json, requests
s = requests.Session()
collection = "osem_home_data_heilbronn"
url = f"https://api.atrai.bike/collections/{collection}/items"
limit, offset = 5000, 0
with open(f"{collection}.jsonl", "w", encoding="utf-8") as out:
    while True:
        r = s.get(url, params={"f": "json", "limit": limit, "offset": offset}, timeout=120)
        r.raise_for_status()
        page = r.json()
        features = page.get("features", [])
        if not features:
            break
        for feature in features:
            out.write(json.dumps(feature, ensure_ascii=False) + "\n")
        offset += len(features)
        print("downloaded:", offset, "out of:", page.get("numberMatched", "unknown"))
        if len(features) < limit:
            break
```

Caution: offset pagination on a collection **changing during a long export** can skip or duplicate rows. Record extraction start/end time, deduplicate by stable ID if provided, and recheck totals. `numberMatched` is a server-reported instantaneous count, not an immutable archival guarantee.

### 3.5 Example snapshot numbers and freshness

Two reports (Manus and Genspark) gave the following **reported 2026-10-28 snapshots**: `osem_home_data_heilbronn` **2,012,544**, `osem_bike_data` **1,474,744**, `track_points` **1,462,631**, `tracks` **6,638**, `statistics` **5**. The official bike guide gives approximate Heilbronn feature counts for roughness (~9,400), overtaking danger (~6,500), and overtaking distance (~1,300). **Do not hard-code these counts as today's values.**

A **directly accessible** `/campaigns/heilbronn` response during this review reported **2,281 rides, ~5,205.4 km, 32 riders**, campaign span **2025-12-05 to 2026-10-26**. New samples may exist after that summary was computed; the API gives **no official hourly ingestion SLA**. For freshness, use campaign `end_date`, `statistics.updatedAt` if present, and max parsed `createdAt`/`startTime` of individual data.

---

## 4. Mobile Datalogger / Heat-Island Summer School: re:edu files

**Card:** Mobile Datalogger / *Heat-Island-Summerschool 2026*. Logged walks with handheld/mobile sensors, useful for urban heat-island comparison.  
**Public share:** <https://cloud.reedu.de/s/X9x2XE9a9xCxLm8>  
**Likely whole-share ZIP action (standard Nextcloud):** <https://cloud.reedu.de/s/X9x2XE9a9xCxLm8/download>

| Attribute | Description / limitations |
|---|---|
| Format | Nextcloud shared directory; folders and downloadable files, **not a live API**. |
| What is available | The hackathon describes **logged walks**. Genspark reports a `datensätze/` tree, `datasets/` aggregates and `raw_data/` per route/day with `senseBox_bike_YYYY-MM-DD_HH-MM_standard*.csv`; Qwen also reports `datasets` and `raw_data`. File list **not independently inspected** here. |
| Measurement types | Temperature/humidity expected for heat-island investigations; **inspect the actual CSV headers** to know which other variables, units and GPS positions appear. |
| Download | Open share and use Nextcloud **Download**; programmatic `/download` is a **candidate**, browser-side verified direct ZIP response not reproduced here. |
| Expected size | Genspark **reports** ~25.4 MB ZIP; not independently validated. |
| Frequency | **Static/manual uploads**. CSV timestamp is the observation time, file modification/upload timestamp is publication time; no guaranteed update schedule. |
| Safe use | Preserve original filenames, coordinate reference system, route labels, sampling gaps and timezone. Dataset names like `innenstadt`, `neckar`, `wartberg` are **reported** and require confirmation from ZIP listing. |

```bash
# Run on your own computer, verify the server responds with a ZIP before extracting.
curl -fL --retry 3 --connect-timeout 20 \
  'https://cloud.reedu.de/s/X9x2XE9a9xCxLm8/download' \
  -o heat_island_share.zip
file heat_island_share.zip
unzip -l heat_island_share.zip | head -50
```

If the URL returns HTML/login rather than a ZIP, open the share in a browser. Do not assume `/public.php/webdav` works without a valid share password.

---

## 5. senseBox:home: stationary sensors

**This is separate from senseBox:bike.** Fixed senseBoxes installed in Heilbronn publish observations. Individual boxes may have different attached sensors, so not every feature has every column.

**Hackathon-supplied exact URL:**

```text
https://api.atrai.bike/collections/osem_home_data_heilbronn/items?f=json&limit=1000000
```

**Recommended paged form:**

```text
GET https://api.atrai.bike/collections/osem_home_data_heilbronn/items?f=json&limit=5000&offset=0
```

**Available data:** timestamped, geolocated environmental measurements from registered home senseBoxes. Common senseBox channels include **temperature (°C), relative humidity (%), air pressure (hPa), particulate matter (µg/m³)**, but check each `properties` object and original sensor metadata; **not all channels are guaranteed present**. Study `createdAt`, `boxId`, geometry and variable names. A 1-million `limit` **does not** fetch all records if the collection exceeds it; paginate to exhaustion.

**Freshness:** stations upload on their own schedule; the API does not promise a common polling interval. Compute the newest `createdAt` per `boxId` and flag offline sensors. Use openSenseMap (§15) for box hardware/sensor metadata where available; do not assume that ATRAI is an exhaustive permanent backup of the original platform.

**Quick integrity check:**

```python
import requests
u = "https://api.atrai.bike/collections/osem_home_data_heilbronn/items"
p = requests.get(u, params={"f":"json", "limit":5}, timeout=60).json()
for f in p.get("features", []):
    print(f.get("properties", {}).get("boxId"), f.get("properties", {}).get("createdAt"),
          list(f.get("properties", {})))
```

---

## 6. Smart Birdhouses / Birdiary

**Hackathon starter notebook (official):**

- [Google Colab](https://colab.research.google.com/github/reedu-reengineering-education/Heilbronn-Hacksite/blob/main/public/birdiary_starter.ipynb) — interactive notebook (requires Colab environment).
- [GitHub notebook view](https://github.com/reedu-reengineering-education/Heilbronn-Hacksite/blob/main/public/birdiary_starter.ipynb).
- [Raw `.ipynb` JSON](https://raw.githubusercontent.com/reedu-reengineering-education/Heilbronn-Hacksite/main/public/birdiary_starter.ipynb) — direct, retrievable during this review.
- [Project](https://wiediversistmeingarten.org/) · [Public station map](https://wiediversistmeingarten.org/view/) · [Birdiary code](https://github.com/Birdiary).

**Actual data API base stated in notebook:** `https://wiediversistmeingarten.org/api`. The notebook explicitly says **no API key** is needed. The notebook was available for inspection, but its live station endpoint did **not** return through this browsing environment; route definitions therefore have **DOCUMENTED**, not directly-live-verified, status.

### 6.1 Endpoint-by-endpoint

| GET endpoint (prefix `/api`) | Exactly what you receive | Keys / usage | Volume / updates |
|---|---|---|---|
| `/station` | Array of all published stations (not just Heilbronn) | `station_id`, `name`, `type`, `location.lat`, `location.lng`, `lastMovement`, `lastEnvironment` | Reported 183 stations on 2026-10-28; changing registry |
| `/station/{station_id}?movements=20&movementsOffset=0` | One station profile plus daily species summary and **20 most recent** movements | `measurements.movements`, `movementsMeta`, `count`; page using `movementsOffset` | Fast for interactive exploration |
| `/movement/{station_id}` | Every movement/visit retained for one station | `mov_id`, `station_id`, `start_date`, `end_date`, `weight`, `detections[]`, optional `validation`, `video`, `audio`, `environment` | Potentially multi-MB; no pagination documented |
| `/statistics/{station_id}` | Station-level totals/averages, daily use, temp/humidity extrema, highlight videos | Exact nesting varies; inspect returned keys | Some specific station requests reported HTTP 500 |
| `/environment/{station_id}` | Temperature and humidity time series for station | Timestamps + environment values | Potentially 15+ MB; sensor cadence reportedly every few minutes |
| `/uploads/videos/{filename}` | Referenced bird video clip | Use `video` URL in movement record; **do not guess filenames** | Static media for each event |
| `/uploads/audios/{filename}` | Referenced audio clip | Use `audio` URL in movement record | Static media |

**Important concepts:**

- **One `movement` = bird perched/visit event**, not one unique bird. `detections[]` can contain several competing AI predictions. A `score` is **model confidence**, not independently validated biological certainty.
- `validation` (when present) may represent a human species confirmation; prefer human-confirmed labels for supervised training.
- `weight` is in **grams**, temperature generally **°C**, humidity **%** per notebook illustrations; read sensor metadata if available.
- Use `start_date` for **event time**; `createdAt` if present may represent **upload time** and may use a different timestamp format.
- Some stations have **no movement** or have been **offline for months**. Use last activity and handle missing values.
- **Geography alert:** Genspark reports zero of 183 public stations inside an approximate Heilbronn bounding box; this **is not independently corroborated** and differs from the notebook's example, which tries to find nearby stations. Run a fresh station/coordinate search before assuming Heilbronn birdhouse coverage.

### 6.2 Minimal complete workflow

```python
import requests, math
base = "https://wiediversistmeingarten.org/api"
s = requests.Session()
stations = s.get(f"{base}/station", timeout=60).json()

def km(a, b):  # a,b are (lat, lon)
    R = 6371
    x1,y1,x2,y2 = map(math.radians, (*a,*b))
    x = math.sin((x2-x1)/2)**2 + math.cos(x1)*math.cos(x2)*math.sin((y2-y1)/2)**2
    return 2*R*math.asin(math.sqrt(x))

near = []
for st in stations:
    loc = st.get("location") or {}
    if loc.get("lat") is None or loc.get("lng") is None: continue
    if km((49.1427,9.2109),(loc["lat"],loc["lng"])) <= 30:
        near.append(st)
print("within 30 km:", len(near))
if near:
    sid = near[0]["station_id"]
    r = s.get(f"{base}/station/{sid}", params={"movements":20,"movementsOffset":0}, timeout=60)
    r.raise_for_status()
    print(r.json().get("movementsMeta"))
```

**Freshness:** station-dependent upload; **no verified global interval**. Check `lastMovement.start_date` / last environment record instead of assigning “every few minutes” to the whole network.

---

## 7. Smart Beehive: telemetry dashboard and labelled video files

### 7.1 BeeHappy telemetry in Grafana

**Official card link:**

```text
https://beehive-grafana-production.up.railway.app/d/beehappy-monitor/beehappy-e28094-bienenstock-monitor?orgId=1&from=now-7d&to=now&timezone=browser&refresh=15m
```

Three monitored hives at/around OpenSpace: internal/brood and outdoor probes, temperature/humidity, plus the site's weather station. The Genspark report says the dashboard JSON has **26 panels**, including hive comparisons, brood conditions, stability/daily rhythm, wind, pressure, UV, light, rain and roof experiment; these panel-level details are **REPORTED** rather than verified by this review.

| Path or action | Expected resource | Public availability | What it *doesn't* provide |
|---|---|---|---|
| `/d/beehappy-monitor/beehappy-e28094-bienenstock-monitor?...` | Browser visualization, selectable historical range | Dashboard link supplied; HTML/raw panel data inaccessible here | Not a downloadable public timeseries endpoint |
| `GET /api/health` | Grafana health/version metadata | REPORTED 200 | No sensor observations |
| `GET /api/dashboards/uid/beehappy-monitor` | Dashboard definition: panels, transformations, data-source UIDs, SQL queries | REPORTED anonymous 200; could not independently fetch | Does **not** contain underlying measurements |
| `POST /api/ds/query` (Grafana standard API) | Queries dashboard data source when properly authenticated/authorized | **ACCESS RESTRICTED / NOT VERIFIED PUBLIC** | Do not assume an unauthenticated GET is usable; 404/405 can be method/auth/proxy effects |
| Panel > Inspect > Data > Download CSV | User-session export for accessible panel | Manual **if Grafana UI allows it** | Not guaranteed for every panel or all-time range |

**Refresh clarification:** `refresh=15m` means **the browser checks panels every 15 minutes**. It does **not** establish 15-minute sample intervals, API materialization intervals, or guaranteed realtime availability. `from=now-7d` means the **view defaults to last seven days**, not that older data do not exist. Dashboard edit/update timestamps (one agent reports 2026-09-14) are **dashboard metadata**, not most recent observation timestamps.

### 7.2 Labelled hive entrance videos

**Public Nextcloud share:** <https://cloud.reedu.de/s/YkHckREGAM89z9m>  
**Candidate share ZIP:** <https://cloud.reedu.de/s/YkHckREGAM89z9m/download>

Per the data card this has labelled entrance videos useful for machine learning (senseBox MCU Eye). Genspark reports `senseBox_hive/data/recordings_sessions/*.tar.gz`, `traindata_20260916.tar.gz`, `uncropped_all.tar.gz`, `rgbee.mp4` and a README, approximate **496.7 MB** whole ZIP. This precise file list and size **could not be independently verified** from the JavaScript-only Nextcloud share. No live video or label API is documented. Uploaded/recorded timestamps are dataset-specific; request a share listing before assuming content or completeness.

---

## 8. OpenData Heilbronn municipal portal

**Portal:** <https://opendata.heilbronn.de/>. It is a **catalog of independent city datasets** (statistics, maps, city bicycle counting data, municipal information), not a single live environmental feed.

### Endpoints and how to discover files

| Address | What it is | Evidence/status |
|---|---|---|
| `https://opendata.heilbronn.de/` | Human dataset search | Official card; intermittently unreachable here |
| `https://opendata.heilbronn.de/data.json` | DCAT-like machine-readable dataset catalog | Genspark **REPORTS HTTP 200**, 140 datasets / 325 distributions |
| `https://opendata.heilbronn.de/catalog.xml` | Alternative DCAT catalog route | Manus **REPORTS**; request timed out here; **UNVERIFIED** |
| `https://opendata.heilbronn.de/api/3/action/package_search` | CKAN-style API suggested by Gemini/Qwen | Genspark **REPORTS HTTP 404**; **do not rely on CKAN** |

**Best documented workflow:** try the first working machine-readable catalog, iterate `dataset[]`, read each entry's `title`, `description`, `keyword`, `issued`, `modified`, and `distribution[]`. A distribution usually advertises a `downloadURL` or `accessURL` and a format. Download the **distribution URL** itself; a catalog `title` is not a file. Use metadata `modified` (if present) for updates, not a fabricated “monthly” citywide schedule.

```python
import requests
u="https://opendata.heilbronn.de/data.json"
r=requests.get(u,timeout=60); r.raise_for_status()
doc=r.json()
print(type(doc), doc.keys() if isinstance(doc,dict) else len(doc))
# Different DCAT serializers may place datasets under different keys.
datasets=doc.get('dataset',[]) if isinstance(doc,dict) else doc
for d in datasets[:3]:
    print(d.get('title'), d.get('modified'))
    for dist in d.get('distribution',[]):
        print(' ', dist.get('mediaType') or dist.get('format'),
              dist.get('downloadURL') or dist.get('accessURL'))
```

Genspark reports municipal bike-counter CSVs, long-term annual climate, city district geometries, statistics and election releases; these are **examples, not promises that every named distribution still exists**. One report claims 200 downloaded distributions; **the actual files/manifest were not included with these six uploads**. Do not equate PDF/HTML presentation pages with clean machine-readable datasets.

**Update schedule:** **per distribution** (some annual/irregular, some counters more frequent); store `issued`, `modified`, HTTP `Last-Modified`, and last successful retrieval timestamp.

---

## 9. Smart City Heilbronn Data Library

**Portal:** <https://data-library.smartcity.hn/>  
**Resource type:** developer-facing API discovery / access-registration portal.

At the public landing-page level, the reports did **not identify an anonymous data API endpoint**, reliable schemas, or an unrestricted historical bulk export. An HTTP 200 shell/landing page is **not equivalent to usable public data**. Look for a specific API product, read its swagger/OpenAPI docs, register/request credentials if the owner allows, and then document product-specific URL, fields, policies, quota and update cadence. **Status: PUBLIC RAW ENDPOINT UNVERIFIED / ACCESS MAY REQUIRE REGISTRATION.**

Do not attempt to guess developer credentials or bypass access controls. No fixed refresh interval can be assigned to the entire Data Library.

---

## 10. MobiData BW

**Heilbronn catalog search:** <https://mobidata-bw.de/dataset/?q=heilbronn>. This Baden-Württemberg mobility portal mixes **static schedules**, **live sharing/parking/charging feeds**, and **historic counter time series**. Not every dataset is specific to Heilbronn; use location filters, stop IDs, coordinates or resource metadata.

### 10.1 Dataset catalog: CKAN

| GET endpoint | Role |
|---|---|
| `https://mobidata-bw.de/api/3/action/package_search?q=heilbronn&rows=100` | Discover datasets with keyword Heilbronn; returned list is **not** raw data |
| `https://mobidata-bw.de/api/3/action/package_list` | List dataset slugs |
| `https://mobidata-bw.de/api/3/action/package_show?id={dataset_slug}` | One dataset's metadata and `resources[]` (format, URL, changed date) |

The Genspark/Manus runs **report 10 Heilbronn-related catalog matches**, but this count is search- and date-dependent. Some examples reported: Kfz traffic/load, **Eco-Counter bicycle counts**, GTFS scheduled transit, EV charging, parking, station accessibility, track4science, e-scooters and bikesharing.

### 10.2 Specific resource families

| Data family | What you actually obtain | Useful entry point | Update and access method |
|---|---|---|---|
| **Eco-Counter bicycle counting** | Bicycle counts per counter by hour/day; *not* individual cyclist GPS | `https://mobidata-bw.de/daten/eco-counter/v2/fahrradzaehler_stundenwerten.csv` (REPORTED working); alternate `.json` | Static-looking file regenerated periodically; one report observed `Last-Modified 2026-10-28 06:16 UTC`, **not** guaranteed schedule; check headers |
| **GTFS schedules** | Stops, routes, trips, shapes, calendar in ZIP | Discover current resource URLs via CKAN `package_show` | Timetable/static files reissued at operator-specific cadence; report suggested weekly for some feeds |
| **GBFS shared bikes and scooters** | Station locations, vehicle availability, vehicle types, system metadata | `https://api.mobidata-bw.de/sharing/gbfs/v3/manifest.json` (public manifest accessible); `https://api.mobidata-bw.de/sharing/gbfs` directory | Query feed's `last_updated`/`ttl`; **per provider** (often minutes), not a universal one-minute SLA |
| **Parking** | Locations, occupancy/availability when supplied | CKAN resource URLs; reported `https://api.mobidata-bw.de/park-api/api/public/datex2/json` | Live-ish per operator; DATEX II/API output format differs from CKAN |
| **EV charging** | Charging site coordinates, connectors, access, possibly current statuses | CKAN resource URLs; reported `https://api.mobidata-bw.de/ocpdb/api/ocpi/3.0/locations` | Location metadata vs operational status may have different cadences |
| **Geospatial WFS** | Feature layers (e.g. parking/chargers) | `https://api.mobidata-bw.de/geoserver/MobiData-BW/ows?service=WFS&request=GetCapabilities` | OGC XML capabilities, then `GetFeature` by type and bounding box |
| **GraphQL shared mobility** | Graph-query data (schema-dependent) | `https://api.mobidata-bw.de/sharing/graphql` | **POST**, not a GET file URL; GET reportedly returns 405; introspection/access needs checking |

**CKAN example:**

```python
import requests
catalog = requests.get('https://mobidata-bw.de/api/3/action/package_search',
                       params={'q':'heilbronn','rows':100},timeout=45).json()
for ds in catalog.get('result',{}).get('results',[]):
    print(ds.get('title'))
    for resource in ds.get('resources',[]):
        print('  ',resource.get('format'),resource.get('url'),resource.get('last_modified'))
```

**GBFS example:** start at manifest, choose system/version/language URLs, then load provider-specific `station_information`, `station_status`, or free-bike feeds **actually advertised by that provider**. Use `ttl` and `last_updated` as feed freshness indicators. **GTFS static is not a live bus-arrival feed**; for vehicle positions/real-time arrivals find an explicitly advertised GTFS-RT or comparable operator feed.

---

## 11. Bright Sky weather

**Documentation & exact API schema:** <https://api.brightsky.dev/openapi.json> (retrievable in this review); **base:** <https://api.brightsky.dev>. Bright Sky is a **public DWD data gateway without a key**, with **historical records starting 2010-01-01** according to its official OpenAPI description. This corrects an uploaded report's unsupported **“only two years”** assertion.

| GET route | Main content | Required selection | Example |
|---|---|---|---|
| `/current_weather` | Best-effort current SYNOP-derived conditions | `lat`+`lon` or station ID | `/current_weather?lat=49.1427&lon=9.2109` |
| `/weather` | Hourly weather observations **and/or forecasts** | `date` (required), lat/lon or station, optional `last_date` | `/weather?lat=49.1427&lon=9.2109&date=2026-10-01&last_date=2026-10-03` |
| `/sources` | Nearby source/station metadata and distances | lat/lon or source/station ID | `/sources?lat=49.1427&lon=9.2109` |
| `/radar` | Radar precipitation composite | documented query parameters vary | Consult OpenAPI |
| `/alerts` | DWD weather alerts | area/time parameters per OpenAPI | Consult OpenAPI |
| `/solar` | Radiation observations | documented parameters per OpenAPI | Consult OpenAPI |
| `/openapi.json` | Complete endpoint types, fields, limits and error responses | none | `/openapi.json` |

### Weather fields and interpretation

The response contains `weather[]` and `sources[]` (exact nesting/fields per OpenAPI). Typical hourly values include `timestamp`, `temperature`, `relative_humidity`, `precipitation`, `wind_speed`, `wind_direction`, `pressure_msl`, `cloud_cover`, `sunshine`, and availability/source flags. Observations may be missing for some hours/sensors. The current endpoint reflects *recent*, not instantaneous, DWD SYNOP observations; official docs describe a **best-effort ~1.5-hour lookback** for current conditions. Weather station/sources are near coordinates, not identical to the on-bike sensor location.

```bash
curl -L 'https://api.brightsky.dev/current_weather?lat=49.1427&lon=9.2109'
curl -L 'https://api.brightsky.dev/weather?lat=49.1427&lon=9.2109&date=2026-10-01&last_date=2026-10-02'
curl -L 'https://api.brightsky.dev/sources?lat=49.1427&lon=9.2109'
```

**Refresh:** observational cadence is generally hourly for `/weather`; source ingest varies and no universal 60-minute freshness guarantee is promised. Read returned timestamps and station source references. Use `date` + `last_date` (not the Gemini/Qwen assumption `first_date` as universal). Historical queries before 2010 are outside official service coverage even though DWD raw files may be older.

---

## 12. DWD Open Data

**Source:** <https://opendata.dwd.de/>. DWD is the **authoritative file publisher** behind much German meteorological data. Its HTTP directory tree offers compressed station files, metadata, forecasts, radar and more; it **is not one GET JSON API**.

### 12.1 Typical station archive paths

```text
https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/air_temperature/recent/
https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/air_temperature/historical/
https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/precipitation/recent/
https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/10_minutes/air_temperature/recent/
https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/daily/kl/recent/
```

Directory listings (including the hourly temperature **recent** directory) were accessible in this review. Identify the exact station ID using the parameter's **station-description file**; do not infer it solely from city name. The Genspark report identified **`03734` (Obersulm-Willsbach)** as an approximately 10 km station, and nearby `06245`, `04349`, `03761`. **Station distances and availability were not independently recalculated** here.

### 12.2 How to choose and read a ZIP

- File names usually include **resolution/variable, station ID, period, and `hist` or `akt`**; e.g. `stundenwerte_TU_03734_..._hist.zip` or `stundenwerte_TU_03734_akt.zip` (**exact current filename must be copied from directory listing**).
- Inside ZIP are text/CSV-like semicolon-delimited measurements plus product descriptions and timestamps; fields commonly include `STATIONS_ID`, `MESS_DATUM` and meteorological parameter columns. Consult the included variable documentation for units, missing value sentinels (often `-999`) and quality flags.
- To obtain the longest span, download **all relevant `historical/` + `recent/` archives** for the chosen variable and station. **Merge, deduplicate and use documented station operating dates**; archives can overlap.
- `akt` / recent products are periodically refreshed; `hist` packages are released/revised on their own schedule. A “10-minute” product describes **record granularity**, not its download publication frequency.

```bash
# Browse with a browser, copy a real .zip URL from the directory, then:
curl -fL 'PASTE_EXACT_DWD_ZIP_URL_HERE' -o dwd_station.zip
unzip -l dwd_station.zip
```

Weather warnings/forecast/radar products live under `/weather/` with distinct update cycles and often GRIB/other scientific formats. No single DWD download provides *every* source worldwide or every historic period.

---

## 13. Open-Meteo weather and air quality

**Portal/docs:** <https://open-meteo.com/en/docs> · [Historical weather docs](https://open-meteo.com/en/docs/historical-weather-api) · [Air quality docs](https://open-meteo.com/en/docs/air-quality-api). **Model-produced data** are distinct from raw road-side or DWD station measurements. Rates/licensing depend on usage tier and purpose.

### 13.1 Correct hosts and examples

| Endpoint | Product / timespan | Example parameters | Refresh behavior |
|---|---|---|---|
| `https://api.open-meteo.com/v1/forecast` | Current/next-days model weather | `latitude`, `longitude`, `current`, `hourly`, `daily`, `timezone` | Forecast model dependent; several runs per day |
| `https://archive-api.open-meteo.com/v1/archive` | Historical weather/reanalysis (**ERA5 from 1940**, ERA5-Land from 1950) | `latitude`, `longitude`, `start_date`, `end_date`, `hourly`, optional `models` | ERA5 daily with ~5-day delay (official documentation); model-specific |
| `https://air-quality-api.open-meteo.com/v1/air-quality` | Modeled pollutant and pollen forecasts/historic model periods | `latitude`, `longitude`, `hourly=pm10,pm2_5,nitrogen_dioxide`, `start_date`, `end_date` where covered | CAMS Europe forecast about daily; CAMS global about 12h; archive coverage **depends on model** |
| `https://api.open-meteo.com/v1/elevation` | Approximate terrain elevation | `latitude`, `longitude` | Static grid, revision dependent |

**Important correction:** `https://api.open-meteo.com/v1/archive` is **not the canonical historical-weather host**; use `archive-api.open-meteo.com`. Air-quality **modeled reanalysis** coverage differs by dataset; official air-quality docs list **CAMS European reanalysis from 2013**, Europe forecasts from Oct 2023 and global forecasts from Aug 2022. Therefore claims that every air-quality variable has a continuous 1940 or 2015 archive are **wrong without choosing a supported model**.

### 13.2 Useful fields and units

| Product | Example data keys | Unit/meaning |
|---|---|---|
| Weather hourly | `temperature_2m`, `relative_humidity_2m`, `precipitation`, `wind_speed_10m`, `pressure_msl`, `shortwave_radiation` | °C, %, mm preceding hour, km/h by default, hPa, W/m² |
| Daily aggregations | `temperature_2m_max`, `temperature_2m_min`, `precipitation_sum`, `sunshine_duration` | °C, °C, mm/day, seconds/day |
| Air quality hourly | `pm10`, `pm2_5`, `nitrogen_dioxide`, `ozone`, `european_aqi` | µg/m³ for pollutants, dimensionless AQI |
| Forecast/current | `current`, `hourly`, `hourly_units`, `timezone`, `utc_offset_seconds` | parallel arrays keyed by `time`; each variable has its own units entry |

```bash
# Forecast at Heilbronn coordinates
curl -G 'https://api.open-meteo.com/v1/forecast' \
 --data-urlencode 'latitude=49.1427' --data-urlencode 'longitude=9.2109' \
 --data-urlencode 'current=temperature_2m,wind_speed_10m' \
 --data-urlencode 'hourly=temperature_2m,relative_humidity_2m,precipitation' \
 --data-urlencode 'timezone=Europe/Berlin'

# Historical ERA5 weather (do not use future end_date)
curl -G 'https://archive-api.open-meteo.com/v1/archive' \
 --data-urlencode 'latitude=49.1427' --data-urlencode 'longitude=9.2109' \
 --data-urlencode 'start_date=2025-01-01' --data-urlencode 'end_date=2025-01-31' \
 --data-urlencode 'hourly=temperature_2m,relative_humidity_2m,precipitation' \
 --data-urlencode 'models=era5' --data-urlencode 'timezone=Europe/Berlin'
```

**Timestamp caution:** docs warn that the returned `utc_offset_seconds` can be a fixed offset even over ranges crossing DST; for exact historical local-time joins prefer `timeformat=unixtime` and convert with a timezone-aware library.

**Archive vs real sensors:** API modeled PM2.5 is not the same as a physical bike PM sensor; spatial resolution can be several kilometers. Treat Open-Meteo as weather/air pollution context, not verification of street-level exposure.

---

## 14. GovData Germany

**Site:** <https://www.govdata.de/> — German national **metadata aggregator** of government datasets. It indexes many other portals including state and municipality sources, and does not expose a magical “download every Heilbronn measurement” endpoint.

| Endpoint | Role | Evidence |
|---|---|---|
| `https://www.govdata.de/` | Public search, filters by topic, geography, publisher | Verified accessible |
| `https://ckan.govdata.de/api/3/action/package_search?q=heilbronn&rows=100` | Machine-readable catalog search | Genspark **REPORTS working**, not independently fetched here |
| `https://ckan.govdata.de/api/3/action/package_show?id={dataset_id}` | Dataset metadata, distribution URLs | CKAN action pattern; **verify current backend behavior** |
| `https://www.govdata.de/api/3/action/package_search` | Sometimes incorrectly assumed API | Genspark **REPORTS 404**; use separate host where confirmed |

**Workflow:** search `Heilbronn` + relevant topic → inspect dataset publisher and spatial/temporal coverage → follow its **distribution's actual URL** → read that file's license and publication dates. Some data overlap OpenData Heilbronn, MobiData or DWD. Deduplicate by source/distribution identifier; count public metadata and actual observation files separately.

**Update:** harvesting occurs on a schedule set by GovData/publisher, but each dataset has its own observation period and `modified`. Treat “daily synchronization” statements in uploaded reports as **unverified universal SLA**.

---

## 15. Additional openSenseMap direct API

openSenseMap is the upstream senseBox ecosystem. **API:** <https://api.opensensemap.org> · [Docs](https://docs.opensensemap.org/). Useful mainly for **station identity, coordinates, sensor inventory and last upload**, even if you obtain the high-volume measurements from ATRAI.

| Endpoint pattern | Use | Status / nuance |
|---|---|---|
| `GET /boxes?grouptag=heilbronn` | Find boxes tagged Heilbronn | Genspark **REPORTED** 49 boxes at snapshot time |
| `GET /boxes?near=9.2109,49.1427,20000` | Nearby boxes (longitude,latitude,radius) | Genspark **REPORTED** 21 within 20 km; query syntax should be checked against current docs |
| `GET /boxes/{boxId}` | Detailed metadata for box | Documented API family |
| `GET /boxes/{boxId}/sensors` | Sensors and latest values for box | Documented API family |
| `GET /boxes/{boxId}/sensors/{sensorId}` | One sensor's latest record | Documented API family |
| `GET /boxes/{boxId}/data/{sensorId}?from-date=...&to-date=...` | Historical measurements of one sensor | Docs/policy vary, may time out; use bounded periods |
| `GET /boxes/{boxId}/locations` | Location history of mobile box | Availability depends on box |
| `GET /boxes/{boxId}/data` | **Do not assume** full-box export | Genspark reports HTTP **405** for GET on this path |

**Observation fields:** box/sensor identifiers, sensor title/unit and latest timestamp (`lastMeasurement.createdAt`), sensor-specific value. Units vary. **Refresh:** per device, check `lastMeasurement`; some reported sensors send every ~30–60 seconds but no uniform promise. Direct openSenseMap high-volume export may be slow/limited. Falling back to ATRAI is a pragmatic mirror, **not a claim of identical completeness/retention**.

---

## 16. Update-frequency and freshness handbook

Use four distinct timestamps **whenever available**: `observed_at`, `ingested_at`, `dataset_generated_at`, and `retrieved_at`. Only infer what each one means from its actual provider schema.

| Source | Record resolution / measurement interval | API or file publication | Dashboard refresh | Trustworthy freshness test |
|---|---|---|---|---|
| ATRAI bike raw | Varies by device/ride | New uploads; processing delay **not specified** | n/a | Max `createdAt` for city after filter |
| ATRAI derived city layers | Segment/event aggregation, not fixed time series | Periodic ingest/build, interval unknown | n/a | `statistics.updatedAt` if present, or campaign end + page timestamps |
| ATRAI home | Sensor/device dependent | Upload-driven, no common schedule | n/a | Max `createdAt` per `boxId` |
| re:edu heat walk ZIP | Sampling times inside CSV | Manual uploads; no published SLA | n/a | ZIP/file modified time + latest CSV sample timestamp |
| Birdiary | Bird event on occurrence; environmental device cadence | Station uploads; no network-wide SLA | n/a | `lastMovement.start_date` / latest environment reading |
| BeeHappy | Unknown: do not infer from panels | Raw DB cadence unavailable to anonymous users | **15 minutes** configured by URL | Data-point timestamps inside accessible panel/CSV |
| Beehive labelled videos | Event/session dates | Manual static share updates | n/a | File mtime + session recording timestamps |
| OpenData Heilbronn | Dataset specific | Annual to intermittent; may vary | n/a | DCAT `modified`, file metadata |
| Smart City Data Library | API/product specific | Unknown without product access | n/a | Published product metadata once subscribed |
| MobiData GBFS | Provider-specific, current-status events | `ttl`/`last_updated` in feed | n/a | Manifest/feed timestamps |
| MobiData counters | Hourly/daily counts in reported resources | File regenerated periodically, exact interval unproven | n/a | `Last-Modified` and last counter timestamp |
| MobiData GTFS | Timetable schedule | Operator release cycle, possibly weekly | n/a | Feed `feed_info` / dataset modified date |
| Bright Sky hourly | Typically hourly | DWD ingest, varies | n/a | `timestamp` and `sources[]`; current uses recent SYNOP |
| DWD 10-min/hourly/daily | Product name reflects record resolution | `recent` refreshed per product; `historical` periodic | n/a | Filename date range, directory timestamps, file records |
| Open-Meteo forecast | Hourly or model native | Model update varies (often multiple/day) | n/a | Model run/time or requested forecast issued time if supplied |
| Open-Meteo ERA5 | Hourly | **Daily, ~5-day lag** officially documented | n/a | Last available archive date |
| Open-Meteo air quality | Hourly/3-hourly model variables | CAMS region/model dependent | n/a | Requested model coverage and current timestamps |
| GovData | Publisher dataset | Harvest + publisher schedules | n/a | `modified` + actual distribution date |
| openSenseMap | Device-specific; some fast sensors | Device upload | n/a | `lastMeasurement.createdAt` |

**Never label an API “realtime” solely because it responds `200`, or “stale” solely because the latest campaign ride finished two days ago.** Devices may be inactive; archives may be intentionally fixed; dataset build times can lag observations.

---

## 17. Copy-and-run recipes

### 17.1 Install prerequisites

```bash
python -m pip install requests pandas
```

### 17.2 Generic HTTP response inspection

```python
import requests
url = "https://api.atrai.bike/collections"
r = requests.get(url, timeout=45)
print("HTTP",r.status_code,"type",r.headers.get("Content-Type"),
      "last-modified",r.headers.get("Last-Modified"),"bytes",len(r.content))
r.raise_for_status()
print(str(r.json())[:1000])
```

### 17.3 Quick query templates by scenario

| Goal | Request / approach | Critical filter |
|---|---|---|
| Display roughest Heilbronn segments | ATRAI `bumpy_roads_heilbronn/items?limit=1000&offset=0` and page | `Normalized Roughness`, line geometry |
| Overtaking hotspot overlay | ATRAI `danger_zones_heilbronn/items` | Risk index, confidence interpretation |
| Road + PM composite hazard | ATRAI `danger_zones_PM_heilbronn/items` | Account for humidity filtering / weighting |
| Compare average cyclist speeds | ATRAI `speed_map_heilbronn/items` | `avg_speed[km/h]`, observation counts |
| Map complete rides | ATRAI `tracks/items` | `groupTags` **contains** `heilbronn` |
| Home temperature station trend | ATRAI `osem_home_data_heilbronn/items` | `boxId`, `createdAt`, temperature field if present |
| Bird detections near Heilbronn | Birdiary `/station` → local radius filter → `/movement/{id}` | Station geography, `start_date`, detection score |
| Hive vs outside temperature | BeeHappy panel | Requires readable panel or session export; cannot assume raw API |
| Bikes counted per hour | MobiData Eco-Counter hourly CSV | Counter ID, local hour, missing values |
| Current weather | Bright Sky `/current_weather?lat=...&lon=...` | Returned source station and observation time |
| 2025 weather baseline | Open-Meteo archive `start_date=2025-01-01&end_date=2025-12-31` | Choose one consistent `models` option |
| Old DWD station observations | DWD climate hourly/daily historical ZIPs | Station ID, variable code and timeframe |
| City district boundaries | OpenData Heilbronn catalog distributions | Find GeoJSON/Shapefile and license |

### 17.4 Standard quality-control checklist

1. **Identify granularity:** a bird visit, a sensor sample, a street segment, a ride, a counter/hour, or a weather model grid cell?
2. **Check place:** Heilbronn vs other cities; actual geospatial coordinates; global station arrays need radius filter.
3. **Check time:** event time vs upload time vs model issue time vs query time; timezone and DST.
4. **Check fields and units:** sensor units/optional fields; DWD missing-value coding; GBFS and CKAN schemas are not interchangeable.
5. **Check completeness:** `numberMatched` vs pages downloaded; data dropout, missing sensor periods, overlapping DWD ZIPs.
6. **Check provenance/licensing/privacy:** sensor/device sources, public licenses, potential location sensitivity; avoid deanonymizing individual cyclists.
7. **Record freshness:** response timestamp, latest data timestamp, last modified header and run manifest.
8. **Retry gracefully:** timeouts, 429 responses and server errors; use sensible request rates and checkpoint large downloads.

---

## 18. Unreachable, restricted, unverified and known failures

These are **specific items** rather than a sweeping claim that the whole hackathon is down.

| Item / URL | Label | Reason / what to do |
|---|---|---|
| `https://hackathon.greencity.hn/resources` | **INTERMITTENT IN THIS TOOL** | Bike guide reachable; materials index sometimes produces a browsing error. User's link list and official bike guide anchor the inventory. |
| ATRAI `GET /collections/{name}/items` | **UNREACHABLE HERE; documented** | Catalog and campaign summary reachable, individual sample GET not returned through browsing environment. Try client `curl`/Python with small page, not `limit=0`. |
| Heat Island Nextcloud `.../X9x2.../download` | **UNREACHABLE HERE; candidate download** | Nextcloud share landing page loads JS shell; direct archive couldn't be verified in browser. Agent Genspark reports success. Check content-type/ZIP signature on your machine. |
| Hive video Nextcloud `.../YkH.../download` | **UNREACHABLE HERE; candidate download** | Same Nextcloud limitation; reported 496.7 MB archive unverified by this review. |
| `https://wiediversistmeingarten.org/api/station` | **UNREACHABLE HERE; documented** | Official raw starter notebook verifies routes; live API response not obtained here. |
| Birdiary `/statistics/{station_id}` | **PARTIAL; reported server errors** | Manus reported HTTP 500 for five station IDs; retry/backoff and mark individual stations failed rather than silently omitting them. |
| BeeHappy dashboard raw PostgreSQL / Grafana `/api/ds/query` | **ACCESS RESTRICTED / UNVERIFIED PUBLIC** | Public dashboard JSON does not prove data source access. Need panel view/export or valid Grafana auth. Grafana query typically uses POST, not GET. |
| Smart City Data Library anonymous data | **NO VERIFIED OPEN ENDPOINT** | Public registration portal; consult product listing/access process. |
| OpenData Heilbronn `/api/3/action/*` | **PROBABLY INVALID** | Genspark reports 404; city portal reported as DKAN. Verify `/data.json` before attempting catalog extraction. |
| OpenData Heilbronn `/data.json`, `/catalog.xml` | **UNREACHABLE HERE; reported** | Other agents disagreed on working catalog. Retry both; test content type/structure. |
| MobiData BW catalog `package_search` | **UNREACHABLE HERE; reported** | Two agents report it working; use `curl -G` from local client and check CKAN JSON `success`. |
| MobiData GraphQL GET | **WRONG METHOD (405 reported)** | GraphQL data is generally retrieved using POST with JSON `query`; do not treat GET as a downloadable catalog file. |
| `https://ckan.govdata.de/api/3/action/package_search` | **UNREACHABLE HERE; reported** | Genspark reports working; GovData main site accessible. Confirm host live before automation. |
| `https://api.opensensemap.org/boxes/{boxId}/data` | **405 reported** | Use documented per-sensor time-series paths or ATRAI data mirror; do not assume entire box path supports GET. |
| `https://api.brightsky.dev/dwd_stations` | **INVALID (404 reported)** | Use Bright Sky `/sources` with coordinates instead. |
| `https://api.open-meteo.com/v1/archive` | **INCORRECT HOST** | Correct historical endpoint is `https://archive-api.open-meteo.com/v1/archive`. |
| `https://www.govdata.de/api/3/action/*` | **INVALID on front-end (404 reported)** | Backend reported separately at `ckan.govdata.de`. |
| Portal claims of one “all-time download” | **NOT A SINGLE ENDPOINT** | Need to discover each distribution/file/feed; mixed licensing, large volume and retention policies. |
| Birdiary station availability in Heilbronn | **CONFLICTING/UNVERIFIED** | Genspark reports no nearby public stations; starter notebook assumes possible local station. Check fresh `/station` coordinates. |

**Error nomenclature:** “unreachable here” means **this execution environment did not retrieve it**, not proof the host is offline; “access restricted” means a known auth/access boundary; “invalid” means a likely incorrect path or method. Do not label a valid-but-404/private route as a source-level outage.

---

## 19. Six-report comparison and corrections

### 19.1 Reports examined

| Report | Strongest useful contribution | Main caveats |
|---|---|---|
| **Gemini** — `greencity_hackathon_data_documentation_gemini.md` | Broad 13-link inventory; Nextcloud and weather examples | **Mislabels `osem_home_data_heilbronn` as bike data**; asserts universal hourly updates, universal CKAN portals, and `bbox`/`datetime` without proving support |
| **Manus** — `greencity_live_data_Manus.md` | Per-station Birdiary and multiple MobiData subservices; reports collection counts and failures | Claims accompanying ZIP downloaded but **only Markdown was uploaded here**; some exact contents/results cannot be audited; OpenData `catalog.xml` vs `data.json` disagreement |
| **Qwen** — `Qwen_markdown_20261028_jaquyieoq_Qwen.md` | Succinct classification and starter paths | Historical Open-Meteo host incorrectly under `api.open-meteo.com`; CKAN route claimed for DKAN Heilbronn; over-generalized access restrictions |
| **Genspark** — `GREEN_CITY_Heilbronn_Live_Data_Documentation_Genspark.md` | Most detailed per-collection/field and apparent HTTP tests; DWD nearest-station and Nextcloud archive contents | Files/HTTP logs not attached; **Bright Sky 2-year claim conflicts with official 2010 coverage**; `eval` should **never** be used for untrusted Python-literal text; some single-run timing statements are too broad |
| **Perplexity** — `LIVE_DATA_Perplexity.md` | Concise ATRAI, source map and pagination guide | Omits Birdiary routes, derived-field detail, source-specific update verification and restrictions; links to raw notebook only |
| **Claude** — `GREENCITY_DATA_ENDPOINTS_Claude.md` | Clearly separates documented vs unverified and includes failure caveats | Explicitly did not execute source requests; suggestions like generic Nextcloud WebDAV, portaled CKAN routes and air-quality scope are **hypotheses**, not verified endpoints |

### 19.2 Resolved conflicts and confidence

| Conflicting statement | Resolution | Confidence basis |
|---|---|---|
| `osem_home_data_heilbronn` is bike measurements | **No**: stationary senseBox:home per Materials card; `osem_bike_data` is bike samples | Exact user-supplied API URL + source card names + ATRAI catalog |
| Heilbronn city catalog is CKAN | **Do not assume**: Genspark reports DKAN/DCAT `data.json`, CKAN action 404; Manus says `catalog.xml` | Disputed live catalog; both candidate paths documented and labelled |
| Bright Sky history only ~2 years | **Incorrect as product documentation:** official Bright Sky says back to **2010-01-01** | Official OpenAPI accessible in this review |
| Open-Meteo archive at `/v1/archive` on forecast host | Use **`archive-api.open-meteo.com/v1/archive`** | Official historical documentation |
| BeeHappy refresh=15m implies samples every 15m | **False**: only dashboard interval is known | URL parameter semantics |
| Birdiary has no public routes | Official notebook explicitly lists **five routes**, plus media paths | Official raw notebook inspected |
| `statistics` field is JSON | Official bike guide says **Python-syntax string** | Official guide; parse only with a safe parser, not `eval` |
| All 45 ATRAI datasets are Heilbronn-specific | **False**: 8 families × 5 cities plus 5 special/global collections | Catalog directly fetched |
| “All historical data already downloaded” | **Not demonstrated by six `.md` uploads** | Only text reports were provided; no purported ZIPs/raw response manifests to inspect |
| A 200 portal response implies data is anonymously queryable | **False**: portal access, API product registration and raw data access are separate | Per-service access descriptions |

**Safe parsing of `statistics`:** only after checking the field is a plain literal and validating type/size: `ast.literal_eval(value)` (still use size limits). **Never call `eval`** on external data. Better yet, treat it as opaque text if you don't need the per-city structure.

---

## 20. Source provenance and verification methodology

### 20.1 Primary links and cross-checks

1. [Hackathon Materials page](https://hackathon.greencity.hn/resources) — six top-level cards.
2. [Official senseBox:bike guide](https://hackathon.greencity.hn/resources/bike-data) — dataset/field definitions, geometry, parameters, formulas and campaigns; **available during this review**.
3. [ATRAI collection catalog](https://api.atrai.bike/collections) — **45 collection names directly retrieved**.
4. [ATRAI Heilbronn campaign](https://api.atrai.bike/campaigns/heilbronn) — direct summary response.
5. [Official Birdiary notebook raw](https://raw.githubusercontent.com/reedu-reengineering-education/Heilbronn-Hacksite/main/public/birdiary_starter.ipynb) — **inspected**; route and field examples.
6. [Bird Diary project](https://wiediversistmeingarten.org/) — public project and station map.
7. [Bright Sky OpenAPI](https://api.brightsky.dev/openapi.json) — **inspected**; history starts 2010, endpoints/parameters/units.
8. [Open-Meteo historical weather docs](https://open-meteo.com/en/docs/historical-weather-api) — **inspected**; hosts, model spans, ERA5 lag and unit definitions.
9. [Open-Meteo air-quality docs](https://open-meteo.com/en/docs/air-quality-api) — **inspected**; pollutant variables, CAMS availability/cadences.
10. [DWD hourly-air-temperature recent directory](https://opendata.dwd.de/climate_environment/CDC/observations_germany/climate/hourly/air_temperature/recent/) — **accessible**.
11. [MobiData BW GBFS v3 manifest](https://api.mobidata-bw.de/sharing/gbfs/v3/manifest.json) — **accessible**; specifics of providers must still be followed.
12. [GovData front-end](https://www.govdata.de/) — **accessible** public catalog.
13. [re:edu share X](https://cloud.reedu.de/s/X9x2XE9a9xCxLm8) and [share Y](https://cloud.reedu.de/s/YkHckREGAM89z9m) — browser pages show JavaScript app shell; downloadable contents **not independently examined**.
14. [Smart City data library](https://data-library.smartcity.hn/) — portal reached but no anonymous raw data route established.

### 20.2 Method and limitations

This documentation cross-read **six uploaded Markdown reports** and inspected selected official website/API documentation using publicly accessible retrieval. **No raw ZIP/data archives or HTTP manifests from the six agents were uploaded**. This environment cannot make normal outbound requests from Python/terminal and browsing tools sometimes fail on API JSON or large/binary files. Therefore independent **download-size, per-file checksums, 1M-row raw response counts, CSV column schemas for archives, and per-station media availability were not verified**. Claims of successful downloads in uploaded reports are preserved with an explicit **REPORTED** label, never silently promoted to direct verification.

### 20.3 Suggested machine-consumable conventions

When you implement a collector, write a manifest record per source and run:

```json
{
  "source_id": "atrai_osem_home_data_heilbronn",
  "url": "https://api.atrai.bike/collections/osem_home_data_heilbronn/items",
  "retrieved_at_utc": "<timestamp at runtime>",
  "http_status": "<integer or error>",
  "content_type": "application/geo+json (verify)",
  "number_matched_reported": "<response field or null>",
  "rows_downloaded": "<count>",
  "earliest_observed_at": "<timestamp or null>",
  "latest_observed_at": "<timestamp or null>",
  "sha256": "<hash of saved bytes>",
  "status": "SUCCESS | PARTIAL | UNREACHABLE | RESTRICTED",
  "license_url": "<source distribution license or null>"
}
```

A source may be missing because it never recorded observations, was offline, is private, or the query failed — **these are different failure modes**. Treat this guide as a reproducible starting reference and run small probe requests before any full export.


## Appendix A. Machine-readable endpoint inventory and the complete 45 ATRAI collections

A companion CSV named **`GREENCITY_HEILBRONN_ENDPOINT_CATALOG_2026-10-28.csv`** lists each concrete route, record granularity, example fields, update cadence, and verification level. The **45 ATRAI collections** are expanded into literal request URLs, not only a `{name}` template. There are **8 city-specific families per five city tags (40)** and **five other collections**. For a current catalog, always repeat `GET /collections`; these names are a snapshot as of 2026-10-28.

| City tag | Valid suffix | Meaning |
|---|---|---|
| `heilbronn` | `_heilbronn` | Heilbronn, Germany |
| `arnsberg` | `_arnsberg` | Arnsberg, Germany |
| `muenster` | `_muenster` | Münster, Germany |
| `lauds_26` | `_lauds_26` | Nancy, France campaign tag |
| `saopaulo` | `_saopaulo` | São Paulo, Brazil |

**Complete 45 names (copied from returned catalog):**

```text
bike_road_network_arnsberg
bike_road_network_heilbronn
bike_road_network_lauds_26
bike_road_network_muenster
bike_road_network_saopaulo
bumpy_roads_arnsberg
bumpy_roads_heilbronn
bumpy_roads_lauds_26
bumpy_roads_muenster
bumpy_roads_saopaulo
danger_zones_PM_arnsberg
danger_zones_PM_heilbronn
danger_zones_PM_lauds_26
danger_zones_PM_muenster
danger_zones_PM_saopaulo
danger_zones_arnsberg
danger_zones_heilbronn
danger_zones_lauds_26
danger_zones_muenster
danger_zones_saopaulo
osem_bike_data
osem_home_data_heilbronn
overtaking_distance_arnsberg
overtaking_distance_heilbronn
overtaking_distance_lauds_26
overtaking_distance_muenster
overtaking_distance_saopaulo
road_network_arnsberg
road_network_heilbronn
road_network_lauds_26
road_network_muenster
road_network_saopaulo
speed_map_arnsberg
speed_map_heilbronn
speed_map_lauds_26
speed_map_muenster
speed_map_saopaulo
statistics
track_points
tracks
traffic_flow_arnsberg
traffic_flow_heilbronn
traffic_flow_lauds_26
traffic_flow_muenster
traffic_flow_saopaulo
```

---

**End of reference — 2026-10-28.**
