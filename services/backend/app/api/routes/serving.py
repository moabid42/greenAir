"""Read-only application queries with frontend-compatible aliases."""

from datetime import date as Date
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from app.api.errors import ERROR_RESPONSES
from app.processing.spatial import point_to_line_m
from app.schemas.serving import (
    BestTimesResponse,
    DayForecast,
    GridResponse,
    ListSegmentsResponse,
    ListSensorsResponse,
    ScoreSnapshot,
    SegmentDetail,
    SegmentFeature,
    Sensor,
    ServiceStatus,
    SportProfile,
)
from app.serving.demo import LOCAL_TZ
from app.serving.repository import ServingRepository

router = APIRouter(responses=ERROR_RESPONSES)
UtcHour = Annotated[
    str,
    Query(
        pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:00:00Z$",
        examples=["2026-10-29T12:00:00Z"],
        description="UTC hour, exactly YYYY-MM-DDTHH:00:00Z.",
    ),
]
PageSize = Annotated[int, Query(ge=1, le=100, description="Maximum resources per page.")]
PageToken = Annotated[str, Query(max_length=200, description="Token from the previous response.")]
Latitude = Annotated[float, Query(ge=-90, le=90, examples=[49.1425])]
Longitude = Annotated[float, Query(ge=-180, le=180, examples=[9.2115])]


def get_repository(request: Request) -> ServingRepository:
    return request.app.state.serving_repository


Repository = Annotated[ServingRepository, Depends(get_repository)]


def check_date(selected: Date) -> None:
    if not Date(2020, 1, 1) <= selected <= Date(2100, 12, 31):
        raise HTTPException(404, "Demo dates are supported from 2020-01-01 through 2100-12-31.")


def parse_hour(t: str) -> datetime:
    try:
        moment = datetime.fromisoformat(t)
    except ValueError as error:
        raise HTTPException(400, "Use a valid UTC calendar hour.") from error
    check_date(moment.astimezone(LOCAL_TZ).date())
    return moment


def page(items: list, page_size: int, page_token: str) -> tuple[list, str]:
    # A versioned cursor, deliberately independent of future database row identities.
    if page_token:
        if not page_token.startswith("mock-v1-") or not page_token[8:].isdigit():
            raise HTTPException(400, "Use next_page_token from a previous response.")
        offset = int(page_token[8:])
        if offset > len(items):
            raise HTTPException(400, "Page token is beyond this collection.")
    else:
        offset = 0
    end = offset + page_size
    return items[offset:end], f"mock-v1-{end}" if end < len(items) else ""


def set_headers(response: Response, repository: ServingRepository, max_age: int = 300) -> None:
    response.headers["Cache-Control"] = f"public, max-age={max_age}"
    response.headers["X-Data-Source"] = "mock"
    response.headers["X-Build-Id"] = repository.build_id


@router.get(
    "/api/v1/day",
    response_model=DayForecast,
    tags=["Frontend compatibility"],
    operation_id="GetFrontendDay",
    summary="Get hourly city conditions",
)
@router.get(
    "/v1/days/{date}",
    response_model=DayForecast,
    tags=["Conditions"],
    operation_id="GetDay",
    summary="Get a day resource",
)
def get_day(date: Date, response: Response, repository: Repository) -> DayForecast:
    """Return 24 Berlin wall-clock slots, including on DST days. All values are mock.

    The frontend applies sport weights to the factor scores; this response has no combined index.
    Try date `2026-10-29`. Supported demo dates: 2020-01-01 through 2100-12-31.
    """
    check_date(date)
    set_headers(response, repository)
    return repository.day(date)


@router.get(
    "/api/v1/grid",
    response_model=GridResponse,
    tags=["Frontend compatibility"],
    operation_id="GetFrontendGrid",
    summary="Get the city factor grid",
)
@router.get(
    "/v1/grids/{date}",
    response_model=GridResponse,
    tags=["Conditions"],
    operation_id="GetGrid",
    summary="Get a grid resource",
)
def get_grid(date: Date, response: Response, repository: Repository) -> GridResponse:
    """Return synthetic 250 m cells over the frontend viewport, with stable IDs and 24 scores
    per factor. Geometry and values are for demonstration, not verified environmental coverage.
    Try date `2026-10-29`. The response is compressed when the client accepts gzip.
    """
    check_date(date)
    set_headers(response, repository)
    return repository.grid(date)


