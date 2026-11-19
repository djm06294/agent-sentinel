"""Create a dedicated *_test DB if absent and run rollback-isolated tests.

Run inside log-api: docker compose exec log-api python tools/run_integration.py
Never drops a database or deletes development records.
"""
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text

from app.core.config import get_settings


def main():
    settings = get_settings()
    name = settings.postgres_db + '_test'
    if len(name.encode('utf-8')) > 63:
        raise SystemExit('Test database name exceeds PostgreSQL identifier limit')
    admin = create_engine(settings.database_url.set(database='postgres'),
                          isolation_level='AUTOCOMMIT', hide_parameters=True)
    with admin.connect() as connection:
        exists = connection.scalar(text('SELECT 1 FROM pg_database WHERE datname=:name'), {'name': name})
        if not exists:
            quoted = connection.dialect.identifier_preparer.quote_identifier(name)
            connection.exec_driver_sql('CREATE DATABASE ' + quoted)
    admin.dispose()
    env = os.environ.copy()
    env['TEST_DATABASE_URL'] = settings.database_url.set(database=name).render_as_string(hide_password=False)
    result = subprocess.run([sys.executable, '-m', 'pytest', '-m', 'integration', '-q'], env=env,
                            cwd=Path(__file__).resolve().parents[1])
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
