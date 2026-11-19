import os
from uuid import UUID, uuid4

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.database import get_db
from app.db.models import BehaviorLog
from app.main import app

pytestmark = pytest.mark.integration


@pytest.fixture
def postgres_client():
    value = os.environ.get('TEST_DATABASE_URL')
    if not value:
        pytest.skip('TEST_DATABASE_URL is not configured; real PostgreSQL required')
    url = make_url(value)
    if (url.drivername != 'postgresql+psycopg' or not url.database
            or not url.database.endswith('_test')
            or url.database == get_settings().postgres_db):
        pytest.fail('Use a separate PostgreSQL database ending in _test')
    engine = create_engine(url, hide_parameters=True)
    with engine.begin() as connection:
        config = Config('alembic.ini')
        config.attributes['connection'] = connection
        command.upgrade(config, 'head')
    with engine.connect() as connection:
        transaction = connection.begin()
        # Service commits release savepoints; all test inserts remain in outer rollback.
        with Session(bind=connection, join_transaction_mode='create_savepoint', expire_on_commit=False) as session:
            app.dependency_overrides[get_db] = lambda: session
            try:
                with TestClient(app) as client:
                    yield client, session
            finally:
                app.dependency_overrides.clear()
        transaction.rollback()
    engine.dispose()


def test_postgres_roundtrip_order_duplicate(postgres_client, payload):
    client, session = postgres_client
    payload['session_id'] = 'test-' + uuid4().hex
    assert client.get('/ready').status_code == 200
    saved = []
    for sequence in [2, 0, 1]:
        payload['sequence_no'] = sequence
        response = client.post('/api/v1/logs', json=payload)
        assert response.status_code == 201
        data = response.json()['data']
        saved.append(data)
        assert client.get('/api/v1/logs/' + data['log_id']).json()['data'] == data
        row = session.get(BehaviorLog, UUID(data['log_id']))
        assert row.metadata_json == payload['metadata']
        assert row.timestamp.tzinfo is not None
    assert client.post('/api/v1/logs', json=payload).status_code == 409
    sequences = session.scalars(select(BehaviorLog.sequence_no).where(
        BehaviorLog.session_id == payload['session_id']).order_by(BehaviorLog.sequence_no)).all()
    assert sequences == [0, 1, 2]
    assert client.get('/api/v1/logs/' + str(uuid4())).status_code == 404
    assert session.scalar(text('SELECT count(*) FROM behavior_logs WHERE session_id = :sid'),
                          {'sid': payload['session_id']}) == 3
