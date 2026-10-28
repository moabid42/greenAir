from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import router
from app.core.config import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the HTTP application without starting workers or external connections."""
    settings = settings if settings is not None else Settings()
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        description="Green City Heilbronn backend. Initial service scaffold.",
    )
    application.state.settings = settings
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
