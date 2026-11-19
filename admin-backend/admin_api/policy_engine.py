"""정책 판단 (11_관리자백엔드.md 4절 가안).

1. 사용자·에이전트·대상 서버가 없거나 비활성이면 DENY
2. 해당 주체(사용자 또는 에이전트)의 활성 정책 중 대상 서버·데이터베이스가 맞는 것만 본다
3. 하나라도 DENY면 DENY (DENY 우선), ALLOW만 있으면 ALLOW
4. 맞는 정책이 없으면 기본 DENY
"""
from collections.abc import Iterable

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from admin_api.models import AccessPolicy, Agent, AgentUser, TargetServer
from admin_api.schemas import PolicyCheckRequest, PolicyCheckResponse


def decide(policies: Iterable[AccessPolicy], database: str) -> PolicyCheckResponse:
    matching = sorted((p for p in policies
                       if p.is_active and (p.scope_value is None or p.scope_value == database)),
                      key=lambda p: (p.priority, str(p.id)))
    for effect in ('DENY', 'ALLOW'):
        hit = next((p for p in matching if p.effect == effect), None)
        if hit is not None:
            return PolicyCheckResponse(decision=effect, policy_id=hit.id,
                                       reason='POLICY_DENY' if effect == 'DENY' else None)
    return PolicyCheckResponse(decision='DENY', reason='NO_MATCHING_POLICY')


def deny(reason: str) -> PolicyCheckResponse:
    return PolicyCheckResponse(decision='DENY', reason=reason)


def check(db: Session, req: PolicyCheckRequest) -> PolicyCheckResponse:
    user = db.get(AgentUser, req.user_id)
    if user is None:
        return deny('UNKNOWN_USER')
    if not user.is_active:
        return deny('USER_INACTIVE')
    agent = db.get(Agent, req.agent_id)
    if agent is None:
        return deny('UNKNOWN_AGENT')
    if not agent.is_active:
        return deny('AGENT_INACTIVE')

    if req.server_id is not None:
        servers = [s for s in [db.get(TargetServer, req.server_id)] if s is not None]
    else:
        servers = list(db.scalars(select(TargetServer).where(TargetServer.database == req.database)))
    if not servers:
        return deny('UNKNOWN_SERVER')
    active_ids = [s.id for s in servers if s.is_active]
    if not active_ids:
        return deny('SERVER_INACTIVE')

    policies = db.scalars(select(AccessPolicy).where(
        AccessPolicy.target_server_id.in_(active_ids),
        or_((AccessPolicy.subject_type == 'USER') & (AccessPolicy.subject_id == user.id),
            (AccessPolicy.subject_type == 'AGENT') & (AccessPolicy.subject_id == agent.id)),
    ))
    return decide(policies, req.database)
