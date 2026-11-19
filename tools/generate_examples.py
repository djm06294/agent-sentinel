"""Regenerate synthetic scenarios and the Postman collection (no secrets)."""
import json
from pathlib import Path
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]


def write(path, data):
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')


base = dict(timestamp='2026-11-19T09:00:00+09:00', user_id='user-demo',
            agent_id='agent-demo', session_id='session-demo',
            request_id=str(UUID(int=1)), sequence_no=0, tool_name='db.query',
            action='read', resource='table:orders', status='success', duration_ms=12,
            metadata={'result_count': 3, 'transport': 'http', 'resource_type': 'table'})
scenarios = [
    ('01_read', {}),
    ('02_update', dict(tool_name='db.update', action='update', metadata={'rows_affected': 1})),
    ('03_denied', dict(status='denied', error_code='ACCESS_DENIED', duration_ms=0, metadata={})),
    ('04_not_found', dict(status='failure', error_code='RESOURCE_NOT_FOUND', resource='table:missing', metadata={})),
    ('05_tool_error', dict(status='failure', error_code='TOOL_TIMEOUT', duration_ms=3000, metadata={'retry_count': 1})),
]
examples = []
for index, (name, changes) in enumerate(scenarios):
    payload = {**base, **changes, 'sequence_no': index, 'request_id': str(UUID(int=index + 1))}
    write(f'examples/{name}.json', payload)
    examples.append(payload)
write('examples/06_sequence.json', [{**base, 'sequence_no': i, 'request_id': str(UUID(int=i + 10)),
                                    'timestamp': f'2026-11-19T09:00:0{i}+09:00'} for i in range(3)])

items = []
def item(name, method, path, expected, payload=None, capture=False):
    request = {'method': method, 'header': [], 'url': '{{base_url}}' + path}
    if payload is not None:
        request['header'] = [{'key': 'Content-Type', 'value': 'application/json'}]
        request['body'] = {'mode': 'raw', 'raw': json.dumps(payload, indent=2), 'options': {'raw': {'language': 'json'}}}
    checks = [f"pm.test('HTTP {expected}', () => pm.response.to.have.status({expected}));"]
    events = []
    if capture:
        events.append({'listen': 'prerequest', 'script': {'type': 'text/javascript', 'exec': [
            "pm.collectionVariables.set('session_id', pm.variables.replaceIn('{{$guid}}'));",
            "pm.collectionVariables.set('request_id', pm.variables.replaceIn('{{$guid}}'));"
        ]}})
        checks += ["if (pm.response.code === 201) { pm.collectionVariables.set('log_id', pm.response.json().data.log_id); pm.collectionVariables.set('saved_data', JSON.stringify(pm.response.json().data)); }"]
    if name == 'Read saved log':
        checks += ["pm.test('Stored data matches', () => pm.expect(pm.response.json().data).to.deep.equal(JSON.parse(pm.collectionVariables.get('saved_data'))));"]
    events.append({'listen': 'test', 'script': {'type': 'text/javascript', 'exec': checks}})
    items.append({'name': name, 'request': request, 'event': events, 'response': []})

item('Health Check', 'GET', '/health', 200)
item('Readiness Check', 'GET', '/ready', 200)
for index, payload in enumerate(examples):
    item(scenarios[index][0], 'POST', '/api/v1/logs', 201,
         {**payload, 'session_id': '{{session_id}}', 'request_id': '{{request_id}}'}, True)
item('Read saved log', 'GET', '/api/v1/logs/{{log_id}}', 200)
item('Invalid request', 'POST', '/api/v1/logs', 422, {'duration_ms': -1})
write('postman/Agent-Sentinel.postman_collection.json', {
    'info': {'name': 'Agent Sentinel', 'schema': 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'},
    'variable': [{'key': 'base_url', 'value': 'http://localhost:8000'},
                 {'key': 'log_id', 'value': ''}, {'key': 'session_id', 'value': ''}, {'key': 'request_id', 'value': ''}],
    'item': items,
})
