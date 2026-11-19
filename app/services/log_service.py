from uuid import UUID

from sqlalchemy.orm import Session

from app.db.models import BehaviorLog
from app.schemas.log import LogCreate, LogRead


def serialize(row: BehaviorLog) -> LogRead:
    values = {name: getattr(row, name) for name in LogRead.model_fields if name != 'metadata'}
    return LogRead(**values, metadata=row.metadata_json)


def create_log(db: Session, payload: LogCreate) -> LogRead:
    values = payload.model_dump(exclude={'metadata'})
    row = BehaviorLog(**values, metadata_json=payload.metadata.model_dump(exclude_none=True))
    try:
        db.add(row)
        db.commit()
        db.refresh(row)
    except Exception:
        db.rollback()
        raise
    return serialize(row)


def read_log(db: Session, log_id: UUID) -> LogRead | None:
    row = db.get(BehaviorLog, log_id)
    return serialize(row) if row is not None else None
