from __future__ import annotations

import hashlib
import hmac
import secrets
from contextvars import ContextVar
from dataclasses import dataclass

import bcrypt
from fastapi import Depends, Header, HTTPException, Request, status

from backend.app.settings import Settings, get_settings


@dataclass(slots=True)
class AuthUser:
    id: str
    username: str
    role: str
    full_name: str
    email: str


APP_ROLES = {"SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN", "PDM-QC"}
SUPERADMIN_ROLE = "SUPERADMIN"
EDIT_ROLES = set(APP_ROLES)
FINAL_APPROVER_ROLES = set(APP_ROLES)
AUDIO_ADMIN_ROLES = {"SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN"}
ROLE_ALIASES = {
    "admin": "SUPERADMIN",
    "data_engineer": "PDM-ADMIN",
    "qc_reviewer": "PDM-QC",
    "supervisor": "PDM-ADMIN",
    "client": "INICIO-ADMIN",
    "INICIO-PM": "INICIO-ADMIN",
    "PDM-PM": "PDM-ADMIN",
}

_CURRENT_REQUEST_USER: ContextVar[AuthUser | None] = ContextVar("current_request_user", default=None)
_CURRENT_REQUEST_PATH: ContextVar[str] = ContextVar("current_request_path", default="")


def current_request_user() -> AuthUser | None:
    return _CURRENT_REQUEST_USER.get()


def current_request_path() -> str:
    return _CURRENT_REQUEST_PATH.get()


def normalize_role(role: str | None) -> str:
    raw = str(role or "").strip()
    return ROLE_ALIASES.get(raw, raw.upper())

TOKEN_SEPARATOR = "."
TOKEN_VERSION = "v1"
_TOKEN_SECRET = "inicio-dev-auth-secret"


_DEV_USERS: dict[str, dict[str, str]] = {
    "superadmin": {
        "id": "00000000-0000-0000-0000-000000000001",
        "username": "superadmin",
        "password_plain": "inicio2026",
        "full_name": "Superadmin",
        "email": "superadmin@inicio.local",
        "role": "SUPERADMIN",
    },
    "engineer": {
        "id": "00000000-0000-0000-0000-000000000002",
        "username": "engineer",
        "password_plain": "BHT-Eng!58",
        "full_name": "Data Engineer",
        "email": "engineer@example.local",
        "role": "PDM-ADMIN",
    },
    "qc": {
        "id": "00000000-0000-0000-0000-000000000003",
        "username": "qc",
        "password_plain": "BHT-QC!63",
        "full_name": "QC Reviewer",
        "email": "qc@example.local",
        "role": "PDM-QC",
    },
    "supervisor": {
        "id": "00000000-0000-0000-0000-000000000004",
        "username": "supervisor",
        "password_plain": "BHT-Sup!71",
        "full_name": "Supervisor",
        "email": "supervisor@example.local",
        "role": "PDM-ADMIN",
    },
    "client": {
        "id": "00000000-0000-0000-0000-000000000005",
        "username": "client",
        "password_plain": "BHT-Client!84",
        "full_name": "Client User",
        "email": "client@example.local",
        "role": "INICIO-ADMIN",
    },
}


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def _query_user_by_username(settings: Settings, username: str) -> dict | None:
    normalized_username = username.strip().lower()
    if not settings.database_url:
        return _DEV_USERS.get(normalized_username)

    from backend.app.database import db_connection
    try:
        with db_connection(settings) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT ua.user_id::text AS id, ua.username, ua.password_hash,
                           ua.full_name, ua.email, ur.role_code AS role
                    FROM app.user_account ua
                    JOIN app.user_role ur USING (user_id)
                    WHERE lower(ua.username) = lower(%s) AND ua.is_active = true
                    LIMIT 1
                    """,
                    (username,),
                )
                return cur.fetchone()
    except Exception:
        return None


def authenticate(settings: Settings, username: str, password: str) -> AuthUser | None:
    row = _query_user_by_username(settings, username)
    if not row:
        return None

    plain_password = row.get("password_plain")
    if plain_password is not None:
        if not hmac.compare_digest(password, plain_password):
            return None
    elif not row.get("password_hash") or not verify_password(password, row["password_hash"]):
        return None

    return AuthUser(
        id=row["id"],
        username=row["username"],
        full_name=row["full_name"],
        email=row["email"],
        role=normalize_role(row["role"]),
    )


def issue_token(user: AuthUser) -> str:
    nonce = secrets.token_urlsafe(12)
    payload = f"{TOKEN_VERSION}:{user.username}:{nonce}"
    signature = hmac.new(_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}{TOKEN_SEPARATOR}{signature}"


def _verify_token_and_extract_username(token: str) -> str | None:
    payload, separator, signature = token.rpartition(TOKEN_SEPARATOR)
    if not separator or not payload or not signature:
        return None
    expected = hmac.new(_TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        return None
    parts = payload.split(":", 2)
    if len(parts) < 3 or parts[0] != TOKEN_VERSION:
        return None
    return parts[1]


def serialize_user(user: AuthUser) -> dict[str, str]:
    return {
        "id": user.id,
        "username": user.username,
        "role": user.role,
        "fullName": user.full_name,
        "email": user.email,
    }


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required.",
    )


def _enforce_audio_reviewer_access(settings: Settings, user: AuthUser, request: Request) -> None:
    """Prevent PDM-QC reviewers from seeing or mutating another reviewer's audio work."""
    path = str(request.url.path).rstrip("/")
    if not path.startswith("/api/main-survey/audio-listening"):
        return

    role = normalize_role(user.role)
    if role in AUDIO_ADMIN_ROLES:
        return
    if role != "PDM-QC":
        return

    method = request.method.upper()
    assignment_actions = (
        path.endswith("/assign")
        or path.endswith("/bulk-assign")
        or path.endswith("/bulk-unassign")
        or path.endswith("/unassign")
    )
    if assignment_actions and method in {"POST", "PUT", "PATCH", "DELETE"}:
        raise HTTPException(status_code=403, detail="Only admins can manage Silent Listening assignments.")

    if path == "/api/main-survey/audio-listening":
        return

    from backend.app.database import db_connection

    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            case_marker = "/api/main-survey/audio-listening/cases/"
            if path.startswith(case_marker):
                identifier = path[len(case_marker):].split("/", 1)[0]
                cur.execute(
                    """
                    SELECT 1
                    FROM clean.audio_listening al
                    INNER JOIN clean.main_case mc ON mc.case_id = al.case_id
                    WHERE (mc.case_id = %s OR mc.submission_key = %s)
                      AND al.assigned_to_user_id = %s
                    LIMIT 1
                    """,
                    (identifier, identifier, str(user.id)),
                )
            else:
                suffix = path[len("/api/main-survey/audio-listening/"):]
                audio_id = suffix.split("/", 1)[0]
                if not audio_id or audio_id in {"assign", "bulk-assign", "bulk-unassign"}:
                    return
                cur.execute(
                    """
                    SELECT 1
                    FROM clean.audio_listening al
                    WHERE al.audio_id::text = %s
                      AND al.assigned_to_user_id = %s
                    LIMIT 1
                    """,
                    (audio_id, str(user.id)),
                )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Silent Listening case not found.")


