import { Mono } from '@/components/common'
import { ResourcePage } from '@/components/ResourcePage'
import { Badge } from '@/components/ui/badge'
import { api, type Agent, type AgentInput, type AgentUser, type AgentUserInput, type Server, type ServerInput } from '@/lib/api'
import { keys, useAgents, useServers, useUsers } from '@/lib/queries'
import { agentSchema, serverSchema, userSchema, type AgentForm, type ServerForm, type UserForm } from '@/lib/schemas'
import { formatKst } from '@/lib/utils'

const updatedColumn = {
  header: '수정',
  className: 'text-muted-foreground hidden text-xs tabular-nums xl:table-cell',
  cell: (row: { updated_at: string }) => formatKst(row.updated_at),
}

const ID_HINT = '행동 로그의 ID와 같은 값입니다. 등록 후에는 바꿀 수 없습니다.'

export function UsersPage() {
  return (
    <ResourcePage<AgentUser, UserForm>
      title="사용자"
      description="AI 에이전트를 사용하는 사람입니다. 사용자 ID는 행동 로그의 user_id와 같습니다."
      noun="사용자"
      query={useUsers()}
      queryKey={keys.users}
      columns={[
        { header: '사용자 ID', cell: (u) => <Mono>{u.id}</Mono> },
        { header: '이름', cell: (u) => u.name, className: 'font-medium' },
        { header: '부서', cell: (u) => u.department ?? '—' },
        updatedColumn,
      ]}
      schema={userSchema}
      defaults={{ id: '', name: '', department: '' }}
      toForm={(u) => ({ id: u.id, name: u.name, department: u.department ?? '' })}
      fields={[
        { name: 'id', label: '사용자 ID', placeholder: 'local-user', createOnly: true, hint: ID_HINT },
        { name: 'name', label: '이름', placeholder: '김주영' },
        { name: 'department', label: '부서 (선택)' },
      ]}
      create={(v) => api.users.create(v as unknown as AgentUserInput)}
      update={(id, v) => api.users.update(id, v as Partial<AgentUserInput>)}
    />
  )
}

export function AgentsPage() {
  const users = useUsers().data ?? []
  const userName = (id: string) => users.find((u) => u.id === id)?.name
  return (
    <ResourcePage<Agent, AgentForm>
      title="에이전트"
      description="사용자가 실행하는 AI 에이전트(Claude Code)입니다. 에이전트 ID는 행동 로그의 agent_id와 같습니다."
      noun="에이전트"
      query={useAgents()}
      queryKey={keys.agents}
      columns={[
        { header: '에이전트 ID', cell: (a) => <Mono>{a.id}</Mono> },
        { header: '이름', cell: (a) => a.name, className: 'font-medium' },
        { header: '종류', cell: () => <Badge variant="outline">Claude Code</Badge> },
        { header: '소유 사용자', cell: (a) => userName(a.owner_user_id) ?? <Mono>{a.owner_user_id}</Mono> },
        {
          header: '접속 토큰',
          // TODO(B-03): 토큰 발급 API가 생기면 발급 버튼 + 1회 표시
          cell: (a) => <span className="text-muted-foreground text-xs">{a.has_token ? '발급됨' : '발급 준비 중'}</span>,
        },
        updatedColumn,
      ]}
      schema={agentSchema}
      defaults={{ id: '', name: 'Claude Code', owner_user_id: '' }}
      toForm={(a) => ({ id: a.id, name: a.name, owner_user_id: a.owner_user_id })}
      fields={[
        { name: 'id', label: '에이전트 ID', placeholder: 'dbhub-agent', createOnly: true, hint: ID_HINT },
        { name: 'name', label: '이름' },
        {
          name: 'owner_user_id',
          label: '소유 사용자',
          type: 'select',
          options: users.map((u) => ({ value: u.id, label: `${u.name} (${u.id})` })),
        },
      ]}
      create={(v) => api.agents.create(v as unknown as AgentInput)}
      update={(id, v) => api.agents.update(id, v as Partial<AgentInput>)}
    />
  )
}

export function ServersPage() {
  return (
    <ResourcePage<Server, ServerForm>
      title="대상 서버"
      description="에이전트가 MCP를 통해 접속하는 데이터베이스 서버입니다."
      noun="대상 서버"
      query={useServers()}
      queryKey={keys.servers}
      columns={[
        { header: '서버 ID', cell: (s) => <Mono>{s.id}</Mono> },
        { header: '이름', cell: (s) => s.name, className: 'font-medium' },
        { header: '주소', cell: (s) => <Mono>{`${s.host}:${s.port}`}</Mono> },
        { header: '데이터베이스', cell: (s) => <Mono>{s.database}</Mono> },
        updatedColumn,
      ]}
      schema={serverSchema}
      defaults={{ id: '', name: '', host: 'localhost', port: 5432, database: '' }}
      toForm={(s) => ({ id: s.id, name: s.name, host: s.host, port: s.port, database: s.database })}
      fields={[
        { name: 'id', label: '서버 ID', placeholder: 'biz-pg', createOnly: true, hint: '등록 후에는 바꿀 수 없습니다.' },
        { name: 'name', label: '이름', placeholder: '업무 DB' },
        { name: 'host', label: '호스트' },
        { name: 'port', label: '포트', type: 'number' },
        {
          name: 'database',
          label: '데이터베이스',
          placeholder: 'mydb',
          hint: 'Gateway가 정책 확인 때 보내는 database 이름과 같아야 합니다.',
        },
      ]}
      create={(v) => api.servers.create(v as unknown as ServerInput)}
      update={(id, v) => api.servers.update(id, v as Partial<ServerInput>)}
    />
  )
}
