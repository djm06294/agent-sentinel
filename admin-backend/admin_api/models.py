"""control_db 데이터 모델 (11_관리자백엔드.md 4절).

PostgreSQL 전용 타입을 쓰지 않아 단위 테스트는 SQLite에서도 돈다.
admin_account(관리자 로그인, T-03)는 인증 작업 때 추가한다.
"""
import uuid
from datetime import datetime

from sqlalchemy import (Boolean, CheckConstraint, DateTime, ForeignKey, Index, Integer, String, Text, Uuid,
                        func, true)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Timestamps:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(),
                                                 onupdate=func.now(), nullable=False)


class AgentUser(Timestamps, Base):
    """에이전트를 사용하는 사람. id가 행동 로그의 user_id와 같은 값이다."""
    __tablename__ = 'agent_user'
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    department: Mapped[str | None] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())


class Agent(Timestamps, Base):
    """에이전트 프로그램. id가 행동 로그의 agent_id와 같은 값이다."""
    __tablename__ = 'agent'
    __table_args__ = (CheckConstraint("type IN ('claude_code')", name='ck_agent_type'),)
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default='claude_code')
    owner_user_id: Mapped[str] = mapped_column(ForeignKey('agent_user.id'), nullable=False, index=True)
    # TODO(B-03 토큰 발급): opaque token의 해시만 저장. 발급 API는 인증 작업 때 추가.
    token_hash: Mapped[str | None] = mapped_column(String(128))
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())

    @property
    def has_token(self) -> bool:
        return self.token_hash is not None


class TargetServer(Timestamps, Base):
    """에이전트가 접속하는 대상 DB 서버."""
    __tablename__ = 'target_server'
    __table_args__ = (CheckConstraint('port BETWEEN 1 AND 65535', name='ck_server_port'),)
    id: Mapped[str] = mapped_column(String(128), primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    host: Mapped[str] = mapped_column(String(255), nullable=False)
    port: Mapped[int] = mapped_column(Integer, nullable=False)
    database: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())


class AccessPolicy(Timestamps, Base):
    """주체(사용자 또는 에이전트) × 대상 서버 → 허용/차단."""
    __tablename__ = 'access_policy'
    __table_args__ = (
        CheckConstraint("subject_type IN ('USER', 'AGENT')", name='ck_policy_subject_type'),
        # TODO(Q1 권한 단위): SCHEMA/TABLE 단위는 확정 후 추가. 지금은 DATABASE만.
        CheckConstraint("scope_type IN ('DATABASE')", name='ck_policy_scope_type'),
        CheckConstraint("effect IN ('ALLOW', 'DENY')", name='ck_policy_effect'),
        CheckConstraint('priority BETWEEN 0 AND 10000', name='ck_policy_priority'),
        Index('ix_policy_subject', 'subject_type', 'subject_id'),
    )
    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    subject_type: Mapped[str] = mapped_column(String(16), nullable=False)
    # USER면 agent_user.id, AGENT면 agent.id (대상 테이블이 달라 FK 대신 API에서 존재 여부 검사)
    subject_id: Mapped[str] = mapped_column(String(128), nullable=False)
    target_server_id: Mapped[str] = mapped_column(ForeignKey('target_server.id'), nullable=False, index=True)
    scope_type: Mapped[str] = mapped_column(String(16), nullable=False, default='DATABASE')
    # NULL이면 서버 전체, 값이 있으면 그 데이터베이스에만 적용
    scope_value: Mapped[str | None] = mapped_column(String(128))
    effect: Mapped[str] = mapped_column(String(8), nullable=False)
    # 숫자가 작을수록 먼저 본다. 결과(DENY 우선)는 바꾸지 않고, 어느 정책이 적용됐는지 고를 때만 쓴다.
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())
    description: Mapped[str | None] = mapped_column(Text)
