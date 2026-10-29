"""Default constants from docs/scoring.md (v0.1). Starting points to tune, not measured truths."""

from enum import StrEnum
from typing import NamedTuple


class Profile(StrEnum):
    RUNNING = "running"
    ROAD_CYCLING = "road_cycling"
    WALKING = "walking"  # walking / outdoor strength


class Component(StrEnum):
    PM25 = "pm25"
    PM10 = "pm10"
    NO2 = "no2"
    O3 = "o3"
    APPARENT_TEMPERATURE = "apparent_temperature"
    WIND = "wind"
    UV = "uv"
    SURFACE = "surface"
    OVERTAKING = "overtaking"
    FLOW = "flow"
    CROWDING = "crowding"
    DAYLIGHT = "daylight"


class Ramp(NamedTuple):
    good: float
    bad: float


# §5.1 lower-is-better anchors; units in the comments.
RAMPS: dict[Component, Ramp] = {
    Component.PM25: Ramp(5, 35),  # µg/m³
    Component.PM10: Ramp(15, 70),  # µg/m³
    Component.NO2: Ramp(10, 60),  # µg/m³
    Component.O3: Ramp(60, 140),  # µg/m³
    Component.WIND: Ramp(10, 45),  # km/h
    Component.UV: Ramp(2, 8),  # UV index
    Component.OVERTAKING: Ramp(0.10, 0.60),  # share of overtakes < 150 cm
    Component.CROWDING: Ramp(0.2, 0.9),  # percentile of hour-of-week counts
}


class Trapezoid(NamedTuple):
    a: float
    b: float
    c: float
    d: float


# §5.3 apparent-temperature comfort bands in °C.
COMFORT_BANDS: dict[Profile, Trapezoid] = {
    Profile.RUNNING: Trapezoid(-5, 5, 15, 28),
    Profile.ROAD_CYCLING: Trapezoid(0, 10, 22, 32),
    Profile.WALKING: Trapezoid(-2, 8, 24, 32),
}

# §6.2 weights. Pollen (0 -> 2 for sensitive users) has no §5 anchors yet and is omitted.
WEIGHTS: dict[Profile, dict[Component, float]] = {
    Profile.RUNNING: {
        Component.PM25: 3,
        Component.NO2: 1,
        Component.O3: 2,
        Component.APPARENT_TEMPERATURE: 3,
        Component.WIND: 1,
        Component.UV: 1,
        Component.SURFACE: 2,
        Component.OVERTAKING: 0,
        Component.FLOW: 1,
        Component.CROWDING: 1,
        Component.DAYLIGHT: 1,
    },
    Profile.ROAD_CYCLING: {
        Component.PM25: 3,
        Component.NO2: 1,
        Component.O3: 2,
        Component.APPARENT_TEMPERATURE: 2,
        Component.WIND: 2,
        Component.UV: 1,
        Component.SURFACE: 2,
        Component.OVERTAKING: 3,
        Component.FLOW: 2,
        Component.CROWDING: 1,
        Component.DAYLIGHT: 1,
    },
    Profile.WALKING: {
        Component.PM25: 2,
        Component.NO2: 1,
        Component.O3: 1,
        Component.APPARENT_TEMPERATURE: 2,
        Component.WIND: 1,
        Component.UV: 2,
        Component.SURFACE: 0.5,
        Component.OVERTAKING: 0,
        Component.FLOW: 0,
        Component.CROWDING: 1,
        Component.DAYLIGHT: 1,
    },
}

# §5.4 rain gate limit P_p in mm/h.
RAIN_LIMITS: dict[Profile, float] = {
    Profile.RUNNING: 3.0,
    Profile.ROAD_CYCLING: 1.0,
    Profile.WALKING: 3.0,
}
AIR_GATE_PM25 = 75.0  # µg/m³

# §3.1, §6.3 shrinkage and confidence scales.
KAPPA = 20.0  # samples
STATION_DISTANCE_SCALE_KM = 3.0
HORIZON_SCALE_HOURS = 12.0
IDW_COVERAGE = 0.3
