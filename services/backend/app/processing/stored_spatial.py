"""Build spatial inputs from complete captures and verified stored measurements."""

import math
from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import select

from app.ingestion.adapters.atrai_segments import COLLECTIONS
from app.ingestion.scheduler import source_lock
from app.processing.snapshots import persist, project
from app.processing.spatial import (
    Segment,
    build_layers,
    distance_m,
    fill_uncovered,
    station_ratios,
)
from app.processing.temporal import hourly_levels
from app.schemas.observation import utc
from app.schemas.observations import Phenomenon
from app.schemas.spatial import (
    SPATIAL_VERSION,
    CaptureSummary,
    SpatialInput,
    SpatialResult,
    SpatialStreet,
)
from app.storage import models as db
from app.storage.results import ResultRepository
from app.storage.spatial import Capture, SpatialRepository


def join_key(layer):
    return tuple(tuple(p) for p in layer.geom.coordinates), str(layer.properties.get("osmid"))


def _fraction(value, maximum=1):
    if type(value) not in {float, int} or not math.isfinite(value) or not 0 <= value <= maximum:
        raise ValueError("value outside verified scale")
    return value / maximum


def static_value(collection, layer):
    p = layer.properties
    if collection == "bumpy_roads_heilbronn":
        if not layer.number_of_boxes:
            raise ValueError("roughness without contributing boxes")
        return "roughness", _fraction(p.get("Normalized Roughness"), 100), "percentage / 100"
    if collection == "traffic_flow_heilbronn":
        if not layer.points_in_segment:
            raise ValueError("flow without contributing points")
        return "flow", _fraction(p.get("avg_traffic_flow")), "normalized speed proxy"
    if collection == "overtaking_distance_heilbronn":
        text = p.get("Overtaking Distance Counts")
        if not isinstance(text, str) or len(text) > 200:
            raise ValueError("invalid histogram text")
        pieces = text.split(",")
        if len(pieces) != 5 or any(not x.strip().isdigit() for x in pieces):
            raise ValueError("expected five nonnegative integer bins")
        bins = [int(x.strip()) for x in pieces]
        if not sum(bins) or sum(bins) != layer.points_in_segment:
            raise ValueError("histogram and contributing points disagree")
        return "overtaking_share", sum(bins[:3]) / sum(bins), "share of distances below 150 cm"
    raise ValueError("unsupported static collection")


def build_streets(captures: list[Capture], road_ids: dict[str, int]):
    """Join a unique directed geometry only; conflicting contributions stay absent."""
    roads = next(c for c in captures if c.collection == "road_network_heilbronn")
    lookup = defaultdict(list)
    attributes, inputs, issues = defaultdict(dict), defaultdict(dict), Counter()
    for road in roads.layers:
        lookup[join_key(road)].append(road)
    candidates = defaultdict(list)
    for capture in captures:
        if capture.collection == roads.collection:
            continue
        for layer in capture.layers:
            matches = lookup.get(join_key(layer), [])
            if len(matches) != 1:
                issues[
                    f"{capture.collection}:ambiguous"
                    if matches
                    else f"{capture.collection}:unmatched"
                ] += 1
                continue
            candidates[(matches[0].feature_id, capture.collection)].append(layer)
    for (road_id, collection), layers in candidates.items():
        if len(layers) != 1:
            issues[f"{collection}:conflicting_contributions"] += len(layers)
            continue
        layer = layers[0]
        try:
            key, value, method = static_value(collection, layer)
        except ValueError:
            issues[f"{collection}:invalid_value"] += 1
            continue
        attributes[road_id][key] = value
        inputs[road_id][key] = SpatialInput(
            collection=collection,
            feature_id=layer.feature_id,
            raw_ref=layer.raw_ref,
            captured_at=layer.built_at,
            unit="fraction",
            method=method,
            boxes=layer.number_of_boxes,
            points=layer.points_in_segment,
        )
    segments, names = [], {}
    for road in roads.layers:
        identifier = str(road_ids[road.feature_id])
        segment = Segment(
            segment_id=identifier, coordinates=road.geom.coordinates, **attributes[road.feature_id]
        )
        segments.append(segment)
        names[identifier] = str(road.properties.get("name") or f"Road {road.feature_id}")
        inputs[identifier] = inputs.pop(road.feature_id, {})
        inputs[identifier]["geometry"] = SpatialInput(
            collection=roads.collection,
            feature_id=road.feature_id,
            raw_ref=road.raw_ref,
            captured_at=road.built_at,
            unit="WGS84",
            method="provider directed LineString",
        )
    return segments, names, inputs, issues


