from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import Request
from fastapi.responses import JSONResponse, Response

from backend.app.auth import _query_user_by_username, _verify_token_and_extract_username, normalize_role
from backend.app.settings import get_settings


QC_WORKSPACE_PREFIXES = (
    "/api/main-survey/callbacks",
    "/api/main-survey/audio-listening",
)
SUPPORT_PREFIXES = (
    "/api/auth/",
    "/api/main-survey/surveycto-session",
)


def inicio_qc_route_allowed(path: str) -> bool:
    normalized_path = str(path or "")
    if any(normalized_path.startswith(prefix) for prefix in (*QC_WORKSPACE_PREFIXES, *SUPPORT_PREFIXES)):
        return True
    # Final decisions use existing case-status routes. Their service wrappers
    # independently verify that every target case belongs to this INICIO-QC user.
    if normalized_path == "/api/main-survey/cases/bulk-status":
        return True
    if normalized_path.startswith("/api/main-survey/cases/") and normalized_path.endswith("/status"):
        return True
    return False


async def enforce_inicio_qc_route_scope(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    authorization = request.headers.get("authorization") or ""
    if authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        username = _verify_token_and_extract_username(token)
        if username:
            settings = get_settings()
            row = _query_user_by_username(settings, username)
            if row and normalize_role(row.get("role")) == "INICIO-QC" and not inicio_qc_route_allowed(request.url.path):
                return JSONResponse(
                    status_code=403,
                    content={
                        "detail": "INICIO-QC access is limited to assigned Respondent Recontact and Silent Listening cases."
                    },
                )
    return await call_next(request)
