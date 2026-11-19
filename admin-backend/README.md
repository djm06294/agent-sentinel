# Admin Backend (관리자 백엔드)

관리자 웹과 MCP Gateway가 쓰는 REST API입니다. 사용자·에이전트·대상 서버·접근 정책을 관리하고,
Gateway가 SQL 실행 전에 물어보는 **정책 확인 API**를 제공합니다. 스펙: `docs/specs/11_관리자백엔드.md`

```txt
[ 관리자 FE ] ──REST──▶ [ Admin API :8001 ] ──▶ [ control_db (PostgreSQL) ]
[ MCP Gateway ] ──POST /api/policy/check──▶ ┘
```

- 로그 수신 API(`app/`, :8000)와 DB(`sentinel_logs`)는 서영님 서비스이고, 이 서비스는 별도 DB(`control_db`)를 씁니다.
- **아직 인증이 없습니다** (T-03 예정). 127.0.0.1에만 열어서 로컬 개발용으로만 씁니다.

## API

Swagger: http://localhost:8001/docs

| ID | Method · Path | 용도 |
|---|---|---|
| B-02 | `GET/POST /api/agent-users`, `GET/PATCH /api/agent-users/{id}` | 사용자 관리 |
| B-03 | `GET/POST /api/agents`, `GET/PATCH /api/agents/{id}` | 에이전트 관리 (토큰 발급은 TODO) |
| B-04 | `GET/POST /api/servers`, `GET/PATCH /api/servers/{id}` | 대상 서버 관리 |
| B-05 | `GET/POST /api/policies`, `GET/PATCH/DELETE /api/policies/{id}` | 접근 정책 관리 |
| B-06 | `POST /api/policy/check` | 정책 확인 (Gateway 전용) |
| - | `GET /health`, `GET /ready` | 상태 확인 |

- 사용자·에이전트·서버는 삭제 대신 `is_active: false`로 비활성화합니다.
- 사용자 `id`·에이전트 `id`는 행동 로그의 `user_id`·`agent_id`와 같은 값을 씁니다 (Gateway의 `GATEWAY_USER_ID`, `GATEWAY_AGENT_ID`).
- 오류 응답: `{"error": {"code": "...", "message": "...", "fields": [{"loc": ["id"], "msg": "..."}]}}`
  - `validation_error`(422), `invalid_reference`(422, 없는 사용자·서버를 가리킴), `already_exists`(409), `not_found`(404)

### 정책 판단 규칙

1. 사용자·에이전트·대상 서버가 없거나 비활성이면 **DENY** (`UNKNOWN_*`, `*_INACTIVE`)
2. 해당 사용자 **또는** 에이전트를 주체로 하는 활성 정책 중, 대상 서버가 맞고 `scope_value`가 비었거나 요청 DB와 같은 것만 봄
3. 하나라도 DENY면 **DENY** (`POLICY_DENY`), ALLOW만 있으면 **ALLOW**
4. 맞는 정책이 없으면 **기본 DENY** (`NO_MATCHING_POLICY`)

`priority`(작을수록 먼저)는 결과를 바꾸지 않고, 응답의 `policy_id`로 어떤 정책을 보여줄지 고를 때만 씁니다.
권한 단위는 미결(Q1)이라 `scope_type`은 `DATABASE`만 받습니다.

```json
// POST /api/policy/check
{ "user_id": "local-user", "agent_id": "dbhub-agent", "database": "mydb",
  "session_id": "...", "tool_name": "execute_sql", "action": "SELECT", "tables": ["customers"] }
// 200
{ "decision": "ALLOW", "policy_id": "6f1c2c1e-...", "reason": null }
```

`server_id`를 보내면 그 서버로, 없으면 `database` 이름이 같은 서버로 판단합니다.

## 실행

**Docker (저장소 루트에서)**

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }   # POSTGRES_PASSWORD 설정
docker compose up -d --build control-db admin-api
Invoke-RestMethod http://localhost:8001/ready
```

시작할 때 `alembic upgrade head`로 테이블을 만듭니다. `CONTROL_POSTGRES_PASSWORD`를 비워 두면 `POSTGRES_PASSWORD`를 같이 씁니다.

**로컬 Python (이 폴더에서)**

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest -q          # SQLite 인메모리로 실행, Docker 불필요

# control-db만 Docker로 띄우고 API는 호스트에서 실행 (저장소 루트에서 DB 실행)
#   docker compose -f compose.yaml -f compose.local.yaml up -d control-db
$env:ADMIN_DB_PASSWORD = "<.env의 비밀번호>"   # ADMIN_DB_PORT 기본값 5434
.venv\Scripts\alembic.exe upgrade head
.venv\Scripts\uvicorn.exe admin_api.main:app --host 127.0.0.1 --port 8001 --reload
```

환경변수 (`ADMIN_` 접두어)

| 이름 | 기본값 |
|---|---|
| `ADMIN_DB_HOST` / `ADMIN_DB_PORT` | `localhost` / `5434` |
| `ADMIN_DB_NAME` / `ADMIN_DB_USER` / `ADMIN_DB_PASSWORD` | `control_db` / `sentinel_admin` / (없음) |
| `ADMIN_DATABASE_URL` | 지정하면 위 값 대신 사용 (예: `sqlite:///./control.db`) |
| `ADMIN_CORS_ORIGINS` | `["http://localhost:5173","http://127.0.0.1:5173"]` (관리자 FE 개발 서버) |

## TODO

- T-03 관리자 로그인(B-01)과 API 인증, `policy/check` 전용 토큰
- B-03 에이전트 토큰 발급 (해시만 저장)
- B-07 로그 조회, B-08 통계, B-09/B-10 탐지·알림 (서영님 스펙 확정 후)
- Q1 권한 단위 확정 시 SCHEMA/TABLE 정책
