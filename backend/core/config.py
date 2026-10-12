from pathlib import Path
from typing import List, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent

class Settings(BaseSettings):
    PROJECT_NAME: str = "ShopPulse API"
    API_V1_STR: str = "/api/v1"
    PORT: int = 8000
    BACKEND_CORS_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:3000"]

    # Voice-to-Bill Settings
    VOICE_MODE: str = "mock"  # "mock" or "sarvam"
    SARVAM_API_KEY: Optional[str] = None

    # Server-Side Gemini Multimodal Vision Settings (Never exposed to frontend)
    GEMINI_API_KEY: Optional[str] = None
    GEMINI_MODEL: str = "gemini-1.5-flash"
    GEMINI_VISION_TIMEOUT_SECONDS: float = 25.0

    # OpenMRP Settings (Material Requirements Planning platform — not Maximum Retail Price)
    OPENMRP_API_KEY: Optional[str] = None
    OPENMRP_ACCOUNT_ID: Optional[str] = None
    OPENMRP_API_VERSION: str = "1.0.forge-preview.3"

    # External Maximum Retail Price (MRP) lookup used by the invoice scanner.
    # MRP_PROVIDER: "openmrp" (default; OpenMRP publishes no MRP, so lookups report
    # MRP_UNAVAILABLE), "custom_http" (any JSON API whose documented MRP field is set
    # in MRP_API_MRP_FIELD), or "none".
    MRP_PROVIDER: str = "openmrp"
    MRP_LOOKUP_ENABLED: bool = True
    MRP_LOOKUP_TIME_BUDGET_SECONDS: float = 12.0
    MRP_API_BASE_URL: Optional[str] = None
    MRP_API_KEY: Optional[str] = None
    MRP_API_AUTH_HEADER: str = "Authorization"
    MRP_API_AUTH_SCHEME: str = "Bearer"
    MRP_API_BARCODE_PATH: Optional[str] = None
    MRP_API_SEARCH_PATH: Optional[str] = None
    MRP_API_SEARCH_PARAM: str = "q"
    MRP_API_RESULTS_FIELD: Optional[str] = None
    MRP_API_MRP_FIELD: Optional[str] = None
    MRP_API_NAME_FIELD: str = "name"
    MRP_API_BRAND_FIELD: str = "brand"
    MRP_API_BARCODE_FIELD: str = "barcode"
    MRP_API_TIMEOUT_SECONDS: float = 5.0

    POSTGRES_SERVER: str = "localhost"
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "shoppulse"

    # JWT Settings
    SECRET_KEY: str = "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 days
    
    DATABASE_URL: Optional[str] = None

    @property
    def SQLALCHEMY_DATABASE_URI(self) -> str:
        if self.DATABASE_URL:
            # If relative sqlite path like sqlite:///./shoppulse.db, resolve against backend dir
            if self.DATABASE_URL.startswith("sqlite:///."):
                rel_path = self.DATABASE_URL.replace("sqlite:///.", "", 1).lstrip("/\\")
                abs_db_path = (BACKEND_DIR / rel_path).resolve().as_posix()
                return f"sqlite:///{abs_db_path}"
            return self.DATABASE_URL
        
        # Default to local sqlite database in backend directory for zero-config startup
        default_db = (BACKEND_DIR / "shoppulse.db").resolve().as_posix()
        return f"sqlite:///{default_db}"

    model_config = SettingsConfigDict(
        env_file=[str(BACKEND_DIR / ".env"), ".env"],
        case_sensitive=True,
        extra="ignore"
    )


settings = Settings()

