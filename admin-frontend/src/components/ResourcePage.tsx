/**
 * 사용자·에이전트·대상 서버처럼 "목록 + 등록/수정 폼 + 활성 스위치" 구조가 같은 관리 화면의 공통 틀.
 * 삭제 대신 비활성화한다 (백엔드에 DELETE 없음).
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useQueryClient, type UseQueryResult } from '@tanstack/react-query'
import { Pencil, Plus } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Controller, useForm, type FieldValues } from 'react-hook-form'
import { toast } from 'sonner'
import type { z } from 'zod'

import { FieldError, PageHeader, TableState } from '@/components/common'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { errorMessage } from '@/lib/api'

export interface FormField {
  name: string
  label: string
  type?: 'text' | 'number' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
  /** 등록할 때만 입력 (ID처럼 바꿀 수 없는 값) */
  createOnly?: boolean
  hint?: string
}

export interface Column<T> {
  header: string
  cell: (row: T) => ReactNode
  className?: string
}

interface Props<T extends { id: string; is_active: boolean }, F extends FieldValues> {
  title: string
  description: string
  noun: string
  query: UseQueryResult<T[]>
  queryKey: readonly string[]
  columns: Column<T>[]
  /** 폼 검증. 출력(변환 후 값)이 그대로 API 요청 본문이 된다 */
  schema: z.ZodTypeAny
  defaults: F
  toForm: (row: T) => F
  fields: FormField[]
  create: (values: Record<string, unknown>) => Promise<unknown>
  update: (id: string, changes: Record<string, unknown>) => Promise<unknown>
}

export function ResourcePage<T extends { id: string; is_active: boolean }, F extends FieldValues>(p: Props<T, F>) {
  const client = useQueryClient()
  const [editing, setEditing] = useState<T | null>(null)
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const form = useForm<F>({ resolver: zodResolver(p.schema), defaultValues: p.defaults as never })
  const { register, control, handleSubmit, reset, formState } = form
  const errors = formState.errors as Record<string, { message?: string } | undefined>

  useEffect(() => {
    if (open) reset((editing ? p.toForm(editing) : p.defaults) as never)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  const run = async (action: () => Promise<unknown>, success: string) => {
    setPending(true)
    try {
      await action()
      toast.success(success)
      await client.invalidateQueries({ queryKey: p.queryKey })
      return true
    } catch (error) {
      toast.error(errorMessage(error))
      return false
    } finally {
      setPending(false)
    }
  }

  const submit = handleSubmit(async (values) => {
    const ok = editing
      ? await run(() => {
          const changes: Record<string, unknown> = { ...values }
          for (const f of p.fields) if (f.createOnly) delete changes[f.name]
          return p.update(editing.id, changes)
        }, `${p.noun}을(를) 저장했습니다.`)
      : await run(() => p.create(values), `${p.noun}을(를) 등록했습니다.`)
    if (ok) setOpen(false)
  })

  const rows = p.query.data ?? []
  const colSpan = p.columns.length + 2

  return (
    <>
      <PageHeader
        title={p.title}
        description={p.description}
        actions={
          <Button
            onClick={() => {
              setEditing(null)
              setOpen(true)
            }}
          >
            <Plus /> {p.noun} 등록
          </Button>
        }
      />
      <div className="p-8">
        <div className="bg-card rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-16 pl-5">사용</TableHead>
                {p.columns.map((c) => (
                  <TableHead key={c.header} className={c.className}>
                    {c.header}
                  </TableHead>
                ))}
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              <TableState
                colSpan={colSpan}
                isLoading={p.query.isLoading}
                error={p.query.error}
                isEmpty={rows.length === 0}
                empty={`등록된 ${p.noun}이(가) 없습니다.`}
              />
              {rows.map((row) => (
                <TableRow key={row.id} className={row.is_active ? undefined : 'opacity-55'}>
                  <TableCell className="pl-5">
                    <Switch
                      checked={row.is_active}
                      aria-label={`${row.id} 사용`}
                      disabled={pending}
                      onCheckedChange={(checked) =>
                        run(
                          () => p.update(row.id, { is_active: checked }),
                          checked ? `${row.id}을(를) 활성화했습니다.` : `${row.id}을(를) 비활성화했습니다.`,
                        )
                      }
                    />
                  </TableCell>
                  {p.columns.map((c) => (
                    <TableCell key={c.header} className={c.className}>
                      {c.cell(row)}
                    </TableCell>
                  ))}
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="수정"
                      onClick={() => {
                        setEditing(row)
                        setOpen(true)
                      }}
                    >
                      <Pencil />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {p.noun} {editing ? '수정' : '등록'}
            </DialogTitle>
            <DialogDescription>
              {editing ? <span className="font-mono">{editing.id}</span> : '비활성화된 항목은 정책 확인에서 항상 차단됩니다.'}
            </DialogDescription>
          </DialogHeader>
          <form id="resource-form" onSubmit={submit} className="grid gap-4" noValidate>
            {p.fields
              .filter((f) => !(editing && f.createOnly))
              .map((f) => (
                <div key={f.name} className="grid gap-1.5">
                  <Label htmlFor={f.name}>{f.label}</Label>
                  {f.type === 'select' ? (
                    <Controller
                      control={control}
                      name={f.name as never}
                      render={({ field }) => (
                        <Select value={field.value as string} onValueChange={field.onChange}>
                          <SelectTrigger id={f.name} className="w-full" aria-invalid={!!errors[f.name]}>
                            <SelectValue placeholder={f.options?.length ? '선택하세요' : '선택할 항목이 없습니다'} />
                          </SelectTrigger>
                          <SelectContent>
                            {f.options?.map((o) => (
                              <SelectItem key={o.value} value={o.value}>
                                {o.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    />
                  ) : (
                    <Input
                      id={f.name}
                      type={f.type ?? 'text'}
                      placeholder={f.placeholder}
                      aria-invalid={!!errors[f.name]}
                      {...register(f.name as never, f.type === 'number' ? { valueAsNumber: true } : {})}
                    />
                  )}
                  {f.hint && !errors[f.name] && <p className="text-muted-foreground text-xs">{f.hint}</p>}
                  <FieldError message={errors[f.name]?.message} />
                </div>
              ))}
          </form>
          <DialogFooter>
            <Button variant="outline" type="button" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" form="resource-form" disabled={pending}>
              {pending ? '저장 중…' : editing ? '저장' : '등록'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
