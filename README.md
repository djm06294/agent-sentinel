# Agent Sentinel

AI 에이전트 행동 기록을 위한 MCP Gateway와 로그 수신 서비스를 함께 관리하는 저장소.

- `mcp-gateway/`: 팀원의 DBHub 중계·원본 로그 수집 구성요소. [Gateway 실행 안내](mcp-gateway/README.md).
- `app/`: 서영의 HTTP 로그 수신·검증·PostgreSQL 저장·단건 조회 서비스.
- Gateway의 tools/call 결과가 로그 수신 API를 통해 PostgreSQL에 자동 저장된다. [통합 실행 안내](docs/GATEWAY_PIPELINE.md).
- [서영 배정 업무 및 완료 현황](docs/SEOYOUNG_WORK.md). 아래 실행 절차는 로그 수신 서비스 기준이다.

## 실행 (Windows PowerShell)

Python 3.11+, Docker Desktop의 Linux containers / Compose v2가 필요하다.
컨테이너는 Python 3.13, PostgreSQL 17을 사용한다. 직접 의존성은 requirements 파일에 고정했다.
`requirements-lock.txt`는 검증한 Windows 환경의 전체 의존성 스냅샷이며 Linux 이미지 검증 결과는 아니다.

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# .env의 POSTGRES_PASSWORD를 로컬 전용 무작위 비밀번호로 변경
docker compose up -d --build
docker compose ps
Invoke-RestMethod http://localhost:8000/ready
```

Swagger: http://localhost:8000/docs · OpenAPI: http://localhost:8000/openapi.json

API는 127.0.0.1:8000에만 노출되며 DB는 Compose 내부에서만 접근한다.
시작 시 `alembic upgrade head`가 스키마를 생성한다. DB 데이터는 named volume에 유지된다.
`docker compose down`은 데이터 볼륨을 보존한다. `down -v`는 데이터를 삭제하므로 사용하지 않는다.
DB 초기 비밀번호 변경은 기존 volume의 DB 계정 비밀번호를 자동 변경하지 않는다.

## 로컬 Python 실행 및 테스트

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
.venv\Scripts\python.exe -m pytest -m "not integration" -q
# Docker의 DB만 사용하고 Python API는 호스트에서 실행할 때
docker compose -f compose.yaml -f compose.local.yaml up -d log-db
.venv\Scripts\alembic.exe upgrade head
.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000
```

이미 Compose API가 8000을 사용 중이면 로컬 API를 동시에 실행하지 않는다.
Postman과 실제 PostgreSQL 통합 테스트는 [TEST_GUIDE](docs/TEST_GUIDE.md)를 따른다.

## 구조와 역할

```text
app/
  main.py                  앱, 상태 점검, 크기 제한, 오류 응답
  api/routes/logs.py       POST/GET 라우트
  core/config.py          환경변수와 비밀값 설정
  db/database.py          연결 풀과 요청별 세션
  db/models.py            SQLAlchemy PostgreSQL 모델
  schemas/log.py          Pydantic 입력·출력·metadata 검증
  services/log_service.py 저장 트랜잭션과 조회
migrations/                Alembic 초기 스키마 및 변경 이력
tests/                     Mock 단위 / PostgreSQL 통합 테스트
examples/                  6가지 합성 시나리오
postman/                   Collection v2.1
tools/                     예제 생성, 실제 HTTP smoke test
docs/                      API, DB, 테스트 및 검증 결과
Dockerfile                 Python API 이미지
compose.yaml               log-api / log-db / 영속 볼륨
compose.local.yaml         선택적 localhost DB 포트
requirements*.txt          의존성
```

## 데이터 계약

`sequence_no`는 생산자가 `(agent_id, session_id)` 안에서 부여하는 0 이상의 고유 순번이다.
수신 순서는 발생 순서가 아니다. UTC 발생 시각과 생산자 순번을 함께 보관한다.
재전송된 순번은 409로 거절하며 자동 idempotent 성공이나 재시도 큐는 제공하지 않는다.
`request_id`는 여러 도구 동작을 연결할 수 있어 고유 제약을 두지 않는다.

로그 수신 API는 민감한 원문 SQL, 프롬프트, 도구 출력, URL 쿼리, 인증 헤더를 수집하지 않는다. Gateway의 원본 로그에는 SQL과 결과가 포함될 수 있으며, 원본 파일 자체는 전송하지 않고 허용 필드로 변환한 행동 이벤트만 저장 API로 자동 전송한다.
metadata는 숫자·열거형 허용 목록만 받으며 확장은 코드·스키마 검토를 거쳐야 한다.
식별자 자체에 비밀값을 넣는 오용까지 자동 식별할 수는 없으므로 생산자도 비식별 ID만 보내야 한다.
현재 API에는 인증이 없다. 원격 MCP 연동 시 인증, TLS, 생산자 신원 검증과 접근 제한이 필요하다.

상세: [DB 스키마](docs/DB_SCHEMA.md), [API 명세](docs/API_SPEC.md),
[테스트 가이드](docs/TEST_GUIDE.md), [실행 검증 결과](docs/VERIFICATION.md).

## 팀 개발 및 동기화

- 로그 수신 서비스 담당 영역: `app/`, `migrations/`, `tests/`, `postman/`.
- 연동 계약은 `docs/API_SPEC.md`, `docs/DB_SCHEMA.md`를 기준으로 한다. 필드 변경은 팀원과 합의한다.
- 각자 `.env`를 생성하고 로컬 비밀번호를 설정한다. `.env`, 가상환경, DB 데이터는 공유하지 않는다.
- 최신 `main`에서 기능 브랜치를 만들어 작업하고 PR 검토 후 병합한다. 공유 브랜치에 강제 푸시하지 않는다.
- 팀원은 저장소를 clone한 뒤 위 Docker 실행 절차로 실행할 수 있다. Docker 이미지와 DB 볼륨은 각 컴퓨터에서 생성된다.
- 서영의 구현 범위는 로그 수신·저장·단건 조회다. Gateway와 저장 API의 연동을 추가 검증했다. 관리자 UI, 정책 판정, 이상탐지는 후속 작업이다.
