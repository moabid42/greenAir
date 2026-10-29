"""Processing pipeline: raw observations -> scores, in one process (docs/processing.md).

    uv run --locked python -m app.processing.pipeline INPUT.json [--output RESULT.json]

INPUT is a `PipelineInput` JSON document. The result is a `PipelineResult`. The
pipeline does not fetch data; ingestion supplies the raw observations.
"""

import argparse
import sys
from datetime import UTC, datetime
from pathlib import Path

from pydantic import AwareDatetime, BaseModel, Field

from app.processing.forecaster import forecast, model_series
from app.processing.normalizer import normalize_batch
from app.processing.spatial import Segment, build_layers, fill_uncovered, station_ratios
from app.processing.temporal import LIVE_WINDOW, climatology, hourly_levels
from app.schemas.observations import Phenomenon, RawObservation
from app.schemas.scores import (
    BestTime,
    ForecastSummary,
    LayerRecord,
    NormalizationSummary,
    PipelineResult,
    ScoreRecord,
)
from app.scoring.engine import best_times, score_segments
from app.scoring.profiles import Profile

P = Phenomenon
FORECAST_PHENOMENA = (
    P.PM2_5,
    P.NO2,
    P.O3,
    P.TEMPERATURE,
    P.RELATIVE_HUMIDITY,
    P.WIND_SPEED,
    P.PRECIPITATION,
    P.UV_INDEX,
)


class PipelineInput(BaseModel):
    issued_at: AwareDatetime
    raw_observations: list[RawObservation]
    segments: list[Segment]
    profiles: list[Profile] = Field(default_factory=lambda: list(Profile))
    horizon_hours: int = Field(default=24, ge=1, le=48)
    severe_weather_alert: bool = False
    # §3.5 is optional in the draft; keep gamma = 1 until validated.
    rush_hour_contrast: bool = False


def run(request: PipelineInput) -> PipelineResult:
    report = normalize_batch(request.raw_observations)
    observations = report.observations
    issued_at = request.issued_at.astimezone(UTC)

    levels = {p: hourly_levels(observations, p) for p in FORECAST_PHENOMENA}
    climatologies = {p: climatology(series) for p, series in levels.items() if series}
    forecasts = {}
    for phenomenon in FORECAST_PHENOMENA:
        result = forecast(
            phenomenon,
            issued_at,
            levels[phenomenon],
            model_series(observations, phenomenon) or None,
            climatologies.get(phenomenon),
            request.horizon_hours,
        )
        if result is not None and result.points:
            forecasts[phenomenon] = result

    spatial = build_layers(request.segments, observations, levels[P.PM2_5], levels[P.TEMPERATURE])
    fill_uncovered(spatial, request.segments, station_ratios(observations, levels[P.PM2_5]))
    live_stations = sorted(
        {
            (obs.longitude, obs.latitude)
            for obs in observations
            if obs.platform == "stationary"
            and obs.kind == "observation"
            and obs.usable
            and issued_at - LIVE_WINDOW <= obs.observed_at <= issued_at
        }
    )
    scores = score_segments(
        request.segments,
        spatial.layers,
        forecasts,
        request.profiles,
        issued_at,
        live_stations,
        request.horizon_hours,
        request.severe_weather_alert,
        climatologies.get(P.NO2) if request.rush_hour_contrast else None,
    )

    return PipelineResult(
        issued_at=issued_at,
        generated_at=datetime.now(UTC),
        normalization=NormalizationSummary(
            observations=len(observations),
            duplicates=report.duplicates,
            unmapped_keys=dict(report.unmapped_keys),
            qc_flags={str(flag): count for flag, count in report.flag_counts.items()},
        ),
        forecasts=[
            ForecastSummary(
                phenomenon=str(phenomenon),
                method=result.method,
                correction=result.correction,
                points=len(result.points),
            )
            for phenomenon, result in forecasts.items()
        ],
        layers=[LayerRecord(**layer.__dict__) for layer in spatial.layers.values()],
        scores=[
            ScoreRecord(
                segment_id=item.segment_id,
                profile=item.profile,
                at=item.at,
                hours_ahead=item.hours_ahead,
                score=item.score,
                confidence=item.confidence,
                components={str(key): value for key, value in item.components.items()},
                gates=item.gates,
            )
            for item in scores
        ],
        best_times=[
            BestTime(segment_id=segment_id, profile=profile, windows=windows)
            for (segment_id, profile), windows in best_times(scores).items()
        ],
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=Path, help="PipelineInput JSON file")
    parser.add_argument("--output", type=Path, help="write the result here instead of stdout")
    args = parser.parse_args(argv)

    request = PipelineInput.model_validate_json(args.input.read_text(encoding="utf-8"))
    document = run(request).model_dump_json(indent=2)
    if args.output:
        args.output.write_text(document + "\n", encoding="utf-8")
    else:
        sys.stdout.write(document + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
