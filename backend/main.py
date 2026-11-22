import sys
from pathlib import Path

# Ensure backend root directory is in sys.path for direct script execution
_backend_dir = Path(__file__).resolve().parent
if str(_backend_dir) not in sys.path:
    sys.path.insert(0, str(_backend_dir))

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from api.main import api_router
import db.models  # noqa: F401  (models are registered; no database access at import)

import logging

logger = logging.getLogger(__name__)

# Stage 5.1: importing this module never touches a database. Schema initialization is an explicit,
# logged startup step (unmanaged development / test databases only; Alembic-managed databases are never
# changed; SHOPPULSE_DB_INIT=off disables it) - see db/init_schema.py.
from db.init_schema import INCREMENTAL_COLUMNS, init_db_schema, initialize_database_on_startup  # noqa: E402,F401


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize_database_on_startup()
    yield


app = FastAPI(
    lifespan=lifespan,
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    docs_url="/docs"
)

# Set all CORS enabled origins
origins = [str(origin) for origin in settings.BACKEND_CORS_ORIGINS] if settings.BACKEND_CORS_ORIGINS else []
if "http://127.0.0.1:5173" not in origins:
    origins.append("http://127.0.0.1:5173")
if "http://localhost:5173" not in origins:
    origins.append("http://localhost:5173")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.API_V1_STR)

@app.get("/")
def root():
    # Shelfora API root health entry
    return {"message": "Welcome to Shelfora API"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=settings.PORT, reload=True, reload_dirs=[str(_backend_dir)])
