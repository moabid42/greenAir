"""Bounded weather adapters built against retained live probe contracts.

No network access occurs here. Forecast issue times are supplied by an explicit
resolver; neither retrieval time nor generationtime_ms is a model issue time.
"""

import hashlib
import math
from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime, timedelta

from app.ingestion.contracts import FeatureReceipt, Manifest, PageResult, RawPayload, Watermark
from app.ingestion.http import LandedResponse
from app.schemas.observation import UNITS, Geometry, Observation, ProviderValue, utc

IssueResolver = Callable[[RawPayload, dict], datetime | None]

BRIGHTSKY_FIELDS = {
    "temperature": ("temp", "°C"),
    "relative_humidity": ("rh", "%"),
    "pressure_msl": ("pressure_msl", "hPa"),
    "wind_speed": ("wind_speed", "km/h"),
    "wind_direction": ("wind_dir", "°"),
    "precipitation": ("precip", "mm"),
    "cloud_cover": ("cloud_cover", "%"),
    "sunshine": ("sunshine", "s"),
}
WEATHER_FIELDS = {
    "temperature_2m": ("temp", "°C"),
    "relative_humidity_2m": ("rh", "%"),
    "pressure_msl": ("pressure_msl", "hPa"),
    "wind_speed_10m": ("wind_speed", "km/h"),
    "wind_direction_10m": ("wind_dir", "°"),
    "precipitation": ("precip", "mm"),
    "cloud_cover": ("cloud_cover", "%"),
    "uv_index": ("uv_index", "1"),
}
AQ_FIELDS = {
    "pm10": ("pm10", "µg/m³"),
    "pm2_5": ("pm25", "µg/m³"),
    "nitrogen_dioxide": ("no2", "µg/m³"),
    "ozone": ("o3", "µg/m³"),
    "european_aqi": ("european_aqi", "EAQI"),
    **{
        f"{p}_pollen": (f"pollen_{p}", "grains/m³")
        for p in ("alder", "birch", "grass", "mugwort", "olive", "ragweed")
    },
}


def numeric(value) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError("provider value must be a finite number")
    return float(value)


def timestamp(value: str) -> datetime:
    return utc(datetime.fromisoformat(value))


def manifest(raw, *, rows, observations, details, partial=False, receipts=()):
    times = [item.ts_utc for item in observations]
    times.extend(item.observed_at for item in receipts if item.observed_at is not None)
    return Manifest(
        source_id=raw.source_id,
        url=raw.url,
        retrieved_at_utc=raw.retrieved_at_utc,
        http_status=raw.http_status,
        content_type=raw.response_headers.get("content-type"),
        rows_downloaded=rows,
        earliest_observed_at=min(times) if times else None,
        latest_observed_at=max(times) if times else None,
        sha256=hashlib.sha256(raw.body).hexdigest(),
        status="PARTIAL" if partial else "SUCCESS",
        details={"phase": "ingestion", **details},
    )


def checkpoint(watermark, *, boundary, target, observations):
    state = dict(watermark.state)
    state.update(cursor=boundary.isoformat(), target_end=target.isoformat(), more=boundary < target)
    if not state["more"]:
        state.pop("cursor", None)
        state.pop("target_end", None)
    times = [item.ts_utc for item in observations]
    if watermark.last_ts is not None:
        times.append(watermark.last_ts)
    return watermark.model_copy(update={"last_ts": max(times) if times else None, "state": state})


