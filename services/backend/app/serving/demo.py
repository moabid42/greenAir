"""Deterministic SYNTHETIC inputs. No downloads, actual stations, or verified coverage.

The grid uses the frontend's documented Heilbronn viewport. Every value and street
line is invented for development. Core factor scores follow its contract; optional
street scores use the existing backend sport scoring engine. They are separate APIs.
"""

import math
from datetime import UTC, date, datetime, time
from zoneinfo import ZoneInfo

from app.processing.forecaster import Forecast, ForecastPoint
from app.processing.spatial import Segment, SegmentLayer
from app.schemas.observations import Phenomenon as P
from app.schemas.serving import (
    BestTimesResponse,
    CellProperties,
    DayForecast,
    Factors,
    GridCells,
    GridFeature,
    GridResponse,
    HourConditions,
    LineString,
    Polygon,
    ScoreComponent,
    SegmentDetail,
    SegmentFeature,
    SegmentProperties,
    Sensor,
    SportProfile,
    TimeWindow,
)
from app.scoring.engine import score_hour
from app.scoring.profiles import WEIGHTS, Profile
from app.scoring.score import best_windows

LOCAL_TZ = ZoneInfo("Europe/Berlin")
BOUNDS = (9.15, 49.105, 9.275, 49.178)
PROFILE = {
    SportProfile.RUNNING: Profile.RUNNING,
    SportProfile.CYCLING: Profile.ROAD_CYCLING,
    SportProfile.WALKING: Profile.WALKING,
}


def clamp(value: float) -> float:
    return round(max(0, min(100, value)), 2)


def factors(
    temp: float,
    humidity: float,
    pm: float,
    no2: float,
    wind: float,
    rush: float,
    light: float,
    exposure: float = 0.5,
) -> Factors:
    perceived = temp + (humidity - 60) * 0.1 if temp > 20 and humidity > 60 else temp
    heat = 100 - max(0, perceived - 18) * 6.5 - max(0, 5 - perceived) * 5
    return Factors(
        heat=clamp(heat),
        air=clamp(100 - pm / 25 * 55 - no2 / 100 * 45),
        wind=clamp(100 - max(0, wind - 15) * 3),
        traffic=clamp(100 - rush * (15 + exposure * 85)),
        light=clamp(max(light * 100, 25)),
        safety=65,
    )


