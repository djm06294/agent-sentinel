import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { z } from 'zod'

import { FieldError } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { Policy, PolicyInput } from '@/lib/api'
import { useAgents, useServers, useUsers } from '@/lib/queries'
import { cn } from '@/lib/utils'

// 백엔드 Identifier 규칙과 동일
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/
const ALL_DATABASES = '__all__'

export const policySchema = z.object({
  name: z.string().trim().min(1, '정책 이름을 입력하세요.').max(100, '100자 이내로 입력하세요.'),
  effect: z.enum(['ALLOW', 'DENY']),
  subject_type: z.enum(['USER', 'AGENT']),
  subject_id: z.string().min(1, '적용할 사용자 또는 에이전트를 선택하세요.'),
  target_server_id: z.string().min(1, '대상 서버를 선택하세요.'),
  scope_value: z.string(),
  priority: z
    .number({ invalid_type_error: '숫자를 입력하세요.' })
    .int('정수를 입력하세요.')
    .min(0, '0 이상이어야 합니다.')
    .max(10000, '10000 이하여야 합니다.'),
  is_active: z.boolean(),
  description: z.string().trim().max(500, '500자 이내로 입력하세요.'),
}).refine((v) => v.scope_value === ALL_DATABASES || IDENTIFIER.test(v.scope_value), {
  path: ['scope_value'],
  message: '데이터베이스 이름 형식이 올바르지 않습니다.',
})

export type PolicyForm = z.infer<typeof policySchema>

export function toPolicyInput(form: PolicyForm): PolicyInput {
  return {
    ...form,
    name: form.name.trim(),
    scope_value: form.scope_value === ALL_DATABASES ? null : form.scope_value,
    description: form.description.trim() || null,
  }
}

const emptyForm: PolicyForm = {
  name: '',
  effect: 'ALLOW',
  subject_type: 'USER',
  subject_id: '',
  target_server_id: '',
  scope_value: ALL_DATABASES,
  priority: 100,
  is_active: true,
  description: '',
}

function fromPolicy(policy: Policy): PolicyForm {
  return {
    name: policy.name,
    effect: policy.effect,
    subject_type: policy.subject_type,
    subject_id: policy.subject_id,
    target_server_id: policy.target_server_id,
    scope_value: policy.scope_value ?? ALL_DATABASES,
    priority: policy.priority,
    is_active: policy.is_active,
    description: policy.description ?? '',
  }
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  policy: Policy | null // null이면 새 정책
  onSubmit: (input: PolicyInput) => Promise<unknown>
  pending: boolean
}

