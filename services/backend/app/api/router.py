from fastapi import APIRouter

from app.api.routes import data_status, health, serving, stations

router = APIRouter()
router.include_router(health.router)
router.include_router(stations.router)

router.include_router(serving.router)

router.include_router(data_status.router)
