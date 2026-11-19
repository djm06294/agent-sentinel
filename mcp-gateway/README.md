# MCP Gateway (DBHub Wrapper)

Claude Code와 DBHub 사이에서 MCP 메시지를 중계하는 Wrapper입니다.

```txt
[ Claude Code ] ⇄ (stdio) ⇄ [ MCP Gateway ] ⇄ (stdio) ⇄ [ DBHub 1.5.0 ] ⇄ (SQL) ⇄ [ PostgreSQL ]
```

- **현재 단계**: 원본 MCP 중계·파일 로그를 유지하면서, `tools/call`은 관리자 백엔드에 **정책 확인(허용/차단)** 후 전달하고 결과를 HTTP 로그 서버에 자동 전송합니다.
- DBHub는 수정하지 않고 `package.json`에 버전을 고정(`1.5.0`)해 의존성으로 사용합니다.
- Wrapper에 준 인자(`--transport`, `--dsn`, `--config`, `--demo` 등)는 DBHub에 그대로 전달됩니다.
- `src/behavior-logger.ts`가 요청·응답 매칭, 스키마 변환, 디스크 대기열과 HTTP 전송을 담당합니다.
- `src/policy-gate.ts`가 정책 확인과 차단 응답을 담당합니다 (아래 [정책 확인](#정책-확인-허용차단)).

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
| `6_policy-decisions.jsonl` | **정책 확인 결과**: `tools/call`마다 허용·차단, `policy_id`, 사유. 차단 시 Gateway가 대신 보낸 응답 (`GATEWAY_POLICY_API_URL` 설정 시) |

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

## 행동 로그 서버 자동 저장

기본값으로 http://127.0.0.1:8000/api/v1/logs 에 tools/call 결과를 전송합니다. 먼저 루트의 Docker Compose 로그 서버를 실행하세요. 원본 SQL이나 조회 결과를 이 API로 전송하지 않습니다.

설정, 필드 매핑, 재시도 정책 및 실제 통합 검증 명령: [GATEWAY_PIPELINE.md](../docs/GATEWAY_PIPELINE.md).

```powershell
npm test
```

원본 파일 기록만 필요하면 실행 환경에 GATEWAY_LOG_ENABLED=false를 설정합니다. Gateway는 stdin/stdout 기반 MCP 프로세스이므로 일반 터미널에서 start:demo를 실행하는 것만으로 도구 호출이 발생하지는 않습니다. MCP 클라이언트 또는 통합 검증 스크립트로 호출해야 합니다.

## 정책 확인 (허용/차단)

`GATEWAY_POLICY_API_URL`을 지정하면 `tools/call`을 DBHub에 넘기기 전에 관리자 백엔드(`admin-backend/`)의 `POST /api/policy/check`를 호출합니다. **지정하지 않으면 정책 확인이 꺼지고** 지금까지처럼 모든 요청을 그대로 전달합니다.

```txt
Claude Code ──tools/call──▶ Gateway ──policy/check──▶ Admin API
                              │  ALLOW → DBHub로 전달
                              └─ DENY  → DBHub로 보내지 않고 Gateway가 도구 오류(isError) 응답
```

- 확인 대상은 `tools/call`뿐입니다. `initialize`, `tools/list`, 알림은 그대로 전달합니다.
- 정책 확인을 기다리는 동안 뒤에 온 메시지가 앞지르지 않도록 클라이언트 → DBHub 메시지를 **받은 순서대로** 처리합니다.
- **정책 서버가 응답하지 않거나(기본 2초) 오류·이상한 응답을 주면 차단**합니다 (fail-closed). 사유: `POLICY_UNAVAILABLE`, `POLICY_API_ERROR`, `POLICY_INVALID_RESPONSE`
- 차단 응답은 JSON-RPC 오류가 아니라 같은 `id`의 도구 오류 결과라서, 에이전트가 차단 사유를 읽고 사용자에게 안내할 수 있습니다.
- 차단된 호출도 행동 로그에 `status: denied`, `error_code: <사유>`(예: `NO_MATCHING_POLICY`, `POLICY_DENY`, `USER_INACTIVE`)로 남고, `6_policy-decisions.jsonl`에 `policy_id`까지 기록됩니다.

정책 확인 요청에 보내는 값

| 필드 | 값 |
|---|---|
| `user_id` / `agent_id` | `GATEWAY_USER_ID` / `GATEWAY_AGENT_ID` (기본 `local-user` / `dbhub-agent`). 관리자 화면에 같은 ID로 등록해야 합니다 |
| `database` | `GATEWAY_DATABASE` → 없으면 `--dsn`(또는 `DSN` 환경변수)의 DB 이름 → `--demo`면 `dbhub_demo` |
| `server_id` | `GATEWAY_SERVER_ID` (선택). 없으면 백엔드가 `database` 이름으로 대상 서버를 찾습니다 |
| `session_id`, `tool_name` | Gateway 세션 ID, 호출한 도구 이름 |

환경변수

| 이름 | 설명 |
|---|---|
| `GATEWAY_POLICY_API_URL` | 예: `http://127.0.0.1:8001/api/policy/check`. 지정 시 정책 확인 켜짐 |
| `GATEWAY_POLICY_TIMEOUT_MS` | 정책 확인 제한 시간 (기본 2000) |
| `GATEWAY_DATABASE`, `GATEWAY_SERVER_ID` | 위 표 참고 |

Claude Code 등록 예시 (정책 확인 켜기)

```bash
claude mcp add agent-sentinel-gateway \
  -e GATEWAY_POLICY_API_URL=http://127.0.0.1:8001/api/policy/check \
  -e GATEWAY_USER_ID=local-user -e GATEWAY_AGENT_ID=dbhub-agent \
  -- node C:/path/to/agent-sentinel/mcp-gateway/dist/index.js --transport stdio --dsn "postgres://user:password@localhost:5433/mydb?sslmode=disable"
```

> 아직 Gateway ↔ 정책 API 사이 인증이 없습니다 (관리자 백엔드 T-03 예정). 두 서비스 모두 127.0.0.1에서만 쓰세요.
