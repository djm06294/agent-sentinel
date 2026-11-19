import {
  BellRing,
  Bot,
  LayoutDashboard,
  ScrollText,
  Server,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { NavLink, Outlet } from 'react-router'

import { cn } from '@/lib/utils'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  ready?: boolean
}

const groups: { title: string; items: NavItem[] }[] = [
  {
    title: '모니터링',
    items: [
      { to: '/dashboard', label: '대시보드', icon: LayoutDashboard },
      { to: '/logs', label: '행동 로그', icon: ScrollText },
      { to: '/alerts', label: '이상 알림', icon: BellRing },
    ],
  },
  {
    title: '접근 통제',
    items: [
      { to: '/policies', label: '접근 정책', icon: ShieldCheck, ready: true },
      { to: '/users', label: '사용자', icon: Users, ready: true },
      { to: '/agents', label: '에이전트', icon: Bot, ready: true },
      { to: '/servers', label: '대상 서버', icon: Server, ready: true },
    ],
  },
]

export function AppLayout() {
  return (
    <div className="flex min-h-svh">
      <aside className="bg-sidebar text-sidebar-foreground flex w-60 shrink-0 flex-col">
        <div className="border-sidebar-border flex h-14 items-center gap-2 border-b px-5">
          <ShieldCheck className="size-5 text-white" />
          <span className="font-semibold tracking-tight text-white">Agent Sentinel</span>
        </div>
        <nav className="flex-1 space-y-6 px-3 py-5">
          {groups.map((group) => (
            <div key={group.title}>
              <p className="mb-2 px-2 text-xs font-medium tracking-wide text-white/40">{group.title}</p>
              <ul className="space-y-0.5">
                {group.items.map(({ to, label, icon: Icon, ready }) => (
                  <li key={to}>
                    <NavLink
                      to={to}
                      className={({ isActive }) =>
                        cn(
                          'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors',
                          'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                          isActive && 'bg-sidebar-accent text-sidebar-accent-foreground font-medium',
                        )
                      }
                    >
                      <Icon className="size-4" />
                      <span className="flex-1">{label}</span>
                      {!ready && <span className="text-[10px] text-white/35">준비 중</span>}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <p className="border-sidebar-border border-t px-5 py-3 text-xs text-white/35">관리자 콘솔 v0.1</p>
      </aside>
      <main className="min-w-0 flex-1">
        <Outlet />
      </main>
    </div>
  )
}
