from contextlib import asynccontextmanager
from datetime import timedelta

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from sqlalchemy import create_engine
from starlette.exceptions import HTTPException

from app.api.documentation import DESCRIPTION, configure_openapi
from app.api.errors import http_error, serving_error, validation_error
from app.api.router import router
from app.core.config import Settings
from app.serving.demo import DemoRepository
from app.serving.errors import ServingDataError
from app.serving.repository import ServingRepository
from app.serving.stored import StoredRepository
from app.storage.repository import Repository
from app.storage.results import ResultRepository


def create_app(
    settings: Settings | None = None, repository: ServingRepository | None = None
) -> FastAPI:
    """Build the HTTP application without starting workers or external connections."""
    settings = settings if settings is not None else Settings()
    owned_engine = None
    if repository is None:
        if settings.serving_data_mode == "stored":
            if not settings.database_url:
                raise ValueError("stored serving requires GREENAIR_DATABASE_URL")
            owned_engine = create_engine(settings.database_url, pool_pre_ping=True)
            repository = StoredRepository(
                ResultRepository(Repository(owned_engine)),
                stale_after=timedelta(hours=settings.snapshot_stale_after_hours),
            )
        else:
            repository = DemoRepository()

    @asynccontextmanager
    async def lifespan(_app):
        try:
            yield
        finally:
            if owned_engine is not None:
                owned_engine.dispose()

    application = FastAPI(
        lifespan=lifespan,
        title=settings.app_name,
        version="0.2.0",
        swagger_ui_parameters={"displayRequestDuration": True, "filter": True},
        description=DESCRIPTION,
    )
    application.state.settings = settings
    application.state.serving_repository = repository
    application.add_exception_handler(ServingDataError, serving_error)
    application.add_exception_handler(HTTPException, http_error)
    application.add_exception_handler(RequestValidationError, validation_error)
    application.add_middleware(GZipMiddleware, minimum_size=1000)
    if settings.cors_origins:
        application.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    application.include_router(router)
    configure_openapi(application)
    return application


app = create_app()
