from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parent  # = backend/app/

class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(BASE_DIR / ".env"),  # = backend/app/.env ✅
        env_file_encoding="utf-8-sig",
        extra="ignore"
    )

    database_url: str
    cors_origins: str = ""
    gemini_api_key: str = ""

settings = Settings()