"""openSenseMap box search: latest value per sensor for one group tag.

Contract: docs/integrations/opensensemap-stations.md
"""

import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from typing import Any

from app.schemas.stations import SensorReading, StationSnapshot

RETRY_STATUS = {429, 500, 502, 503, 504}


class UpstreamError(RuntimeError):
    """The provider could not be reached or returned an unusable payload."""


def fetch_boxes(
    base_url: str,
    grouptag: str,
    timeout: float,
    attempts: int = 3,
    backoff_seconds: float = 1.0,
) -> list[dict[str, Any]]:
    """GET /boxes?grouptag=...&full=true with bounded retries; returns the raw box list."""
    query = urllib.parse.urlencode({"grouptag": grouptag, "full": "true"})
    url = f"{base_url.rstrip('/')}/boxes?{query}"
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                content_type = response.headers.get("Content-Type", "")
                if "json" not in content_type:
                    raise UpstreamError(f"unexpected content type {content_type!r} from {url}")
                payload = json.load(response)
            break
        except urllib.error.HTTPError as error:
            if error.code not in RETRY_STATUS or attempt == attempts:
                raise UpstreamError(f"HTTP {error.code} from {url}") from error
        except (urllib.error.URLError, TimeoutError) as error:
            if attempt == attempts:
                raise UpstreamError(f"{url} unreachable: {error}") from error
        except json.JSONDecodeError as error:
            raise UpstreamError(f"invalid JSON from {url}") from error
        time.sleep(backoff_seconds * 2 ** (attempt - 1))
    if not isinstance(payload, list):
        raise UpstreamError(f"expected a JSON array of boxes from {url}")
    return payload


def parse_boxes(payload: list[dict[str, Any]]) -> list[StationSnapshot]:
    """Map provider boxes to snapshots, keeping absent values as None rather than zero."""
    return [_parse_box(box) for box in payload]


def _parse_box(box: dict[str, Any]) -> StationSnapshot:
    coordinates = box["currentLocation"]["coordinates"]
    return StationSnapshot(
        box_id=box["_id"],
        name=box["name"],
        exposure=box.get("exposure"),
        grouptags=box.get("grouptag") or [],
        longitude=coordinates[0],
        latitude=coordinates[1],
        height_m=coordinates[2] if len(coordinates) > 2 else None,
        last_measurement_at=_parse_time(box.get("lastMeasurementAt")),
        sensors=[_parse_sensor(sensor) for sensor in box.get("sensors", [])],
    )


def _parse_sensor(sensor: dict[str, Any]) -> SensorReading:
    last = sensor.get("lastMeasurement")
    # `full=false` returns a measurement id string instead of an object.
    if not isinstance(last, dict):
        last = {}
    raw_value = last.get("value")
    return SensorReading(
        sensor_id=sensor["_id"],
        title=sensor["title"],
        unit=sensor.get("unit"),
        sensor_type=sensor.get("sensorType"),
        value=_parse_float(raw_value),
        raw_value=None if raw_value is None else str(raw_value),
        measured_at=_parse_time(last.get("createdAt")),
    )


def _parse_float(raw: Any) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def _parse_time(raw: str | None) -> datetime | None:
    # Provider timestamps are ISO 8601 UTC with a `Z` suffix.
    return datetime.fromisoformat(raw) if raw else None
