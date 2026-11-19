# Gateway → 로그 API → PostgreSQL 자동 저장

## 실행

프로젝트 루트 PowerShell:

```powershell
docker compose up -d --build
npm.cmd --prefix mcp-gateway ci
npm.cmd --prefix mcp-gateway run build
.venv/Scripts/python.exe tools/verify_gateway_pipeline.py
```

처음 설치한 PC는 README대로 .env를 생성하고 로컬 비밀번호를 설정한다. 검증 스크립트는 표준 Python 라이브러리만 사용하므로 Python 3.11+가 있으면 `python tools/verify_gateway_pipeline.py`로 실행해도 된다.

스크립트는 실제 Gateway 프로세스에 MCP 도구 요청을 보내고 정상·실패 로그 2건을 실제 PostgreSQL에 남긴다. HTTP GET과 독립 psql SELECT로 전체 필드를 대조하며, 디스크 대기 이벤트를 재시작 후 재전송해 409와 행 수 유지도 확인한다. 기존 데이터는 지우지 않는다.

여기서 SQL 실행 대상은 DBHub 내장 SQLite 데모 DB이며, 행동 로그 저장 대상은 Docker PostgreSQL이다. 실제 업무 PostgreSQL이나 Claude Code UI 연결까지 검증한 것은 아니다.

## 실제 MCP 클라이언트에서 사용

mcp-gateway/README.md의 `node .../mcp-gateway/dist/index.js --transport stdio --demo` 등록 방식을 그대로 사용한다. API 서버가 실행되어 있으면 tools/call 응답 후 자동 저장된다. 이미 등록된 클라이언트는 새 빌드 적용을 위해 MCP 연결을 재시작한다. 실제 업무 DB를 쓰려면 해당 DBHub 설정을 별도로 제공한다. 로그 DB를 업무 DB로 취급하지 않는다.

Gateway 프로세스의 환경변수:

| 변수 | 기본값 / 의미 |
|---|---|
| GATEWAY_LOG_API_URL | http://127.0.0.1:8000/api/v1/logs (POST 전체 경로) |
| GATEWAY_LOG_ENABLED | true, false로 설정 시 원본 파일 기록만 유지 |
| GATEWAY_USER_ID | local-user, 비민감 사용자 식별 라벨 |
| GATEWAY_AGENT_ID | dbhub-agent, 비민감 에이전트 식별 라벨 |
| GATEWAY_OUTBOX_DIR | GATEWAY_LOG_DIR 아래 behavior-outbox |
| GATEWAY_LOG_DIR | 저장소 logs/ (원본 파일 및 기본 대기열 위치) |

Gateway는 Python용 .env를 자동 로드하지 않는다. 실행 터미널이나 MCP 클라이언트의 환경 설정으로 지정한다. user_id/agent_id는 인증된 신원이라는 뜻이 아니다. 식별자는 API 규칙의 ASCII 문자·길이를 충족해야 한다.

## 필드 매핑

- tools/call만 수집한다. initialize, tools/list, 알림은 행동 DB에 넣지 않는다.
- session_id: 기존 Gateway RawLogger 세션 UUID. 재연결 시 새 세션.
- request_id: 호출마다 생성하는 UUID. JSON-RPC 원문 ID는 저장하지 않으며 숫자/문자열 ID를 구분해 응답을 매칭한다.
- sequence_no: 요청을 받은 순서대로 0부터 증가. 응답 순서가 바뀌어도 유지한다.
- timestamp: 요청 수신 시각. duration_ms: 응답까지 경과 시간.
- tool_name: execute_sql 또는 search_objects. 미등록 도구는 unknown_tool로 기록.
- action=tool_call, resource=mcp:dbhub. SQL에서 테이블명·조회/수정 여부를 추측하지 않는다.
- 성공 응답은 success. JSON-RPC 오류, isError, DBHub success=false는 failure와 고정 오류 코드로 기록한다.
- 응답을 120초간 받지 못하면 MCP_RESPONSE_TIMEOUT, 종료 시 미응답 호출은 MCP_SESSION_ENDED로 기록한다. 이는 관측 실패이며 실제 DB 작업의 성공·실패를 확정하지 않는다. 뒤늦은 응답으로 해당 이벤트를 수정하지 않는다.
- metadata는 transport=stdio, resource_type=service만 포함한다. SQL, 인수, 결과 행, 오류 메시지 원문은 전송하지 않는다.
- 정책 확인(GATEWAY_POLICY_API_URL 지정 시)에서 차단된 호출은 DBHub로 보내지 않고 status=denied, error_code=차단 사유(NO_MATCHING_POLICY, POLICY_DENY, USER_INACTIVE, POLICY_UNAVAILABLE 등)로 기록한다. duration_ms는 정책 확인에 걸린 시간이다. 자세한 동작은 mcp-gateway/README.md의 "정책 확인".

## 전송·실패 처리

이벤트를 *.pending.json으로 디스크에 쓴 뒤 전송한다. API 전송은 비동기로 수행하여 네트워크 장애가 MCP 응답을 기다리게 하지 않는다. 파일 시스템 쓰기 실패는 stderr에 보고하며 완전한 무손실을 보장하지 않는다.

- HTTP 요청 제한 시간 2초, 미전송 파일을 5초 주기로 재시도. 1회 최대 100개.
- 201: 저장 ID를 receipts.jsonl에 기록 후 대기 파일 제거.
- duplicate_log 409: 동일 세션·순번이 이미 있으므로 중복으로 기록 후 대기 종료. 내용 동일성을 별도로 입증하는 응답은 아니다.
- 잘못된 입력·인증·경로 등의 400/401/403/404/405/413/422: *.rejected.json으로 보존해 수정·수동 재처리가 필요함을 표시.
- 연결 오류, 그 외 오류 응답: 파일을 보존해 재시도. 다음 Gateway 실행에서도 같은 대기열 경로의 파일을 다시 전송한다.
- 정상 종료 시 최대 약 5초간 전송하고 남은 파일은 유지한다. 응답 전 강제 종료된 호출은 메모리에만 있으므로 복구되지 않는다.
- 동시에 추적하는 미응답 호출은 최대 1000개이며 초과 시 stderr 경고 후 해당 호출 기록을 생략한다.

logs/ 및 전송 대기 파일은 Git 제외 대상이다. 기존 원본 로그 파일은 SQL·결과 원문을 포함할 수 있으므로 별도 관리가 필요하다. API 인증·TLS는 이번 구현 범위가 아니다.

## 검증

```powershell
npm.cmd --prefix mcp-gateway test
.venv/Scripts/python.exe tools/verify_gateway_pipeline.py
```

단위 검증은 순서가 뒤바뀐 응답, 자료형이 다른 동일 ID, 원문 제외, 실패/미응답 처리, API 장애, 디스크 복구·재시도·중복·거절 처리를 확인한다. 통합 검증은 실제 Gateway와 HTTP API 및 PostgreSQL을 사용한다.
