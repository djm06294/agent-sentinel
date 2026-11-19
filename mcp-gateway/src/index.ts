#!/usr/bin/env node
// MCP Gateway (Wrapper) v0.1
// Claude Code <-(stdio)-> Wrapper <-(stdio)-> DBHub
//
// 원본 MCP 메시지 중계 + tools/call 정책 확인(허용/차단) + 결과를 HTTP 로그 서버로 자동 전송.
// stdout은 MCP JSON-RPC 전용 채널이므로 Wrapper 자체 출력은 반드시 stderr로만 보낸다.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { RawLogger, type Direction, type EndReason } from './raw-logger.js';

import { BehaviorLogger, EventOutbox } from './behavior-logger.js';
import { databaseFromDbhubArgs, deniedResponse, PolicyClient, PolicyGate } from './policy-gate.js';

const require = createRequire(import.meta.url);

// npx 대신 package.json에 고정된 버전의 DBHub를 node로 직접 실행한다 (Windows에서도 shell 불필요)
function resolveDbhubEntry(): string {
  const pkgPath = require.resolve('@bytebase/dbhub/package.json');
  const pkg = require(pkgPath) as { bin: Record<string, string> };
  return join(dirname(pkgPath), pkg.bin.dbhub);
}

function logInfo(message: string): void {
  process.stderr.write(`[mcp-gateway] ${message}\n`);
}

// Wrapper에 넘어온 인자(--transport, --dsn, --config, --demo 등)는 DBHub에 그대로 전달한다
const dbhubArgs = process.argv.slice(2);

// 기본 로그 위치: 저장소 루트의 logs/ (git 제외 대상)
const logDir = process.env.GATEWAY_LOG_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../logs');
const heartbeatMs = Number(process.env.GATEWAY_HEARTBEAT_MS) || undefined;
const rawLogger = new RawLogger(logDir, dbhubArgs, heartbeatMs);
if (process.env.GATEWAY_PG_CONTAINER) {
  rawLogger.followPostgres(process.env.GATEWAY_PG_CONTAINER);
}
logInfo(`session_id=${rawLogger.sessionId}, 로그 저장 위치: ${rawLogger.dir}`);

// Default identity is a local label, not an authenticated user identity.
const userId = process.env.GATEWAY_USER_ID ?? 'local-user';
const agentId = process.env.GATEWAY_AGENT_ID ?? 'dbhub-agent';
const behaviorLogger = process.env.GATEWAY_LOG_ENABLED === 'false' ? undefined : new BehaviorLogger(
  rawLogger.sessionId,
  userId,
  agentId,
  new EventOutbox({
    url: process.env.GATEWAY_LOG_API_URL ?? 'http://127.0.0.1:8000/api/v1/logs',
    dir: process.env.GATEWAY_OUTBOX_DIR ?? join(logDir, 'behavior-outbox'),
    report: logInfo,
  }),
  logInfo,
);
const child = spawn(process.execPath, [resolveDbhubEntry(), ...dbhubArgs], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

// DBHub의 stderr는 파일에 남기고, Claude Code 쪽 MCP 로그에서도 보이도록 그대로 흘려보낸다
child.stderr.on('data', (chunk: Buffer) => {
  rawLogger.dbhubStderr(chunk);
  process.stderr.write(chunk);
});

// 정책 확인(T-06): GATEWAY_POLICY_API_URL을 지정했을 때만 켠다.
// 켜져 있으면 정책 서버 장애·이상 응답도 차단한다 (fail-closed).
const policyUrl = process.env.GATEWAY_POLICY_API_URL;
const database = process.env.GATEWAY_DATABASE ?? databaseFromDbhubArgs(dbhubArgs, process.env)
  ?? (dbhubArgs.includes('--demo') ? 'dbhub_demo' : 'unknown');
const policyGate = policyUrl ? new PolicyGate(
  new PolicyClient({ url: policyUrl, timeoutMs: Number(process.env.GATEWAY_POLICY_TIMEOUT_MS) || undefined }),
  {
    user_id: userId, agent_id: agentId, session_id: rawLogger.sessionId, database,
    server_id: process.env.GATEWAY_SERVER_ID || undefined,
  },
  {
    forward: (line) => child.stdin.write(line + '\n'),
    deny: (id, _tool, decision) => {
      const response = deniedResponse(id, decision);
      behaviorLogger?.deny(id, decision.reason ?? 'POLICY_DENY');
      rawLogger.policy({ id, gateway_response: JSON.parse(response) });
      process.stdout.write(response + '\n');
    },
    decided: (id, tool, decision) => {
      rawLogger.policy({ id, tool_name: tool, database, ...decision });
      if (decision.decision === 'DENY') logInfo(`정책 차단: ${tool} (${decision.reason})`);
    },
  },
) : undefined;
logInfo(policyGate
  ? `정책 확인 켜짐: ${policyUrl} (user=${userId}, agent=${agentId}, database=${database})`
  : '정책 확인 꺼짐: GATEWAY_POLICY_API_URL 미지정 (모든 요청 전달)');

// MCP stdio 전송은 메시지 1개 = JSON 1줄이므로 줄 단위로 중계한다
function forward(direction: Direction, line: string): void {
  rawLogger.message(direction, line);
  behaviorLogger?.observe(direction, line);
  if (direction === 'server_to_client') process.stdout.write(line + '\n');
  else if (policyGate) policyGate.submit(line); // tools/call은 정책 확인 후 전달 또는 차단
  else child.stdin.write(line + '\n');
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) =>
  forward('client_to_server', line),
);
createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) =>
  forward('server_to_client', line),
);

// 종료가 어떤 경로로 시작됐는지 기록한다. 아무 경로도 없이 DBHub가 끝나면 dbhub_exit
let endReason: EndReason = 'dbhub_exit';

// 클라이언트가 연결을 끊으면 DBHub의 입력도 닫아 정상 종료를 유도한다
process.stdin.on('end', () => {
  endReason = 'client_closed';
  // 정책 확인 중인 요청까지 DBHub에 넘긴 뒤 입력을 닫는다
  void (policyGate?.drain() ?? Promise.resolve()).then(() => child.stdin.end());
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    endReason = 'signal';
    child.kill(signal);
  });
}

let finishing = false;
async function finish(code: number | null): Promise<void> {
  if (finishing) return;
  finishing = true;
  await behaviorLogger?.close();
  // Allow the optional PostgreSQL log follower to collect its final lines.
  await new Promise(resolve => setTimeout(resolve, 1000));
  rawLogger.close(code, endReason);
  process.exit(code ?? 1);
}

child.on('error', () => {
  logInfo('DBHub 실행 실패');
  endReason = 'dbhub_spawn_error';
  void finish(1);
});

// close fires after stdout is drained, so the last tool result is recorded before shutdown.
child.on('close', (code, signal) => {
  if (code !== 0) logInfo(`DBHub 종료 (code=${code}, signal=${signal})`);
  void finish(code);
});