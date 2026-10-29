"""Process persisted observations into versioned, UTC-based serving inputs."""

import hashlib
import json
from collections import Counter
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.ingestion.scheduler import source_lock
from app.processing.forecaster import model_series
from app.processing.ingested import project_observation
from app.processing.normalizer import quality_control
from app.processing.temporal import hourly_levels
from app.schemas.observation import utc
from app.schemas.observations import Phenomenon
from app.schemas.snapshots import VERSION, DayResult, Reading, ResultSnapshot, SensorResult
from app.storage.results import ResultRepository

BERLIN = ZoneInfo("Europe/Berlin")
REQUIRED_MODEL = ("temperature", "relative_humidity", "wind_speed", "pm2_5", "no2")


def day_bounds(selected: date) -> tuple[datetime, datetime]:
    return (
        datetime.combine(selected, time(), BERLIN).astimezone(UTC),
        datetime.combine(selected + timedelta(days=1), time(), BERLIN).astimezone(UTC),
    )


def project(rows):
    readings, issues = [], Counter()
    for item, retrieved_at in rows:
        try:
            observation = project_observation(item, retrieved_at=retrieved_at)
        except ValueError as exc:
            issues[str(exc)] += 1
            continue
        readings.append(
            Reading(
                observation=observation,
                exposure=item.provenance.exposure,
                station_name=item.provenance.station_name,
            )
        )
    readings.sort(
        key=lambda r: (
            r.observation.source,
            r.observation.station_id,
            r.observation.phenomenon,
            r.observation.observed_at,
            r.observation.sensor_id or "",
            r.observation.sample_id or "",
            r.observation.raw_ref or 0,
        )
    )
    cleaned = {
        o.key: o
        for o in quality_control([r.observation for r in readings], sensor_sources={"osem"})
    }
    return [
        r.model_copy(update={"observation": cleaned[r.observation.key]}) for r in readings
    ], issues


def persist(repository: ResultRepository, key: str, payload, status: str, now: datetime):
    data = payload.model_dump(mode="json")
    fingerprint = hashlib.sha256(
        json.dumps(data, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    build_id = hashlib.sha256(f"{VERSION}:{key}:{fingerprint}".encode()).hexdigest()
    return repository.save(
        ResultSnapshot(
            build_id=build_id,
            resource_key=key,
            input_sha256=fingerprint,
            built_at=utc(now),
            status=status,
            payload=data,
        )
    )


def process_day(repository: ResultRepository, selected: date, *, now: datetime) -> ResultSnapshot:
    now = utc(now)
    key = f"days/{selected}"
    with source_lock(repository.engine, f"processing:{key}") as acquired:
        if not acquired:
            raise RuntimeError("day processing already running")
        start, end = day_bounds(selected)
        rows = repository.observations(since=start, until=end, retrieved_before=now)
        # Use one latest captured model run per source, never average revisions.
        latest = {}
        for item, retrieved in rows:
            if item.kind == "forecast":
                latest[item.source] = max(
                    latest.get(item.source, (datetime.min.replace(tzinfo=UTC), 0)),
                    (retrieved, item.raw_ref),
                )
        rows = [
            (o, r) for o, r in rows if o.kind != "forecast" or (r, o.raw_ref) == latest[o.source]
        ]
        readings, issues = project(rows)
        # Future station timestamps are not current/historical measurements.
        measured = [
            r.observation
            for r in readings
            if r.exposure == "outdoor"
            and r.observation.kind == "observation"
            and r.observation.observed_at <= now
        ]
        observations = [r.observation for r in readings]
        measured_series = {
            str(p): {t.isoformat(): v for t, v in hourly_levels(measured, p).items()}
            for p in Phenomenon
        }
        models = {
            str(p): {t.isoformat(): v for t, v in model_series(observations, p).items()}
            for p in Phenomenon
        }
        instants = [
            start + timedelta(hours=i) for i in range(int((end - start).total_seconds() / 3600))
        ]
        missing = {p: sum(t.isoformat() not in models[p] for t in instants) for p in REQUIRED_MODEL}
        status = "SUCCESS" if not any(missing.values()) else "PARTIAL"
        if not readings:
            status = "UNAVAILABLE"
        return persist(
            repository,
            key,
            DayResult(
                date=selected,
                instants=instants,
                readings=readings,
                measured_levels=measured_series,
                model_series=models,
                missing_model_slots=missing,
                issues=dict(issues),
            ),
            status,
            now,
        )


def process_sensors(repository: ResultRepository, *, now: datetime) -> ResultSnapshot:
    now = utc(now)
    with source_lock(repository.engine, "processing:sensors") as acquired:
        if not acquired:
            raise RuntimeError("sensor processing already running")
        rows = repository.observations(
            until=now + timedelta(microseconds=1), retrieved_before=now, measurements_only=True
        )
        readings, issues = project(rows)
        readings = [r for r in readings if r.observation.platform == "stationary"]
        return persist(
            repository,
            "sensors",
            SensorResult(readings=readings, issues=dict(issues)),
            "UNAVAILABLE" if not readings else "PARTIAL" if issues else "SUCCESS",
            now,
        )