def process_spatial(repository: ResultRepository, *, since: datetime, now: datetime):
    since, now = utc(since), utc(now)
    if not 0 < (now - since).total_seconds() <= 31 * 86400:
        raise ValueError("reference window must be positive and at most 31 days")
    with source_lock(repository.engine, "processing:spatial") as acquired:
        if not acquired:
            raise RuntimeError("spatial processing already running")
        reader = SpatialRepository(repository.repository)
        captures = [
            c for collection in COLLECTIONS if (c := reader.latest_capture(collection)) is not None
        ]
        issues = Counter()
        for collection in COLLECTIONS:
            if not any(c.collection == collection for c in captures):
                issues[f"{collection}:missing_capture"] += 1
        roads = next((c for c in captures if c.collection == COLLECTIONS[0]), None)
        if roads is None:
            segments, names, inputs = [], {}, {}
        else:
            with repository.engine.connect() as conn:
                ids = dict(
                    conn.execute(
                        select(db.segment.c.feature_id, db.segment.c.id).where(
                            db.segment.c.collection == COLLECTIONS[0],
                        )
                    ).all()
                )
            segments, names, inputs, join_issues = build_streets(captures, ids)
            issues.update(join_issues)
        rows = repository.observations(
            since=since, until=now, retrieved_before=now, kind="observation"
        )
        readings, projection_issues = project(rows)
        issues.update(projection_issues)
        measured = [
            r.observation
            for r in readings
            if r.observation.kind == "observation"
            and (r.observation.platform == "mobile" or r.exposure == "outdoor")
        ]
        levels = {p: hourly_levels(measured, p) for p in (Phenomenon.PM2_5, Phenomenon.TEMPERATURE)}
        report = build_layers(
            segments,
            measured,
            levels[Phenomenon.PM2_5],
            levels[Phenomenon.TEMPERATURE],
            require_unique_match=True,
        )
        stations = station_ratios(measured, levels[Phenomenon.PM2_5])
        fill_uncovered(report, segments, stations, max_distance_m=2000)
        issues.update(
            mobile_without_reference=report.without_level, mobile_unmatched=report.unmatched
        )
        reference_points = {
            (o.longitude, o.latitude)
            for o in measured
            if o.platform == "stationary" and o.usable and o.phenomenon == Phenomenon.PM2_5
        }
        streets = []
        coverage = Counter()
        for segment in segments:
            layer = report.layers[segment.segment_id]
            coverage[layer.pm_source] += 1
            distance = min(
                (distance_m(segment.center, point) / 1000 for point in reference_points),
                default=None,
            )
            streets.append(
                SpatialStreet(
                    name=names[segment.segment_id],
                    segment=segment,
                    layer=layer,
                    inputs=inputs[segment.segment_id],
                    station_distance_km=distance,
                )
            )
        result = SpatialResult(
            streets=streets,
            reference_start=since,
            reference_end=now,
            captures=[
                CaptureSummary(
                    collection=c.collection,
                    captured_at=c.captured_at,
                    retrieved_at=c.retrieved_at,
                    reported_total=c.reported_total,
                    local=len(c.layers),
                    filtered=c.filtered,
                    raw_refs=c.raw_refs,
                )
                for c in captures
            ],
            measured_levels={
                str(p): {t.isoformat(): v for t, v in hours.items()} for p, hours in levels.items()
            },
            observation_raw_refs=sorted({o.raw_ref for o in measured if o.raw_ref}),
            issues=dict(issues),
            pm_coverage=dict(coverage),
        )
        return persist(
            repository,
            "spatial",
            result,
            "PARTIAL" if streets else "UNAVAILABLE",
            now,
            version=SPATIAL_VERSION,
        )
