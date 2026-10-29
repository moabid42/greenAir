from datetime import timedelta

import pytest

from app.processing.forecaster import forecast, model_series
from app.processing.normalizer import normalize_batch
from app.processing.temporal import climatology, hourly_levels
from app.schemas.observations import Phenomenon
from tests.e2e import synthetic
from tests.e2e.conftest import bus_round_trip

P = Phenomenon
ISSUED = synthetic.START + timedelta(hours=synthetic.HOURS - 1, minutes=15)


@pytest.fixture(scope="module")
def observations():
    records = synthetic.station_records() + synthetic.model_records()
    return normalize_batch(bus_round_trip(records)).observations


def test_model_forecast_corrects_the_model_bias(observations):
    levels = hourly_levels(observations, P.PM2_5)
    model = model_series(observations, P.PM2_5)
    assert all(hour not in levels for hour in list(model)[-24:])  # model-only future

    result = forecast(P.PM2_5, ISSUED, levels, model)

    assert result.method == "model_bias_corrected"
    assert result.correction == pytest.approx(2.0, abs=0.01)
    assert len(result.points) == 24
    for point in result.points:
        assert point.value == pytest.approx(synthetic.pm25_level(point.at), abs=0.1)
    assert max(point.value for point in result.points) == pytest.approx(20.0, abs=0.1)


def test_climatology_forecast_without_model(observations):
    levels = hourly_levels(observations, P.PM2_5)
    result = forecast(P.PM2_5, ISSUED, levels, climatology=climatology(levels))

    assert result.method == "climatology_decay"
    assert result.correction == pytest.approx(1.0, abs=0.01)
    for point in result.points:
        assert point.value == pytest.approx(synthetic.pm25_level(point.at), abs=0.1)
