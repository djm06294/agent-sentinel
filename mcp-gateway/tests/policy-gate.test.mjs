import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { BehaviorLogger } from '../dist/behavior-logger.js';
import { PolicyClient, PolicyGate, deniedResponse, databaseFromDbhubArgs } from '../dist/policy-gate.js';

const ctx = { user_id: 'local-user', agent_id: 'dbhub-agent', session_id: 's1', database: 'mydb' };
const call = (id, name = 'execute_sql') =>
  JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: { sql: 'SELECT 1' } } });

async function withServer(handler, fn) {
  const received = [];
  const server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    received.push(JSON.parse(text));
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}/api/policy/check`, received);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const json = (status, body) => (_req, res) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

test('정책 API 결과를 그대로 쓰고, 요청에는 사용자·에이전트·DB·도구 이름만 보낸다', async () => {
  await withServer(json(200, { decision: 'ALLOW', policy_id: 'p1', reason: null }), async (url, received) => {
    const decision = await new PolicyClient({ url }).check(ctx, 'execute_sql');
    assert.deepEqual(decision, { decision: 'ALLOW', policy_id: 'p1', reason: null });
    assert.deepEqual(received[0], { ...ctx, tool_name: 'execute_sql' });
  });
  await withServer(json(200, { decision: 'DENY', policy_id: 'p2', reason: 'POLICY_DENY' }), async (url) => {
    assert.deepEqual(await new PolicyClient({ url }).check(ctx, 'x'), { decision: 'DENY', policy_id: 'p2', reason: 'POLICY_DENY' });
  });
});

test('정책 서버 장애·오류·이상 응답은 모두 차단 (fail-closed)', async () => {
  const cases = [
    [json(500, { error: {} }), 'POLICY_API_ERROR'],
    [json(200, 'not json'), 'POLICY_INVALID_RESPONSE'],
    [json(200, { decision: 'MAYBE' }), 'POLICY_INVALID_RESPONSE'],
    [() => {}, 'POLICY_UNAVAILABLE'], // 응답 없음 → 타임아웃
  ];
  for (const [handler, reason] of cases) {
    await withServer(handler, async (url) => {
      const decision = await new PolicyClient({ url, timeoutMs: 200 }).check(ctx, 'execute_sql');
      assert.deepEqual(decision, { decision: 'DENY', policy_id: null, reason });
    });
  }
  // 서버가 아예 없음
  const decision = await new PolicyClient({ url: 'http://127.0.0.1:1/api/policy/check', timeoutMs: 500 }).check(ctx, 'x');
  assert.equal(decision.reason, 'POLICY_UNAVAILABLE');
});

test('형식에 맞지 않는 차단 사유는 POLICY_DENY로 바꾼다 (로그 error_code 보호)', async () => {
  await withServer(json(200, { decision: 'DENY', reason: 'bad reason; DROP' }), async (url) => {
    assert.equal((await new PolicyClient({ url }).check(ctx, 'x')).reason, 'POLICY_DENY');
  });
});

test('자격증명이 들어간 URL은 거부', () => {
  assert.throws(() => new PolicyClient({ url: 'http://u:p@localhost/x' }));
  assert.throws(() => new PolicyClient({ url: 'file:///etc/passwd' }));
});

test('정책 확인 중에도 메시지 순서를 지키고, tools/call만 확인한다', async () => {
  const checked = [];
  const client = {
    async check(_ctx, tool) {
      checked.push(tool);
      await new Promise((r) => setTimeout(r, tool === 'slow' ? 50 : 1));
      return tool === 'blocked'
        ? { decision: 'DENY', policy_id: 'p9', reason: 'POLICY_DENY' }
        : { decision: 'ALLOW', policy_id: 'p1', reason: null };
    },
  };
  const out = [];
  const gate = new PolicyGate(client, ctx, {
    forward: (line) => out.push(['forward', JSON.parse(line).id ?? JSON.parse(line).method]),
    deny: (id, tool, d) => out.push(['deny', id, tool, d.reason]),
  });
  gate.submit(JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize' }));
  gate.submit(call(1, 'slow'));
  gate.submit(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 1 } }));
  gate.submit(call(2, 'blocked'));
  gate.submit(call('3'));
  gate.submit('not json');
  await gate.drain();
  assert.deepEqual(checked, ['slow', 'blocked', 'execute_sql']);
  assert.deepEqual(out, [
    ['forward', 0],
    ['forward', 1],
    ['forward', 'notifications/cancelled'],
    ['deny', 2, 'blocked', 'POLICY_DENY'],
    ['forward', '3'],
  ]);
});

test('차단 응답은 같은 id의 도구 오류(isError)이고 사유를 담는다', () => {
  const res = JSON.parse(deniedResponse('abc', { decision: 'DENY', policy_id: null, reason: 'USER_INACTIVE' }));
  assert.equal(res.id, 'abc');
  assert.equal(res.result.isError, true);
  assert.match(res.result.content[0].text, /USER_INACTIVE/);
});

test('차단된 호출은 행동 로그에 denied + 사유로 남는다', async () => {
  const events = [];
  const logger = new BehaviorLogger('s', 'u', 'a', { enqueue: (e) => events.push(e), close: async () => {} }, () => {});
  logger.observe('client_to_server', call(7));
  logger.deny(7, 'NO_MATCHING_POLICY');
  // 뒤늦게 같은 id 응답이 와도 다시 기록하지 않는다
  logger.observe('server_to_client', JSON.stringify({ jsonrpc: '2.0', id: 7, result: { isError: true } }));
  await logger.close();
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'denied');
  assert.equal(events[0].error_code, 'NO_MATCHING_POLICY');
});

test('DSN에서 데이터베이스 이름을 꺼낸다', () => {
  assert.equal(databaseFromDbhubArgs(['--dsn', 'postgres://u:p@h:5433/mydb?sslmode=disable'], {}), 'mydb');
  assert.equal(databaseFromDbhubArgs(['--dsn=postgres://h/biz%20db'], {}), 'biz db');
  assert.equal(databaseFromDbhubArgs([], { DSN: 'postgres://h:5432/envdb' }), 'envdb');
  assert.equal(databaseFromDbhubArgs(['--demo'], {}), undefined);
  assert.equal(databaseFromDbhubArgs(['--dsn', 'not a url'], {}), undefined);
});