def get_current_user(
    request: Request,
    authorization: str | None = Header(default=None),
    x_device_id: str | None = Header(default=None, alias="x-device-id"),
    settings: Settings = Depends(get_settings),
) -> AuthUser:
    if not authorization or not authorization.startswith("Bearer "):
        from backend.app.activity_log import infer_module_from_path, log_activity

        log_activity(
            settings,
            action="denied_access",
            module=infer_module_from_path(str(request.url.path)),
            username=None,
            role=None,
            status="failed",
            success=False,
            description="Authentication required.",
            entity_type="route",
            entity_id=str(request.url.path),
            metadata={"method": request.method, "reason": "missing_or_invalid_authorization_header"},
            request=request,
            device_id=x_device_id,
            error_message="Authentication required.",
        )
        raise _unauthorized()
    token = authorization.split(" ", 1)[1].strip()
    username = _verify_token_and_extract_username(token)
    if not username:
        from backend.app.activity_log import infer_module_from_path, log_activity

        log_activity(
            settings,
            action="denied_access",
            module=infer_module_from_path(str(request.url.path)),
            username=None,
            role=None,
            status="failed",
            success=False,
            description="Authentication failed because the bearer token is invalid.",
            entity_type="route",
            entity_id=str(request.url.path),
            metadata={"method": request.method, "reason": "invalid_token"},
            request=request,
            device_id=x_device_id,
            error_message="Invalid bearer token.",
        )
        raise _unauthorized()
    row = _query_user_by_username(settings, username)
    if not row:
        from backend.app.activity_log import infer_module_from_path, log_activity

        log_activity(
            settings,
            action="denied_access",
            module=infer_module_from_path(str(request.url.path)),
            username=username,
            role=None,
            status="failed",
            success=False,
            description="Authentication failed because the user account is unavailable.",
            entity_type="route",
            entity_id=str(request.url.path),
            metadata={"method": request.method, "reason": "user_not_found_or_inactive"},
            request=request,
            device_id=x_device_id,
            error_message="User not found or inactive.",
        )
        raise _unauthorized()
    current_user = AuthUser(
        id=row["id"],
        username=row["username"],
        full_name=row["full_name"],
        email=row["email"],
        role=normalize_role(row["role"]),
    )
    request.state.current_user = current_user
    _CURRENT_REQUEST_USER.set(current_user)
    _CURRENT_REQUEST_PATH.set(str(request.url.path))
    _enforce_audio_reviewer_access(settings, current_user, request)
    return current_user


def require_roles(*roles: str):
    normalized_roles = {normalize_role(role) for role in roles}

    def dependency(
        request: Request,
        x_device_id: str | None = Header(default=None, alias="x-device-id"),
        user: AuthUser = Depends(get_current_user),
        settings: Settings = Depends(get_settings),
    ) -> AuthUser:
        if normalized_roles and user.role not in normalized_roles:
            from backend.app.activity_log import infer_module_from_path, log_activity

            log_activity(
                settings,
                action="denied_access",
                module=infer_module_from_path(str(request.url.path)),
                user=user,
                status="failed",
                success=False,
                description="User attempted to access a restricted action without the required role.",
                entity_type="route",
                entity_id=str(request.url.path),
                before_value={"role": user.role},
                metadata={"method": request.method, "allowed_roles": sorted(normalized_roles)},
                request=request,
                device_id=x_device_id,
                error_message="You do not have permission for this action.",
            )
            raise HTTPException(status_code=403, detail="You do not have permission for this action.")
        return user

    return dependency
