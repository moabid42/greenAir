"""ATRAI city line captures; original properties and directed geometry survive."""

import hashlib
import json
from collections.abc import Callable
from datetime import datetime
from typing import Any

from app.ingestion.contracts import (
    FeatureReceipt,
    LayerRecord,
    Manifest,
    PageResult,
    RawPayload,
    SegmentRecord,
    Watermark,
)
from app.ingestion.http import LandedResponse
from app.schemas.observation import Geometry, utc

COLLECTIONS = (
    "road_network_heilbronn",
    "bumpy_roads_heilbronn",
    "overtaking_distance_heilbronn",
    "traffic_flow_heilbronn",
)


def feature_identity(feature: dict, collection: str) -> str:
    properties = feature["properties"]
    if collection == "road_network_heilbronn":
        # Actual provider index is the opaque OSMnx (u,v,key) tuple string. Never
        # interpret it as executable Python or replace it with a page offset.
        identity = properties.get("index")
        if not isinstance(identity, str) or not identity:
            raise ValueError("road feature lacks its probe-verified OSM edge index")
        return identity
    content = {"geometry": feature["geometry"], "osmid": properties.get("osmid")}
    geometry_hash = hashlib.sha256(
        json.dumps(content, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    # Non-road samples did not expose GeoJSON IDs. Their property IDs have not
    # been proven globally unique, so include the geometry in the identity.
    provider_id = feature.get("id", properties.get("id"))
    return f"{provider_id}:{geometry_hash}" if provider_id is not None else geometry_hash


def _count(properties: dict, key: str) -> int | None:
    value = properties.get(key)
    return value if type(value) is int and 0 <= value < 2**31 else None


class AtraiSegmentAdapter:
    """Store source geometry/properties unchanged; no street score calculation."""

    def __init__(
        self,
        source_id: str,
        collection: str,
        *,
        bbox: tuple[float, float, float, float],
        page_size: int = 1000,
        lookup: Callable[[Geometry, str | None], int | None] | None = None,
    ):
        if collection not in COLLECTIONS:
            raise ValueError("only verified Heilbronn line collections are supported")
        if not 1 <= page_size <= 1000:
            raise ValueError("page size must be between 1 and 1000")
        self.page_size = page_size
        self.source_id, self.collection, self.bbox = source_id, collection, bbox
        self.lookup = lookup

    def request(self, watermark: Watermark, start: datetime, end: datetime) -> dict:
        return {
            "url": f"https://api.atrai.bike/collections/{self.collection}/items",
            "params": {"f": "json", "limit": self.page_size, "offset": watermark.last_offset},
        }

    def decode(self, raw: RawPayload, raw_ref: int, watermark: Watermark) -> PageResult:
        if raw.source_id != self.source_id or watermark.source_id != self.source_id:
            raise ValueError("raw and watermark sources must match adapter")
        payload = LandedResponse(raw_ref, raw, 0).json()
        if (
            not isinstance(payload, dict)
            or payload.get("type") != "FeatureCollection"
            or not isinstance(payload.get("features"), list)
        ):
            raise ValueError("expected ATRAI GeoJSON FeatureCollection")
        features = payload["features"]
        offset, limit = payload.get("offset"), payload.get("limit")
        if (
            type(offset) is not int
            or offset < 0
            or type(limit) is not int
            or not 1 <= limit <= 5000
        ):
            raise ValueError("invalid source pagination envelope")
        if payload.get("numberReturned") != len(features) or len(features) > limit:
            raise ValueError("inconsistent source numberReturned/limit")
        if offset != int(raw.request_params.get("offset", 0)):
            raise ValueError("source returned another offset")
        matched = payload.get("numberMatched")
        if matched is not None and (type(matched) is not int or matched < 0):
            raise ValueError("invalid provider total")
        if matched is None or offset + len(features) > matched:
            raise ValueError("a consistent provider total is required")
        if offset and matched != watermark.state.get("reported_total"):
            raise ValueError("provider total changed during capture; restart manually")
        if offset and not features and offset < matched:
            raise ValueError("premature empty page; capture cannot advance")
        if limit != raw.request_params.get("limit"):
            raise ValueError("source returned another page limit")
        # Freeze the application capture clock across pages/restarts, without
        # inventing provider issuance or rounding away intraday rebuilds.
        stamp = (watermark.state.get("capture_at") if offset else None) or watermark.state.get(
            "_scheduler", {}
        ).get("window_end")
        built_at = utc(datetime.fromisoformat(stamp)) if stamp else raw.retrieved_at_utc
        layers, segments, receipts, errors = [], [], [], []
        filtered = 0
        for feature in features:
            fallback = hashlib.sha256(
                json.dumps(feature, sort_keys=True, separators=(",", ":")).encode()
            ).hexdigest()
            identity = fallback
            try:
                properties: dict[str, Any] = feature["properties"]
                if not isinstance(properties, dict):
                    raise ValueError("feature properties must be an object")
                identity = feature_identity(feature, self.collection)
                geom = Geometry.model_validate(feature["geometry"])
                expected = (
                    "Point"
                    if self.collection in {"danger_zones_heilbronn", "danger_zones_PM_heilbronn"}
                    else "LineString"
                )
                if geom.type != expected:
                    raise ValueError(f"expected {expected}; source geometry changed")
                if not geom.inside_bbox(self.bbox):
                    filtered += 1
                    receipts.append(
                        FeatureReceipt(
                            source_id=self.source_id,
                            feature_id=identity,
                            build_key=built_at.isoformat(),
                            raw_ref=raw_ref,
                            outcome="FILTERED",
                            reason="outside user-approved bbox",
                        )
                    )
                    continue
                osmid = str(properties["osmid"]) if properties.get("osmid") is not None else None
                segment_id = self.lookup(geom, osmid) if self.lookup else None
                if self.collection == "road_network_heilbronn":
                    segments.append(
                        SegmentRecord(
                            collection=self.collection,
                            feature_id=identity,
                            osmid=osmid,
                            geom=geom,
                            raw_ref=raw_ref,
                        )
                    )
                layers.append(
                    LayerRecord(
                        collection=self.collection,
                        feature_id=identity,
                        built_at=built_at,
                        geom=geom,
                        properties=properties,
                        raw_ref=raw_ref,
                        segment_id=segment_id,
                        number_of_boxes=_count(properties, "Number of Boxes"),
                        points_in_segment=_count(properties, "points_in_segment")
                        if "points_in_segment" in properties
                        else _count(properties, "Number of Points"),
                    )
                )
                receipts.append(
                    FeatureReceipt(
                        source_id=self.source_id,
                        feature_id=identity,
                        build_key=built_at.isoformat(),
                        raw_ref=raw_ref,
                        outcome="INGESTED",
                        canonical_count=1,
                    )
                )
            except (ValueError, TypeError, KeyError) as exc:
                errors.append({"feature_id": identity, "error": str(exc)})
                receipts.append(
                    FeatureReceipt(
                        source_id=self.source_id,
                        feature_id=identity,
                        build_key=built_at.isoformat(),
                        raw_ref=raw_ref,
                        outcome="UNRESOLVED",
                        reason=str(exc),
                    )
                )
        next_offset = offset + len(features)
        more = bool(features) and (matched is None or next_offset < matched)
        state = dict(watermark.state)
        state.update(more=more, capture_at=built_at.isoformat(), reported_total=matched)
        checkpoint = watermark.model_copy(update={"last_offset": next_offset, "state": state})
        return PageResult(
            layers=layers,
            segments=segments,
            receipts=receipts,
            next_watermark=checkpoint,
            manifest=Manifest(
                source_id=self.source_id,
                url=raw.url,
                retrieved_at_utc=raw.retrieved_at_utc,
                http_status=raw.http_status,
                content_type=raw.response_headers.get("content-type"),
                number_matched_reported=matched,
                rows_downloaded=len(features),
                status="PARTIAL" if errors else "SUCCESS",
                details={
                    "phase": "ingestion",
                    "collection": self.collection,
                    "build_key": built_at.isoformat(),
                    "build_clock": (
                        "application capture start; provider build and observation times unknown"
                    ),
                    "offset": offset,
                    "limit": limit,
                    "terminal": not more,
                    "pagination_guarantee": "offset only; no provider snapshot or order guarantee",
                    "outside_bbox": filtered,
                    "unresolved": errors,
                    "original_property_keys_preserved": True,
                },
            ),
        )
