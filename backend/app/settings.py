from pydantic_settings import BaseSettings, SettingsConfigDict


_ENV_FILE = str(__file__).replace("settings.py", "..\\.env")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_ENV_FILE, extra="ignore")

    database_url: str
    cors_origins: str = ""
    gemini_api_key: str = ""


settings = Settings()
