from alembic import context
from sqlalchemy import create_engine, pool

from admin_api.config import get_settings
from admin_api.models import Base

config = context.config
target_metadata = Base.metadata


def run() -> None:
    url = get_settings().sqlalchemy_url
    if context.is_offline_mode():
        context.configure(url=url, target_metadata=target_metadata, literal_binds=True)
        with context.begin_transaction():
            context.run_migrations()
        return
    engine = create_engine(url, poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run()
