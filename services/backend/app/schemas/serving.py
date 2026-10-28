"""Public demo contracts. Mock values are synthetic, never provider observations."""

from datetime import date, datetime
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

Score = Annotated[float, Field(ge=0, le=100)]
Fraction = Annotated[float, Field(ge=0, le=1)]
HourlyScores = Annotated[list[Score], Field(min_length=24, max_length=24)]
Point = tuple[float, float]


class ClientModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Factors(BaseModel):
    heat: Score
    air: Score
    wind: Score
    traffic: Score
    light: Score
    safety: Score


class HourConditions(ClientModel):
    hour: int = Field(ge=0, le=23, description="Europe/Berlin wall-clock hour.")
    temp_c: float = Field(description="Synthetic air temperature in degrees Celsius.")
    humidity: float = Field(ge=0, le=100, description="Relative humidity, percent.")
    pm25: float = Field(ge=0, description="Synthetic PM2.5, µg/m³.")
    no2: float = Field(ge=0, description="Synthetic NO₂, µg/m³.")
    wind_kmh: float = Field(ge=0, description="Wind speed, km/h.")
    rush: Fraction
    daylight: Fraction
    factors: Factors


class DayForecast(ClientModel):
    name: str = Field(description="Resource name: days/YYYY-MM-DD.")
    date: date
    timezone: Literal["Europe/Berlin"] = "Europe/Berlin"
    generated_at: AwareDatetime
    source: Literal["mock"] = "mock"
    hours: list[HourConditions] = Field(min_length=24, max_length=24)


class CellProperties(BaseModel):
    id: str
    place: str
    heat: HourlyScores
    air: HourlyScores
    wind: HourlyScores
    traffic: HourlyScores
    light: HourlyScores
    safety: Score | None
    green: Fraction


class Polygon(BaseModel):
    type: Literal["Polygon"] = "Polygon"
    coordinates: list[list[Point]]


class GridFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: Polygon
    properties: CellProperties


class GridCells(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[GridFeature]


class GridResponse(ClientModel):
    name: str
    date: date
    cell_size_m: float = Field(gt=0)
    source: Literal["mock"] = "mock"
    generated_at: AwareDatetime
    cells: GridCells


class Sensor(ClientModel):
    name: str = Field(description="Display name, retained for frontend compatibility.")
    id: str
    resource_name: str = Field(description="Resource name: sensors/{id}.")
    kind: Literal["sensebox_home", "lubw", "bike_counter"]
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    latest: dict[str, float | None]
    updated_at: AwareDatetime | None
    source: Literal["mock"] = "mock"


class ListSensorsResponse(BaseModel):
    sensors: list[Sensor]
    next_page_token: str = ""


class LineString(BaseModel):
    type: Literal["LineString"] = "LineString"
    coordinates: list[Point] = Field(min_length=2)


class SegmentProperties(BaseModel):
    segment_id: int
    name: str
    resource_name: str
    coverage: Literal["mock"] = "mock"


class SegmentFeature(BaseModel):
    type: Literal["Feature"] = "Feature"
    geometry: LineString
    properties: SegmentProperties


class ListSegmentsResponse(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[SegmentFeature]
    next_page_token: str = ""
    source: Literal["mock"] = "mock"
    build_id: str


class SportProfile(StrEnum):
    RUNNING = "running"
    CYCLING = "cycling"
    WALKING = "walking"


class ScoreSnapshot(BaseModel):
    profile: SportProfile
    t: str = Field(description="Requested UTC hour, echoed unchanged.")
    # Forecast describes the temporal category; source always identifies synthetic provenance.
    kind: Literal["forecast"] = "forecast"
    source: Literal["mock"] = "mock"
    version: str
    build_id: str
    scores: dict[str, tuple[Annotated[int, Field(ge=0, le=100)], Fraction, int]]


class ScoreComponent(BaseModel):
    key: str
    label: str
    value: float | None
    unit: str
    weight: float
    source: Literal["mock"] = "mock"


class SegmentDetail(BaseModel):
    segment_id: int
    name: str
    profile: SportProfile
    t: str
    kind: Literal["forecast"] = "forecast"
    source: Literal["mock"] = "mock"
    score: Score
    confidence: Fraction
    components: list[ScoreComponent]
    gates: list[str]
    missing: list[str]


class TimeWindow(BaseModel):
    at: AwareDatetime
    score: Score


class BestTimesResponse(BaseModel):
    name: str
    segment_id: int
    profile: SportProfile
    date: date
    timezone: Literal["Europe/Berlin"] = "Europe/Berlin"
    source: Literal["mock"] = "mock"
    windows: list[TimeWindow]


class ServiceStatus(BaseModel):
    name: Literal["status"] = "status"
    build_id: str
    source: Literal["mock"] = "mock"
    generated_at: datetime
    pipeline_connected: Literal[False] = False
    sources: list[dict[str, str]]
