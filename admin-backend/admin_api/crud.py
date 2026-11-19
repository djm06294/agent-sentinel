"""라우터에서 공통으로 쓰는 조회·생성·수정 도우미."""
from typing import TypeVar

from sqlalchemy.orm import Session

from admin_api.errors import ApiError, not_found
from admin_api.models import Agent, AgentUser, Base, TargetServer

M = TypeVar('M', bound=Base)


def get_or_404(db: Session, model: type[M], key: object) -> M:
    obj = db.get(model, key)
    if obj is None:
        raise not_found(model.__tablename__, key)
    return obj


def require(db: Session, model: type[Base], key: object, field: str) -> None:
    """다른 항목을 가리키는 값이 실제로 있는지 확인 (없으면 422)."""
    if db.get(model, key) is None:
        raise ApiError(422, 'invalid_reference', f'{field} refers to a missing {model.__tablename__}: {key}')


def require_subject(db: Session, subject_type: str, subject_id: str) -> None:
    require(db, AgentUser if subject_type == 'USER' else Agent, subject_id, 'subject_id')


def require_server(db: Session, server_id: str) -> None:
    require(db, TargetServer, server_id, 'target_server_id')


def create(db: Session, obj: M) -> M:
    key = getattr(obj, 'id', None)
    if key is not None and db.get(type(obj), key) is not None:
        raise ApiError(409, 'already_exists', f'{type(obj).__tablename__} already exists: {key}')
    db.add(obj)
    return save(db, obj)


def update(db: Session, obj: M, changes: dict) -> M:
    for name, value in changes.items():
        setattr(obj, name, value)
    return save(db, obj)


def save(db: Session, obj: M) -> M:
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(obj)
    return obj
