from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import BigInteger, CheckConstraint, DateTime, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class BehaviorLog(Base):
    __tablename__ = 'behavior_logs'
    __table_args__ = (
        UniqueConstraint('agent_id', 'session_id', 'sequence_no', name='uq_log_sequence'),
        CheckConstraint('sequence_no >= 0', name='ck_sequence'),
        CheckConstraint('duration_ms >= 0', name='ck_duration'),
        CheckConstraint("status IN ('success', 'failure', 'denied')", name='ck_status'),
        CheckConstraint("(status = 'success' AND error_code IS NULL) OR (status <> 'success' AND error_code IS NOT NULL)", name='ck_error'),
        CheckConstraint("jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 1024", name='ck_metadata'),
        Index('ix_logs_agent_time', 'agent_id', 'timestamp'),
        Index('ix_logs_session_time', 'session_id', 'timestamp'),
        Index('ix_logs_time', 'timestamp', 'log_id'),
        Index('ix_logs_request', 'request_id'),
    )
    log_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False)
    agent_id: Mapped[str] = mapped_column(String(128), nullable=False)
    session_id: Mapped[str] = mapped_column(String(128), nullable=False)
    request_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    sequence_no: Mapped[int] = mapped_column(BigInteger, nullable=False)
    tool_name: Mapped[str] = mapped_column(String(128), nullable=False)
    action: Mapped[str] = mapped_column(String(128), nullable=False)
    resource: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    error_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    metadata_json: Mapped[dict] = mapped_column('metadata', JSONB, nullable=False, default=dict)
