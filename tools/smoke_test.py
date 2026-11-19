"""Real HTTP POST/GET; prints ID for independent SQL verification."""
import json
from pathlib import Path
from uuid import uuid4

import httpx

payload = json.loads(Path('examples/01_read.json').read_text(encoding='utf-8'))
payload['session_id'] = 'smoke-' + uuid4().hex
payload['request_id'] = str(uuid4())
with httpx.Client(base_url='http://localhost:8000', timeout=10) as client:
    client.get('/ready').raise_for_status()
    response = client.post('/api/v1/logs', json=payload)
    assert response.status_code == 201, response.text
    saved = response.json()['data']
    read = client.get('/api/v1/logs/' + saved['log_id'])
    assert read.status_code == 200
    assert read.json()['data'] == saved
    assert client.post('/api/v1/logs', json=payload).status_code == 409
    print(json.dumps(saved, indent=2))
