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
