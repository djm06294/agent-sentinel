import { Navigate, Route, Routes } from 'react-router'

import { AppLayout } from '@/components/layout/AppLayout'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { PoliciesPage } from '@/pages/policies/PoliciesPage'
import { AgentsPage, ServersPage, UsersPage } from '@/pages/ResourcePages'

export default function App() {
  return (
    <Routes>
      {/* TODO(F-01): 관리자 로그인(B-01)이 생기면 로그인 화면과 인증 가드 추가 */}
      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/policies" replace />} />
        <Route path="policies" element={<PoliciesPage />} />
        <Route path="users" element={<UsersPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="servers" element={<ServersPage />} />
        <Route
          path="dashboard"
          element={
            <PlaceholderPage
              title="대시보드"
              description="오늘의 호출 수, 허용·차단 비율, 신규 알림을 한눈에 봅니다."
              plan="통계 API(B-08)가 준비되면 일별 추이 차트와 함께 표시됩니다."
            />
          }
        />
        <Route
          path="logs"
          element={
            <PlaceholderPage
              title="행동 로그"
              description="에이전트가 MCP로 실행한 도구 호출 기록입니다."
              plan="로그 조회 API(B-07)가 준비되면 기간·사용자·결과로 필터링해 볼 수 있습니다."
            />
          }
        />
        <Route
          path="alerts"
          element={
            <PlaceholderPage
              title="이상 알림"
              description="이상탐지 서비스가 찾아낸 의심 행동입니다."
              plan="탐지 결과 형식이 확정되면(서영님 서비스) 목록과 판단 근거를 보여줍니다."
            />
          }
        />
        <Route path="*" element={<Navigate to="/policies" replace />} />
      </Route>
    </Routes>
  )
}
