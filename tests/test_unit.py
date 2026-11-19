from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError, OperationalError

from app.db.database import get_db
from app.main import app


@pytest.fixture
def client():
    db = MagicMock()
    def refresh(row):
        row.log_id = uuid4()
        row.received_at = datetime.now(timezone.utc)
    db.refresh.side_effect = refresh
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app, raise_server_exceptions=False) as http:
        yield http, db
    app.dependency_overrides.clear()


def test_store_and_read(client, payload):
    http, db = client
    response = http.post('/api/v1/logs', json=payload)
    assert response.status_code == 201
    data = response.json()['data']
    row = db.add.call_args.args[0]
    db.get.return_value = row
    assert http.get('/api/v1/logs/' + data['log_id']).json()['data'] == data
    assert data['agent_id'] == payload['agent_id']
    db.commit.assert_called_once()


@pytest.mark.parametrize('change', [
    {'agent_id': None}, {'duration_ms': '4'}, {'duration_ms': True},
    {'timestamp': 'invalid'}, {'timestamp': '2026-11-19T10:00:00'},
    {'timestamp': 12345}, {'duration_ms': -1}, {'sequence_no': -1},
    {'status': 'unknown'}, {'status': 'denied'}, {'error_code': 'BAD'},
    {'metadata': {'password': 'secret'}}, {'metadata': {'nested': {'token': 'secret'}}},
    {'metadata': {'rows_affected': '10'}}, {'resource': 'https://user:password@host'},
    {'unexpected': 'secret'}, {'tool_name': 'x' * 129},
])
def test_invalid(client, payload, change):
    http, db = client
    payload.update(change)
    response = http.post('/api/v1/logs', json=payload)
    assert response.status_code == 422
    assert 'secret' not in response.text
    db.add.assert_not_called()


def test_missing_field(client, payload):
    del payload['user_id']
    assert client[0].post('/api/v1/logs', json=payload).status_code == 422


def test_not_found(client):
    http, db = client
    db.get.return_value = None
    assert http.get('/api/v1/logs/' + str(uuid4())).status_code == 404
    assert http.get('/api/v1/logs/not-a-uuid').status_code == 422


def test_db_failure_rollback(client, payload):
    http, db = client
    db.commit.side_effect = OperationalError('SECRET SQL', {}, Exception('SECRET password'))
    response = http.post('/api/v1/logs', json=payload)
    assert response.status_code == 503
    assert 'SECRET' not in response.text
    db.rollback.assert_called_once()


def test_duplicate(client, payload):
    http, db = client
    original = Exception('private details')
    original.sqlstate = '23505'
    db.commit.side_effect = IntegrityError('', {}, original)
    assert http.post('/api/v1/logs', json=payload).status_code == 409


def test_health_and_ready(client):
    http, db = client
    assert http.get('/health').status_code == 200
    assert http.get('/ready').status_code == 200
    db.execute.side_effect = OperationalError('', {}, Exception('private'))
    assert http.get('/ready').status_code == 503
    assert http.get('/health').status_code == 200


def test_size_and_malformed(client):
    http, _ = client
    assert http.post('/api/v1/logs', content=b'x' * 16385).status_code == 413
    assert http.post('/api/v1/logs', content=b'{', headers={'Content-Type': 'application/json'}).status_code == 422


def test_unexpected_error(client, payload):
    http, db = client
    db.add.side_effect = RuntimeError('SECRET')
    response = http.post('/api/v1/logs', json=payload)
    assert response.status_code == 500
    assert 'SECRET' not in response.text


def test_multiple_actions(client, payload):
    http, db = client
    ids = []
    for sequence in range(3):
        payload['sequence_no'] = sequence
        response = http.post('/api/v1/logs', json=payload)
        assert response.status_code == 201
        ids.append(response.json()['data']['log_id'])
    assert len(set(ids)) == 3
    assert db.commit.call_count == 3


def test_all_synthetic_examples(client):
    import json
    from pathlib import Path
    http, _ = client
    for path in Path('examples').glob('*.json'):
        values = json.loads(path.read_text(encoding='utf-8'))
        for value in values if isinstance(values, list) else [values]:
            assert http.post('/api/v1/logs', json=value).status_code == 201


def test_chunked_body_limit():
    import asyncio
    from app.main import BodyLimitMiddleware
    called = []
    sent = []
    messages = iter([
        {'type': 'http.request', 'body': b'a' * 10000, 'more_body': True},
        {'type': 'http.request', 'body': b'b' * 10000, 'more_body': False},
    ])
    async def downstream(scope, receive, send):
        called.append(True)
    async def receive():
        return next(messages)
    async def send(message):
        sent.append(message)
    asyncio.run(BodyLimitMiddleware(downstream)({'type': 'http'}, receive, send))
    assert not called
    assert sent[0]['status'] == 413