class BrightSkyAdapter:
    """Prefer verified DWD station 15547; preserve each fallback's own location."""

    canonical_source = "brightsky"

    def __init__(
        self,
        *,
        bbox,
        dwd_station_id="15547",
        current=False,
        issue_resolver=None,
        source_id="brightsky",
    ):
        self.source_id = source_id
        self.bbox = tuple(bbox)
        self.dwd_station_id = dwd_station_id
        self.current = current
        self.issue_resolver = issue_resolver
        self._target = None

    def request(self, watermark, start, end):
        start, end = utc(start), utc(end)
        if start >= end:
            raise ValueError("weather interval must be nonempty")
        self._target = end
        params = {"dwd_station_id": self.dwd_station_id, "tz": "UTC", "units": "dwd"}
        endpoint = "current_weather" if self.current else "weather"
        if not self.current:
            cursor = timestamp(watermark.state["cursor"]) if watermark.state.get("more") else start
            if not start <= cursor < end:
                raise ValueError("weather cursor is outside requested interval")
            params.update(
                date=cursor.isoformat(), last_date=min(cursor + timedelta(days=1), end).isoformat()
            )
        return {"url": f"https://api.brightsky.dev/{endpoint}", "method": "GET", "params": params}

    def decode(self, raw: RawPayload, raw_ref: int, watermark: Watermark) -> PageResult:
        if raw.source_id != self.source_id or watermark.source_id != self.source_id:
            raise ValueError("raw and watermark sources must match adapter")
        payload = LandedResponse(raw_ref, raw, 0).json()
        if not isinstance(payload, dict) or not isinstance(payload.get("sources"), list):
            raise ValueError("expected Bright Sky sources and weather envelope")
        weather = payload.get("weather")
        if isinstance(weather, dict):
            weather = [weather]
        if not isinstance(weather, list):
            raise ValueError("expected Bright Sky weather records")
        if raw.request_params.get("units", "dwd") not in {"dwd", "si"}:
            raise ValueError("unknown Bright Sky units")
        sources = {item["id"]: item for item in payload["sources"]}
        observations, receipts, errors = [], [], []
        missing, filtered = Counter(), Counter()
        issue = None
        for record in weather:
            identity = f"{record.get('source_id')}:{record.get('timestamp')}"
            record_observations, record_errors, record_filtered = [], [], 0
            stamp = None
            try:
                stamp = timestamp(record["timestamp"])
                fallback = record.get("fallback_source_ids", {})
                if not isinstance(fallback, dict):
                    raise ValueError("fallback_source_ids must be an object")
                for base_field, (phenomenon, unit) in BRIGHTSKY_FIELDS.items():
                    field = base_field
                    if self.current and base_field in {
                        "precipitation",
                        "wind_speed",
                        "wind_direction",
                        "sunshine",
                    }:
                        field += "_60"
                    value = record.get(field)
                    if value is None:
                        missing[field] += 1
                        continue
                    try:
                        source_id = fallback.get(field, record["source_id"])
                        source = sources[source_id]
                        geom = Geometry(type="Point", coordinates=[source["lon"], source["lat"]])
                        if not geom.inside_bbox(self.bbox):
                            filtered[field] += 1
                            record_filtered += 1
                            continue
                        source_type = source["observation_type"]
                        if source_type not in {"forecast", "current", "historical", "synop"}:
                            raise ValueError("unknown Bright Sky observation_type")
                        kind = "forecast" if source_type == "forecast" else "observation"
                        if kind == "forecast" and issue is None:
                            if self.issue_resolver is None:
                                raise ValueError("forecast issue policy has not been configured")
                            issue = utc(self.issue_resolver(raw, payload))
                        value = numeric(value)
                        si = raw.request_params.get("units") == "si"
                        if phenomenon == "sunshine":
                            value *= 1 if si else 60
                        elif si and phenomenon == "temp":
                            value -= 273.15
                        elif si and phenomenon == "pressure_msl":
                            value /= 100
                        elif si and phenomenon == "wind_speed":
                            value *= 3.6
                        station = (
                            source.get("dwd_station_id")
                            or source.get("wmo_station_id")
                            or f"source:{source_id}"
                        )
                        record_observations.append(
                            Observation(
                                source=self.source_id,
                                station_id=str(station),
                                geom=geom,
                                phenomenon=phenomenon,
                                unit=unit,
                                value=value,
                                ts_utc=stamp,
                                kind=kind,
                                issued_at=issue if kind == "forecast" else None,
                                raw_ref=raw_ref,
                                provenance=ProviderValue(
                                    platform="stationary",
                                    raw_key=field,
                                    raw_value=record[field],
                                    raw_unit=(
                                        {
                                            "temp": "K",
                                            "pressure_msl": "Pa",
                                            "wind_speed": "m/s",
                                            "sunshine": "s",
                                        }.get(phenomenon, unit)
                                        if si
                                        else "min"
                                        if phenomenon == "sunshine"
                                        else unit
                                    ),
                                    interval_seconds=3600 if phenomenon == "precip" else None,
                                ),
                            )
                        )
                    except (ValueError, TypeError, KeyError) as exc:
                        record_errors.append(f"{field}: {exc}")
            except (ValueError, TypeError, KeyError) as exc:
                record_errors.append(str(exc))
            observations.extend(record_observations)
            outcome = (
                "UNRESOLVED" if record_errors else "INGESTED" if record_observations else "FILTERED"
            )
            reason = "; ".join(record_errors) or (
                "outside bbox" if record_filtered else "missing values"
            )
            receipts.append(
                FeatureReceipt(
                    source_id=self.source_id,
                    feature_id=identity,
                    raw_ref=raw_ref,
                    build_key=issue.isoformat() if issue else "observations",
                    outcome=outcome,
                    reason=reason if outcome != "INGESTED" else None,
                    observed_at=stamp,
                    canonical_count=len(record_observations),
                )
            )
            errors.extend({"record": identity, "error": err} for err in record_errors)
        boundary = (
            timestamp(raw.request_params["last_date"])
            if "last_date" in raw.request_params
            else raw.retrieved_at_utc
        )
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
                rows=len(weather),
                observations=observations,
                receipts=receipts,
                partial=bool(errors or missing or filtered),
                details={
                    "missing_by_field": dict(missing),
                    "outside_bbox_by_field": dict(filtered),
                    "unresolved": errors[:100],
                    "unresolved_count": len(errors),
                    "source_provenance": payload["sources"],
                    "fallback_source_ids": (
                        "retained per record in raw payload; geometry follows each field's source"
                    ),
                },
            ),
        )


