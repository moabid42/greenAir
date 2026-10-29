"""Read-only projection of persisted real results; no upstream or dummy fallback."""

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from statistics import fmean

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from app.processing.snapshots import BERLIN
from app.schemas.observations import Observation
from app.schemas.serving import (
    ChannelProvenance,
    DayForecast,
    Factors,
    GridCells,
    GridResponse,
    HourConditions,
    ScoreSnapshot,
    Sensor,
    ServiceStatus,
)
from app.schemas.snapshots import DayResult, SensorResult
from app.schemas.spatial import SPATIAL_VERSION, SpatialResult
from app.scoring.engine import solar_elevation_deg
from app.serving.errors import ServingDataError
from app.serving.spatial import (
    project_best,
    project_detail,
    project_grid,
    project_scores,
    segment_features,
)
from app.storage import models as db
from app.storage.results import ResultRepository

FIELDS = {
    "temperature": "tempC",
    "relative_humidity": "humidity",
    "pm2_5": "pm25",
    "no2": "no2",
    "wind_speed": "windKmh",
}
SENSOR_FIELDS = {
    "temperature": "Temperature",
    "relative_humidity": "Humidity",
    "pm2_5": "PM2.5",
    "pm10": "PM10",
    "pm1": "PM1",
    "pm4": "PM4",
    "no2": "NO2",
    "o3": "O3",
    "wind_speed": "Wind",
    "pressure": "Pressure",
    "uv_index": "UV Index",
}


def provenance(items: list[Observation], unit: str) -> ChannelProvenance:
    return ChannelProvenance(
        source_id=items[0].source,
        kind=items[0].kind,
        observed_at=sorted({o.observed_at for o in items}),
        retrieved_at=max((o.retrieved_at for o in items if o.retrieved_at), default=None),
        issued_at=items[0].issued_at if len({o.issued_at for o in items}) == 1 else None,
        raw_refs=sorted({o.raw_ref for o in items if o.raw_ref}),
        unit=unit,
        method="mean_of_actual_utc_instants"
        if len({o.observed_at for o in items}) > 1
        else "source_value",
        qc_flags=sorted({str(flag) for o in items for flag in o.qc_flags}),
    )


def factors(values):
    temp, rh, pm, no2, wind = (values[k] for k in ["tempC", "humidity", "pm25", "no2", "windKmh"])
    # Core frontend factor formulas; sport weighting remains in the client.
    heat = None
    if temp is not None and rh is not None:
        perceived = temp + (rh - 60) * 0.1 if temp > 20 and rh > 60 else temp
        heat = max(0, min(100, 100 - max(0, perceived - 18) * 6.5 - max(0, 5 - perceived) * 5))
    air = (
        max(0, min(100, 100 - pm / 25 * 55 - no2 / 100 * 45))
        if pm is not None and no2 is not None
        else None
    )
    wind_score = max(0, min(100, 100 - max(0, wind - 15) * 3)) if wind is not None else None
    return Factors(heat=heat, air=air, wind=wind_score, traffic=None, light=None, safety=None)


