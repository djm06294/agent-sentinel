from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL, make_url


class Settings(BaseSettings):
    """환경변수는 ADMIN_ 접두어를 쓴다 (예: ADMIN_DB_HOST). 로그 서비스 설정과 섞이지 않게 분리."""
    model_config = SettingsConfigDict(env_prefix='ADMIN_', env_file='.env', extra='ignore')

    # 지정하면 아래 개별 값 대신 사용 (예: 로컬 실험용 sqlite:///./control.db)
    database_url: SecretStr | None = None
    db_host: str = 'localhost'
    db_port: int = 5434
    db_name: str = 'control_db'
    db_user: str = 'sentinel_admin'
    db_password: SecretStr = SecretStr('')
    # 관리자 FE(Vite 개발 서버) 주소
    cors_origins: list[str] = ['http://localhost:5173', 'http://127.0.0.1:5173']

    @property
    def sqlalchemy_url(self) -> URL:
        if self.database_url is not None:
            return make_url(self.database_url.get_secret_value())
        return URL.create('postgresql+psycopg', username=self.db_user,
                          password=self.db_password.get_secret_value(),
                          host=self.db_host, port=self.db_port, database=self.db_name)


@lru_cache
def get_settings() -> Settings:
    return Settings()
