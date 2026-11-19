"""control_db 초기 스키마: 사용자·에이전트·대상 서버·접근 정책."""
from alembic import op
import sqlalchemy as sa

revision = '0001'
down_revision = None
branch_labels = None
depends_on = None


def timestamps():
    return [
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    ]


def upgrade():
    op.create_table(
        'agent_user',
        sa.Column('id', sa.String(128), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('department', sa.String(100), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        *timestamps(),
    )
    op.create_table(
        'agent',
        sa.Column('id', sa.String(128), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('type', sa.String(32), nullable=False),
        sa.Column('owner_user_id', sa.String(128), sa.ForeignKey('agent_user.id'), nullable=False),
        sa.Column('token_hash', sa.String(128), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        *timestamps(),
        sa.CheckConstraint("type IN ('claude_code')", name='ck_agent_type'),
    )
    op.create_index('ix_agent_owner_user_id', 'agent', ['owner_user_id'])
    op.create_table(
        'target_server',
        sa.Column('id', sa.String(128), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('host', sa.String(255), nullable=False),
        sa.Column('port', sa.Integer(), nullable=False),
        sa.Column('database', sa.String(128), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        *timestamps(),
        sa.CheckConstraint('port BETWEEN 1 AND 65535', name='ck_server_port'),
    )
    op.create_index('ix_target_server_database', 'target_server', ['database'])
    op.create_table(
        'access_policy',
        sa.Column('id', sa.Uuid(), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('subject_type', sa.String(16), nullable=False),
        sa.Column('subject_id', sa.String(128), nullable=False),
        sa.Column('target_server_id', sa.String(128), sa.ForeignKey('target_server.id'), nullable=False),
        sa.Column('scope_type', sa.String(16), nullable=False),
        sa.Column('scope_value', sa.String(128), nullable=True),
        sa.Column('effect', sa.String(8), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False),
        sa.Column('is_active', sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        *timestamps(),
        sa.CheckConstraint("subject_type IN ('USER', 'AGENT')", name='ck_policy_subject_type'),
        sa.CheckConstraint("scope_type IN ('DATABASE')", name='ck_policy_scope_type'),
        sa.CheckConstraint("effect IN ('ALLOW', 'DENY')", name='ck_policy_effect'),
        sa.CheckConstraint('priority BETWEEN 0 AND 10000', name='ck_policy_priority'),
    )
    op.create_index('ix_policy_subject', 'access_policy', ['subject_type', 'subject_id'])
    op.create_index('ix_access_policy_target_server_id', 'access_policy', ['target_server_id'])


def downgrade():
    op.drop_table('access_policy')
    op.drop_table('target_server')
    op.drop_table('agent')
    op.drop_table('agent_user')
