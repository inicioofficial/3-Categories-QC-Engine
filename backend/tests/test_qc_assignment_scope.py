import pytest
from fastapi import HTTPException

from backend.app.auth import APP_ROLES, EDIT_ROLES, AuthUser
from backend.app.services.inicio_qc_route_scope import inicio_qc_route_allowed
from backend.app.services.qc_assignment_decision_scope import update_main_case_status_scoped
from backend.app.services.qc_assignment_scope import (
    assignment_roles_for_actor,
    assignment_visible_to_actor,
)


def test_inicio_qc_is_registered_platform_role_without_global_edit_rights():
    assert "INICIO-QC" in APP_ROLES
    assert "INICIO-QC" not in EDIT_ROLES


def test_inicio_qc_route_boundary_only_allows_qc_workspaces_and_scoped_decisions():
    assert inicio_qc_route_allowed("/api/auth/me")
    assert inicio_qc_route_allowed("/api/main-survey/callbacks")
    assert inicio_qc_route_allowed("/api/main-survey/callbacks/case-1/detail")
    assert inicio_qc_route_allowed("/api/main-survey/audio-listening")
    assert inicio_qc_route_allowed("/api/main-survey/audio-listening/cases/case-1/detail")
    assert inicio_qc_route_allowed("/api/main-survey/surveycto-session")
    assert inicio_qc_route_allowed("/api/main-survey/cases/bulk-status")
    assert inicio_qc_route_allowed("/api/main-survey/cases/submission-1/status")

    assert not inicio_qc_route_allowed("/api/main-survey/overview")
    assert not inicio_qc_route_allowed("/api/main-survey/cases")
    assert not inicio_qc_route_allowed("/api/main-survey/export")
    assert not inicio_qc_route_allowed("/api/admin/users")


def test_inicio_qc_status_wrapper_rejects_non_final_case_actions_before_data_access():
    user = AuthUser(
        id="00000000-0000-0000-0000-000000000201",
        username="inicio_qc",
        role="INICIO-QC",
        full_name="INICIO QC",
        email="inicio-qc@example.test",
    )
    with pytest.raises(HTTPException) as exc_info:
        update_main_case_status_scoped(None, user, "submission-1", "pending_review")  # type: ignore[arg-type]
    assert exc_info.value.status_code == 403


def test_assignment_role_matrix():
    assert assignment_roles_for_actor("SUPERADMIN") == {"PDM-QC", "INICIO-QC"}
    assert assignment_roles_for_actor("PDM-ADMIN") == {"PDM-QC"}
    assert assignment_roles_for_actor("INICIO-ADMIN") == {"INICIO-QC"}
    assert assignment_roles_for_actor("PDM-QC") == set()
    assert assignment_roles_for_actor("INICIO-QC") == set()


def test_pdm_qc_only_sees_own_pdm_assignment():
    actor_id = "00000000-0000-0000-0000-000000000101"
    other_id = "00000000-0000-0000-0000-000000000102"

    assert assignment_visible_to_actor("PDM-QC", actor_id, "PDM-QC", actor_id)
    assert not assignment_visible_to_actor("PDM-QC", actor_id, "PDM-QC", other_id)
    assert not assignment_visible_to_actor("PDM-QC", actor_id, "INICIO-QC", actor_id)
    assert not assignment_visible_to_actor("PDM-QC", actor_id, "PDM-QC", None)


def test_inicio_qc_only_sees_own_inicio_assignment():
    actor_id = "00000000-0000-0000-0000-000000000201"
    other_id = "00000000-0000-0000-0000-000000000202"

    assert assignment_visible_to_actor("INICIO-QC", actor_id, "INICIO-QC", actor_id)
    assert not assignment_visible_to_actor("INICIO-QC", actor_id, "INICIO-QC", other_id)
    assert not assignment_visible_to_actor("INICIO-QC", actor_id, "PDM-QC", actor_id)
    assert not assignment_visible_to_actor("INICIO-QC", actor_id, "INICIO-QC", None)


def test_inicio_admin_only_sees_assigned_inicio_qc_cases():
    inicio_qc_a = "00000000-0000-0000-0000-000000000301"
    inicio_qc_b = "00000000-0000-0000-0000-000000000302"

    assert assignment_visible_to_actor("INICIO-ADMIN", "admin", "INICIO-QC", inicio_qc_a)
    assert assignment_visible_to_actor("INICIO-ADMIN", "admin", "INICIO-QC", inicio_qc_b)
    assert not assignment_visible_to_actor("INICIO-ADMIN", "admin", "PDM-QC", inicio_qc_a)
    assert not assignment_visible_to_actor("INICIO-ADMIN", "admin", "INICIO-QC", None)


def test_superadmin_and_pdm_admin_keep_full_qc_queue_visibility():
    for role in ("SUPERADMIN", "PDM-ADMIN"):
        assert assignment_visible_to_actor(role, "admin", "PDM-QC", "reviewer-a")
        assert assignment_visible_to_actor(role, "admin", "INICIO-QC", "reviewer-b")
        assert assignment_visible_to_actor(role, "admin", None, None)
