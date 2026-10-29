"""Meaningful capture-to-spatial regression tests, with explicit sparse coverage."""

from datetime import timedelta

import pytest
from spatial_fixture import AS_OF, replay_layers
from sqlalchemy import create_engine

from app.processing.stored_spatial import build_streets, process_spatial, static_value
from app.schemas.spatial import SPATIAL_VERSION, SpatialResult
from app.storage import models as db
from app.storage.repository import Repository
from app.storage.results import ResultRepository
from app.storage.spatial import SpatialRepository


@pytest.fixture
def repository():
    engine = create_engine("sqlite://")
    db.metadata.create_all(engine)
    yield Repository(engine)
    engine.dispose()


def test_selected_real_layers_are_normalized_and_keep_original_evidence(repository):
    replay_layers(repository)
    results = ResultRepository(repository)
    snapshot = process_spatial(results, since=AS_OF - timedelta(days=1), now=AS_OF)
    result = SpatialResult.model_validate(snapshot.payload)
    assert snapshot.schema_version == SPATIAL_VERSION and snapshot.status == "PARTIAL"
    assert len(result.streets) == 2
    rough = next(s for s in result.streets if s.layer.roughness is not None)
    assert rough.layer.roughness == pytest.approx(22.142857142857142 / 100)
    assert rough.layer.flow == pytest.approx(0.3390459547104433)
    assert rough.inputs["roughness"].raw_ref > 0
    assert rough.inputs["roughness"].method == "percentage / 100"
    overtaking = next(s for s in result.streets if s.layer.overtaking_share is not None)
    assert overtaking.layer.overtaking_share == 1
    assert overtaking.inputs["overtaking_share"].points == 11
    assert all(s.layer.pm_source == "none" and s.layer.pm_samples == 0 for s in result.streets)
    assert result.pm_coverage == {"none": 2}
    assert not any(result.measured_levels.values())
    assert results.latest("spatial") is None  # Different contract version.
    assert results.latest("spatial", version=SPATIAL_VERSION) == snapshot
    assert process_spatial(results, since=AS_OF - timedelta(days=1), now=AS_OF) == snapshot


def test_direction_ambiguity_and_conflicting_static_contributions_remain_missing(repository):
    replay_layers(repository)
    reader = SpatialRepository(repository)
    roads = reader.latest_capture("road_network_heilbronn")
    roughness = reader.latest_capture("bumpy_roads_heilbronn")
    ids = {road.feature_id: i + 1 for i, road in enumerate(roads.layers)}
    original = roughness.layers[0]
    # Reversing the source line must not silently attach it to a directed edge.
    roughness.layers[:] = [
        original.model_copy(
            update={
                "geom": original.geom.model_copy(
                    update={"coordinates": original.geom.coordinates[::-1]}
                )
            }
        )
    ]
    segments, _, _, issues = build_streets([roads, roughness], ids)
    assert all(s.roughness is None for s in segments)
    assert issues["bumpy_roads_heilbronn:unmatched"] == 1
    roughness.layers[:] = [original, original]
    segments, _, _, issues = build_streets([roads, roughness], ids)
    assert all(s.roughness is None for s in segments)
    assert issues["bumpy_roads_heilbronn:conflicting_contributions"] == 2
    roughness.layers[:] = [original]
    roads.layers.append(roads.layers[0].model_copy(update={"feature_id": "ambiguous"}))
    ids["ambiguous"] = 3
    _, _, _, issues = build_streets([roads, roughness], ids)
    assert issues["bumpy_roads_heilbronn:ambiguous"] == 1


def test_invalid_values_and_histograms_are_not_clamped_or_guessed(repository):
    replay_layers(repository)
    reader = SpatialRepository(repository)
    rough = reader.latest_capture("bumpy_roads_heilbronn").layers[0]
    for value in (-1, 101, True, "22"):
        changed = rough.model_copy(update={"properties": {"Normalized Roughness": value}})
        with pytest.raises(ValueError):
            static_value(rough.collection, changed)
    overtake = reader.latest_capture("overtaking_distance_heilbronn").layers[0]
    for text in ("__import__('os')", "0,1,2", "0,-1,12,0,0", "0,0,0,0,0", "1,1,1,1,1"):
        changed = overtake.model_copy(update={"properties": {"Overtaking Distance Counts": text}})
        with pytest.raises(ValueError):
            static_value(overtake.collection, changed)


def test_missing_roads_cannot_publish_a_spatial_product(repository):
    results = ResultRepository(repository)
    snapshot = process_spatial(results, since=AS_OF - timedelta(days=1), now=AS_OF)
    assert snapshot.status == "UNAVAILABLE"
    assert results.latest("spatial", version=SPATIAL_VERSION) is None
    assert not snapshot.payload["streets"]


