from fastapi import APIRouter
from api.routes import health, auth, shops

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(shops.router, prefix="/shops", tags=["shops"])