class OpenMeteoAdapter:
    """Keep returned grid geometry, units and hourly arrays authoritative."""

    def __init__(
        self,
        source_id,
        *,
        bbox,
        issue_resolver=None,
        latitude=49.1427,
        longitude=9.2109,
        forecast_days=2,
    ):
        if source_id not in {"openmeteo_fcst", "openmeteo_aq"}:
            raise ValueError("unknown Open-Meteo source")
        if not 1 <= forecast_days <= 2:
            raise ValueError("probe-verified forecasts are bounded to two days")
        self.source_id, self.bbox = source_id, tuple(bbox)
        self.issue_resolver = issue_resolver
        self.latitude, self.longitude, self.forecast_days = latitude, longitude, forecast_days
        self.fields = AQ_FIELDS if source_id == "openmeteo_aq" else WEATHER_FIELDS

    def request(self, watermark, start, end):
        host, path = (
            ("air-quality-api.open-meteo.com", "air-quality")
            if self.source_id == "openmeteo_aq"
            else ("api.open-meteo.com", "forecast")
        )
        return {
            "url": f"https://{host}/v1/{path}",
            "method": "GET",
            "params": {
                "latitude": self.latitude,
                "longitude": self.longitude,
                "timezone": "UTC",
                "timeformat": "unixtime",
                "forecast_days": self.forecast_days,
                "hourly": ",".join(self.fields),
            },
        }

    def decode(self, raw: RawPayload, raw_ref: int, watermark: Watermark) -> PageResult:
        if raw.source_id != self.source_id or watermark.source_id != self.source_id:
            raise ValueError("raw and watermark sources must match adapter")
        payload = LandedResponse(raw_ref, raw, 0).json()
        if not isinstance(payload, dict) or not isinstance(payload.get("hourly"), dict):
            raise ValueError("expected Open-Meteo hourly envelope")
        hourly, units = payload["hourly"], payload.get("hourly_units", {})
        times = hourly.get("time")
        if (
            not isinstance(times, list)
            or units.get("time") != "unixtime"
            or payload.get("utc_offset_seconds") != 0
        ):
            raise ValueError("expected explicit UTC Unix timestamps")
        if len(times) > self.forecast_days * 24:
            raise ValueError("hourly response exceeds requested forecast bound")
        epochs = [numeric(epoch) for epoch in times]
        if any(b - a != 3600 for a, b in zip(epochs, epochs[1:], strict=False)):
            raise ValueError("expected unique ascending hourly timestamps")
        resolved = self.issue_resolver(raw, payload) if self.issue_resolver else None
        issue = utc(resolved) if resolved is not None else None
        geom = Geometry(type="Point", coordinates=[payload["longitude"], payload["latitude"]])
        station = f"grid:{payload['latitude']}:{payload['longitude']}"
        valid_fields, field_errors = {}, {}
        for field, (phenomenon, unit) in self.fields.items():
            values = hourly.get(field)
            expected = "" if field == "uv_index" else unit
            actual = units.get(field)
            actual = actual.replace("μ", "µ") if isinstance(actual, str) else actual
            if not isinstance(values, list) or len(values) != len(times):
                field_errors[field] = "missing or misaligned hourly array"
            elif actual != expected:
                field_errors[field] = f"unverified unit {actual!r}"
            elif phenomenon == "european_aqi" and UNITS.get(phenomenon) != "EAQI":
                field_errors[field] = "EAQI vocabulary extension has not been configured"
            else:
                valid_fields[field] = values
        observations, receipts, errors = [], [], []
        missing = Counter()
        inside = geom.inside_bbox(self.bbox)
        stamps = []
        for index, epoch in enumerate(times):
            stamp = datetime.fromtimestamp(numeric(epoch), UTC)
            stamps.append(stamp)
            record_observations, record_errors = [], []
            if inside:
                for field, values in valid_fields.items():
                    value = values[index]
                    if value is None:
                        missing[field] += 1
                    phenomenon, unit = self.fields[field]
                    try:
                        record_observations.append(
                            Observation(
                                source=self.source_id,
                                station_id=station,
                                geom=geom,
                                phenomenon=phenomenon,
                                value=numeric(value) if value is not None else None,
                                unit=unit,
                                ts_utc=stamp,
                                kind="forecast",
                                issued_at=issue,
                                raw_ref=raw_ref,
                                provenance=ProviderValue(
                                    platform="stationary",
                                    raw_key=field,
                                    raw_value=value,
                                    raw_unit=units[field],
                                    interval_seconds=3600 if phenomenon == "precip" else None,
                                ),
                            )
                        )
                    except (ValueError, TypeError) as exc:
                        record_errors.append(f"{field}: {exc}")
            observations.extend(record_observations)
            errors.extend({"time": epoch, "error": err} for err in record_errors)
            outcome = (
                "FILTERED"
                if not inside
                else "UNRESOLVED"
                if field_errors or record_errors
                else "INGESTED"
                if record_observations
                else "FILTERED"
            )
            receipts.append(
                FeatureReceipt(
                    source_id=self.source_id,
                    feature_id=f"{station}:{epoch}",
                    build_key=issue.isoformat() if issue else f"capture:{raw_ref}",
                    raw_ref=raw_ref,
                    outcome=outcome,
                    reason="outside bbox"
                    if not inside
                    else "; ".join(record_errors)
                    or ("see manifest field errors" if field_errors else None),
                    observed_at=stamp,
                    canonical_count=len(record_observations),
                )
            )
        state = dict(watermark.state)
        state.update(more=False)
        latest = max([*stamps, *([watermark.last_ts] if watermark.last_ts else [])], default=None)
        return PageResult(
            observations=observations,
            receipts=receipts,
            next_watermark=watermark.model_copy(update={"last_ts": latest, "state": state}),
            manifest=manifest(
                raw,
                rows=len(times),
                observations=observations,
                receipts=receipts,
                partial=bool(field_errors or errors or missing or not inside or not times),
                details={
                    "field_errors": field_errors,
                    "unresolved": errors[:100],
                    "missing_by_field": dict(missing),
                    "outside_bbox": len(times) if not inside else 0,
                    "hourly_units": units,
                    "issued_at": issue.isoformat() if issue else None,
                    "issue_clock": "provider issuance if supplied; otherwise unknown",
                    "model_metadata": {
                        key: payload.get(key)
                        for key in (
                            "latitude",
                            "longitude",
                            "elevation",
                            "timezone",
                            "utc_offset_seconds",
                        )
                    },
                },
            ),
        )
