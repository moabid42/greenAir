"""Verified openSenseMap stationary metadata/latest adapter; no network on import.

The local bbox response is a snapshot, not a historical completeness claim.
Per-sensor originals, sensor IDs, altitude and unsupported channels stay raw.
"""

import hashlib
import math
from datetime import datetime

from app.ingestion.contracts import FeatureReceipt, Manifest, PageResult, RawPayload, Watermark
from app.ingestion.http import LandedResponse
from app.schemas.observation import Geometry, Observation, ProviderValue, utc

BBOX = (9.05, 49.05, 9.35, 49.25)
BOXES_URL = "https://api.opensensemap.org/boxes"

# Exact titles and units observed in raw refs 60, 62, 63 and 67. No generic
# pressure mapping: pressure at a sensor is not necessarily sea-level pressure.
CHANNELS = {
    **dict.fromkeys(("Temperatur", "Temperature"), ("temp", "°C", "°C", 1.0)),
    **dict.fromkeys(
        (
            "rel. Luftfeuchte",
            "Relative Luftfeuchte",
            "rel. Luftfeuchtigkeit",
            "Rel. Humidity",
            "Luftfeuchtigkeit",
            "Humid",
        ),
        ("rh", "%", "%", 1.0),
    ),
    **dict.fromkeys(("PM1", "Finedust PM1", "PM01"), ("pm1", "µg/m³", "µg/m³", 1.0)),
    **dict.fromkeys(("PM2.5", "PM25", "PM2,5", "Finedust PM2.5"), ("pm25", "µg/m³", "µg/m³", 1.0)),
    **dict.fromkeys(("PM4", "Finedust PM4"), ("pm4", "µg/m³", "µg/m³", 1.0)),
    **dict.fromkeys(("PM10", "Finedust PM10"), ("pm10", "µg/m³", "µg/m³", 1.0)),
    **dict.fromkeys(
        ("Windgeschwindigkeit", "Windspeed", "Wind"), ("wind_speed", "km/h", "km/h", 1.0)
    ),
    **dict.fromkeys(("Windrichtung", "Wind Direction"), ("wind_dir", "°", "°", 1.0)),
    "UV-Index": ("uv_index", "Idx", "1", 1.0),
    "UV Index": ("uv_index", "Index 1-12", "1", 1.0),
    "Luftdruck (NN)": ("pressure_msl", "hPa", "hPa", 1.0),
}
UNRESOLVED_TITLES = {"Luftdruck", "Pressure", "Rain Rate", "Regen"}


