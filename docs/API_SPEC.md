# API 명세 v1

Base URL: `http://localhost:8000`. JSON 본문, Content-Type `application/json`.

| 메서드/경로 | 성공 | 기능 |
|---|---|---|
| POST /api/v1/logs | 201 | 검증 후 커밋된 로그 반환 |
| GET /api/v1/logs/{log_id} | 200 | UUID 단건 조회 |
| GET /health | 200 | 프로세스 생존 |
| GET /ready | 200 / 503 | DB 연결 및 behavior_logs 접근 확인 |

## 저장 예시

```json
{
  "timestamp": "2026-11-19T09:00:00+09:00",
  "user_id": "user-demo", "agent_id": "agent-demo", "session_id": "session-demo",
  "request_id": "00000000-0000-0000-0000-000000000001", "sequence_no": 0,
  "tool_name": "db.query", "action": "read", "resource": "table:orders",
  "status": "success", "duration_ms": 12,
  "metadata": {"result_count": 3, "transport": "http", "resource_type": "table"}
}
```

응답 예시(실제 log_id와 received_at은 서버가 생성):

```json
{
  "data": {
    "log_id": "bdf2b315-1b42-4992-8b93-1b84fbedcba6",
    "timestamp": "2026-11-19T00:00:00Z", "received_at": "2026-11-19T00:00:01Z",
    "user_id": "user-demo", "agent_id": "agent-demo", "session_id": "session-demo",
    "request_id": "00000000-0000-0000-0000-000000000001", "sequence_no": 0,
    "tool_name": "db.query", "action": "read", "resource": "table:orders",
    "status": "success", "duration_ms": 12, "error_code": null,
    "metadata": {"result_count": 3, "rows_affected": null, "retry_count": null,
                 "transport": "http", "resource_type": "table"}
  }
}
```

GET 응답 구조도 동일하다. 응답 metadata의 미지정 필드는 null로 표현되며 DB에서는 생략된다.
상태 응답은 `{"data":{"status":"ok"}}` / `{"data":{"status":"ready"}}`.

## 오류

공통 형식: `{"error":{"code":"validation_error","message":"Invalid request; see /docs for the schema"}}`.

| 상태 | code | 의미 |
|---|---|---|
| 404 | not_found | 존재하지 않는 UUID 또는 경로 |
| 409 | duplicate_log | 같은 agent/session/sequence_no 재전송 |
| 413 | payload_too_large | 본문 16KB 초과 |
| 422 | validation_error | 필수값/타입/시간대/enum/metadata/JSON 오류 |
| 500 | internal_error | 예상하지 못한 서버 오류 |
| 503 | database_unavailable / database_error | 접속 실패, 저장·조회 오류 |

입력 원문, SQL, 연결 문자열, DB 예외는 오류 응답에 포함하지 않는다.
`denied`/`failure` 로그를 정상 수신하면 201이다. 기록된 행동의 결과와 수집 API 결과는 별개다.
이 서비스는 접근 권한을 판정하지 않는다.

인증·배치·목록 조회·수정·삭제 API는 제공하지 않는다. 503 직후 실제 커밋 여부가 불명확할 수 있으므로
생산자는 같은 순번을 유지해서 재전송하고 409를 별도 처리해야 한다.
스키마의 실행 가능한 명세는 `/openapi.json`과 `/docs`를 사용한다.
