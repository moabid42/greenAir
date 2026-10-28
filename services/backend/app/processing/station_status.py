from datetime import datetime, timedelta

from app.schemas.stations import StationSnapshot, StationState, StationStatus


def classify(snapshot: StationSnapshot, now: datetime, stale_after: timedelta) -> StationStatus:
    """Label a station by the age of its newest upload relative to `now` (UTC)."""
    last = snapshot.last_measurement_at
    if last is None:
        state: StationState = "no_data"
        age_minutes = None
    else:
        age = now - last
        state = "online" if age <= stale_after else "stale"
        age_minutes = round(age.total_seconds() / 60, 1)
    return StationStatus(**snapshot.model_dump(), state=state, age_minutes=age_minutes)
