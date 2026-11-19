from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.config import get_settings


@lru_cache
def get_engine():
    return create_engine(get_settings().database_url, pool_pre_ping=True,
                         pool_size=5, max_overflow=5, pool_timeout=5,
                         connect_args={'connect_timeout': 3, 'options': '-c statement_timeout=5000'},
                         hide_parameters=True)


def get_db():
    with Session(get_engine(), expire_on_commit=False) as session:
        yield session
