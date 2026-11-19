from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.log import ErrorResponse, LogCreate, LogResponse
from app.services.log_service import create_log, read_log

router = APIRouter(prefix='/api/v1/logs', tags=['logs'], responses={
    422: {'model': ErrorResponse}, 503: {'model': ErrorResponse}, 500: {'model': ErrorResponse}})


@router.post('', response_model=LogResponse, status_code=201,
             responses={409: {'model': ErrorResponse}, 413: {'model': ErrorResponse}})
def insert_log(payload: LogCreate, db: Session = Depends(get_db)):
    return {'data': create_log(db, payload)}


@router.get('/{log_id}', response_model=LogResponse, responses={404: {'model': ErrorResponse}})
def get_log(log_id: UUID, db: Session = Depends(get_db)):
    result = read_log(db, log_id)
    if result is None:
        raise HTTPException(status_code=404, detail='Log not found')
    return {'data': result}