export function PolicyFormDialog({ open, onOpenChange, policy, onSubmit, pending }: Props) {
  const users = useUsers().data ?? []
  const agents = useAgents().data ?? []
  const servers = useServers().data ?? []

  const form = useForm<PolicyForm>({ resolver: zodResolver(policySchema), defaultValues: emptyForm })
  const { register, control, handleSubmit, watch, setValue, reset, formState } = form
  const errors = formState.errors

  useEffect(() => {
    if (open) reset(policy ? fromPolicy(policy) : emptyForm)
  }, [open, policy, reset])

  const subjectType = watch('subject_type')
  const serverId = watch('target_server_id')
  const effect = watch('effect')
  const subjects =
    subjectType === 'USER'
      ? users.map((u) => ({ id: u.id, label: u.name, active: u.is_active }))
      : agents.map((a) => ({ id: a.id, label: a.name, active: a.is_active }))
  const server = servers.find((s) => s.id === serverId)
  // 서버 기본 DB + (수정 시) 기존 정책에 저장된 DB를 선택지로 보여준다
  const databases = [...new Set([server?.database, policy?.scope_value].filter((v): v is string => !!v))]

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(toPolicyInput(values))
      onOpenChange(false)
    } catch {
      // 오류 알림은 mutation에서 띄우고, 입력 내용을 지키기 위해 창은 닫지 않는다
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{policy ? '접근 정책 수정' : '새 접근 정책'}</DialogTitle>
          <DialogDescription>누가(주체) 어떤 대상 서버에 접근할 수 있는지 정합니다.</DialogDescription>
        </DialogHeader>

        <form id="policy-form" onSubmit={submit} className="grid gap-5" noValidate>
          <div className="grid gap-1.5">
            <Label htmlFor="name">정책 이름</Label>
            <Input id="name" placeholder="예: 주영 업무 DB 허용" {...register('name')} />
            <FieldError message={errors.name?.message} />
          </div>

          <div className="grid gap-1.5">
            <Label>결과</Label>
            <Controller
              control={control}
              name="effect"
              render={({ field }) => (
                <div className="grid grid-cols-2 gap-2" role="radiogroup">
                  {(['ALLOW', 'DENY'] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={field.value === value}
                      onClick={() => field.onChange(value)}
                      className={cn(
                        'rounded-md border px-3 py-2 text-sm font-medium transition-colors',
                        field.value === value
                          ? value === 'ALLOW'
                            ? 'border-allow bg-allow/10 text-allow'
                            : 'border-deny bg-deny/10 text-deny'
                          : 'text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {value === 'ALLOW' ? '허용 (ALLOW)' : '차단 (DENY)'}
                    </button>
                  ))}
                </div>
              )}
            />
            {effect === 'DENY' && (
              <p className="text-muted-foreground text-xs">차단 정책은 같은 대상에 대한 허용 정책보다 항상 우선합니다.</p>
            )}
          </div>

          <div className="grid grid-cols-[9rem_1fr] gap-3">
            <div className="grid gap-1.5">
              <Label>주체 유형</Label>
              <Controller
                control={control}
                name="subject_type"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v)
                      setValue('subject_id', '')
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="USER">사용자</SelectItem>
                      <SelectItem value="AGENT">에이전트</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{subjectType === 'USER' ? '사용자' : '에이전트'}</Label>
              <Controller
                control={control}
                name="subject_id"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger className="w-full" aria-invalid={!!errors.subject_id}>
                      <SelectValue placeholder={subjects.length ? '선택하세요' : '먼저 등록해 주세요'} />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label} <span className="text-muted-foreground font-mono text-xs">{s.id}</span>
                          {!s.active && <span className="text-muted-foreground text-xs">(비활성)</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError message={errors.subject_id?.message} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label>대상 서버</Label>
              <Controller
                control={control}
                name="target_server_id"
                render={({ field }) => (
                  <Select
                    value={field.value}
                    onValueChange={(v) => {
                      field.onChange(v)
                      setValue('scope_value', ALL_DATABASES)
                    }}
                  >
                    <SelectTrigger className="w-full" aria-invalid={!!errors.target_server_id}>
                      <SelectValue placeholder={servers.length ? '선택하세요' : '먼저 등록해 주세요'} />
                    </SelectTrigger>
                    <SelectContent>
                      {servers.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name} <span className="text-muted-foreground font-mono text-xs">{s.host}:{s.port}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError message={errors.target_server_id?.message} />
            </div>
            <div className="grid gap-1.5">
              <Label>적용 범위 (데이터베이스)</Label>
              <Controller
                control={control}
                name="scope_value"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange} disabled={!server}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL_DATABASES}>서버 전체</SelectItem>
                      {databases.map((db) => (
                        <SelectItem key={db} value={db}>
                          <span className="font-mono">{db}</span>
                        </SelectItem>
                      ))}
                      {/* TODO(Q1 권한 단위): 확정되면 SCHEMA/TABLE 단위 선택 추가 */}
                      <SelectItem value="__schema__" disabled>
                        스키마·테이블 단위 (준비 중)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                )}
              />
              <FieldError message={errors.scope_value?.message} />
            </div>
          </div>

          <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="priority">우선순위</Label>
              <Input id="priority" type="number" min={0} max={10000} {...register('priority', { valueAsNumber: true })} />
              <FieldError message={errors.priority?.message} />
            </div>
            <p className="text-muted-foreground pt-7 text-xs leading-relaxed">
              숫자가 작을수록 먼저 표시됩니다. 허용·차단 결과는 바꾸지 않고, 여러 정책이 겹칠 때 어느 정책이 적용됐는지 고를 때만 씁니다.
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="description">설명 (선택)</Label>
            <Textarea id="description" rows={2} {...register('description')} />
            <FieldError message={errors.description?.message} />
          </div>

          <Controller
            control={control}
            name="is_active"
            render={({ field }) => (
              <label className="flex items-center gap-3 text-sm">
                <Switch checked={field.value} onCheckedChange={field.onChange} />
                정책 사용
              </label>
            )}
          />
        </form>

        <DialogFooter>
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            취소
          </Button>
          <Button type="submit" form="policy-form" disabled={pending}>
            {pending ? '저장 중…' : policy ? '저장' : '등록'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
