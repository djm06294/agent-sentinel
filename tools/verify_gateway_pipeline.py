"""Actual Gateway -> HTTP log API -> PostgreSQL verification.

Requires built mcp-gateway and running Docker Compose API/DB. Uses DBHub's demo
SQLite as the *business* database; PostgreSQL is the actual log destination.
Adds two synthetic logs to the development DB and preserves them.
"""
import json
import os
from pathlib import Path
import queue
import shutil
import subprocess
import threading
import time
from urllib.request import urlopen
from uuid import uuid4
from datetime import datetime

ROOT = Path(__file__).resolve().parents[1]


def main():
    with urlopen('http://127.0.0.1:8000/ready', timeout=5) as response:
        assert response.status == 200
    run_dir = ROOT / 'logs' / 'pipeline-verification' / uuid4().hex
    outbox = run_dir / 'outbox'
    env = os.environ.copy()
    env.update(GATEWAY_LOG_ENABLED='true', GATEWAY_USER_ID='verification-user',
               GATEWAY_AGENT_ID='verification-agent', GATEWAY_LOG_DIR=str(run_dir),
               GATEWAY_OUTBOX_DIR=str(outbox),
               GATEWAY_LOG_API_URL='http://127.0.0.1:8000/api/v1/logs')
    env.pop('GATEWAY_PG_CONTAINER', None)
    process = subprocess.Popen([shutil.which('node') or 'node', 'dist/index.js', '--transport', 'stdio', '--demo'],
                               cwd=ROOT / 'mcp-gateway', env=env, stdin=subprocess.PIPE,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8')
    messages = queue.Queue()
    stderr = []

    def read():
        for line in process.stdout:
            try:
                messages.put(json.loads(line))
            except ValueError:
                messages.put({'invalid_stdout': True})

    threading.Thread(target=read, daemon=True).start()
    threading.Thread(target=lambda: stderr.extend(process.stderr.readlines()), daemon=True).start()

    def send(message):
        process.stdin.write(json.dumps(message) + '\n')
        process.stdin.flush()

    def request(request_id, method, params):
        send(dict(jsonrpc='2.0', id=request_id, method=method, params=params))
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            message = messages.get(timeout=max(1, deadline - time.monotonic()))
            assert 'invalid_stdout' not in message, 'Non-JSON protocol output'
            if message.get('id') == request_id:
                assert 'error' not in message, message
                return message['result']
        raise TimeoutError(method)

    try:
        request(1, 'initialize', dict(protocolVersion='2024-11-05', capabilities={},
                                    clientInfo=dict(name='pipeline-verification', version='1.0')))
        send(dict(jsonrpc='2.0', method='notifications/initialized'))
        tools = request(2, 'tools/list', {})
        assert 'execute_sql' in [tool['name'] for tool in tools['tools']]
        marker = 'do_not_store_' + uuid4().hex
        good = request(3, 'tools/call', dict(name='execute_sql', arguments={'sql': f"SELECT '{marker}' AS private_value"}))
        assert not good.get('isError'), good
        bad = request(4, 'tools/call', dict(name='execute_sql', arguments={'sql': 'SELECT * FROM missing_pipeline_table_' + uuid4().hex}))
        assert bad.get('isError') or any('"success": false' in c.get('text', '') for c in bad.get('content', [])), bad
        process.stdin.close()
        process.wait(timeout=20)
        assert process.returncode == 0
        receipts = [json.loads(line) for line in (outbox / 'receipts.jsonl').read_text().splitlines()]
        assert len(receipts) == 2 and all(row['http_status'] == 201 for row in receipts), receipts
        receipts.sort(key=lambda row: row['sequence_no'])
        assert [row['sequence_no'] for row in receipts] == [0, 1]
        session_id = receipts[0]['session_id']
        sql = f"SELECT row_to_json(t) FROM (SELECT * FROM behavior_logs WHERE session_id = '{session_id}' ORDER BY sequence_no) t;"
        selected = subprocess.run(['docker', 'compose', 'exec', '-T', 'log-db', 'sh', '-c',
                                   'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'],
                                  input=sql, text=True, encoding='utf-8', cwd=ROOT, capture_output=True, check=True)
        rows = [json.loads(line) for line in selected.stdout.splitlines() if line.strip()]
        assert len(rows) == 2
        assert [row['status'] for row in rows] == ['success', 'failure']
        assert rows[1]['error_code'] in ['MCP_TOOL_ERROR', 'TOOL_EXECUTION_FAILED']
        assert marker not in json.dumps(rows)
        for receipt, row in zip(receipts, rows):
            assert row['log_id'] == receipt['log_id']
            assert row['user_id'] == 'verification-user' and row['agent_id'] == 'verification-agent'
            assert row['tool_name'] == 'execute_sql' and row['metadata']['transport'] == 'stdio'
            with urlopen('http://127.0.0.1:8000/api/v1/logs/' + row['log_id'], timeout=5) as response:
                api = json.load(response)['data']
            for key, value in api.items():
                if key in ['timestamp', 'received_at']:
                    assert datetime.fromisoformat(value.replace('Z', '+00:00')) == datetime.fromisoformat(row[key])
                elif key == 'metadata':
                    assert {k: v for k, v in value.items() if v is not None} == row[key]
                else:
                    assert value == row[key], key
        # Simulate a lost HTTP acknowledgement after DB commit: replay the same event
        # from disk in a new gateway process. PostgreSQL's unique key must keep two rows.
        replay = {key: value for key, value in rows[0].items() if key not in ['log_id', 'received_at']}
        (outbox / (replay['request_id'] + '.pending.json')).write_text(json.dumps(replay), encoding='utf-8')
        restarted = subprocess.run([shutil.which('node') or 'node', 'dist/index.js', '--transport', 'stdio', '--demo'],
                                   cwd=ROOT / 'mcp-gateway', env=env, input='', text=True,
                                   encoding='utf-8', capture_output=True, timeout=30)
        assert restarted.returncode == 0, 'Replay process failed'
        replay_receipts = [json.loads(line) for line in (outbox / 'receipts.jsonl').read_text().splitlines()]
        assert len(replay_receipts) == 3 and replay_receipts[-1]['http_status'] == 409
        assert not list(outbox.glob('*.pending.json'))
        repeated = subprocess.run(['docker', 'compose', 'exec', '-T', 'log-db', 'sh', '-c',
                                  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA'],
                                 input=sql, text=True, encoding='utf-8', cwd=ROOT, capture_output=True, check=True)
        assert len([line for line in repeated.stdout.splitlines() if line.strip()]) == 2
        summary = dict(result='PASS', session_id=session_id, stored_logs=[row['log_id'] for row in rows],
                       statuses=[row['status'] for row in rows], raw_sql_stored=False,
                       restart_replay='409, no duplicate row', business_db='DBHub demo SQLite', log_db='PostgreSQL')
        (run_dir / 'verification.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
        print(json.dumps(summary, indent=2))
    finally:
        if process.poll() is None:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True)
            else:
                process.terminate()
                process.wait(timeout=10)


if __name__ == '__main__':
    main()
