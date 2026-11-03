from __future__ import annotations

from fastapi import HTTPException

from backend.app.auth import AuthUser, normalize_role
from backend.app.services import main_survey_cases as _core
from backend.app.services.qc_assignment_scope import (
    _assert_audio_case_access,
    _assert_callback_case_access,
)
from backend.app.settings import Settings


_ORIGINAL_UPDATE_STATUS = _core.update_main_case_status
_ORIGINAL_BULK_UPDATE_STATUS = _core.bulk_update_main_case_status


def _delegated_qc_user(user: AuthUser) -> AuthUser:
    """Reuse existing status logic without granting INICIO-QC platform-wide edit rights."""
    return AuthUser(
        id=user.id,
        username=user.username,
        role="PDM-QC",
        full_name=user.full_name,
        email=user.email,
    )


def _assert_inicio_qc_case_assignment(settings: Settings, user: AuthUser, identifier: str) -> None:
    callback_error: HTTPException | None = None
    try:
        _assert_callback_case_access(settings, user, identifier)
        return
    except HTTPException as exc:
        callback_error = exc
        if exc.status_code != 404:
            raise

    try:
        _assert_audio_case_access(settings, user, identifier)
        return
    except HTTPException as exc:
        if exc.status_code != 404:
            raise

    raise HTTPException(
        status_code=404,
        detail="Assigned QC case not found.",
    ) from callback_error


def update_main_case_status_scoped(
    settings: Settings,
    user: AuthUser,
    submission_key: str,
    new_status: str,
    note: str | None = None,
    device_id: str | None = None,
):
    if normalize_role(user.role) != "INICIO-QC":
        return _ORIGINAL_UPDATE_STATUS(settings, user, submission_key, new_status, note, device_id)

    if new_status not in _core.MAIN_FINAL_STATUSES:
        raise HTTPException(status_code=403, detail="INICIO-QC can only approve or reject assigned QC cases.")
    _assert_inicio_qc_case_assignment(settings, user, submission_key)
    return _ORIGINAL_UPDATE_STATUS(settings, _delegated_qc_user(user), submission_key, new_status, note, device_id)


def bulk_update_main_case_status_scoped(
    settings: Settings,
    user: AuthUser,
    submission_keys: list[str],
    new_status: str,
    note: str | None = None,
):
    if normalize_role(user.role) != "INICIO-QC":
        return _ORIGINAL_BULK_UPDATE_STATUS(settings, user, submission_keys, new_status, note)

    if new_status not in _core.MAIN_FINAL_STATUSES:
        raise HTTPException(status_code=403, detail="INICIO-QC can only approve or reject assigned QC cases.")
    for submission_key in dict.fromkeys(str(key or "").strip() for key in submission_keys if str(key or "").strip()):
        _assert_inicio_qc_case_assignment(settings, user, submission_key)
    return _ORIGINAL_BULK_UPDATE_STATUS(settings, _delegated_qc_user(user), submission_keys, new_status, note)


def install_qc_assignment_decision_scope() -> None:
    _core.update_main_case_status = update_main_case_status_scoped
    _core.bulk_update_main_case_status = bulk_update_main_case_status_scoped
