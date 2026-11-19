import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { TableCell, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: ReactNode }) {
  return (
    <header className="bg-card flex items-end justify-between gap-4 border-b px-8 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{description}</p>
      </div>
      {actions}
    </header>
  )
}

export function EffectBadge({ effect }: { effect: 'ALLOW' | 'DENY' }) {
  return (
    <Badge
      className={cn(
        'font-mono text-[11px]',
        effect === 'ALLOW' ? 'bg-allow/10 text-allow border-allow/30' : 'bg-deny/10 text-deny border-deny/30',
      )}
      variant="outline"
    >
      {effect === 'ALLOW' ? '허용' : '차단'}
    </Badge>
  )
}

export function ActiveBadge({ active }: { active: boolean }) {
  return (
    <Badge variant={active ? 'secondary' : 'outline'} className={cn(!active && 'text-muted-foreground')}>
      {active ? '활성' : '비활성'}
    </Badge>
  )
}

/** 목록 테이블의 로딩·오류·빈 상태 한 줄 */
export function TableState({
  colSpan,
  isLoading,
  error,
  isEmpty,
  empty,
}: {
  colSpan: number
  isLoading: boolean
  error: unknown
  isEmpty: boolean
  empty: string
}) {
  const message = isLoading ? '불러오는 중…' : error ? errorMessage(error) : isEmpty ? empty : null
  if (!message) return null
  return (
    <TableRow>
      <TableCell colSpan={colSpan} className={cn('text-muted-foreground h-24 text-center', !!error && 'text-deny')}>
        {message}
      </TableCell>
    </TableRow>
  )
}

export function FieldError({ message }: { message?: string }) {
  return message ? <p className="text-deny text-xs">{message}</p> : null
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-[13px]">{children}</span>
}
