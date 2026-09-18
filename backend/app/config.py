from pydantic_settings import BaseSettings
from typing import List
import json, os

class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+aiosqlite:///./reactx.db"
    SECRET_KEY: str = "reactx-dev-secret"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440
    CORS_ORIGINS: str = '["http://localhost:5500","http://127.0.0.1:5500","null","file://"]'
    PIPELINE_INTERVAL_SECONDS: int = 30
    LIVE_SIGNAL_INTERVAL_SECONDS: int = 45
    LOG_LEVEL: str = "INFO"

    @property
    def cors_origins_list(self) -> List[str]:
        try:
            return json.loads(self.CORS_ORIGINS)
        except Exception:
            return ["*"]

    class Config:
        env_file = ".env"
        extra = "ignore"

settings = Settings()
