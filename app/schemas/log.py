import json
from datetime import datetime, timezone
from typing import Annotated, Literal
from uuid import UUID

from pydantic import (AwareDatetime, BaseModel, ConfigDict, Field,
                      StringConstraints, field_validator, model_validator)

# Identifiers only: no raw SQL, URLs, credentials, prompts or tool outputs.
Identifier = Annotated[str, StringConstraints(strict=True, min_length=1, max_length=128,
                                             pattern=r'^[A-Za-z0-9][A-Za-z0-9_.:/-]*$')]
Nonnegative = Annotated[int, Field(strict=True, ge=0, le=2147483647)]


class Metadata(BaseModel):
    model_config = ConfigDict(extra='forbid')
    rows_affected: Nonnegative | None = None
    result_count: Nonnegative | None = None
    retry_count: Annotated[int, Field(strict=True, ge=0, le=100)] | None = None
    transport: Literal['stdio', 'http', 'sse'] | None = None
    resource_type: Literal['table', 'record', 'file', 'service'] | None = None


class LogCreate(BaseModel):
    model_config = ConfigDict(extra='forbid')
    timestamp: AwareDatetime
    user_id: Identifier
    agent_id: Identifier
    session_id: Identifier
    request_id: UUID
    sequence_no: Annotated[int, Field(strict=True, ge=0, le=9223372036854775807)]
    tool_name: Identifier
    action: Identifier
    resource: Identifier
    status: Literal['success', 'failure', 'denied']
    duration_ms: Nonnegative
    error_code: Identifier | None = None
    metadata: Metadata = Field(default_factory=Metadata)

    @field_validator('timestamp', mode='before')
    @classmethod
    def timestamp_format(cls, value):
        if not isinstance(value, (str, datetime)):
            raise ValueError('ISO 8601 timestamp with timezone required')
        return value

    @field_validator('timestamp')
    @classmethod
    def utc_timestamp(cls, value):
        return value.astimezone(timezone.utc)

    @model_validator(mode='after')
    def check_outcome(self):
        if self.status == 'success' and self.error_code is not None:
            raise ValueError('success must not include error_code')
        if self.status != 'success' and self.error_code is None:
            raise ValueError('failure and denied require error_code')
        if len(json.dumps(self.metadata.model_dump(exclude_none=True)).encode()) > 1024:
            raise ValueError('metadata exceeds 1024 bytes')
        return self


class LogRead(LogCreate):
    log_id: UUID
    received_at: AwareDatetime


class LogResponse(BaseModel):
    data: LogRead


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail
