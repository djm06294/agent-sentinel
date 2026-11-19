from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    postgres_db: str = 'sentinel_logs'
    postgres_user: str = 'sentinel'
    postgres_password: SecretStr = SecretStr('')
    db_host: str = 'localhost'
    db_port: int = 5432

    @property
    def database_url(self) -> URL:
        return URL.create('postgresql+psycopg', username=self.postgres_user,
                          password=self.postgres_password.get_secret_value(),
                          host=self.db_host, port=self.db_port, database=self.postgres_db)


@lru_cache
def get_settings() -> Settings:
    return Settings()
