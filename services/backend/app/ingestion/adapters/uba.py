"""UBA hourly measurements, using verified station/component metadata.

API hours are local CET/CEST measurement endings. Ambiguous or nonexistent local
hours stay unresolved rather than choosing a DST fold without source evidence.
"""

from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.ingestion.adapters.weather import checkpoint, manifest, numeric, timestamp
from app.ingestion.contracts import FeatureReceipt, PageResult, RawPayload, Watermark
from app.ingestion.http import LandedResponse
from app.schemas.observation import Geometry, Observation, ProviderValue

BERLIN = ZoneInfo("Europe/Berlin")
# Actual metadata refs 14/15/16 and limits ref 17, checked 2026-10-28 UTC.
STATIONS = {
    "226": {"code": "DEBW015", "name": "Heilbronn", "lon": 9.2248, "lat": 49.1655},
    "353": {
        "code": "DEBW152",
        "name": "Heilbronn Weinsberger Straße-Ost",
        "lon": 9.2259,
        "lat": 49.1460,
    },
}
COMPONENTS = {"1": "pm10", "3": "o3", "5": "no2", "9": "pm25"}
MEASURE_COLUMNS = ["component id", "scope id", "value", "date end", "index"]


def local_timestamp(text: str) -> datetime:
    """Convert only uniquely resolvable local times, including a 24:00 ending."""
    if " 24:" in text:
        day, clock = text.split(" ", 1)
        if clock != "24:00:00":
            raise ValueError("24-hour notation requires exactly 24:00:00")
        naive = datetime.fromisoformat(day) + timedelta(days=1)
    else:
        naive = datetime.fromisoformat(text)
    if naive.tzinfo is not None:
        raise ValueError("UBA expected the documented naive CET/CEST format")
    candidates = set()
    for fold in (0, 1):
        aware = naive.replace(tzinfo=BERLIN, fold=fold)
        normalized = aware.astimezone(UTC)
        if normalized.astimezone(BERLIN).replace(tzinfo=None) == naive:
            candidates.add(normalized)
    if len(candidates) != 1:
        label = "ambiguous" if candidates else "nonexistent"
        raise ValueError(f"{label} CET/CEST timestamp: {text}")
    return candidates.pop()


