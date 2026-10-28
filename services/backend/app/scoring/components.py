"""Component goodness functions f_k in [0, 1] (docs/scoring.md §4.4, §5)."""

import math

from app.scoring.profiles import COMFORT_BANDS, RAMPS, Component, Profile


def clip01(value: float) -> float:
    return min(1.0, max(0.0, value))


def ramp(component: Component, value: float) -> float:
    """§5.1 lower-is-better: 1 at or below `good`, 0 at or above `bad`."""
    good, bad = RAMPS[component]
    return clip01((bad - value) / (bad - good))


def apparent_temperature(temperature_c: float, humidity_pct: float, wind_m_s: float) -> float:
    """§4.4 Steadman form; vapour pressure in hPa, wind in m/s (not km/h)."""
    vapour_hpa = (
        humidity_pct / 100 * 6.105 * math.exp(17.27 * temperature_c / (237.7 + temperature_c))
    )
    return temperature_c + 0.33 * vapour_hpa - 0.70 * wind_m_s - 4.00


def comfort(profile: Profile, apparent_temperature_c: float) -> float:
    """§5.3 trapezoid over apparent temperature."""
    a, b, c, d = COMFORT_BANDS[profile]
    at = apparent_temperature_c
    if at <= a or at >= d:
        return 0.0
    if at < b:
        return (at - a) / (b - a)
    if at <= c:
        return 1.0
    return (d - at) / (d - c)


def surface(roughness: float) -> float:
    """§5.2 roughness rho_s in [0, 1] from `bumpy_roads`."""
    return clip01(1 - roughness)


def flow(flow_index: float) -> float:
    """§5.2 phi_s in [0, 1] from `traffic_flow` (1 = free-moving)."""
    return clip01(flow_index)


def daylight(profile: Profile, is_daylight: bool, unlit_path: bool = False) -> float:
    """§5.2: night factor 0.5 for running and cycling on unlit paths, 0.8 otherwise."""
    if is_daylight:
        return 1.0
    if unlit_path and profile in (Profile.RUNNING, Profile.ROAD_CYCLING):
        return 0.5
    return 0.8
