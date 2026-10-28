from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from starlette.exceptions import HTTPException

from app.api.errors import http_error, validation_error
from app.api.router import router
from app.core.config import Settings
from app.serving.demo import DemoRepository
from app.serving.repository import ServingRepository


def create_app(
    settings: Settings | None = None, repository: ServingRepository | None = None
) -> FastAPI:
    """Build the HTTP application without starting workers or external connections."""
    settings = settings if settings is not None else Settings()
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Green City Heilbronn API. Demo data is synthetic and labelled mock.",
    )
    application.state.settings = settings
    application.state.serving_repository = (
        repository if repository is not None else DemoRepository()
    )
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
    return application


app = create_app()
