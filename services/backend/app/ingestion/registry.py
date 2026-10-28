"""Explicit first-slice source registration; imported only by the worker."""

from datetime import timedelta

from app.ingestion.adapters.osem import OsemAdapter
from app.ingestion.adapters.uba import UbaAdapter
from app.ingestion.adapters.weather import BrightSkyAdapter, OpenMeteoAdapter
from app.ingestion.scheduler import Job, RequestSpec
from app.ingestion.settings import IngestionSettings


def get_jobs(settings: IngestionSettings) -> list[Job]:
    # Application polling rates, not assertions of provider measurement cadence.
    adapters = [
        (OpenMeteoAdapter("openmeteo_fcst", bbox=settings.bbox), timedelta(hours=1)),
        (OpenMeteoAdapter("openmeteo_aq", bbox=settings.bbox), timedelta(hours=3)),
        (OsemAdapter(), timedelta(minutes=5)),
        (BrightSkyAdapter(bbox=settings.bbox, current=True), timedelta(minutes=30)),
        *[
            (
                UbaAdapter(
                    station, component, bbox=settings.bbox, source_id=f"uba_{station}_{component}"
                ),
                timedelta(hours=1),
            )
            for station, component in [
                ("226", "1"),
                ("226", "3"),
                ("226", "5"),
                ("226", "9"),
                ("353", "5"),
            ]
        ],
    ]
    jobs = []
    for adapter, cadence in adapters:

        def request(watermark, start, end, *, adapter=adapter):
            return RequestSpec(**adapter.request(watermark, start, end))

        jobs.append(Job(adapter.source_id, cadence, adapter, request, lookback=timedelta(days=1)))
    return jobs
