import { describe, expect, it } from 'vitest'

import { policySchema, toPolicyInput, type PolicyForm } from '@/pages/policies/PolicyFormDialog'
import { serverSchema, userSchema } from '@/lib/schemas'

const policy: PolicyForm = {
  name: ' 주영 업무 DB 허용 ',
  effect: 'ALLOW',
  subject_type: 'USER',
  subject_id: 'local-user',
  target_server_id: 'biz-pg',
  scope_value: '__all__',
  priority: 100,
  is_active: true,
  description: '  ',
}

describe('정책 폼', () => {
  it('서버 전체 선택과 빈 설명은 null로 보낸다', () => {
    const input = toPolicyInput(policySchema.parse(policy))
    expect(input).toMatchObject({ name: '주영 업무 DB 허용', scope_value: null, description: null })
  })

  it('특정 데이터베이스는 그대로 보낸다', () => {
    expect(toPolicyInput(policySchema.parse({ ...policy, scope_value: 'mydb' })).scope_value).toBe('mydb')
  })

  it('주체·서버를 고르지 않으면 거부한다', () => {
    const result = policySchema.safeParse({ ...policy, subject_id: '', target_server_id: '' })
    expect(result.success).toBe(false)
    expect(result.error?.issues.map((i) => i.path[0]).sort()).toEqual(['subject_id', 'target_server_id'])
  })

  it('우선순위 범위와 데이터베이스 이름 형식을 검사한다', () => {
    expect(policySchema.safeParse({ ...policy, priority: 10001 }).success).toBe(false)
    expect(policySchema.safeParse({ ...policy, priority: Number.NaN }).success).toBe(false)
    expect(policySchema.safeParse({ ...policy, scope_value: 'bad db' }).success).toBe(false)
  })
})

describe('관리 폼', () => {
  it('사용자 ID는 백엔드와 같은 식별자 규칙을 쓴다', () => {
    expect(userSchema.safeParse({ id: 'local-user', name: '김주영', department: '' }).success).toBe(true)
    expect(userSchema.safeParse({ id: '-bad', name: 'a', department: '' }).success).toBe(false)
    expect(userSchema.safeParse({ id: 'has space', name: 'a', department: '' }).success).toBe(false)
  })

  it('빈 부서는 null로 바꾼다', () => {
    expect(userSchema.parse({ id: 'u', name: 'a', department: ' ' }).department).toBeNull()
  })

  it('포트는 1~65535', () => {
    const server = { id: 's', name: 'n', host: 'localhost', database: 'mydb' }
    expect(serverSchema.safeParse({ ...server, port: 5432 }).success).toBe(true)
    expect(serverSchema.safeParse({ ...server, port: 0 }).success).toBe(false)
    expect(serverSchema.safeParse({ ...server, port: 70000 }).success).toBe(false)
  })
})
