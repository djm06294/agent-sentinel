# Admin Frontend (관리자 콘솔)

관리자 백엔드(`admin-backend/`, :8001)를 쓰는 웹 화면입니다. 스펙: `docs/specs/12_관리자FE.md`

- 스택: TypeScript, React 19, Vite 6, Tailwind CSS 4, shadcn/ui, React Router 7, TanStack Query 5, React Hook Form + Zod
- 개발 서버는 `/api` 요청을 관리자 백엔드로 넘깁니다 (`vite.config.ts` 프록시). 다른 주소면 `ADMIN_API_URL`로 바꿉니다.

## 화면

| ID | 화면 | 상태 |
|---|---|---|
| F-06 | 접근 정책: 목록, 등록·수정, 사용 스위치, 삭제 | ✅ |
| F-03 | 사용자: 목록, 등록·수정, 활성/비활성 | ✅ |
| F-04 | 에이전트: 목록, 등록·수정, 활성/비활성 (토큰 발급은 준비 중) | ✅ |
| F-05 | 대상 서버: 목록, 등록·수정, 활성/비활성 | ✅ |
| F-02 | 대시보드 | 준비 중 화면 |
| F-07 | 행동 로그 | 준비 중 화면 |
| F-08 | 이상 알림 | 준비 중 화면 |
| F-01 | 로그인 | 백엔드 인증(T-03) 후 |

- 시각은 서버 UTC 값을 한국 시간으로 표시합니다.
- 사용자·에이전트·서버는 삭제 대신 비활성화합니다 (비활성이면 정책 확인에서 항상 차단).
- 정책 범위는 권한 단위가 미결(Q1)이라 "서버 전체" 또는 서버의 데이터베이스만 고를 수 있습니다.

## 실행

먼저 관리자 백엔드를 띄웁니다 (`admin-backend/README.md`).

```powershell
cd admin-frontend
npm ci
npm run dev        # http://localhost:5173
```

```powershell
npm test           # 폼 검증 단위 테스트 (Vitest)
npm run lint
npm run build      # 타입 검사 + 빌드 (dist/)
```

## 구조

```txt
src/
  lib/api.ts             API 타입·클라이언트, 오류 코드 → 화면 문구
  lib/queries.ts         TanStack Query 훅
  lib/schemas.ts         사용자·에이전트·서버 폼 검증 (백엔드 규칙과 맞춤)
  components/ResourcePage.tsx   목록 + 등록/수정 + 활성 스위치 공통 화면
  components/layout/     사이드바 레이아웃
  components/ui/         shadcn/ui 컴포넌트
  pages/policies/        접근 정책 화면과 폼
  pages/ResourcePages.tsx       사용자·에이전트·서버 화면
```