class OsemAdapter:
    """One city-bounded snapshot per run; use separate daily/5-minute jobs.

    ``limit`` is not honored as a bbox result cap by the observed API. There is
    no verified offset/cursor contract; a complete returned JSON array is one
    snapshot page. The caller's transport still bounds bytes and timeout.
    """

    def __init__(self, *, metadata_only: bool = False, bbox=BBOX):
        self.metadata_only = metadata_only
        self.source_id = "osem_metadata" if metadata_only else "osem"
        self.bbox = tuple(bbox)

    def request(self, watermark: Watermark, start: datetime, end: datetime) -> dict:
        # start/end schedule a latest snapshot; they are not falsely advertised
        # as a historical range supported by this endpoint.
        return {
            "url": BOXES_URL,
            "method": "GET",
            "params": {
                "bbox": ",".join(str(value) for value in self.bbox),
                "limit": 20,
                "full": "false" if self.metadata_only else "true",
            },
        }

    def decode(self, raw: RawPayload, raw_ref: int, watermark: Watermark) -> PageResult:
        manifest = Manifest(
            source_id=self.source_id,
            url=raw.url,
            retrieved_at_utc=raw.retrieved_at_utc,
            http_status=raw.http_status,
            content_type=raw.response_headers.get("content-type"),
            sha256=hashlib.sha256(raw.body).hexdigest(),
            status="SUCCESS",
            details={"scope": "stationary latest snapshot; not historical coverage"},
        )
        if raw.source_id != self.source_id or watermark.source_id != self.source_id:
            raise ValueError("raw and watermark sources must match the adapter")
        try:
            boxes = LandedResponse(raw_ref, raw, 0).json()
            if isinstance(boxes, dict):
                boxes = [boxes]  # Same verified box-detail schema, useful for raw replay.
            if not isinstance(boxes, list) or any(not isinstance(b, dict) for b in boxes):
                raise ValueError("expected box array or box detail object")
        except (ValueError, TypeError) as exc:
            manifest.status = (
                "RESTRICTED"
                if raw.http_status in {401, 403}
                else "UNREACHABLE"
                if raw.error or raw.http_status is None or raw.http_status >= 500
                else "PARTIAL"
            )
            manifest.details["error"] = str(exc)
            return PageResult(manifest=manifest)

        observations, receipts, inventory, excluded, unresolved = [], [], [], {}, []
        missing_readings = 0
        for box in boxes:
            box_id = box.get("_id")
            exclusion = None
            geom = None
            if not isinstance(box_id, str) or not box_id:
                manifest.status = "PARTIAL"
                unresolved.append({"reason": "missing box identity"})
                continue
            if box.get("exposure") == "mobile":
                exclusion = "mobile box excluded from stationary observations"
            elif box.get("exposure") not in {"indoor", "outdoor"}:
                exclusion = "stationary exposure is unverified"
                manifest.status = "PARTIAL"
            try:
                location = box.get("currentLocation", {})
                if location.get("type") != "Point":
                    raise ValueError("currentLocation must be a Point")
                coordinates = location["coordinates"]
                if len(coordinates) not in {2, 3}:
                    raise ValueError("invalid coordinate dimension")
                geom = Geometry(type="Point", coordinates=coordinates[:2])
                if not geom.inside_bbox(self.bbox):
                    exclusion = "currentLocation outside approved bbox"
            except (KeyError, TypeError, ValueError) as exc:
                exclusion = f"invalid currentLocation: {exc}"
                manifest.status = "PARTIAL"
            if exclusion:
                excluded[box_id] = exclusion
            else:
                inventory.append(box_id)
            sensors = box.get("sensors")
            if not isinstance(sensors, list):
                manifest.status = "PARTIAL"
                unresolved.append({"box_id": box_id, "reason": "missing sensor inventory"})
                continue
            if self.metadata_only:
                continue
            for sensor in sensors:
                if not isinstance(sensor, dict):
                    manifest.status = "PARTIAL"
                    unresolved.append({"box_id": box_id, "reason": "invalid sensor metadata"})
                    continue
                reading = sensor.get("lastMeasurement")
                if not isinstance(reading, dict) or reading.get("value") is None:
                    missing_readings += 1
                    manifest.status = "PARTIAL"
                    continue
                sensor_id, timestamp = sensor.get("_id"), reading.get("createdAt")
                if not isinstance(sensor_id, str) or not sensor_id:
                    manifest.status = "PARTIAL"
                    unresolved.append({"box_id": box_id, "reason": "missing sensor identity"})
                    continue
                observed_at = None
                reason, outcome, canonical_count = exclusion, "FILTERED", 0
                try:
                    observed_at = utc(datetime.fromisoformat(timestamp))
                    if not exclusion:
                        title = sensor.get("title")
                        channel = CHANNELS.get(title)
                        if channel is None:
                            reason = "channel outside verified canonical contract"
                            if title in UNRESOLVED_TITLES:
                                raise ValueError("pressure reference or rain interval unverified")
                        else:
                            phenomenon, provider_unit, unit, factor = channel
                            if sensor.get("unit") != provider_unit:
                                raise ValueError(
                                    "unit does not match the verified channel contract"
                                )
                            if isinstance(reading["value"], bool):
                                raise ValueError("boolean reading is not a measurement")
                            value = float(reading["value"]) * factor
                            if not math.isfinite(value):
                                raise ValueError("measurement must be finite")
                            observations.append(
                                Observation(
                                    source="osem",
                                    station_id=box_id,
                                    geom=geom,
                                    phenomenon=phenomenon,
                                    value=value,
                                    unit=unit,
                                    ts_utc=observed_at,
                                    raw_ref=raw_ref,
                                    provenance=ProviderValue(
                                        platform="stationary",
                                        sensor_id=sensor_id,
                                        raw_key=title,
                                        raw_value=reading["value"],
                                        raw_unit=sensor["unit"],
                                        exposure=box["exposure"],
                                        station_name=box.get("name"),
                                    ),
                                )
                            )
                            outcome, reason, canonical_count = "INGESTED", None, 1
                except (ValueError, TypeError, OverflowError) as exc:
                    outcome, reason = "UNRESOLVED", str(exc)
                    manifest.status = "PARTIAL"
                    unresolved.append({"box_id": box_id, "sensor_id": sensor_id, "reason": reason})
                receipts.append(
                    FeatureReceipt(
                        source_id=self.source_id,
                        feature_id=f"{box_id}:{sensor_id}:"
                        f"{observed_at.isoformat() if observed_at else timestamp}",
                        raw_ref=raw_ref,
                        outcome=outcome,
                        reason=reason,
                        observed_at=observed_at,
                        canonical_count=canonical_count,
                    )
                )
        times = [item.ts_utc for item in observations]
        manifest.rows_downloaded = len(boxes) if self.metadata_only else len(receipts)
        manifest.earliest_observed_at = min(times, default=None)
        manifest.latest_observed_at = max(times, default=None)
        manifest.details.update(
            stationary_box_ids=sorted(set(inventory)),
            returned_boxes=len(boxes),
            excluded_boxes=excluded,
            missing_readings=missing_readings,
            unresolved=unresolved,
            metadata_only=self.metadata_only,
        )
        last_times = times + ([watermark.last_ts] if watermark.last_ts else [])
        next_watermark = watermark.model_copy(
            update={
                "last_ts": max(last_times, default=None),
                "last_success_at": raw.retrieved_at_utc,
                "last_offset": 0,
                "state": {
                    **watermark.state,
                    "more": False,
                    "cursor": 0,
                    "stationary_box_ids": sorted(set(inventory)),
                },
            }
        )
        return PageResult(
            observations=observations,
            receipts=receipts,
            next_watermark=next_watermark,
            manifest=manifest,
        )
