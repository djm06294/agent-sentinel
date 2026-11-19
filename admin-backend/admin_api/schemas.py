"""요청·응답 형식. Enum 값은 00_공통_인터페이스 3절 규칙대로 대문자."""
import uuid
from datetime import datetime
from typing import Annotated, ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

# 행동 로그 API(app/schemas/log.py)와 같은 식별자 규칙
Identifier = Annotated[str, StringConstraints(min_length=1, max_length=128,
                                             pattern=r'^[A-Za-z0-9][A-Za-z0-9_.:/-]*$')]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Host = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=255,
                                       pattern=r'^[A-Za-z0-9.:\-\[\]]+$')]
Port = Annotated[int, Field(ge=1, le=65535)]
Description = Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)]

SubjectType = Literal['USER', 'AGENT']
Effect = Literal['ALLOW', 'DENY']
ScopeType = Literal['DATABASE']  # TODO(Q1 권한 단위): SCHEMA/TABLE은 확정 후 추가
AgentType = Literal['claude_code']


class Input(BaseModel):
    model_config = ConfigDict(extra='forbid')


class Patch(Input):
    """PATCH는 보낸 필드만 바꾼다. NOT NULL 컬럼에 null을 보내면 거부."""
    non_nullable: ClassVar[frozenset[str]] = frozenset()

    @model_validator(mode='after')
    def reject_null(self):
        for name in self.model_fields_set & self.non_nullable:
            if getattr(self, name) is None:
                raise ValueError(f'{name} cannot be null')
        return self

    def changes(self) -> dict:
        return self.model_dump(exclude_unset=True)


class Output(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    created_at: datetime
    updated_at: datetime


# ── 사용자 (B-02) ─────────────────────────────────────────
class AgentUserCreate(Input):
    id: Identifier
    name: Name
    department: Name | None = None
    is_active: bool = True


class AgentUserUpdate(Patch):
    non_nullable = frozenset({'name', 'is_active'})
    name: Name | None = None
    department: Name | None = None
    is_active: bool | None = None


class AgentUserRead(Output):
    id: str
    name: str
    department: str | None
    is_active: bool


# ── 에이전트 (B-03) ───────────────────────────────────────
class AgentCreate(Input):
    id: Identifier
    name: Name
    type: AgentType = 'claude_code'
    owner_user_id: Identifier
    is_active: bool = True


class AgentUpdate(Patch):
    non_nullable = frozenset({'name', 'owner_user_id', 'is_active'})
    name: Name | None = None
    owner_user_id: Identifier | None = None
    is_active: bool | None = None


class AgentRead(Output):
    id: str
    name: str
    type: str
    owner_user_id: str
    is_active: bool
    has_token: bool


# ── 대상 서버 (B-04) ──────────────────────────────────────
class ServerCreate(Input):
    id: Identifier
    name: Name
    host: Host
    port: Port = 5432
    database: Identifier
    is_active: bool = True


class ServerUpdate(Patch):
    non_nullable = frozenset({'name', 'host', 'port', 'database', 'is_active'})
    name: Name | None = None
    host: Host | None = None
    port: Port | None = None
    database: Identifier | None = None
    is_active: bool | None = None


class ServerRead(Output):
    id: str
    name: str
    host: str
    port: int
    database: str
    is_active: bool


# ── 접근 정책 (B-05) ──────────────────────────────────────
class PolicyCreate(Input):
    name: Name
    subject_type: SubjectType
    subject_id: Identifier
    target_server_id: Identifier
    scope_type: ScopeType = 'DATABASE'
    scope_value: Identifier | None = None
    effect: Effect
    priority: Annotated[int, Field(ge=0, le=10000)] = 100
    is_active: bool = True
    description: Description | None = None


class PolicyUpdate(Patch):
    non_nullable = frozenset({'name', 'subject_type', 'subject_id', 'target_server_id', 'scope_type',
                              'effect', 'priority', 'is_active'})
    name: Name | None = None
    subject_type: SubjectType | None = None
    subject_id: Identifier | None = None
    target_server_id: Identifier | None = None
    scope_type: ScopeType | None = None
    scope_value: Identifier | None = None
    effect: Effect | None = None
    priority: Annotated[int, Field(ge=0, le=10000)] | None = None
    is_active: bool | None = None
    description: Description | None = None


class PolicyRead(Output):
    id: uuid.UUID
    name: str
    subject_type: str
    subject_id: str
    target_server_id: str
    scope_type: str
    scope_value: str | None
    effect: str
    priority: int
    is_active: bool
    description: str | None


# ── 정책 확인 (B-06, 00번 7절) ────────────────────────────
class PolicyCheckRequest(BaseModel):
    # Gateway가 필드를 더 보내도 깨지지 않도록 모르는 필드는 무시
    model_config = ConfigDict(extra='ignore')
    user_id: Identifier
    agent_id: Identifier
    database: Identifier
    # Gateway가 대상 서버를 알면 지정. 없으면 database 이름으로 서버를 찾는다.
    server_id: Identifier | None = None
    session_id: str | None = None
    tool_name: str | None = None
    action: str | None = None
    schemas: list[str] = []
    tables: list[str] = []  # TODO(Q1): TABLE 단위 정책이 생기면 판단에 사용


DenyReason = Literal['NO_MATCHING_POLICY', 'POLICY_DENY', 'UNKNOWN_USER', 'USER_INACTIVE',
                     'UNKNOWN_AGENT', 'AGENT_INACTIVE', 'UNKNOWN_SERVER', 'SERVER_INACTIVE']


class PolicyCheckResponse(BaseModel):
    decision: Effect
    policy_id: uuid.UUID | None = None
    reason: DenyReason | None = None