@router.get(
    "/api/v1/sensors",
    response_model=list[Sensor],
    tags=["Frontend compatibility"],
    operation_id="GetFrontendSensors",
    summary="Get demo sensor markers",
)
def frontend_sensors(response: Response, repository: Repository) -> list[Sensor]:
    """Return synthetic markers in the existing frontend's array format. None are real stations."""
    set_headers(response, repository, 60)
    return repository.sensors()


@router.get(
    "/v1/sensors",
    response_model=ListSensorsResponse,
    tags=["Sensors"],
    operation_id="ListSensors",
    summary="List sensor resources",
)
def list_sensors(
    response: Response, repository: Repository, page_size: PageSize = 50, page_token: PageToken = ""
) -> ListSensorsResponse:
    """List synthetic sensor resources with bounded pagination."""
    set_headers(response, repository, 60)
    sensors, token = page(repository.sensors(), page_size, page_token)
    return ListSensorsResponse(sensors=sensors, next_page_token=token)


@router.get(
    "/v1/sensors/{sensor_id}",
    response_model=Sensor,
    tags=["Sensors"],
    operation_id="GetSensor",
    summary="Get a sensor resource",
)
def get_sensor(sensor_id: str, repository: Repository) -> Sensor:
    """Get a synthetic sensor by stable ID, for example `mock-1`."""
    sensor = next((s for s in repository.sensors() if s.id == sensor_id), None)
    if sensor is None:
        raise HTTPException(404, "Sensor not found. List sensors to select a supported ID.")
    return sensor


@router.get(
    "/segments",
    response_model=ListSegmentsResponse,
    tags=["Frontend compatibility"],
    operation_id="GetFrontendSegments",
    summary="Get demo street GeoJSON",
)
@router.get(
    "/v1/segments",
    response_model=ListSegmentsResponse,
    tags=["Street scores"],
    operation_id="ListSegments",
    summary="List segment resources",
)
def list_segments(
    repository: Repository,
    page_size: PageSize = 50,
    page_token: PageToken = "",
    bbox: Annotated[
        str | None,
        Query(
            description="Optional west,south,east,north WGS84 bounding box.",
            examples=["9.15,49.105,9.275,49.178"],
        ),
    ] = None,
) -> ListSegmentsResponse:
    """Return invented demo lines as GeoJSON. IDs match the score responses. Vector tiles
    are deferred; this endpoint supports small GeoJSON overlays without a tile server.
    """
    segments = repository.segments()
    if bbox is not None:
        try:
            west, south, east, north = map(float, bbox.split(","))
            if not (-180 <= west < east <= 180 and -90 <= south < north <= 90):
                raise ValueError
        except ValueError as error:
            raise HTTPException(
                400, "bbox must be west,south,east,north with increasing bounds."
            ) from error
        segments = [
            s
            for s in segments
            if (
                min(p[0] for p in s.geometry.coordinates) <= east
                and max(p[0] for p in s.geometry.coordinates) >= west
                and min(p[1] for p in s.geometry.coordinates) <= north
                and max(p[1] for p in s.geometry.coordinates) >= south
            )
        ]
    features, token = page(segments, page_size, page_token)
    return ListSegmentsResponse(
        features=features, next_page_token=token, build_id=repository.build_id
    )


@router.get(
    "/v1/segments/{segment_id}",
    response_model=SegmentFeature,
    tags=["Street scores"],
    operation_id="GetSegment",
    summary="Get a segment resource",
)
def get_segment(segment_id: int, repository: Repository) -> SegmentFeature:
    """Get one invented demo line, for example segment `1`."""
    segment = next(
        (s for s in repository.segments() if s.properties.segment_id == segment_id), None
    )
    if segment is None:
        raise HTTPException(404, "Segment not found. List segments to select a supported ID.")
    return segment


