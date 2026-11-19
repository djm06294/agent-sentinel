import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from admin_api.db import get_db
from admin_api.main import app
from admin_api.models import Base


@pytest.fixture
def client():
    # 테스트마다 새 인메모리 SQLite (외래키 검사 켬)
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    event.listen(engine, 'connect', lambda conn, _: conn.execute('PRAGMA foreign_keys=ON'))
    Base.metadata.create_all(engine)

    def override():
        with Session(engine, expire_on_commit=False) as session:
            yield session

    app.dependency_overrides[get_db] = override
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def seeded(client):
    """사용자 1명, 에이전트 1개, 대상 서버 1대."""
    assert client.post('/api/agent-users', json={'id': 'user-a', 'name': '김주영'}).status_code == 201
    assert client.post('/api/agents', json={'id': 'agent-a', 'name': 'Claude Code', 'owner_user_id': 'user-a'}
                       ).status_code == 201
    assert client.post('/api/servers', json={'id': 'biz-pg', 'name': '업무 DB', 'host': 'localhost',
                                             'port': 5433, 'database': 'mydb'}).status_code == 201
    return client
