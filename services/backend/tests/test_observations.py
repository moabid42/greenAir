from datetime import UTC, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.schemas.observations import (
    BLOCKING_FLAGS,
    CANONICAL_UNITS,
    Observation,
    Phenomenon,
    QcFlag,
    RawObservation,
)

BERLIN_SUMMER = timezone(timedelta(hours=2))


def observation(**overrides):
    fields = {
        "source": "opensensemap",
        "station_id": "box-1",
        "platform": "stationary",
        "kind": "observation",
        "phenomenon": Phenomenon.TEMPERATURE,
        "value": 21.5,
        "unit": "°C",
        "observed_at": datetime(2026, 7, 1, 14, 0, tzinfo=BERLIN_SUMMER),
        "longitude": 9.2109,
        "latitude": 49.1427,
        "raw_key": "Temperatur",
        "raw_value": "21.5",
        "raw_unit": "°C",
    }
    return Observation(**(fields | overrides))


def test_every_phenomenon_has_a_canonical_unit():
    assert set(CANONICAL_UNITS) == set(Phenomenon)


def test_observation_converts_time_to_utc():
    assert observation().observed_at == datetime(2026, 7, 1, 12, 0, tzinfo=UTC)
    assert observation().observed_at.utcoffset() == timedelta(0)


def test_observation_rejects_naive_time_and_wrong_unit():
    with pytest.raises(ValidationError):
        observation(observed_at=datetime(2026, 7, 1, 12, 0))
    with pytest.raises(ValidationError, match="must use"):
        observation(unit="K")


@pytest.mark.parametrize(("longitude", "latitude"), [(181, 49), (9, 91)])
def test_coordinates_are_wgs84_longitude_latitude(longitude, latitude):
    with pytest.raises(ValidationError):
        observation(longitude=longitude, latitude=latitude)


def test_usable_requires_value_and_no_blocking_flag():
    assert observation().usable
    assert observation(qc_flags=(QcFlag.ASSUMED_UTC, QcFlag.ASSUMED_UNIT)).usable
    assert not observation(value=None).usable
    for flag in BLOCKING_FLAGS:
        assert not observation(qc_flags=(flag,)).usable


def test_key_separates_sources_and_mobile_samples():
    assert observation().key != observation(source="atrai").key
    assert observation(sample_id="a").key != observation(sample_id="b").key


def test_raw_observation_keeps_provider_values_and_allows_naive_time():
    raw = RawObservation(
        source="atrai",
        station_id="69bd6c0f867a8a00078bebc4",
        platform="stationary",
        raw_key="Finedust PM2.5",
        raw_value=3.82,
        observed_at=datetime(2026, 7, 8, 23, 19, 53),
        longitude=8.989321,
        latitude=49.15711,
    )
    assert raw.kind == "observation"
    assert raw.observed_at.tzinfo is None
    with pytest.raises(ValidationError):
        RawObservation(**(raw.model_dump() | {"retrieved_at": datetime(2026, 10, 28)}))
