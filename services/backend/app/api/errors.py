"""Google-style HTTP JSON errors (AIP-193), including typed ErrorInfo details."""

from typing import Literal

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from starlette.exceptions import HTTPException

from app.serving.errors import ServingDataError


class ErrorInfo(BaseModel):
    type: Literal["type.googleapis.com/google.rpc.ErrorInfo"] = Field(
        default="type.googleapis.com/google.rpc.ErrorInfo", alias="@type"
    )
    reason: str
    domain: str = "greenair.local"
    metadata: dict[str, str] = {}


class ErrorStatus(BaseModel):
    code: int
    status: str
    message: str
    details: list[ErrorInfo]


class ErrorResponse(BaseModel):
    error: ErrorStatus


STATUS = {
    400: "INVALID_ARGUMENT",
    404: "NOT_FOUND",
    422: "INVALID_ARGUMENT",
    502: "UNAVAILABLE",
    503: "UNAVAILABLE",
    500: "INTERNAL",
}
ERROR_RESPONSES = {
    code: {"model": ErrorResponse, "description": description}
    for code, description in {
        400: "Invalid resource parameter.",
        404: "Resource or coverage not found.",
        422: "Invalid compatibility-route parameter.",
        503: "Serving data unavailable.",
    }.items()
}


def error_response(
    code: int,
    message: str,
    metadata: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    status = STATUS.get(code, "UNKNOWN")
    body = ErrorResponse(
        error=ErrorStatus(
            code=code,
            status=status,
            message=message,
            details=[ErrorInfo(reason=status, metadata=metadata or {})],
        )
    )
    return JSONResponse(status_code=code, content=body.model_dump(by_alias=True), headers=headers)


async def http_error(request: Request, exception: HTTPException) -> JSONResponse:
    return error_response(exception.status_code, str(exception.detail), headers=exception.headers)


async def validation_error(request: Request, exception: RequestValidationError) -> JSONResponse:
    fields = {
        str(i): ".".join(map(str, e["loc"])) + ": " + e["msg"]
        for i, e in enumerate(exception.errors())
    }
    code = 400 if request.url.path.startswith("/v1/") else 422
    return error_response(code, "Check the request parameters.", fields)


async def serving_error(request: Request, exception: ServingDataError) -> JSONResponse:
    return error_response(exception.status_code, str(exception))
