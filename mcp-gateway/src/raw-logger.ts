// 수집 가능한 로그를 가공 없이 출처별 파일로 저장한다 (분석용, 00번 스키마 변환 전 단계)
//
// <logDir>/<세션 시작 시각>/
// 파일명 앞 번호는 데이터 흐름 순서 (Gateway 자신 → 요청 → 응답 → DBHub → PostgreSQL)
//   1_session.json           세션 정보 (session_id, 실행 인자, 시작·생존 확인·종료 시각)
//   2_client-requests.jsonl  Claude Code -> DBHub : 실행한 명령 (server/discover, tools/call ...)
//   3_dbhub-responses.jsonl  DBHub -> Claude Code : DBHub가 돌려준 결과·오류
//   4_dbhub-stderr.log       DBHub 프로세스 자체 출력 (시작 배너, 연결 오류 등)
//   5_postgres.log           PostgreSQL 서버 로그 (docker logs, GATEWAY_PG_CONTAINER 지정 시)
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Direction = 'client_to_server' | 'server_to_client';

// 정상 종료 경로별 사유. 강제 종료(프로세스 kill)는 종료 코드가 실행되지 않으므로 기록되지 않는다
export type EndReason = 'client_closed' | 'signal' | 'dbhub_exit' | 'dbhub_spawn_error';

const DEFAULT_HEARTBEAT_MS = 30_000;

// DSN에 들어 있는 비밀번호는 기록하지 않는다
function redactArgs(args: string[]): string[] {
  return args.map((arg) => arg.replace(/(:\/\/[^:/@]+:)[^@]*@/, '$1****@'));
}

export class RawLogger {
  // Wrapper 실행(= MCP 연결) 1회마다 새로 발급. 정규화 이벤트 로그(T-03)도 이 값을 그대로 쓴다
  readonly sessionId = randomUUID();
  readonly dir: string;
  private readonly startedAt = new Date();
  private readonly sessionInfo: Record<string, unknown>;
  private readonly heartbeat: NodeJS.Timeout;
  private pgFollower?: ChildProcess;

  constructor(baseDir: string, dbhubArgs: string[], heartbeatMs = DEFAULT_HEARTBEAT_MS) {
    this.dir = join(baseDir, this.startedAt.toISOString().replace(/[:.]/g, '-'));
    mkdirSync(this.dir, { recursive: true });
    this.sessionInfo = {
      session_id: this.sessionId,
      started_at: this.startedAt.toISOString(),
      // 마지막 생존 확인 시각. 실제 종료 시각(ended_at)이 아니다: 강제 종료 시 종료 시각은 이 값 이후 heartbeat_ms 이내로만 추정 가능
      last_seen_at: this.startedAt.toISOString(),
      heartbeat_ms: heartbeatMs,
      wrapper_pid: process.pid,
      dbhub_args: redactArgs(dbhubArgs),
      pg_container: process.env.GATEWAY_PG_CONTAINER ?? null,
    };
    this.writeSessionInfo();
    // unref: heartbeat 타이머 때문에 프로세스 종료가 늦어지지 않도록 한다
    this.heartbeat = setInterval(() => {
      this.sessionInfo.last_seen_at = new Date().toISOString();
      this.writeSessionInfo();
    }, heartbeatMs).unref();
  }

  message(direction: Direction, line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      msg = { unparsed: line };
    }
    const file = direction === 'client_to_server' ? '2_client-requests.jsonl' : '3_dbhub-responses.jsonl';
    this.append(file, JSON.stringify({ ts: new Date().toISOString(), msg }) + '\n');
  }

  dbhubStderr(chunk: Buffer): void {
    this.append('4_dbhub-stderr.log', chunk);
  }

  // 세션 시작 시각 이후의 PostgreSQL 컨테이너 로그를 실시간으로 따라가며 저장
  followPostgres(container: string): void {
    const follower = spawn('docker', ['logs', '--follow', '--timestamps', '--since', this.startedAt.toISOString(), container], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // postgres 이미지는 서버 로그를 stderr로 출력한다
    follower.stdout?.on('data', (chunk: Buffer) => this.append('5_postgres.log', chunk));
    follower.stderr?.on('data', (chunk: Buffer) => this.append('5_postgres.log', chunk));
    follower.on('error', (err) => this.append('5_postgres.log', `[mcp-gateway] docker logs 실행 실패: ${err.message}\n`));
    this.pgFollower = follower;
  }

  // 종료가 감지된 경우에만 호출된다. 여기서만 ended_at을 기록한다
  close(exitCode: number | null, endReason: EndReason): void {
    clearInterval(this.heartbeat);
    this.pgFollower?.kill();
    const now = new Date().toISOString();
    this.sessionInfo.last_seen_at = now;
    this.sessionInfo.ended_at = now;
    this.sessionInfo.end_reason = endReason;
    this.sessionInfo.dbhub_exit_code = exitCode;
    this.writeSessionInfo();
  }

  // 쓰는 도중 강제 종료돼도 1_session.json이 깨지지 않도록 임시 파일에 쓴 뒤 교체한다
  private writeSessionInfo(): void {
    const file = join(this.dir, '1_session.json');
    try {
      writeFileSync(file + '.tmp', JSON.stringify(this.sessionInfo, null, 2) + '\n');
      renameSync(file + '.tmp', file);
    } catch (err) {
      process.stderr.write(`[mcp-gateway] 1_session.json 기록 실패: ${(err as Error).message}\n`);
    }
  }

  // 로그 기록 실패가 MCP 중계를 막으면 안 되므로 오류는 stderr에만 남긴다
  private append(file: string, data: string | Buffer): void {
    try {
      appendFileSync(join(this.dir, file), data);
    } catch (err) {
      process.stderr.write(`[mcp-gateway] 로그 기록 실패 (${file}): ${(err as Error).message}\n`);
    }
  }
}