class UbaAdapter:
    """One station/component job, with its own raw/checkpoint source namespace."""

    canonical_source = "uba"

    def __init__(self, station_id, component_id, *, bbox, source_id="uba"):
        self.station_id, self.component_id = str(station_id), str(component_id)
        if self.station_id not in STATIONS or self.component_id not in COMPONENTS:
            raise ValueError("unverified UBA station/component")
        if self.station_id == "353" and self.component_id != "5":
            raise ValueError("only hourly NO2 is verified for DEBW152")
        self.source_id, self.bbox = source_id, tuple(bbox)
        self._target = None

    def request(self, watermark, start, end):
        start, end = timestamp(start.isoformat()), timestamp(end.isoformat())
        if start >= end:
            raise ValueError("UBA interval must be nonempty")
        cursor = timestamp(watermark.state["cursor"]) if watermark.state.get("more") else start
        if not start <= cursor < end:
            raise ValueError("UBA cursor is outside requested interval")
        day = cursor.astimezone(BERLIN).date().isoformat()
        self._target = end
        return {
            "url": "https://luftdaten.umweltbundesamt.de/api/air-data/v4/measures/json",
            "method": "GET",
            "params": {
                "station": self.station_id,
                "component": self.component_id,
                "scope": 2,
                "date_from": day,
                "date_to": day,
                "time_from": 1,
                "time_to": 24,
            },
        }

    def decode(self, raw: RawPayload, raw_ref: int, watermark: Watermark) -> PageResult:
        if raw.source_id != self.source_id or watermark.source_id != self.source_id:
            raise ValueError("raw and watermark sources must match adapter")
        payload = LandedResponse(raw_ref, raw, 0).json()
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
            raise ValueError("expected UBA measures data envelope")
        if payload.get("indices") != {"data": {"station id": {"date start": MEASURE_COLUMNS}}}:
            raise ValueError("UBA measure indices changed")
        request = payload.get("request", {})
        for field, expected in (
            ("station", self.station_id),
            ("component", self.component_id),
            ("scope", "2"),
        ):
            if (
                str(request.get(field)) != expected
                or str(raw.request_params.get(field)) != expected
            ):
                raise ValueError(f"UBA response/request {field} mismatch")
        station = STATIONS[self.station_id]
        geom = Geometry(type="Point", coordinates=[station["lon"], station["lat"]])
        inside = geom.inside_bbox(self.bbox)
        observations, receipts, errors = [], [], []
        missing = filtered = 0
        downloaded = 0
        for station_id, records in payload["data"].items():
            if not isinstance(records, dict):
                raise ValueError("UBA station records must be keyed by interval start")
            for start_text, record in records.items():
                downloaded += 1
                identity = f"{station_id}:{self.component_id}:2:{start_text}"
                stamp, record_observations, error = None, [], None
                outcome = "UNRESOLVED"
                try:
                    if station_id != self.station_id:
                        raise ValueError("unexpected UBA station in filtered response")
                    if not isinstance(record, list) or len(record) != 5:
                        raise ValueError("expected five UBA measure columns")
                    if str(record[0]) != self.component_id or str(record[1]) != "2":
                        raise ValueError("unexpected component or non-hourly scope")
                    # Validate both interval endpoints. A DST transition interval
                    # must not gain an invented fold when only one endpoint is unique.
                    start_stamp = local_timestamp(start_text)
                    stamp = local_timestamp(record[3])
                    if stamp - start_stamp != timedelta(hours=1):
                        raise ValueError("UBA record is not a uniquely resolved hourly interval")
                    if not inside:
                        outcome, error = "FILTERED", "outside user-approved bbox"
                        filtered += 1
                    elif record[2] is None:
                        missing += 1
                        outcome, error = "FILTERED", "missing value"
                    else:
                        record_observations.append(
                            Observation(
                                source=self.source_id,
                                station_id=station["code"],
                                geom=geom,
                                phenomenon=COMPONENTS[self.component_id],
                                value=numeric(record[2]),
                                unit="µg/m³",
                                ts_utc=stamp,
                                kind="observation",
                                raw_ref=raw_ref,
                                provenance=ProviderValue(
                                    platform="stationary",
                                    exposure="outdoor",
                                    station_name=station["name"],
                                    sensor_id=f"{self.station_id}:{self.component_id}:2",
                                    raw_key=self.component_id,
                                    raw_value=record[2],
                                    raw_unit="µg/m³",
                                    interval_seconds=3600,
                                ),
                            )
                        )
                        outcome = "INGESTED"
                except (ValueError, TypeError, KeyError) as exc:
                    error = str(exc)
                    errors.append({"record": identity, "error": error})
                observations.extend(record_observations)
                receipts.append(
                    FeatureReceipt(
                        source_id=self.source_id,
                        feature_id=identity,
                        raw_ref=raw_ref,
                        outcome=outcome,
                        reason=error,
                        observed_at=stamp,
                        canonical_count=len(record_observations),
                    )
                )
        day = datetime.fromisoformat(raw.request_params["date_to"]).date() + timedelta(days=1)
        boundary = datetime.combine(day, time(), tzinfo=BERLIN).astimezone(UTC)
        target = self._target or timestamp(
            watermark.state.get(
                "target_end",
                watermark.state.get("_scheduler", {}).get("window_end", boundary.isoformat()),
            )
        )
        return PageResult(
            observations=observations,
            receipts=receipts,
            next_watermark=checkpoint(
                watermark, boundary=boundary, target=target, observations=observations
            ),
            manifest=manifest(
                raw,
                rows=downloaded,
                observations=observations,
                receipts=receipts,
                partial=bool(errors or missing or filtered or not downloaded),
                details={
                    "station": station,
                    "station_api_id": self.station_id,
                    "component_id": self.component_id,
                    "scope": "2: one hour average",
                    "timestamp_semantics": "measurement interval end; CET/CEST uniquely resolved",
                    "missing_values": missing,
                    "outside_bbox": filtered,
                    "unresolved": errors[:100],
                    "unresolved_count": len(errors),
                    "source_meta": payload.get("meta", {}),
                    "number_matched_reported": None,
                },
            ),
        )
