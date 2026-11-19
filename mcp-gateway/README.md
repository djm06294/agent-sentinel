# MCP Gateway (DBHub Wrapper)

Claude Code와 DBHub 사이에서 MCP 메시지를 중계하는 Wrapper입니다.

```txt
[ Claude Code ] ⇄ (stdio) ⇄ [ MCP Gateway ] ⇄ (stdio) ⇄ [ DBHub 1.5.0 ] ⇄ (SQL) ⇄ [ PostgreSQL ]
```

- **현재 단계 (v0.1)**: 메시지를 그대로 전달하면서 원본 로그만 파일로 남깁니다. 정책 검사는 아직 없습니다.
- DBHub는 수정하지 않고 `package.json`에 버전을 고정(`1.5.0`)해 의존성으로 사용합니다.
- Wrapper에 준 인자(`--transport`, `--dsn`, `--config`, `--demo` 등)는 DBHub에 그대로 전달됩니다.
- 다음 단계(로그 저장, 정책 확인)를 넣을 위치는 `src/index.ts`의 `forward()` 안 TODO 주석으로 표시해 두었습니다.

## 요구 사항

- Node.js **22.5.0 이상** (DBHub가 `node:sqlite`를 사용)

## 설치 및 빌드

```bash
cd mcp-gateway
npm ci
npm run build
```

## Claude Code에 등록하기

`agent-sentinel` 폴더에서 실행합니다. 경로는 각자 PC의 **절대 경로**로 바꿔 주세요.

**PostgreSQL 연결**

```bash
claude mcp add agent-sentinel-gateway -- node C:/path/to/agent-sentinel/mcp-gateway/dist/index.js --transport stdio --dsn "postgres://user:password@localhost:5432/mydb?sslmode=disable"
```

**DB 없이 체험 (DBHub 내장 SQLite 샘플)**

```bash
claude mcp add agent-sentinel-gateway -- node C:/path/to/agent-sentinel/mcp-gateway/dist/index.js --transport stdio --demo
```

등록 후 Claude Code를 다시 시작하고 `/mcp`에서 `agent-sentinel-gateway`가 연결됐는지, `execute_sql`, `search_objects` 도구가 보이는지 확인합니다.

> DSN에 비밀번호가 들어가므로 `.mcp.json`처럼 커밋되는 파일에는 넣지 않습니다. 로컬 DB는 `?sslmode=disable`을 붙여야 접속됩니다.

## 원본 로그 (raw log)

Wrapper가 실행될 때마다 저장소 루트의 `logs/<세션 시작 시각>/` 폴더에 출처별로 저장합니다. `logs/`는 `.gitignore`에 들어 있어 업로드되지 않습니다.

| 파일 | 내용 |
|---|---|
| `1_session.json` | `session_id`, 실행 인자(DSN 비밀번호는 `****`), 시작·생존 확인·종료 시각, DBHub 종료 코드 (아래 표) |
| `2_client-requests.jsonl` | **실행한 명령**: Claude Code → DBHub 메시지 (`server/discover`, `tools/list`, `tools/call` 등) |
| `3_dbhub-responses.jsonl` | **DBHub 결과**: DBHub → Claude Code 응답 (`success`, 오류 `code`, **조회 결과 행 원문 포함**) |
| `4_dbhub-stderr.log` | DBHub 프로세스 자체 출력 (시작 배너, 연결된 DB, 연결 오류) |
| `5_postgres.log` | **DB에서 실제로 실행된 일**: PostgreSQL 서버 로그 (`GATEWAY_PG_CONTAINER` 설정 시) |

`1_session.json` 필드

| 필드 | 설명 |
|---|---|
| `session_id` | Wrapper 실행(= MCP 연결) 1회마다 새로 만드는 UUID. 재연결하면 새 값. JSON-RPC `id`는 연결마다 0부터 다시 시작하므로 요청은 `(session_id, id)`로 구분 |
| `started_at` | Wrapper 시작 시각 |
| `last_seen_at` | **마지막 생존 확인 시각** (`heartbeat_ms`마다 갱신). 종료 시각이 아님 |
| `ended_at`, `end_reason` | 종료가 감지됐을 때만 기록. `client_closed`(클라이언트가 연결 닫음), `signal`(SIGINT/SIGTERM), `dbhub_exit`(DBHub가 먼저 종료), `dbhub_spawn_error` |
| `dbhub_exit_code` | DBHub 종료 코드 (정상 0) |

> **`ended_at`이 없으면** 실행 중이거나 **강제 종료**된 세션입니다. Claude Code는 세션을 끝낼 때 Wrapper를 강제 종료하므로(Windows 실측) 대부분 이 경우입니다. 이때 실제 종료 시각은 `last_seen_at` ~ `last_seen_at + heartbeat_ms` 사이로만 추정할 수 있습니다.

환경변수

| 이름 | 설명 |
|---|---|
| `GATEWAY_LOG_DIR` | 로그 저장 위치 변경 (기본: 저장소 루트 `logs/`) |
| `GATEWAY_HEARTBEAT_MS` | `last_seen_at` 갱신 주기 (기본: 30000) |
| `GATEWAY_PG_CONTAINER` | PostgreSQL Docker 컨테이너 이름 (예: `claude-pg`). 지정하면 세션 동안 `docker logs`를 따라가며 `5_postgres.log`에 저장 |

`5_postgres.log`에 SQL이 남으려면 PostgreSQL에서 문장 로그를 켜야 합니다 (로컬 개발 DB 전용).

```sql
ALTER SYSTEM SET log_statement = 'all';
ALTER SYSTEM SET log_duration = on;
ALTER SYSTEM SET log_line_prefix = '%m [%p] app=%a user=%u db=%d ';
SELECT pg_reload_conf();
```

> PostgreSQL 컨테이너 로그에는 같은 DB에 붙은 다른 클라이언트(psql 등)의 SQL도 함께 기록됩니다.

## 참고

- stdout은 MCP JSON-RPC 전용입니다. Wrapper에서 디버그 출력이 필요하면 반드시 **stderr**로 보내야 합니다 (stdout에 섞이면 연결이 깨집니다).
- 스펙: `10_MCP서버.md` (T-01 ~ T-09), 데이터 형식: `00_공통_인터페이스.md`
