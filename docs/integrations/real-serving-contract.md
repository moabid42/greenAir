# Real serving contract and missing values

Core day fields now accept explicit nulls. Null means absent/unusable input; zero
remains an actual numeric value. Factor scores accept null independently, so missing
traffic and safety do not become invented defaults. Sport weights stay in the client.
Each hour can carry actual UTC instants, missing-channel names and per-channel
source kind, valid times, retrieval/issue times, raw references, units and QC flags.
The public day retains 24 Berlin wall-clock slots; exact source instants make DST
gaps/repeated hours traceable. Provider selection is implemented in the next commit.

Day/grid/sensor provenance accepts mock, forecast (model output), measured, mixed or
unavailable. Day metadata includes build/retrieval times, partial/stale status and
attribution. Grids can be explicitly disabled with no features and an unavailable
status/message. Sensors retain indoor/outdoor exposure, per-channel provenance and
staleness. Dynamic OpenAPI derives these contracts from the actual models.

The frontend formats missing raw values as an em dash or No data, draws missing
hours neutrally, and excludes missing core weather/air hours from recommendations.
Internal unavailable scores use NaN only as a client calculation sentinel; API JSON
uses null, and display/chart/recommendation boundaries handle it explicitly. Missing
traffic never becomes Quiet. Analytics/Coach omit unavailable values from ranges;
no-data sensor or day requests do not silently fall back to dummy data. Date changes
clear old map/sensor data and cancel outdated sensor fetches. Offline demo mode now
uses consistently synthetic inputs instead of mixing live browser weather with
invented air values. Backend-provided grids are never replaced by synthetic ones.

Validation: backend nullable/OpenAPI tests plus existing API checks; frontend core
tests check that daylight-only missing hours cannot produce recommendations, zero
stays numeric, and partial windows exclude gaps. `just check-web` includes these
checks plus lint/type-check/build; CI already calls the same recipe. Real provider
projection and browser verification remain subsequent requirements.
