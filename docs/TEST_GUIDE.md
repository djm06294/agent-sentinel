# 실행·테스트 가이드

## 1. Docker와 API

프로젝트 루트에서 실행한다. Docker Desktop을 설치·시작하고 Linux containers를 활성화한다.

```powershell
docker version
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# 이미 .env가 있으면 덮어쓰지 말고 기존 설정을 유지한다.
# POSTGRES_PASSWORD를 로컬 전용 비밀번호로 변경한 뒤 실행
docker compose up -d --build
docker compose ps
Invoke-RestMethod http://localhost:8000/health
Invoke-RestMethod http://localhost:8000/ready
```

두 상태 API가 200이어야 한다. `/health`는 DB 장애 중에도 200일 수 있다.

## 2. Postman

1. `postman/Agent-Sentinel.postman_collection.json`을 Import한다.
2. Collection 변수 `base_url`을 `http://localhost:8000`으로 설정한다.
3. Collection Runner에서 위에서 아래로 전체 실행한다.
4. Health/Readiness 200, 5가지 저장 요청 201, 저장 ID 조회 200, 잘못된 요청 422를 확인한다.
5. 저장 요청의 사전 스크립트는 매번 새 session_id/request_id를 생성한다.
   테스트 스크립트는 응답 log_id를 Collection 변수에 저장하며 조회 요청이 재사용한다.
6. 실제 저장 응답의 log_id를 복사해 아래 SQL로 독립 확인한다.

예상 응답 구조는 [API_SPEC](API_SPEC.md)에 있다. Collection에는 상태 코드 assertion이 포함되어 있다.
Collection Runner 재실행은 새 정상 로그를 추가한다. 샘플 데이터 자동 삭제는 하지 않는다.

## 3. SQL로 저장 확인

```powershell
docker compose exec log-db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

열린 psql에서 실행:

```sql
SELECT log_id, timestamp, received_at, agent_id, session_id, sequence_no, status
FROM behavior_logs ORDER BY received_at DESC LIMIT 20;

SELECT * FROM behavior_logs
WHERE log_id = '여기에-실제-응답-UUID';

SELECT sequence_no, timestamp, action, status
FROM behavior_logs
WHERE agent_id = 'agent-demo' AND session_id = 'session-demo'
ORDER BY sequence_no;
```

종료: `\q`. API 응답과 SQL의 ID·필드가 일치해야 저장 검증 완료다.
컨테이너 재시작 후 동일 ID가 조회되면 영속성도 확인할 수 있다.

## 4. pytest

```powershell
.venv\Scripts\python.exe -m pytest -m "not integration" -q
docker compose exec log-api python tools/run_integration.py
```

두 번째 명령은 개발 DB 이름에 `_test`를 붙인 **별도 DB**를 생성하고 Alembic을 적용한다.
테스트마다 외부 트랜잭션과 savepoint를 사용하여 서비스의 commit 이후에도 삽입 데이터를 rollback한다.
DB 삭제·개발 테이블 truncate·개발 데이터 삭제는 하지 않는다. 테스트 DB와 스키마는 남는다.
DB 생성 권한이 필요하다. 현재 Compose DB 계정은 로컬 개발용 PostgreSQL 초기 관리자 계정이다.
운영 배포 시 migration 계정과 최소권한 API 계정을 분리한다.

기존 별도 테스트 DB를 직접 지정하려면:

```powershell
$env:TEST_DATABASE_URL = 'postgresql+psycopg://USER:PASSWORD@localhost:5432/sentinel_logs_test'
.venv\Scripts\python.exe -m pytest -m integration -q
Remove-Item Env:TEST_DATABASE_URL
```

비밀번호 특수문자는 URL 인코딩해야 한다. DB 이름은 `_test`로 끝나고 개발 DB와 달라야 한다.
연결 문자열은 기록·커밋하지 않는다. TEST_DATABASE_URL 미설정 시 통합 테스트는 skip이다.
통합 테스트는 실제 POST/GET, PostgreSQL 필드 일치, 시간대, 동일 세션 순서, 중복 409 및 이후 조회를 확인한다.

추가 실제 HTTP smoke test:

```powershell
.venv\Scripts\python.exe tools/smoke_test.py
```

이 명령은 실제 개발 로그 DB에 합성 로그 1개를 저장한다. 출력된 ID를 SQL로 확인한다.
이는 Postman 앱 실행 자체를 대체하는 검증 결과로 보고하면 안 된다.

## 5. 합성 시나리오

| 파일 | 행동 | 결과 |
|---|---|---|
| 01_read.json | 정상 조회 | success |
| 02_update.json | 정상 수정 | success |
| 03_denied.json | 권한 부족 | denied / ACCESS_DENIED |
| 04_not_found.json | 없는 자원 | failure / RESOURCE_NOT_FOUND |
| 05_tool_error.json | 도구 실행 오류 | failure / TOOL_TIMEOUT |
| 06_sequence.json | 같은 에이전트·세션의 연속 3개 행동 | 순번 0, 1, 2 |

06은 배열 자료이며 API는 단건만 받는다. 각 항목을 개별 POST하고 공통 session_id를 새 값으로 바꾼다.
01~05와 같은 기본 세션을 재사용하면 순번 충돌이 발생할 수 있다. 같은 자료 재전송의 409는 의도된 동작이다.
시나리오는 생산자가 보고한 행동 결과를 저장하는 것이며, 실제 업무 DB 호출이나 이상 판정을 수행하지 않는다.

## 6. 문제 점검

- `docker` 명령을 찾지 못함: Docker Desktop 설치 여부·PATH 확인 후 터미널 재시작.
- Docker 엔진 연결 실패: Docker Desktop 시작, Linux containers 및 WSL2 설정 확인.
- 8000 충돌: 기존 로컬 uvicorn 프로세스 확인; 임의로 다른 프로젝트 프로세스를 종료하지 않는다.
- 503: `docker compose ps`, `docker compose logs --tail 100 log-api log-db`, migration 적용 여부 확인.
- 비밀번호 변경 후 접속 실패: 기존 영속 volume 계정은 .env 변경만으로 갱신되지 않는다.
- 422: 시간대 포함 timestamp, 숫자 타입, sequence_no, 허용 metadata 및 오류 코드 조건 확인.
- 409: 생산자가 부여한 동일 agent/session/sequence_no 재사용 여부 확인.

로그나 장애 보고에 연결 문자열·비밀번호·요청 원문을 붙이지 않는다.
