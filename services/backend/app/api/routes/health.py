from fastapi import APIRouter, Request

from app.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(request: Request) -> HealthResponse:
    """Process liveness only; does not assert database or upstream availability."""
    return HealthResponse(service=request.app.title)
