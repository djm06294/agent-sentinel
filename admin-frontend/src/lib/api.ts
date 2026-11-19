/** 관리자 백엔드(admin-backend) API 클라이언트. 형식은 docs/specs/11_관리자백엔드.md 5절. */

export type SubjectType = 'USER' | 'AGENT'
export type Effect = 'ALLOW' | 'DENY'

interface Timestamps {
  created_at: string
  updated_at: string
}

export interface AgentUser extends Timestamps {
  id: string
  name: string
  department: string | null
  is_active: boolean
}

export interface Agent extends Timestamps {
  id: string
  name: string
  type: 'claude_code'
  owner_user_id: string
  is_active: boolean
  has_token: boolean
}

export interface Server extends Timestamps {
  id: string
  name: string
  host: string
  port: number
  database: string
  is_active: boolean
}

export interface Policy extends Timestamps {
  id: string
  name: string
  subject_type: SubjectType
  subject_id: string
  target_server_id: string
  scope_type: 'DATABASE'
  scope_value: string | null
  effect: Effect
  priority: number
  is_active: boolean
  description: string | null
}

export type PolicyInput = Omit<Policy, 'id' | 'scope_type' | keyof Timestamps>
export type AgentUserInput = Omit<AgentUser, keyof Timestamps>
export type AgentInput = Omit<Agent, 'type' | 'has_token' | keyof Timestamps>
export type ServerInput = Omit<Server, keyof Timestamps>

/** 백엔드 오류 응답 {"error": {code, message, fields}} */
export class ApiError extends Error {
  status: number
  code: string
  fields: { loc: string[]; msg: string }[]

  constructor(status: number, code: string, message: string, fields: ApiError['fields'] = []) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'network_error', '관리자 백엔드에 연결할 수 없습니다.')
  }
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const err = data?.error
    throw new ApiError(response.status, err?.code ?? 'http_error', err?.message ?? response.statusText, err?.fields)
  }
  return data as T
}

const resource = <T, Input>(path: string) => ({
  list: () => request<T[]>('GET', path),
  create: (input: Input) => request<T>('POST', path, input),
  update: (id: string, changes: Partial<Input>) => request<T>('PATCH', `${path}/${encodeURIComponent(id)}`, changes),
})

export const api = {
  users: resource<AgentUser, AgentUserInput>('/agent-users'),
  agents: resource<Agent, AgentInput>('/agents'),
  servers: resource<Server, ServerInput>('/servers'),
  policies: {
    ...resource<Policy, PolicyInput>('/policies'),
    remove: (id: string) => request<void>('DELETE', `/policies/${encodeURIComponent(id)}`),
  },
}

/** 오류 코드를 화면 문구로 */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return '알 수 없는 오류가 발생했습니다.'
  switch (error.code) {
    case 'already_exists':
      return '같은 ID가 이미 있습니다.'
    case 'invalid_reference':
      return '선택한 대상이 존재하지 않습니다. 목록을 새로고침해 주세요.'
    case 'validation_error':
      return '입력값을 확인해 주세요.'
    case 'not_found':
      return '항목을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.'
    default:
      return error.message
  }
}
