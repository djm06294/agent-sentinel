#!/usr/bin/env node
// MCP Gateway (Wrapper) v0.1
// Claude Code <-(stdio)-> Wrapper <-(stdio)-> DBHub
//
// 현재 단계: 메시지를 그대로 중계하면서 원본 로그만 파일로 남긴다 (정책 검사 없음).
// stdout은 MCP JSON-RPC 전용 채널이므로 Wrapper 자체 출력은 반드시 stderr로만 보낸다.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { RawLogger, type Direction, type EndReason } from './raw-logger.js';

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

const child = spawn(process.execPath, [resolveDbhubEntry(), ...dbhubArgs], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: process.env,
});

// DBHub의 stderr는 파일에 남기고, Claude Code 쪽 MCP 로그에서도 보이도록 그대로 흘려보낸다
child.stderr.on('data', (chunk: Buffer) => {
  rawLogger.dbhubStderr(chunk);
  process.stderr.write(chunk);
});

// MCP stdio 전송은 메시지 1개 = JSON 1줄이므로 줄 단위로 중계한다
function forward(direction: Direction, line: string): void {
  rawLogger.message(direction, line);
  // TODO(T-03): Event Logger - 요청·응답을 짝지어 agent_event_log 스키마(00번 4절)로 기록
  // TODO(T-06): Policy Client - client_to_server의 tools/call은 정책 확인 후 전달/차단
  const target = direction === 'client_to_server' ? child.stdin : process.stdout;
  target.write(line + '\n');
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
  child.stdin.end();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    endReason = 'signal';
    child.kill(signal);
  });
}

child.on('error', (err) => {
  logInfo(`DBHub 실행 실패: ${err.message}`);
  rawLogger.close(null, 'dbhub_spawn_error');
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (code !== 0) {
    logInfo(`DBHub 종료 (code=${code}, signal=${signal})`);
  }
  // docker logs가 마지막 PostgreSQL 로그를 따라잡을 시간을 잠깐 준다
  setTimeout(() => {
    rawLogger.close(code, endReason);
    process.exit(code ?? 1);
  }, 1000);
});
