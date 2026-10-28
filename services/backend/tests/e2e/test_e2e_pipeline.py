"""Full processing run through the command-line entry point, as a separate process."""

import json
import subprocess
import sys
from datetime import timedelta
from pathlib import Path

import pytest

from app.schemas.scores import PipelineResult
from tests.e2e import synthetic

SERVICE_ROOT = Path(__file__).resolve().parents[2]
ISSUED = synthetic.START + timedelta(hours=synthetic.HOURS - 1, minutes=15)  # Sun 23:15 UTC
RUSH_UTC = {6, 7, 16, 17}  # Monday 07-08 and 17-18 CET


@pytest.fixture(scope="module")
def result(tmp_path_factory):
    records = (
        synthetic.station_records()
        + synthetic.model_records()
        + synthetic.weather_model_records()
        + synthetic.mobile_records()
    )
    bundle = {
        "issued_at": ISSUED.isoformat(),
        "raw_observations": [json.loads(record.model_dump_json()) for record in records],
        "segments": synthetic.SEGMENTS,
    }
    directory = tmp_path_factory.mktemp("pipeline")
    source = directory / "input.json"
    source.write_text(json.dumps(bundle), encoding="utf-8")

    completed = subprocess.run(
        [sys.executable, "-m", "app.processing.pipeline", str(source)],
        cwd=SERVICE_ROOT,
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    return PipelineResult.model_validate_json(completed.stdout)


def scores_for(result, segment_id, profile):
    return {
        item.at.hour: item
        for item in result.scores
        if item.segment_id == segment_id and item.profile == profile
    }


def test_run_summarizes_inputs_and_forecast_methods(result):
    assert result.normalization.qc_flags["humid_pm"] == 10
    assert result.normalization.qc_flags["stuck"] == 24
    methods = {f.phenomenon: (f.method, f.correction) for f in result.forecasts}
    assert methods["pm2_5"][0] == "model_bias_corrected"
    assert methods["pm2_5"][1] == pytest.approx(2.0, abs=0.01)
    assert methods["temperature"][0] == "model_bias_corrected"
    assert methods["temperature"][1] == pytest.approx(0.0, abs=0.05)
    # No station measures wind or rain, so their model output is used uncorrected.
    assert methods["precipitation"] == ("model_uncorrected", None)
    assert "no2" not in methods


def test_layers_and_scores_are_labelled_derived(result):
    layers = {layer.segment_id: layer for layer in result.layers}
    assert layers["seg-busy"].pm_source == "samples"
    assert layers["seg-uncovered"].pm_source == "idw"
    assert all(layer.kind == "derived" for layer in result.layers)

    assert len(result.scores) == 3 * 24 * 3
    assert all(item.kind == "derived" for item in result.scores)
    assert {item.hours_ahead for item in result.scores} == set(range(1, 25))


def test_rain_gate_and_daylight(result):
    busy = scores_for(result, "seg-busy", "road_cycling")
    assert busy[synthetic.RAIN_HOUR.hour].score == 0
    assert busy[synthetic.RAIN_HOUR.hour].gates["rain"] == 0
    assert busy[2].components["daylight"] == 0.8  # 03:00 CET, dark
    assert busy[11].components["daylight"] == 1.0  # 12:00 CET


def test_park_beats_busy_street_in_rush_hour(result):
    busy = scores_for(result, "seg-busy", "running")
    park = scores_for(result, "seg-park", "running")
    for hour in RUSH_UTC:
        assert park[hour].score > busy[hour].score
    # The rush-hour PM level lowers the busy street's score against midday.
    assert busy[7].components["pm25"] < busy[10].components["pm25"]


def test_best_times_avoid_rush_hours_and_rain(result):
    best = {(b.segment_id, b.profile): b.windows for b in result.best_times}
    assert len(best) == 9
    for (segment_id, _), windows in best.items():
        assert len(windows) == 3
        for at, _ in windows:
            assert at.hour not in RUSH_UTC | {synthetic.RAIN_HOUR.hour}, segment_id


def test_confidence_reflects_coverage(result):
    busy = scores_for(result, "seg-busy", "walking")
    uncovered = scores_for(result, "seg-uncovered", "walking")
    assert all(uncovered[hour].confidence <= 0.3 for hour in uncovered)
    assert busy[0].confidence > uncovered[0].confidence
    assert busy[23].confidence < busy[0].confidence  # longer horizon
