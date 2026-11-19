"""정책 엔진 (11번 스펙 7절): 정책 없음 / ALLOW만 / DENY 우선 / 비활성 사용자 + 기타 경계 사례."""
import pytest

REQ = {'user_id': 'user-a', 'agent_id': 'agent-a', 'database': 'mydb',
       'session_id': 's1', 'tool_name': 'execute_sql', 'action': 'SELECT', 'tables': ['customers']}


def policy(c, **kw):
    body = {'name': 'p', 'subject_type': 'USER', 'subject_id': 'user-a', 'target_server_id': 'biz-pg',
            'effect': 'ALLOW', **kw}
    r = c.post('/api/policies', json=body)
    assert r.status_code == 201, r.text
    return r.json()['id']


def check(c, **kw):
    r = c.post('/api/policy/check', json={**REQ, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_no_policy_is_default_deny(seeded):
    assert check(seeded) == {'decision': 'DENY', 'policy_id': None, 'reason': 'NO_MATCHING_POLICY'}


def test_allow_only(seeded):
    pid = policy(seeded)
    assert check(seeded) == {'decision': 'ALLOW', 'policy_id': pid, 'reason': None}


def test_deny_wins_over_allow_regardless_of_priority(seeded):
    policy(seeded, priority=1)
    deny_id = policy(seeded, subject_type='AGENT', subject_id='agent-a', effect='DENY', priority=9000)
    assert check(seeded) == {'decision': 'DENY', 'policy_id': deny_id, 'reason': 'POLICY_DENY'}


def test_lowest_priority_number_is_reported(seeded):
    policy(seeded, priority=50)
    first = policy(seeded, priority=5)
    assert check(seeded)['policy_id'] == first


def test_agent_policy_applies(seeded):
    pid = policy(seeded, subject_type='AGENT', subject_id='agent-a')
    assert check(seeded)['policy_id'] == pid


def test_other_subject_policy_is_ignored(seeded):
    seeded.post('/api/agent-users', json={'id': 'user-b', 'name': 'b'})
    policy(seeded, subject_id='user-b')
    assert check(seeded)['reason'] == 'NO_MATCHING_POLICY'


def test_inactive_policy_is_ignored(seeded):
    policy(seeded, is_active=False)
    assert check(seeded)['decision'] == 'DENY'


def test_scope_value_limits_database(seeded):
    policy(seeded, scope_value='otherdb')
    assert check(seeded)['reason'] == 'NO_MATCHING_POLICY'
    pid = policy(seeded, scope_value='mydb')
    assert check(seeded)['policy_id'] == pid


@pytest.mark.parametrize('path,reason', [
    ('/api/agent-users/user-a', 'USER_INACTIVE'),
    ('/api/agents/agent-a', 'AGENT_INACTIVE'),
    ('/api/servers/biz-pg', 'SERVER_INACTIVE'),
])
def test_inactive_entities_deny_even_with_allow(seeded, path, reason):
    policy(seeded)
    seeded.patch(path, json={'is_active': False})
    assert check(seeded) == {'decision': 'DENY', 'policy_id': None, 'reason': reason}


@pytest.mark.parametrize('override,reason', [
    ({'user_id': 'ghost'}, 'UNKNOWN_USER'),
    ({'agent_id': 'ghost'}, 'UNKNOWN_AGENT'),
    ({'database': 'unknown_db'}, 'UNKNOWN_SERVER'),
    ({'server_id': 'nope'}, 'UNKNOWN_SERVER'),
])
def test_unknown_entities_deny(seeded, override, reason):
    policy(seeded)
    assert check(seeded, **override)['reason'] == reason


def test_explicit_server_id(seeded):
    pid = policy(seeded)
    assert check(seeded, server_id='biz-pg')['policy_id'] == pid


def test_unknown_request_fields_are_ignored_but_required_ones_validated(seeded):
    policy(seeded)
    assert check(seeded, future_field=1)['decision'] == 'ALLOW'
    assert seeded.post('/api/policy/check', json={'user_id': 'user-a'}).status_code == 422
