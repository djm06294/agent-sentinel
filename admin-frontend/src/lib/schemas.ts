/** 관리 화면 폼 검증 (백엔드 admin_api/schemas.py 규칙과 맞춤) */
import { z } from 'zod'

const identifier = z
  .string()
  .trim()
  .min(1, 'ID를 입력하세요.')
  .max(128, '128자 이내로 입력하세요.')
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/, '영문·숫자로 시작하고 영문·숫자·_ . : / - 만 쓸 수 있습니다.')
const name = z.string().trim().min(1, '이름을 입력하세요.').max(100, '100자 이내로 입력하세요.')

export const userSchema = z.object({
  id: identifier,
  name,
  department: z
    .string()
    .trim()
    .max(100, '100자 이내로 입력하세요.')
    .transform((v) => v || null),
})
export type UserForm = z.input<typeof userSchema>

export const agentSchema = z.object({
  id: identifier,
  name,
  owner_user_id: z.string().min(1, '소유 사용자를 선택하세요.'),
})
export type AgentForm = z.input<typeof agentSchema>

export const serverSchema = z.object({
  id: identifier,
  name,
  host: z
    .string()
    .trim()
    .min(1, '호스트를 입력하세요.')
    .max(255)
    .regex(/^[A-Za-z0-9.:\-[\]]+$/, '호스트 이름 또는 IP 주소를 입력하세요.'),
  port: z
    .number({ invalid_type_error: '포트 번호를 입력하세요.' })
    .int()
    .min(1, '1~65535 사이여야 합니다.')
    .max(65535, '1~65535 사이여야 합니다.'),
  database: identifier,
})
export type ServerForm = z.input<typeof serverSchema>
