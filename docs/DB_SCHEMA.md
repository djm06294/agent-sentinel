# PostgreSQL 스키마

DB 기본 이름 `sentinel_logs`, 테이블 `public.behavior_logs`. 업무 DB와 분리된 로그 전용 DB다.

| 필드 | PostgreSQL 타입 | 입력 필수 / 기본 | 제약·설계 이유 |
|---|---|---|---|
| log_id | UUID PK | 서버 생성 | UUID4; 클라이언트 지정 불가 |
| timestamp | TIMESTAMPTZ | 필수 | 시간대 포함 ISO 8601, API에서 UTC 정규화; 발생 시각 |
| received_at | TIMESTAMPTZ | DB now() | 저장 트랜잭션 시각; 네트워크 수신 시작 시각과는 차이 있음 |
| user_id | VARCHAR(128) | 필수 | 사용자 비식별 ID |
| agent_id | VARCHAR(128) | 필수 | 에이전트 비식별 ID |
| session_id | VARCHAR(128) | 필수 | 작업 세션 연결 |
| request_id | UUID | 필수 | 한 요청의 여러 도구 동작 연결; 중복 허용 |
| sequence_no | BIGINT | 필수 | 0..2^63-1; 생산자가 세션 내 발생 순서를 부여 |
| tool_name | VARCHAR(128) | 필수 | 도구 이름, 예: db.query |
| action | VARCHAR(128) | 필수 | read/update 등 동작 분류 |
| resource | VARCHAR(128) | 필수 | table:orders 등 논리 자원 ID; 원문 데이터 금지 |
| status | VARCHAR(16) | 필수 | success / failure / denied |
| duration_ms | INTEGER | 필수 | 0..2^31-1; 정수, boolean과 문자열 금지 |
| error_code | VARCHAR(128) | 선택/null | success는 null; failure/denied는 필수 |
| metadata | JSONB | 선택/{} | 객체만, DB UTF-8 직렬화 1024바이트 이하 |

문자열 식별자는 API에서 길이 1..128 및 `^[A-Za-z0-9][A-Za-z0-9_.:/-]*$`로 제한한다.
이 규칙은 원문 텍스트와 URL 자격정보 유입을 줄이지만 문자열 의미상 비밀 여부를 증명하지 않는다.
DB는 길이·NOT NULL·PK·고유 순번·결과·시간 비용·metadata 크기를 제약한다.
식별자 패턴과 metadata의 허용 키·타입은 API가 검증하므로 외부 시스템은 DB에 직접 쓰지 않는다.

## metadata 계약

중첩·배열·임의 문자열·알 수 없는 키는 거절한다. 모두 선택 필드이며 null은 저장 시 생략한다.

| 키 | 타입/범위 |
|---|---|
| rows_affected, result_count | 정수 0..2^31-1 |
| retry_count | 정수 0..100 |
| transport | stdio / http / sse |
| resource_type | table / record / file / service |

전체 HTTP 본문은 실제 수신 바이트 기준 16384바이트 이하이다.
확장 시 Metadata 모델과 API 문서·생산자 계약을 함께 변경한다. JSONB 추가 키 자체는 DDL 변경이 필요 없다.

## 인덱스와 순서

- PK(log_id): 단건 조회.
- UNIQUE(agent_id, session_id, sequence_no): 같은 생산자 세션 내 중복 방지 및 순번 조회.
- (agent_id, timestamp): 특정 에이전트 기간 조회.
- (session_id, timestamp): 세션 시간 범위 조회.
- (timestamp, log_id): 전역 기간·시간순 조회, 동시 시각의 안정적 정렬.
- (request_id): 요청 추적.

실제 생산자 순서는 `WHERE agent_id=... AND session_id=... ORDER BY sequence_no`로 재구성한다.
서로 다른 생산자의 전역 인과 순서는 시계 오차 때문에 보장하지 않는다.
수신 지연과 순번 누락은 허용한다. 누락 복구·시계 동기화는 생산자 책임이다.

## 마이그레이션

`alembic upgrade head`로 0001 스키마 생성. 기존 revision을 수정하지 않고 새 revision을 추가한다.
`alembic revision --autogenerate -m "description"` 후 DDL을 검토한다.
운영 환경의 동시 여러 API 시작은 별도 단일 migration 작업으로 분리해야 한다.
초기 마이그레이션 downgrade는 테이블을 삭제하므로 데이터 보존 환경에서 실행하지 않는다.
