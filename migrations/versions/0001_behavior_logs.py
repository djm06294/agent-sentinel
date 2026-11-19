"""Initial immutable behavior log schema."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'behavior_logs',
        sa.Column('log_id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        *[sa.Column(name, sa.String(128), nullable=False) for name in
          ('user_id', 'agent_id', 'session_id', 'tool_name', 'action', 'resource')],
        sa.Column('request_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('sequence_no', sa.BigInteger(), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('duration_ms', sa.Integer(), nullable=False),
        sa.Column('error_code', sa.String(128), nullable=True),
        sa.Column('metadata', postgresql.JSONB(), nullable=False),
        sa.UniqueConstraint('agent_id', 'session_id', 'sequence_no', name='uq_log_sequence'),
        sa.CheckConstraint('sequence_no >= 0', name='ck_sequence'),
        sa.CheckConstraint('duration_ms >= 0', name='ck_duration'),
        sa.CheckConstraint("status IN ('success', 'failure', 'denied')", name='ck_status'),
        sa.CheckConstraint("(status = 'success' AND error_code IS NULL) OR (status <> 'success' AND error_code IS NOT NULL)", name='ck_error'),
        sa.CheckConstraint("jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 1024", name='ck_metadata'),
    )
    for name, columns in (
        ('ix_logs_agent_time', ['agent_id', 'timestamp']),
        ('ix_logs_session_time', ['session_id', 'timestamp']),
        ('ix_logs_time', ['timestamp', 'log_id']),
        ('ix_logs_request', ['request_id']),
    ):
        op.create_index(name, 'behavior_logs', columns)


def downgrade():
    op.drop_table('behavior_logs')
