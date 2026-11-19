"""관리 API (B-02 ~ B-06).

TODO(T-03 관리자 인증): B-01 로그인 이후 모든 관리 API에 관리자 토큰을 요구하고,
policy/check는 MCP 전용 토큰으로 보호한다. 지금은 127.0.0.1에만 노출해 로컬 개발용으로 쓴다.
"""
import uuid

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from admin_api import crud, policy_engine
from admin_api.db import get_db
from admin_api.models import AccessPolicy, Agent, AgentUser, TargetServer
from admin_api.schemas import (AgentCreate, AgentRead, AgentUpdate, AgentUserCreate, AgentUserRead,
                               AgentUserUpdate, PolicyCheckRequest, PolicyCheckResponse, PolicyCreate,
                               PolicyRead, PolicyUpdate, ServerCreate, ServerRead, ServerUpdate,
                               SubjectType)

router = APIRouter(prefix='/api')
DB = Depends(get_db)


# ── 사용자 (B-02) ─────────────────────────────────────────
@router.get('/agent-users', response_model=list[AgentUserRead], tags=['agent-users'])
def list_users(db: Session = DB):
    return db.scalars(select(AgentUser).order_by(AgentUser.id)).all()


@router.post('/agent-users', response_model=AgentUserRead, status_code=201, tags=['agent-users'])
def create_user(body: AgentUserCreate, db: Session = DB):
    return crud.create(db, AgentUser(**body.model_dump()))


@router.get('/agent-users/{user_id}', response_model=AgentUserRead, tags=['agent-users'])
def get_user(user_id: str, db: Session = DB):
    return crud.get_or_404(db, AgentUser, user_id)


@router.patch('/agent-users/{user_id}', response_model=AgentUserRead, tags=['agent-users'])
def update_user(user_id: str, body: AgentUserUpdate, db: Session = DB):
    return crud.update(db, crud.get_or_404(db, AgentUser, user_id), body.changes())


# ── 에이전트 (B-03) ───────────────────────────────────────
@router.get('/agents', response_model=list[AgentRead], tags=['agents'])
def list_agents(owner_user_id: str | None = None, db: Session = DB):
    query = select(Agent).order_by(Agent.id)
    if owner_user_id is not None:
        query = query.where(Agent.owner_user_id == owner_user_id)
    return db.scalars(query).all()


@router.post('/agents', response_model=AgentRead, status_code=201, tags=['agents'])
def create_agent(body: AgentCreate, db: Session = DB):
    crud.require(db, AgentUser, body.owner_user_id, 'owner_user_id')
    return crud.create(db, Agent(**body.model_dump()))


@router.get('/agents/{agent_id}', response_model=AgentRead, tags=['agents'])
def get_agent(agent_id: str, db: Session = DB):
    return crud.get_or_404(db, Agent, agent_id)


@router.patch('/agents/{agent_id}', response_model=AgentRead, tags=['agents'])
def update_agent(agent_id: str, body: AgentUpdate, db: Session = DB):
    agent = crud.get_or_404(db, Agent, agent_id)
    changes = body.changes()
    if 'owner_user_id' in changes:
        crud.require(db, AgentUser, changes['owner_user_id'], 'owner_user_id')
    return crud.update(db, agent, changes)


# ── 대상 서버 (B-04) ──────────────────────────────────────
@router.get('/servers', response_model=list[ServerRead], tags=['servers'])
def list_servers(db: Session = DB):
    return db.scalars(select(TargetServer).order_by(TargetServer.id)).all()


@router.post('/servers', response_model=ServerRead, status_code=201, tags=['servers'])
def create_server(body: ServerCreate, db: Session = DB):
    return crud.create(db, TargetServer(**body.model_dump()))


@router.get('/servers/{server_id}', response_model=ServerRead, tags=['servers'])
def get_server(server_id: str, db: Session = DB):
    return crud.get_or_404(db, TargetServer, server_id)


@router.patch('/servers/{server_id}', response_model=ServerRead, tags=['servers'])
def update_server(server_id: str, body: ServerUpdate, db: Session = DB):
    return crud.update(db, crud.get_or_404(db, TargetServer, server_id), body.changes())


# ── 접근 정책 (B-05) ──────────────────────────────────────
@router.get('/policies', response_model=list[PolicyRead], tags=['policies'])
def list_policies(subject_type: SubjectType | None = None, subject_id: str | None = None,
                  target_server_id: str | None = None, db: Session = DB):
    query = select(AccessPolicy).order_by(AccessPolicy.priority, AccessPolicy.created_at)
    if subject_type is not None:
        query = query.where(AccessPolicy.subject_type == subject_type)
    if subject_id is not None:
        query = query.where(AccessPolicy.subject_id == subject_id)
    if target_server_id is not None:
        query = query.where(AccessPolicy.target_server_id == target_server_id)
    return db.scalars(query).all()


@router.post('/policies', response_model=PolicyRead, status_code=201, tags=['policies'])
def create_policy(body: PolicyCreate, db: Session = DB):
    crud.require_subject(db, body.subject_type, body.subject_id)
    crud.require_server(db, body.target_server_id)
    return crud.create(db, AccessPolicy(**body.model_dump()))


@router.get('/policies/{policy_id}', response_model=PolicyRead, tags=['policies'])
def get_policy(policy_id: uuid.UUID, db: Session = DB):
    return crud.get_or_404(db, AccessPolicy, policy_id)


@router.patch('/policies/{policy_id}', response_model=PolicyRead, tags=['policies'])
def update_policy(policy_id: uuid.UUID, body: PolicyUpdate, db: Session = DB):
    policy = crud.get_or_404(db, AccessPolicy, policy_id)
    changes = body.changes()
    if {'subject_type', 'subject_id'} & changes.keys():
        crud.require_subject(db, changes.get('subject_type', policy.subject_type),
                             changes.get('subject_id', policy.subject_id))
    if 'target_server_id' in changes:
        crud.require_server(db, changes['target_server_id'])
    return crud.update(db, policy, changes)


@router.delete('/policies/{policy_id}', status_code=204, tags=['policies'])
def delete_policy(policy_id: uuid.UUID, db: Session = DB):
    db.delete(crud.get_or_404(db, AccessPolicy, policy_id))
    db.commit()
    return Response(status_code=204)


# ── 정책 확인 (B-06) — MCP Gateway가 SQL 실행 전에 호출 ──
@router.post('/policy/check', response_model=PolicyCheckResponse, tags=['policy-check'])
def check_policy(body: PolicyCheckRequest, db: Session = DB):
    return policy_engine.check(db, body)
