from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app import auth
from backend.app.auth import AuthUser
from backend.app.services import main_data_scope
from survey_platform.etl.category_forms import _media_type


def _user(role: str, user_id: str = "11111111-1111-1111-1111-111111111111") -> AuthUser:
    return AuthUser(
        id=user_id,
        username="reviewer",
        role=role,
        full_name="Reviewer",
        email="reviewer@example.com",
    )


def _settings():
    return SimpleNamespace(main_survey_formdef_version="", surveycto_main_form_id="")


def test_audio_list_scope_filters_pdm_qc_to_current_assignment(monkeypatch):
    reviewer = _user("PDM-QC")
    monkeypatch.setattr(main_data_scope, "active_workspace_form_id", lambda: None)
    monkeypatch.setattr(auth, "current_request_user", lambda: reviewer)
    monkeypatch.setattr(auth, "current_request_path", lambda: "/api/main-survey/audio-listening")

    clause, params = main_data_scope.main_case_scope_clause(_settings(), "mc")

    assert "clean.audio_listening" in clause
    assert "scoped_al.assigned_to_user_id = %s" in clause
    assert params == [reviewer.id]


def test_audio_list_scope_does_not_restrict_admin(monkeypatch):
    admin = _user("PDM-ADMIN")
    monkeypatch.setattr(main_data_scope, "active_workspace_form_id", lambda: None)
    monkeypatch.setattr(auth, "current_request_user", lambda: admin)
    monkeypatch.setattr(auth, "current_request_path", lambda: "/api/main-survey/audio-listening")

    clause, params = main_data_scope.main_case_scope_clause(_settings(), "mc")

    assert clause == ""
    assert params == []


def test_pdm_qc_cannot_manage_audio_assignments():
    request = SimpleNamespace(
        url=SimpleNamespace(path="/api/main-survey/audio-listening/assign"),
        method="POST",
    )

    with pytest.raises(HTTPException) as exc:
        auth._enforce_audio_reviewer_access(_settings(), _user("PDM-QC"), request)

    assert exc.value.status_code == 403


def test_admin_can_manage_audio_assignments():
    request = SimpleNamespace(
        url=SimpleNamespace(path="/api/main-survey/audio-listening/assign"),
        method="POST",
    )

    auth._enforce_audio_reviewer_access(_settings(), _user("INICIO-ADMIN"), request)


@pytest.mark.parametrize(
    "variable_name",
    [
        "audiorecord1",
        "audio_audit_b1",
        "audio_audit_CO_BAO1a",
        "audio_audit_SP_M1a",
        "audio_audit_SP_BAU5a",
        "audio_audit_SP_BAU7",
        "audio_audit_SP_R1a",
        "audio_audit_SP_BAR5a",
        "audio_audit_SP_BAR7",
        "audio_audit_EO_BAU1a",
        "audio_audit_EO_BAU5a",
        "audio_audit_EO_BAU7",
        "audio_audit_EO_BAR5a",
        "audio_audit_EO_BAR7",
        "audio_audit_bau1y",
        "audio_audit_SN_BAU5a",
        "audio_audit_SN_BAU7",
        "audio_audit_SN_RE1a",
        "audio_audit_SN_RE5a",
        "audio_audit_SN_2BAU7",
        "audio_audit_N_QC1",
    ],
)
def test_category_audio_variables_are_ingested_as_audio(variable_name):
    assert _media_type(variable_name, "example-recording.m4a") == "audio"
