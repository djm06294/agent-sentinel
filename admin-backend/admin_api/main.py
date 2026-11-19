from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.orm import Session

from admin_api import errors
from admin_api.config import get_settings
from admin_api.db import get_db
from admin_api.routes import router

app = FastAPI(title='Agent Sentinel Admin API', version='0.1.0')
app.add_middleware(CORSMiddleware, allow_origins=get_settings().cors_origins,
                   allow_methods=['GET', 'POST', 'PATCH', 'DELETE'], allow_headers=['Content-Type', 'Authorization'])
errors.register(app)
app.include_router(router)


@app.get('/health', tags=['health'])
def health():
    return {'status': 'ok'}


@app.get('/ready', tags=['health'])
def ready(db: Session = Depends(get_db)):
    # DB 연결과 마이그레이션으로 만든 테이블 접근만 확인
    db.execute(text('SELECT id FROM access_policy LIMIT 0'))
    return {'status': 'ready'}
