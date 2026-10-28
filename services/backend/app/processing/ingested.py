"""Explicit projection of persisted ingestion values into processing contracts.

Ingestion has already converted provider units. Never normalize its raw originals
a second time: preserve them as provenance and map the canonical value instead.
"""

from datetime import datetime

from app.schemas.observation import Observation as Ingested
from app.schemas.observation import utc
from app.schemas.observations import CANONICAL_UNITS, Observation, Phenomenon

PHENOMENA = {
    "temp": Phenomenon.TEMPERATURE,
    "rh": Phenomenon.RELATIVE_HUMIDITY,
    "pressure_msl": Phenomenon.PRESSURE,
    "pm1": Phenomenon.PM1,
    "pm25": Phenomenon.PM2_5,
    "pm4": Phenomenon.PM4,
    "pm10": Phenomenon.PM10,
    "no2": Phenomenon.NO2,
    "o3": Phenomenon.O3,
    "wind_speed": Phenomenon.WIND_SPEED,
    "precip": Phenomenon.PRECIPITATION,
    "uv_index": Phenomenon.UV_INDEX,
}


def project_observation(item: Ingested, *, retrieved_at: datetime) -> Observation:
    """Reject unresolved metadata; unsupported channels stay stored for later use."""
    provenance = item.provenance
    if provenance is None:
        raise ValueError("per-value provider provenance is required for processing")
    if item.geom.type != "Point":
        raise ValueError("point processing cannot project a line observation")
    if item.phenomenon not in PHENOMENA:
        raise ValueError(f"unsupported processing phenomenon: {item.phenomenon}")
    if item.phenomenon == "precip" and provenance.interval_seconds != 3600:
        raise ValueError("precipitation requires a verified hourly interval")
    if item.qc_flags:
        raise ValueError("ingested values must not carry downstream QC flags")
    phenomenon = PHENOMENA[item.phenomenon]
    value = item.value
    if value is not None and phenomenon == Phenomenon.WIND_SPEED:
        value /= 3.6
    return Observation(
        source=item.source,
        station_id=item.station_id,
        platform=provenance.platform,
        kind="model" if item.kind == "forecast" else item.kind,
        phenomenon=phenomenon,
        value=value,
        unit=CANONICAL_UNITS[phenomenon],
        observed_at=utc(item.ts_utc),
        longitude=item.geom.coordinates[0],
        latitude=item.geom.coordinates[1],
        raw_key=provenance.raw_key,
        raw_value=None if provenance.raw_value is None else str(provenance.raw_value),
        raw_unit=provenance.raw_unit,
        sample_id=provenance.sample_id,
        sensor_id=provenance.sensor_id,
        raw_ref=item.raw_ref,
        retrieved_at=utc(retrieved_at),
        issued_at=item.issued_at,
    )
