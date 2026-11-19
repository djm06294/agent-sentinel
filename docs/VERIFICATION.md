# 실행 검증 결과

검증일: 2026-11-19 (Asia/Seoul). 대상: agent-sentinel 로그 수신 서비스.
이번 실행은 이전 Docker 미설치 상태의 기록을 대체한다. 아래 결과는 실제 실행 결과다.

## 단계별 결과

| 항목 | 실제 결과 |
|---|---|
| Docker 설치 확인 | 사용자 경로 DockerDesktop 확인; Desktop 4.97.0, Engine/CLI 29.9.2, Compose v5.6.1 |
| 최초 엔진 연결 | 실패: dockerDesktopLinuxEngine named pipe 없음. Docker Desktop 시작 후 해결 |
| .env | 기존 파일 없음 확인 후 CreateNew 방식 생성. 무작위 비밀번호 사용, 출력하지 않음. git check-ignore로 제외 확인 |
| docker compose up -d --build | 성공; log-api 및 log-db 모두 healthy |
| Alembic | 컨테이너 시작 시 적용, upgrade head 재실행 성공; current = 0001 (head) |
| GET /health, /ready, /docs, /openapi.json | 모두 HTTP 200 |
| 실제 HTTP smoke test | POST 201, GET 200 및 응답 전체 일치, 동일 요청 재전송 409 |
| 독립 PostgreSQL SELECT | 아래 UUID의 모든 API 필드 일치; 시각은 DateTimeOffset으로 정규화, metadata 항목별 대조 |
| 컨테이너 pytest -q | 28 passed, 1 skipped; TEST_DATABASE_URL 미설정으로 통합 항목만 skip |
| python tools/run_integration.py | 별도 sentinel_logs_test DB에서 1 passed, 28 deselected; 실제 저장/조회, 순번, 중복 409, 없는 ID 404 확인 |
| pip check (컨테이너) | No broken requirements found |
| Postman Collection (Newman 6.2.1) | 9 requests, 10 assertions, 실패 0; 5개 저장 201, 조회 일치, 잘못된 입력 422 |
| 컨테이너 재시작 후 조회 | 동일 UUID 조회 성공; 두 서비스 다시 healthy |
| 최종 SQL count | 개발 DB 합성 로그 6건; 테스트 DB 0건으로 rollback 확인 |

## 저장 증거

- log_id: 8792caa2-1571-432e-9598-ee2d8f28d06b
- session_id: smoke-68ea4df5caac4f3099bf2c0a6ede4886
- request_id: 1a61d0cc-8e62-4d23-9568-7f4e97557cda
- received_at: 2026-11-19T13:02:58.769926Z
- timestamp: 2026-11-19T00:00:00Z (입력 +09:00과 같은 시점)
- agent-demo / user-demo / sequence_no 0 / status success
- 개발 DB 6건은 smoke test 1건과 Collection 5건이다. 삭제하지 않았다.

## 실행 명령

프로젝트 루트에서 실행한 주요 명령:

```powershell
docker version
docker compose version
docker compose up -d --build
docker compose exec -T log-api alembic upgrade head
docker compose exec -T log-api alembic current
.venv/Scripts/python.exe tools/smoke_test.py
docker compose exec -T log-api python -m pytest -q
docker compose exec -T log-api python tools/run_integration.py
docker compose exec -T log-api python -m pip check
npx.cmd --yes newman@6.2.1 run postman/Agent-Sentinel.postman_collection.json --reporters cli
docker compose restart log-db log-api
docker compose ps
```

SELECT는 log-db 컨테이너의 psql로 실행하여 API 응답과 별도로 대조했다.
서비스는 실행 상태로 유지했다. Swagger: http://localhost:8000/docs

## 경고와 검증 범위