def test_canonical_mobile_samples_use_only_contemporaneous_outdoor_station_levels(repository):
    from app.ingestion.contracts import RawPayload
    from app.schemas.observation import Geometry, Observation, ProviderValue

    replay_layers(repository)
    road = SpatialRepository(repository).latest_capture("road_network_heilbronn").layers[0]
    coordinates = road.geom.coordinates[0]
    ref = repository.land_raw(
        RawPayload(
            source_id="synthetic_spatial_test",
            url="https://example.test/synthetic-only",
            retrieved_at_utc=AS_OF,
            body=b"explicitly synthetic canonical observation fixture",
        )
    )
    moment = AS_OF - timedelta(hours=1)
    observations = []
    for phenomenon, unit, stationary, mobile in [("pm25", "µg/m³", 10, 15), ("temp", "°C", 20, 24)]:
        for platform, exposure, value, count in [
            ("stationary", "outdoor", stationary, 1),
            ("stationary", "indoor", 99, 1),
            ("mobile", None, mobile, 20),
        ]:
            for i in range(count):
                observations.append(
                    Observation(
                        source="synthetic_spatial_test",
                        station_id=f"{platform}-{exposure}",
                        geom=Geometry(type="Point", coordinates=coordinates),
                        phenomenon=phenomenon,
                        value=value,
                        unit=unit,
                        ts_utc=moment,
                        raw_ref=ref,
                        provenance=ProviderValue(
                            platform=platform,
                            exposure=exposure,
                            sample_id=str(i) if platform == "mobile" else None,
                            raw_key=phenomenon,
                            raw_value=value,
                            raw_unit=unit,
                        ),
                    )
                )
    repository.ingest_page(ref, observations)
    snapshot = process_spatial(
        ResultRepository(repository), since=moment - timedelta(hours=1), now=AS_OF
    )
    result = SpatialResult.model_validate(snapshot.payload)
    layer = next(s.layer for s in result.streets if s.layer.pm_samples)
    assert layer.pm_samples == 20 and layer.pm_source == "samples"
    assert layer.pm_ratio == pytest.approx(1.5**0.5)
    assert layer.heat_anomaly == 2
    assert list(result.measured_levels["pm2_5"].values()) == [10]
    assert list(result.measured_levels["temperature"].values()) == [20]
    assert result.observation_raw_refs == [ref]


def test_postgresql_spatial_capture_json_geometry_and_version_restart():
    import os
    from datetime import UTC, datetime

    from sqlalchemy import delete, select

    url = os.environ.get("GREENAIR_TEST_DATABASE_URL")
    if not url:
        pytest.skip("requires migrated PostgreSQL")
    engine = create_engine(url)
    repository = Repository(engine)
    results = ResultRepository(repository)
    at = datetime(2096, 3, 2, 12, tzinfo=UTC)
    refs, build_id = [], None
    try:
        replay_layers(repository, at=at)
        with engine.connect() as conn:
            refs = (
                conn.execute(
                    select(db.raw_payload.c.id).where(
                        db.raw_payload.c.retrieved_at_utc == at,
                        db.raw_payload.c.source_id.like("atrai_%"),
                    )
                )
                .scalars()
                .all()
            )
        snapshot = process_spatial(results, since=at - timedelta(days=1), now=at)
        build_id = snapshot.build_id
        restored = ResultRepository(Repository(engine)).latest("spatial", version=SPATIAL_VERSION)
        assert restored == snapshot
        result = SpatialResult.model_validate(restored.payload)
        assert len(result.streets) == 2
        assert sum(s.layer.roughness is not None for s in result.streets) == 1
        assert result.pm_coverage == {"none": 2}
        assert process_spatial(results, since=at - timedelta(days=1), now=at) == restored
    finally:
        with engine.begin() as conn:
            if build_id:
                conn.execute(
                    delete(db.result_snapshot).where(db.result_snapshot.c.build_id == build_id)
                )
            for table in (db.segment_layer_value, db.feature_receipt, db.manifest, db.segment):
                conn.execute(delete(table).where(table.c.raw_ref.in_(refs)))
            conn.execute(delete(db.watermark).where(db.watermark.c.source_id.like("atrai_%")))
            conn.execute(delete(db.raw_payload).where(db.raw_payload.c.id.in_(refs)))
        engine.dispose()


def test_processing_cutoff_cannot_use_a_future_capture(repository):
    replay_layers(repository)
    reader = SpatialRepository(repository)
    assert (
        reader.latest_capture(
            "road_network_heilbronn", retrieved_before=AS_OF - timedelta(seconds=1)
        )
        is None
    )
    snapshot = process_spatial(
        ResultRepository(repository),
        since=AS_OF - timedelta(days=1),
        now=AS_OF - timedelta(seconds=1),
    )
    assert snapshot.status == "UNAVAILABLE" and not snapshot.payload["streets"]