class StoredRepository:
    source = "forecast"
    build_id = "stored-results-v1"

    def __init__(
        self,
        results: ResultRepository,
        *,
        clock=lambda: datetime.now(UTC),
        stale_after=timedelta(hours=3),
    ):
        self.results, self.clock, self.stale_after = results, clock, stale_after
        self.generated_at = clock()
        self._spatial_cache = None

    def _spatial(self):
        try:
            with self.results.engine.connect() as conn:
                identifier = conn.execute(
                    select(db.result_snapshot.c.build_id)
                    .where(
                        db.result_snapshot.c.resource_key == "spatial",
                        db.result_snapshot.c.schema_version == SPATIAL_VERSION,
                        db.result_snapshot.c.status != "UNAVAILABLE",
                    )
                    .order_by(
                        db.result_snapshot.c.built_at.desc(), db.result_snapshot.c.build_id.desc()
                    )
                    .limit(1)
                ).scalar_one_or_none()
            if identifier is None:
                return None
            cached = self._spatial_cache
            if cached is not None and cached[0].build_id == identifier:
                return cached
            snapshot = self.results.latest("spatial", version=SPATIAL_VERSION)
            cached = (snapshot, SpatialResult.model_validate(snapshot.payload))
            self._spatial_cache = cached
            return cached
        except SQLAlchemyError as exc:
            raise ServingDataError(
                "Stored spatial conditions are temporarily unavailable."
            ) from exc

    @property
    def spatial_source(self):
        return "mixed" if self._spatial() else "unavailable"

    def _load(self, key):
        try:
            snapshot = self.results.latest(key)
        except SQLAlchemyError as exc:
            raise ServingDataError("Stored conditions are temporarily unavailable.") from exc
        if snapshot is None:
            raise ServingDataError(
                "No stored data covers this resource. Refresh inputs or select an available date.",
                404,
            )
        return snapshot

    def day(self, selected: date) -> DayForecast:
        snapshot = self._load(f"days/{selected}")
        result = DayResult.model_validate(snapshot.payload)
        hours = []
        retrievals = []
        for hour in range(24):
            instants = [t for t in result.instants if t.astimezone(BERLIN).hour == hour]
            metadata, values = {}, {}
            for phenomenon, field in FIELDS.items():
                items = [
                    r.observation
                    for r in result.readings
                    if r.observation.kind == "model"
                    and r.observation.source
                    == ("openmeteo_aq" if phenomenon in {"pm2_5", "no2"} else "openmeteo_fcst")
                    and r.observation.phenomenon == phenomenon
                    and r.observation.observed_at in instants
                ]
                # A repeated hour needs usable values at both actual UTC instants.
                usable = [o for o in items if o.usable]
                complete = bool(instants) and {o.observed_at for o in usable} == set(instants)
                value = fmean(o.value for o in usable) if complete else None
                if field == "windKmh" and value is not None:
                    value *= 3.6
                values[field] = value
                if items:
                    metadata[field] = provenance(
                        items, "km/h" if field == "windKmh" else items[0].unit
                    )
                    retrievals.extend(o.retrieved_at for o in items if o.retrieved_at)
            daylight = (
                fmean(
                    float(
                        solar_elevation_deg(t + timedelta(minutes=30), (9.2109, 49.1427)) > -0.833
                    )
                    for t in instants
                )
                if instants
                else None
            )
            metadata["daylight"] = ChannelProvenance(
                source_id="solar-position",
                kind="derived",
                observed_at=instants,
                unit="fraction",
                method="approximate_solar_elevation_at_hour_midpoint",
            )
            factor_values = factors(values)
            factor_values.light = daylight * 100 if daylight is not None else None
            hours.append(
                HourConditions(
                    hour=hour,
                    **values,
                    rush=None,
                    daylight=daylight,
                    factors=factor_values,
                    instants=instants,
                    provenance=metadata,
                    missing=[k for k, v in values.items() if v is None]
                    + ["traffic", "safety"]
                    + (["light"] if daylight is None else []),
                )
            )
        retrieved = min(retrievals) if retrievals else None
        stale = retrieved is None or self.clock() - retrieved > self.stale_after
        if not any(
            h.temp_c is not None or h.pm25 is not None or h.wind_kmh is not None for h in hours
        ):
            raise ServingDataError(
                "No model conditions cover this date. Select a date with stored model data.", 404
            )
        return DayForecast(
            name=f"days/{selected}",
            date=selected,
            generated_at=snapshot.built_at,
            source="forecast",
            hours=hours,
            build_id=snapshot.build_id,
            retrieved_at=retrieved,
            status="stale" if stale else "partial",
            attribution=["Open-Meteo", "CAMS ENSEMBLE / Copernicus Atmosphere Monitoring Service"],
        )

    def grid(self, selected: date) -> GridResponse:
        spatial = self._spatial()
        if spatial:
            snapshot, result = spatial
            return project_grid(
                result,
                self.day(selected),
                snapshot.build_id,
                snapshot.built_at,
                factor_function=factors,
            )
        return GridResponse(
            name=f"grids/{selected}",
            date=selected,
            cell_size_m=250,
            source="unavailable",
            generated_at=self.clock(),
            cells=GridCells(features=[]),
            status="unavailable",
            message=(
                "Verified spatial layers are not connected yet. "
                "City models do not establish street-level observations."
            ),
        )

    def sensors(self) -> list[Sensor]:
        snapshot = self._load("sensors")
        result = SensorResult.model_validate(snapshot.payload)
        grouped = defaultdict(list)
        for reading in result.readings:
            o = reading.observation
            if (
                o.kind == "observation"
                and o.platform == "stationary"
                and (o.source == "osem" or o.source == "uba" or o.source.startswith("uba_"))
            ):
                grouped[(o.source.split("_")[0], o.station_id)].append(reading)
        sensors = []
        for (provider, station), readings in sorted(grouped.items()):
            latest, metadata = {}, {}
            by_channel = defaultdict(list)
            for r in readings:
                o = r.observation
                label = SENSOR_FIELDS.get(str(o.phenomenon), str(o.phenomenon))
                by_channel[label].append(o)
            for label, items in by_channel.items():
                # Retain parallel sensor identity; do not silently average their readings.
                for index, o in enumerate(sorted(items, key=lambda o: o.sensor_id or "")):
                    key = label if len(items) == 1 else f"{label} ({o.sensor_id or index + 1})"
                    latest[key] = o.value if o.usable else None
                    metadata[key] = provenance([o], o.unit)
            newest = max(r.observation.observed_at for r in readings)
            first = readings[0]
            identifier = f"{provider}-{station}"
            sensors.append(
                Sensor(
                    id=identifier,
                    resource_name=f"sensors/{identifier}",
                    name=first.station_name or station,
                    kind="lubw" if provider == "uba" else "sensebox_home",
                    lat=first.observation.latitude,
                    lng=first.observation.longitude,
                    latest=latest,
                    updated_at=newest,
                    source="measured",
                    exposure=first.exposure,
                    stale=any(
                        self.clock() - r.observation.observed_at
                        > (timedelta(hours=3) if provider == "uba" else timedelta(minutes=30))
                        for r in readings
                    ),
                    channel_provenance=metadata,
                )
            )
        return sensors

    def segment_collection(self):
        spatial = self._spatial()
        return (
            (segment_features(spatial[1]), spatial[0].build_id, "mixed")
            if spatial
            else ([], self.build_id, "unavailable")
        )

    def segments(self):
        return self.segment_collection()[0]

    def _street(self, segment_id):
        spatial = self._spatial()
        street = (
            next((s for s in spatial[1].streets if s.segment.segment_id == str(segment_id)), None)
            if spatial
            else None
        )
        if street is None:
            raise ServingDataError("No verified road geometry covers this segment.", 404)
        return spatial[0], street

    def detail(self, segment_id, profile, moment):
        snapshot, street = self._street(segment_id)
        day = self.day(moment.astimezone(BERLIN).date())
        if not any(moment in h.instants for h in day.hours):
            raise ServingDataError("No conditions cover this UTC hour.", 404)
        return project_detail(street, profile, moment, day, snapshot.build_id, clock=self.clock())

    def score_snapshot(self, profile, moment):
        spatial = self._spatial()
        if spatial is None:
            return ScoreSnapshot(
                profile=profile,
                t=moment.strftime("%Y-%m-%dT%H:00:00Z"),
                source="unavailable",
                version="unavailable",
                build_id=self.build_id,
                scores={},
            )
        day = self.day(moment.astimezone(BERLIN).date())
        if not any(moment in h.instants for h in day.hours):
            raise ServingDataError("No conditions cover this UTC hour.", 404)
        return project_scores(
            spatial[1], profile, moment, day, spatial[0].build_id, clock=self.clock()
        )

    def best_times(self, segment_id, profile, selected):
        snapshot, street = self._street(segment_id)
        return project_best(
            street, profile, selected, self.day(selected), snapshot.build_id, clock=self.clock()
        )

    def status(self) -> ServiceStatus:
        try:
            with self.results.engine.connect() as conn:
                dates = (
                    conn.execute(
                        select(db.result_snapshot.c.resource_key)
                        .where(
                            db.result_snapshot.c.resource_key.like("days/%"),
                            db.result_snapshot.c.status != "UNAVAILABLE",
                        )
                        .distinct()
                    )
                    .scalars()
                    .all()
                )
                watermarks = conn.execute(select(db.watermark)).mappings().all()
        except SQLAlchemyError as exc:
            raise ServingDataError("Stored conditions are temporarily unavailable.") from exc
        return ServiceStatus(
            source="mixed",
            build_id=self.build_id,
            generated_at=self.clock(),
            pipeline_connected=True,
            spatial_source=self.spatial_source,
            available_dates=sorted(date.fromisoformat(d[5:]) for d in dates),
            sources=[
                {
                    "id": r["source_id"],
                    "status": r["state"].get("_scheduler", {}).get("last_run_status", "unknown"),
                    "lastSuccessAt": r["last_success_at"].isoformat()
                    if r["last_success_at"]
                    else "",
                }
                for r in watermarks
            ],
        )