- 테스트 실패는 없다. 일반 pytest에서 skip된 통합 테스트는 전용 실행에서 통과했다.
- 컨테이너 Python 3.13.5에서 테스트했다. 이번 작업에서 Windows 단위 테스트는 재실행하지 않았다.
- pytest 캐시 디렉터리 권한 경고, Starlette/AnyIO 사용 중단 예고, Alembic path_separator 설정 경고가 발생했다. 테스트 통과와 구분하며 코드 수정은 하지 않았다.
- Newman 실행 중 일부 전이 의존성 및 Node API 사용 중단 경고가 발생했다. Collection 실행은 성공했다.
- Postman 데스크톱 앱의 GUI Runner는 실행하지 않았다. Collection 원본과 사전/검증 스크립트를 Newman으로 실제 실행했다.
- 재시작 후 데이터 유지는 확인했다. 컨테이너 삭제·재생성, 호스트 재부팅, 백업 복구, 부하 및 운영 보안 검증은 수행하지 않았다.
- 해당 검증 작업에서는 기존 .env 덮어쓰기, DB 볼륨 삭제, Git commit/push를 수행하지 않았다. 테스트 DB와 개발 합성 로그는 보존했다.

## 팀원 Gateway 반영 후 독립 실행 검증 (2026-11-19)

- 작업 브랜치: feat/log-service-on-gateway. 팀원 main f767828 기반에 로그 서버 추가.
- Node.js v24.20.0에서 mcp-gateway의 npm ci 및 npm run build 성공.
- 로컬 검증 클라이언트로 Gateway를 --transport stdio --demo 모드에서 실행.
- MCP initialize 성공: DBHub MCP Server 1.5.0.
- tools/list에서 execute_sql, search_objects 확인.
- tools/call로 SELECT 1 AS verification_value 실행, 결과 1 확인.
- 원본 요청·응답 JSONL 기록 및 세션 종료 시각, 종료 코드 0 확인. logs/verification/에 생성한 검증 로그는 Git 제외.
- 검증용 Gateway는 종료했다. Claude Code 등록은 수행하지 않았다.
- 기존 Docker 로그 서버: 단위 테스트 28 passed, PostgreSQL 통합 테스트 1 passed. API와 DB 모두 healthy.
- Gateway와 로그 수신 API 사이 자동 전송 연동 및 실제 업무 PostgreSQL 연결은 이번에 검증하지 않았다. Gateway는 내장 데모 DB를 사용했다.
- npm audit에서 전이 의존성 hono, @hono/node-server에 moderate 등급 패키지 2개 보고. 자동 업데이트는 수행하지 않았으며 해결 완료로 간주하지 않는다.
- npm 설치에서 cpu-features, oracledb, ssh2 설치 스크립트 승인 관련 경고 발생. 데모 검증은 통과했으나 Oracle/SSH 등의 선택 기능은 검증하지 않았다.
- 기존 Python 테스트의 사용 중단 예고 및 통합 테스트 캐시 권한 경고는 남아 있다.
- 이번 검증에서는 Git 커밋·푸시를 수행하지 않았다.

## Gateway → HTTP API → PostgreSQL 자동 저장 추가 검증

앞선 독립 실행 단계 이후 자동 전송 기능을 구현했다. 아래 결과가 최신 연동 상태다.

- npm --prefix mcp-gateway test: 3개 통과. 응답 순서/ID 매칭, 민감 원문 제외, 오류·미응답, API 장애·디스크 재시도·409·422 처리 확인.
- tools/verify_gateway_pipeline.py: 실제 Gateway tools/call → POST API → PostgreSQL → GET/SQL 전체 필드 대조 성공.
- 정상 SQL 실행 success 및 존재하지 않는 테이블 조회 failure 각각 저장.
- 마지막 검증 session_id: 30539a8c-b901-4ae7-b2a0-ccc58c573144.
- success log_id: 9ea21c5f-a99b-4c55-a3c6-f632460f5e00.
- failure log_id: a69baf03-09b9-42f2-91e8-0b0d01af67da.
- 정상 SQL의 고유 테스트 문자열이 저장 DB 데이터에 포함되지 않음 확인.
- 저장된 이벤트의 디스크 재전송을 새 Gateway 프로세스로 실행: 409 및 동일 세션 행 수 2 유지 확인.
- 두 차례 실제 실행에서 합성 로그 총 4건 추가, 삭제하지 않음.
- 업무 SQL 대상은 DBHub SQLite 데모 DB, 로그 저장은 실제 Docker PostgreSQL. Claude Code UI 등록 및 실제 업무 PostgreSQL 연결은 미검증.
- Gateway 테스트 프로세스는 종료. 로그 API/DB는 유지. 기존 의존성 경고는 앞 절과 같으며 해결됐다고 주장하지 않음.
