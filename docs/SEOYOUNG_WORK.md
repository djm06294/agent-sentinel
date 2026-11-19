# 서영 배정 업무 및 완료 현황

회의 PDF와 녹음에서 정한 목표: 로그 시나리오·필드 설계, PostgreSQL DB·스키마 구성, 로그 수신 API·명세서 작성, HTTP 요청으로 실제 DB에 로그 저장 확인.

## 팀원 코드 위에서 이어지는 작업

- 기준: origin/main의 f767828 (DBHub MCP Gateway 및 원본 로그 수집).
- 작업 브랜치: feat/log-service-on-gateway.
- 그 위에 서영의 로그 수신 서비스 코드를 추가했다. 이후 추가 요청에 따라 mcp-gateway에 API 자동 전송 기능을 구현했다.
- main에는 아직 서영의 로그 서버가 병합되지 않았다. 이 브랜치를 최종 검토·검증 후 PR로 올린다.

## 배정 업무 체크리스트

- [x] 행동 시나리오와 예제 JSON: examples/의 6종 예제.
- [x] 로그 종류·필드·형식: app/schemas/log.py 및 docs/DB_SCHEMA.md.
- [x] PostgreSQL DB·테이블·제약·인덱스: compose.yaml, app/db/models.py, migrations/.
- [x] 로그 수신 웹 API 및 서버: app/main.py, app/api/routes/logs.py.
- [x] API 명세서: docs/API_SPEC.md.
- [x] HTTP 로그 전송 → 실제 DB 저장: HTTP 및 Newman 실행, SQL SELECT 대조.
- [x] 독립 로그 수신·저장 서비스 실행: log-api/log-db 정상 상태 및 재시작 후 데이터 유지 확인.

## 실제 검증 근거

- 로그 서버 단위 테스트 28개, 별도 PostgreSQL 통합 테스트 1개 통과.
- Postman Collection은 Newman으로 요청 9개·검증 10개 통과. Postman GUI 실행은 미수행.
- 팀원 Gateway는 npm ci/build 후 내장 데모 DB에서 MCP 초기 연결, 도구 목록, SELECT 1 호출, 원본 요청·응답 로그 생성, 정상 종료 확인.
- 상세 실행 결과와 의존성 경고는 VERIFICATION.md를 따른다. Gateway → HTTP API → PostgreSQL 자동 저장은 추가 통합 검증을 완료했다. Claude Code UI 및 실제 업무 DB 검증은 별도다.

## 후속 연동 작업 (이번 배정 업무에 포함되지 않음)

- [x] Gateway 요청·응답에서 저장용 로그를 생성하고 HTTP API로 전송.
- [ ] 팀원과 최종 생산자 계약 검토(구현 매핑은 GATEWAY_PIPELINE.md): user_id/agent_id/session_id/request_id/sequence_no 및 실행 결과 매핑.
- [x] 원본 SQL·조회 결과를 제외하고 허용 metadata만 전송하는 변환 처리.
- [x] 재전송·중복·서버 장애 처리 및 실제 흐름 통합 테스트.
- [ ] 정책 판정, 이상탐지, 관리자 UI 연계는 별도 범위로 설계.

Gateway의 JSON-RPC 원본 로그를 저장 API 스키마로 변환하는 코드와 전송 대기열을 추가했다. 상세 실행·매핑은 GATEWAY_PIPELINE.md를 따른다.

## 팀원과 실행·공유

각 구성요소는 루트 README와 mcp-gateway/README.md에 따라 별도로 실행한다. .env, logs/, node_modules/, dist/, 가상환경, DB 데이터는 Git에 올리지 않는다. 루트 Docker 이미지는 로그 수신 서비스용이므로 Gateway와 원본 로그를 빌드 대상에서 제외한다.
