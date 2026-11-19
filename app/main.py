import logging

from fastapi import Depends, FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session
from starlette.exceptions import HTTPException

from app.api.routes.logs import router
from app.db.database import get_db

logger = logging.getLogger('sentinel')


def error(status, code, message):
    return JSONResponse(status_code=status, content={'error': {'code': code, 'message': message}})


class BodyLimitMiddleware:
    """Bound actual bytes, including chunked bodies, before JSON parsing."""
    def __init__(self, app, limit=16384):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        body = bytearray()
        while True:
            message = await receive()
            if message['type'] == 'http.disconnect':
                return
            body.extend(message.get('body', b''))
            if len(body) > self.limit:
                return await error(413, 'payload_too_large', 'Request exceeds 16384 bytes')(scope, receive, send)
            if not message.get('more_body', False):
                break
        async def replay():
            return {'type': 'http.request', 'body': bytes(body), 'more_body': False}
        await self.app(scope, replay, send)


app = FastAPI(title='Agent Sentinel Log API', version='1.0.0')
app.add_middleware(BodyLimitMiddleware)
app.include_router(router)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Do not echo input, validation context, credentials, or arbitrary field names.
    return error(422, 'validation_error', 'Invalid request; see /docs for the schema')


@app.exception_handler(HTTPException)
async def http_error(request, exc):
    return error(exc.status_code, 'not_found' if exc.status_code == 404 else 'http_error',
                 'Resource not found' if exc.status_code == 404 else 'Request rejected')


@app.exception_handler(IntegrityError)
async def integrity_error(request, exc):
    if getattr(exc.orig, 'sqlstate', None) == '23505':
        return error(409, 'duplicate_log', 'Agent/session sequence already exists')
    return error(503, 'database_error', 'Storage operation failed')


@app.exception_handler(SQLAlchemyError)
async def database_error(request, exc):
    logger.warning('Database operation failed: %s', type(exc).__name__)
    return error(503, 'database_unavailable', 'Storage is unavailable')


@app.exception_handler(Exception)
async def unexpected_error(request, exc):
    logger.error('Unhandled error: %s', type(exc).__name__)
    return error(500, 'internal_error', 'Internal server error')


@app.get('/health')
def health():
    return {'data': {'status': 'ok'}}


@app.get('/ready')
def ready(db: Session = Depends(get_db)):
    # Checks connectivity and migration-created table access without scanning data.
    db.execute(text('SELECT log_id FROM behavior_logs LIMIT 0'))
    return {'data': {'status': 'ready'}}
