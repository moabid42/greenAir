from collections import Counter
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request

from app.core.config import Settings
from app.ingestion.adapters.opensensemap import UpstreamError, fetch_boxes, parse_boxes
from app.processing.station_status import classify
from app.schemas.stations import StationStatusResponse
from app.serving.demo import DemoRepository

router = APIRouter(tags=["stations"])

BoxFetcher = Callable[[Settings], list[dict[str, Any]]]


def get_box_fetcher(request: Request) -> BoxFetcher:
    if request.app.state.settings.station_data_mode == "mock":
        # Exercise the same parser/classifier without contacting a provider.
        repository = DemoRepository()

        def mock_boxes(settings: Settings) -> list[dict[str, Any]]:
            return [
                {
                    "_id": sensor.id,
                    "name": sensor.name,
                    "grouptag": ["demo"],
                    "currentLocation": {"coordinates": [sensor.lng, sensor.lat]},
                    "lastMeasurementAt": sensor.updated_at.isoformat(),
                    "sensors": [
                        {
                            "_id": f"{sensor.id}-{key}",
                            "title": key,
                            "unit": None,
                            "lastMeasurement": {
                                "value": str(value),
                                "createdAt": sensor.updated_at.isoformat(),
                            },
                        }
                        for key, value in sensor.latest.items()
                        if value is not None
                    ],
                }
                for sensor in repository.sensors()
            ]

        return mock_boxes
    return lambda settings: fetch_boxes(
        settings.opensensemap_base_url,
        settings.opensensemap_grouptag,
        settings.opensensemap_timeout_seconds,
    )


@router.get("/stations/status", response_model=StationStatusResponse)
def station_status(
    request: Request, fetcher: Annotated[BoxFetcher, Depends(get_box_fetcher)]
) -> StationStatusResponse:
    """Live upload status and latest readings of the Green City stationary senseBoxes."""
    settings: Settings = request.app.state.settings
    try:
        snapshots = parse_boxes(fetcher(settings))
    except UpstreamError as error:
        raise HTTPException(status_code=502, detail=f"openSenseMap unavailable: {error}") from error
    retrieved_at = datetime.now(UTC)
    stale_after = timedelta(minutes=settings.station_stale_after_minutes)
    stations = [classify(snapshot, retrieved_at, stale_after) for snapshot in snapshots]
    states = Counter(station.state for station in stations)
    return StationStatusResponse(
        source="mock" if settings.station_data_mode == "mock" else "opensensemap",
        grouptag=settings.opensensemap_grouptag,
        retrieved_at=retrieved_at,
        stale_after_minutes=settings.station_stale_after_minutes,
        counts={state: states.get(state, 0) for state in ("online", "stale", "no_data")},
        stations=stations,
    )