@router.get(
    "/scores",
    response_model=ScoreSnapshot,
    tags=["Frontend compatibility"],
    operation_id="GetFrontendScores",
    summary="Get street scores for one hour",
)
@router.get(
    "/v1/scores",
    response_model=ScoreSnapshot,
    tags=["Street scores"],
    operation_id="ListScores",
    summary="List scores for a profile and UTC hour",
)
def list_scores(profile: SportProfile, t: UtcHour, repository: Repository) -> ScoreSnapshot:
    """Run the existing sport scoring engine on synthetic inputs. `kind=forecast` describes
    the time category; `source=mock` identifies provenance. Confidence is zero because there
    is no verified coverage. Integer segment IDs match `/v1/segments`.
    """
    moment = parse_hour(t)
    details = [
        repository.detail(s.properties.segment_id, profile, moment) for s in repository.segments()
    ]
    return ScoreSnapshot(
        profile=profile,
        t=t,
        version="mock-scoring-v1",
        build_id=repository.build_id,
        scores={str(d.segment_id): (round(d.score), d.confidence, 0) for d in details},
    )


@router.get(
    "/score",
    response_model=SegmentDetail,
    tags=["Frontend compatibility"],
    operation_id="GetFrontendScore",
    summary="Get street conditions near a point",
)
@router.get(
    "/v1/scores:lookup",
    response_model=SegmentDetail,
    tags=["Street scores"],
    operation_id="LookupScore",
    summary="Look up a score by location",
)
def lookup_score(
    lat: Latitude, lon: Longitude, profile: SportProfile, t: UtcHour, repository: Repository
) -> SegmentDetail:
    """Find the nearest demo line within 200 m; return NOT_FOUND outside that coverage.
    Try lat=49.1425, lon=9.2115, profile=running, t=2026-10-29T12:00:00Z.
    Component values are goodness scores (0–100), not raw pollutant measurements.
    """
    moment = parse_hour(t)
    segments = repository.segments()
    if not segments:
        raise HTTPException(404, "No street data is available here.")
    nearest = min(segments, key=lambda s: point_to_line_m((lon, lat), s.geometry.coordinates))
    if point_to_line_m((lon, lat), nearest.geometry.coordinates) > 200:
        raise HTTPException(404, "No street data is available within 200 m.")
    return repository.detail(nearest.properties.segment_id, profile, moment)


@router.get(
    "/v1/segments/{segment_id}/bestTimes/{date}",
    response_model=BestTimesResponse,
    tags=["Street scores"],
    operation_id="GetBestTimes",
    summary="Get recommended hours",
)
@router.get(
    "/best-time",
    response_model=BestTimesResponse,
    tags=["Frontend compatibility"],
    operation_id="GetFrontendBestTimes",
    summary="Get recommended hours for a segment",
)
def best_times(
    segment_id: int, date: Date, profile: SportProfile, repository: Repository
) -> BestTimesResponse:
    """Return up to three distinct one-hour recommendations using synthetic scores.
    Try segment_id=1, date=2026-10-29, profile=running. This is not an exercise safety guarantee.
    """
    check_date(date)
    try:
        return repository.best_times(segment_id, profile, date)
    except KeyError as error:
        raise HTTPException(404, "Segment not found.") from error


@router.get(
    "/status",
    response_model=ServiceStatus,
    tags=["Frontend compatibility"],
    operation_id="GetFrontendStatus",
    summary="Get data build status",
)
@router.get(
    "/v1/status",
    response_model=ServiceStatus,
    tags=["Operations"],
    operation_id="GetStatus",
    summary="Get serving status",
)
def get_status(repository: Repository) -> ServiceStatus:
    """Report the active mock geometry build and disconnected pipeline. This is separate
    from process liveness (`/health`). SSE and upstream refresh are deferred.
    """
    return ServiceStatus(
        build_id=repository.build_id,
        generated_at=repository.generated_at,
        sources=[{"id": "dummy", "status": "ok", "source": "mock"}],
    )
