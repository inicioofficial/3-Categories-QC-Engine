from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.services import surveycto_credentials as credentials


def test_media_credentials_ignore_user_session_and_use_server_env() -> None:
    settings = SimpleNamespace(
        surveycto_username="render-user",
        surveycto_password="render-password",
    )
    credentials._SESSIONS["legacy-user-session"] = credentials.SurveyCtoCredentialSession(
        token="legacy-user-session",
        user_id="user-1",
        username="user-entered-name",
        password="user-entered-password",
        created_at=0.0,
        expires_at=999999999.0,
    )
    try:
        assert credentials.resolve_surveycto_credentials_for_media(
            settings,
            "legacy-user-session",
        ) == ("render-user", "render-password")
    finally:
        credentials._SESSIONS.pop("legacy-user-session", None)


def test_media_credentials_require_server_configuration() -> None:
    settings = SimpleNamespace(surveycto_username=None, surveycto_password=None)

    with pytest.raises(HTTPException) as exc_info:
        credentials.resolve_surveycto_credentials_for_media(settings)

    assert exc_info.value.status_code == 503
    assert "not configured on the server" in str(exc_info.value.detail)
