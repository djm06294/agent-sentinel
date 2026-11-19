from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session

from admin_api.config import get_settings


@lru_cache
def get_engine() -> Engine:
    url = get_settings().sqlalchemy_url
    if url.get_backend_name() == 'postgresql':
        return create_engine(url, pool_pre_ping=True, pool_size=5, max_overflow=5, pool_timeout=5,
                             connect_args={'connect_timeout': 3}, hide_parameters=True)
    return create_engine(url, hide_parameters=True)


def get_db() -> Iterator[Session]:
    with Session(get_engine(), expire_on_commit=False) as session:
        yield session