class DemoRepository:
    build_id = "mock-segments-v1"

    def __init__(self) -> None:
        self.generated_at = datetime.now(UTC)

    def day(self, selected: date) -> DayForecast:
        seasonal = math.cos(2 * math.pi * (selected.timetuple().tm_yday - 200) / 365)
        hours = []
        for hour in range(24):
            wave = math.cos(2 * math.pi * (hour - 15) / 24)
            temp = round(13 + 11 * seasonal + 5 * wave, 1)
            humidity = round(65 - 12 * wave, 1)
            rush = math.exp(-(((hour - 8) / 1.5) ** 2)) + 0.85 * math.exp(
                -(((hour - 17) / 1.8) ** 2)
            )
            rush = round(min(1, rush) * (0.3 if selected.weekday() >= 5 else 1), 3)
            pm, no2 = round(7 + 9 * rush, 1), round(12 + 25 * rush, 1)
            wind = round(10 + 4 * wave, 1)
            light = round(max(0, min(1, math.sin(math.pi * (hour - 6) / 12) * 1.5)), 3)
            hours.append(
                HourConditions(
                    hour=hour,
                    temp_c=temp,
                    humidity=humidity,
                    pm25=pm,
                    no2=no2,
                    wind_kmh=wind,
                    rush=rush,
                    daylight=light,
                    factors=factors(temp, humidity, pm, no2, wind, rush, light),
                )
            )
        return DayForecast(
            name=f"days/{selected}", date=selected, generated_at=self.generated_at, hours=hours
        )

    def grid(self, selected: date) -> GridResponse:
        day = self.day(selected)
        west, south, east, north = BOUNDS
        dx = 250 / (111_320 * math.cos(math.radians(49.14)))
        dy = 250 / 111_320
        features = []
        for row in range(math.ceil((north - south) / dy)):
            for col in range(math.ceil((east - west) / dx)):
                x, y = west + col * dx, south + row * dy
                right, top = min(x + dx, east), min(y + dy, north)
                green = ((row * 7 + col * 11) % 17) / 16
                exposure = 1 - green
                series = {key: [] for key in ("heat", "air", "wind", "traffic", "light")}
                for hour in day.hours:
                    scores = factors(
                        hour.temp_c - green * 2,
                        hour.humidity,
                        hour.pm25 * (1.2 - green * 0.4),
                        hour.no2 * (1.1 - green * 0.2),
                        hour.wind_kmh,
                        hour.rush,
                        hour.daylight,
                        exposure,
                    )
                    for key in series:
                        series[key].append(getattr(scores, key))
                ring = [(x, y), (right, y), (right, top), (x, top), (x, y)]
                features.append(
                    GridFeature(
                        geometry=Polygon(coordinates=[ring]),
                        properties=CellProperties(
                            id=f"r{row}c{col}",
                            place=f"Demo area {row + 1}-{col + 1}",
                            safety=None if (row + col) % 4 == 0 else clamp(45 + 40 * green),
                            green=green,
                            **series,
                        ),
                    )
                )
        return GridResponse(
            name=f"grids/{selected}",
            date=selected,
            cell_size_m=250,
            generated_at=self.generated_at,
            cells=GridCells(features=features),
        )

    def sensors(self) -> list[Sensor]:
        return [
            Sensor(
                id=f"mock-{i}",
                resource_name=f"sensors/mock-{i}",
                name=f"Demo sensor {i}",
                kind=kind,
                lat=lat,
                lng=lon,
                latest={"Temperature": 16 + i, "PM2.5": 8 + i, "Humidity": None},
                updated_at=self.generated_at,
            )
            for i, (kind, lon, lat) in enumerate(
                [
                    ("sensebox_home", 9.2109, 49.1427),
                    ("lubw", 9.225, 49.15),
                    ("bike_counter", 9.20, 49.13),
                ],
                1,
            )
        ]

    def segments(self) -> list[SegmentFeature]:
        return [
            SegmentFeature(
                geometry=LineString(coordinates=[(lon, lat), (lon + 0.003, lat + 0.001)]),
                properties=SegmentProperties(
                    segment_id=i, name=f"Demo street {i}", resource_name=f"segments/{i}"
                ),
            )
            for i, (lon, lat) in enumerate(
                [
                    (9.210, 49.142),
                    (9.220, 49.148),
                    (9.198, 49.134),
                    (9.230, 49.158),
                    (9.180, 49.125),
                    (9.245, 49.140),
                ],
                1,
            )
        ]

    def detail(self, segment_id: int, profile: SportProfile, moment: datetime) -> SegmentDetail:
        feature = next((s for s in self.segments() if s.properties.segment_id == segment_id), None)
        if feature is None:
            raise KeyError(segment_id)
        local = moment.astimezone(LOCAL_TZ)
        hour = self.day(local.date()).hours[local.hour]
        values = {
            P.PM2_5: hour.pm25,
            P.NO2: hour.no2,
            P.O3: 45.0,
            P.TEMPERATURE: hour.temp_c,
            P.RELATIVE_HUMIDITY: hour.humidity,
            P.WIND_SPEED: hour.wind_kmh / 3.6,
            P.PRECIPITATION: 0.0,
            P.UV_INDEX: 2.0,
        }
        forecasts = {
            p: Forecast(p, moment, "model_uncorrected", None, (ForecastPoint(moment, value, 0),))
            for p, value in values.items()
        }
        segment = Segment(segment_id=str(segment_id), coordinates=feature.geometry.coordinates)
        layer = SegmentLayer(
            segment_id=str(segment_id),
            pm_ratio=0.7 + segment_id * 0.1,
            pm_samples=0,
            pm_source="none",
            heat_anomaly=segment_id * 0.2,
            heat_samples=0,
            roughness=segment_id / 10,
            overtaking_share=0.15,
            flow=0.7,
        )
        scored = score_hour(segment, layer, PROFILE[profile], moment, 0, forecasts, math.inf)
        return SegmentDetail(
            segment_id=segment_id,
            name=feature.properties.name,
            profile=profile,
            t=moment.astimezone(UTC).strftime("%Y-%m-%dT%H:00:00Z"),
            score=round(scored.score or 0, 2),
            confidence=0,
            components=[
                ScoreComponent(
                    key=str(key),
                    label=str(key).replace("_", " ").title(),
                    value=round(value * 100, 2),
                    unit="goodness / 100",
                    weight=WEIGHTS[PROFILE[profile]].get(key, 0),
                )
                for key, value in scored.components.items()
            ],
            gates=[key for key, value in scored.gates.items() if value == 0],
            missing=["verified observations", "verified street geometry", "crowding"],
        )

    def best_times(
        self, segment_id: int, profile: SportProfile, selected: date
    ) -> BestTimesResponse:
        # Core day/grid arrays have 24 wall-clock slots, but recommendations must
        # identify real instants. Skip nonexistent spring hours; choose fold=0 in autumn.
        moments = []
        for hour in range(24):
            local = datetime.combine(selected, time(hour), LOCAL_TZ)
            moment = local.astimezone(UTC)
            if moment.astimezone(LOCAL_TZ).hour == hour:
                moments.append(moment)
        details = [self.detail(segment_id, profile, moment) for moment in moments]
        windows = best_windows([d.score for d in details])
        return BestTimesResponse(
            name=f"segments/{segment_id}/bestTimes/{selected}",
            segment_id=segment_id,
            profile=profile,
            date=selected,
            windows=[TimeWindow(at=moments[w.start_index], score=w.score) for w in windows],
        )
