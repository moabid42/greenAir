"""Serving boundary: replace the provider without changing HTTP contracts."""

from datetime import date, datetime
from typing import Protocol

from app.schemas.serving import (
    BestTimesResponse,
    DayForecast,
    GridResponse,
    SegmentDetail,
    SegmentFeature,
    Sensor,
    SportProfile,
)


class ServingRepository(Protocol):
    build_id: str
    generated_at: datetime

    def day(self, selected: date) -> DayForecast: ...
    def grid(self, selected: date) -> GridResponse: ...
    def sensors(self) -> list[Sensor]: ...
    def segments(self) -> list[SegmentFeature]: ...
    def detail(self, segment_id: int, profile: SportProfile, moment: datetime) -> SegmentDetail: ...
    def best_times(
        self, segment_id: int, profile: SportProfile, selected: date
    ) -> BestTimesResponse: ...
