import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'

import { EffectBadge, Mono, PageHeader, TableState } from '@/components/common'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { api, type Policy, type PolicyInput } from '@/lib/api'
import { keys, useAgents, usePolicies, useSave, useServers, useUsers } from '@/lib/queries'
import { formatKst } from '@/lib/utils'
import { PolicyFormDialog } from '@/pages/policies/PolicyFormDialog'

export function PoliciesPage() {
  const policies = usePolicies()
  const users = useUsers().data ?? []
  const agents = useAgents().data ?? []
  const servers = useServers().data ?? []

  const [editing, setEditing] = useState<Policy | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [deleting, setDeleting] = useState<Policy | null>(null)

  const create = useSave(keys.policies, (input: PolicyInput) => api.policies.create(input), '정책을 등록했습니다.')
  const update = useSave(
    keys.policies,
    ({ id, changes }: { id: string; changes: Partial<PolicyInput> }) => api.policies.update(id, changes),
    '정책을 저장했습니다.',
  )
  const remove = useSave(keys.policies, (id: string) => api.policies.remove(id), '정책을 삭제했습니다.')

  const subjectName = (p: Policy) =>
    (p.subject_type === 'USER' ? users : agents).find((s) => s.id === p.subject_id)?.name
  const serverOf = (p: Policy) => servers.find((s) => s.id === p.target_server_id)

  const openForm = (policy: Policy | null) => {
    setEditing(policy)
    setFormOpen(true)
  }

  const rows = policies.data ?? []

  return (
    <>
      <PageHeader
        title="접근 정책"
        description="사용자·에이전트가 어떤 대상 서버에 접근할 수 있는지 관리합니다."
        actions={
          <Button onClick={() => openForm(null)}>
            <Plus /> 새 정책
          </Button>
        }
      />

      <div className="space-y-4 p-8">
        <ul className="bg-card text-muted-foreground grid gap-1 rounded-lg border px-5 py-3 text-xs sm:grid-cols-3">
          <li>
            <strong className="text-foreground">차단 우선</strong> · 허용과 차단이 겹치면 차단
          </li>
          <li>
            <strong className="text-foreground">기본 차단</strong> · 맞는 정책이 없으면 차단
          </li>
          <li>
            <strong className="text-foreground">비활성 제외</strong> · 꺼진 정책·사용자·서버는 차단
          </li>
        </ul>

        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 pl-5">사용</TableHead>
                <TableHead>정책 이름</TableHead>
                <TableHead>결과</TableHead>
                <TableHead>주체</TableHead>
                <TableHead>대상 서버</TableHead>
                <TableHead>범위</TableHead>
                <TableHead className="text-right">우선순위</TableHead>
                <TableHead className="hidden xl:table-cell">수정</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={9}
                isLoading={policies.isLoading}
                error={policies.error}
                isEmpty={rows.length === 0}
                empty="등록된 정책이 없습니다. 정책이 없으면 모든 접근이 차단됩니다."
              />
              {rows.map((p) => {
                const server = serverOf(p)
                return (
                  <TableRow key={p.id} className={p.is_active ? undefined : 'opacity-55'}>
                    <TableCell className="pl-5">
                      <Switch
                        checked={p.is_active}
                        aria-label={`${p.name} 사용`}
                        disabled={update.isPending}
                        onCheckedChange={(checked) => update.mutate({ id: p.id, changes: { is_active: checked } })}
                      />
                    </TableCell>
                    <TableCell className="font-medium">
                      {p.name}
                      {p.description && <p className="text-muted-foreground text-xs font-normal">{p.description}</p>}
                    </TableCell>
                    <TableCell>
                      <EffectBadge effect={p.effect} />
                    </TableCell>
                    <TableCell>
                      <span className="text-muted-foreground mr-1.5 text-xs">
                        {p.subject_type === 'USER' ? '사용자' : '에이전트'}
                      </span>
                      {subjectName(p) ?? <Mono>{p.subject_id}</Mono>}
                    </TableCell>
                    <TableCell>{server?.name ?? <Mono>{p.target_server_id}</Mono>}</TableCell>
                    <TableCell>{p.scope_value ? <Mono>{p.scope_value}</Mono> : '서버 전체'}</TableCell>
                    <TableCell className="text-right tabular-nums">{p.priority}</TableCell>
                    <TableCell className="text-muted-foreground hidden text-xs tabular-nums xl:table-cell">{formatKst(p.updated_at)}</TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button variant="ghost" size="icon" aria-label="수정" onClick={() => openForm(p)}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" aria-label="삭제" onClick={() => setDeleting(p)}>
                        <Trash2 />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </div>

      <PolicyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        policy={editing}
        pending={create.isPending || update.isPending}
        onSubmit={(input) =>
          editing ? update.mutateAsync({ id: editing.id, changes: input }) : create.mutateAsync(input)
        }
      />

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>정책을 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              「{deleting?.name}」 정책을 삭제합니다. 되돌릴 수 없으며, 잠시 끄려면 삭제 대신 사용 스위치를 끄세요.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => deleting && remove.mutate(deleting.id)}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
