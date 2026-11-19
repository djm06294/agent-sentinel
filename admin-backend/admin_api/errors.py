"""오류 응답 형식: {"error": {"code": ..., "message": ..., "fields": [...]}} (로그 API와 같은 모양)."""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from starlette.exceptions import HTTPException

logger = logging.getLogger('admin_api')


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def not_found(kind: str, key: object) -> ApiError:
    return ApiError(404, 'not_found', f'{kind} not found: {key}')


def error(status: int, code: str, message: str, fields: list | None = None) -> JSONResponse:
    body: dict = {'code': code, 'message': message}
    if fields:
        body['fields'] = fields
    return JSONResponse(status_code=status, content={'error': body})


def register(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError):
        return error(exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        # 폼에 오류를 표시할 수 있도록 위치·메시지만 돌려준다 (입력값은 되돌려주지 않음)
        fields = [{'loc': [str(p) for p in e['loc'][1:]], 'msg': e['msg']} for e in exc.errors()]
        return error(422, 'validation_error', 'Invalid request', fields)

    @app.exception_handler(HTTPException)
    async def http_error(_: Request, exc: HTTPException):
        return error(exc.status_code, 'not_found' if exc.status_code == 404 else 'http_error', str(exc.detail))

    @app.exception_handler(IntegrityError)
    async def integrity_error(_: Request, exc: IntegrityError):
        return error(409, 'conflict', 'Request conflicts with existing data')

    @app.exception_handler(SQLAlchemyError)
    async def database_error(_: Request, exc: SQLAlchemyError):
        logger.warning('Database operation failed: %s', type(exc).__name__)
        return error(503, 'database_unavailable', 'Storage is unavailable')
