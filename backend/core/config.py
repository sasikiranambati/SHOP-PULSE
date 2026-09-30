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

