def test_user_create_get_update_list(client):
    r = client.post('/api/agent-users', json={'id': 'user-a', 'name': ' 김주영 ', 'department': '보안팀'})
    assert r.status_code == 201
    assert r.json()['name'] == '김주영'
    assert r.json()['is_active'] is True

    assert client.post('/api/agent-users', json={'id': 'user-a', 'name': 'x'}).json()['error']['code'] == \
        'already_exists'

    r = client.patch('/api/agent-users/user-a', json={'is_active': False})
    assert r.status_code == 200 and r.json()['is_active'] is False and r.json()['department'] == '보안팀'

    assert [u['id'] for u in client.get('/api/agent-users').json()] == ['user-a']
    assert client.get('/api/agent-users/nobody').status_code == 404


def test_validation_errors_report_fields_without_echoing_input(client):
    r = client.post('/api/agent-users', json={'id': 'bad id!', 'name': 'secret-value', 'extra': 1})
    assert r.status_code == 422
    body = r.json()['error']
    assert body['code'] == 'validation_error'
    assert {tuple(f['loc']) for f in body['fields']} == {('id',), ('extra',)}
    assert 'secret-value' not in r.text


def test_patch_rejects_null_for_required_field(client):
    client.post('/api/agent-users', json={'id': 'user-a', 'name': 'a'})
    assert client.patch('/api/agent-users/user-a', json={'name': None}).status_code == 422
    # 선택 필드는 null로 비울 수 있다
    client.patch('/api/agent-users/user-a', json={'department': '팀'})
    assert client.patch('/api/agent-users/user-a', json={'department': None}).json()['department'] is None


def test_agent_requires_existing_owner(client):
    r = client.post('/api/agents', json={'id': 'agent-a', 'name': 'cc', 'owner_user_id': 'ghost'})
    assert r.status_code == 422 and r.json()['error']['code'] == 'invalid_reference'

    client.post('/api/agent-users', json={'id': 'user-a', 'name': 'a'})
    r = client.post('/api/agents', json={'id': 'agent-a', 'name': 'cc', 'owner_user_id': 'user-a'})
    assert r.status_code == 201
    assert r.json()['type'] == 'claude_code' and r.json()['has_token'] is False
    assert client.patch('/api/agents/agent-a', json={'owner_user_id': 'ghost'}).status_code == 422
    assert [a['id'] for a in client.get('/api/agents', params={'owner_user_id': 'user-a'}).json()] == ['agent-a']


def test_server_crud_and_port_validation(client):
    assert client.post('/api/servers', json={'id': 's1', 'name': 'n', 'host': 'h', 'port': 70000,
                                             'database': 'd'}).status_code == 422
    r = client.post('/api/servers', json={'id': 's1', 'name': 'n', 'host': 'localhost', 'database': 'mydb'})
    assert r.status_code == 201 and r.json()['port'] == 5432
    assert client.patch('/api/servers/s1', json={'port': 5433}).json()['port'] == 5433


def test_policy_crud(seeded):
    c = seeded
    body = {'name': '주영 업무DB 허용', 'subject_type': 'USER', 'subject_id': 'user-a',
            'target_server_id': 'biz-pg', 'effect': 'ALLOW'}
    r = c.post('/api/policies', json=body)
    assert r.status_code == 201
    policy = r.json()
    assert policy['scope_type'] == 'DATABASE' and policy['scope_value'] is None and policy['priority'] == 100

    assert c.post('/api/policies', json={**body, 'subject_id': 'ghost'}).status_code == 422
    assert c.post('/api/policies', json={**body, 'subject_type': 'AGENT'}).status_code == 422  # user-a는 에이전트 아님
    assert c.post('/api/policies', json={**body, 'target_server_id': 'nope'}).status_code == 422
    assert c.post('/api/policies', json={**body, 'effect': 'allow'}).status_code == 422
    assert c.post('/api/policies', json={**body, 'scope_type': 'TABLE'}).status_code == 422

    r = c.patch(f"/api/policies/{policy['id']}", json={'effect': 'DENY', 'priority': 10})
    assert r.json()['effect'] == 'DENY' and r.json()['priority'] == 10
    assert c.patch(f"/api/policies/{policy['id']}", json={'subject_type': 'AGENT'}).status_code == 422

    assert len(c.get('/api/policies', params={'subject_id': 'user-a'}).json()) == 1
    assert c.get('/api/policies', params={'subject_type': 'AGENT'}).json() == []

    assert c.delete(f"/api/policies/{policy['id']}").status_code == 204
    assert c.get(f"/api/policies/{policy['id']}").status_code == 404
    assert c.get('/api/policies/not-a-uuid').status_code == 422


def test_health(client):
    assert client.get('/health').json() == {'status': 'ok'}
    assert client.get('/ready').json() == {'status': 'ready'}
