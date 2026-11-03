from __future__ import annotations

from threading import RLock
from typing import Any

from fastapi import HTTPException

from backend.app.auth import AuthUser, normalize_role
from backend.app.database import db_connection
from backend.app.settings import Settings
from backend.app.services import main_survey_cases as _core


QC_ROLES = {"PDM-QC", "INICIO-QC"}
ASSIGNMENT_MANAGER_ROLES = {"SUPERADMIN", "PDM-ADMIN", "INICIO-ADMIN"}
FULL_QC_QUEUE_VISIBILITY_ROLES = {"SUPERADMIN", "PDM-ADMIN"}
_ASSIGNABLE_ROLES: dict[str, set[str]] = {
    "SUPERADMIN": {"PDM-QC", "INICIO-QC"},
    "PDM-ADMIN": {"PDM-QC"},
    "INICIO-ADMIN": {"INICIO-QC"},
}

_BOOTSTRAP_LOCK = RLock()
_BOOTSTRAPPED_DATABASES: set[str] = set()

# Stable references captured before install_qc_assignment_scope() replaces the
# service functions imported by the existing API router.
_ORIGINAL = {
    "list_callbacks": _core.list_callbacks,
    "create_callback": _core.create_callback,
    "bulk_push_to_callback": _core.bulk_push_to_callback,
    "get_callback_case_detail": _core.get_callback_case_detail,
    "get_or_create_verification_questions": _core.get_or_create_verification_questions,
    "save_verification_response": _core.save_verification_response,
    "save_accompaniment_verification": _core.save_accompaniment_verification,
    "record_callback_outcome": _core.record_callback_outcome,
    "unassign_callback": _core.unassign_callback,
    "bulk_unassign_callbacks": _core.bulk_unassign_callbacks,
    "list_audio_listening": _core.list_audio_listening,
    "assign_audio_review": _core.assign_audio_review,
    "submit_audio_review": _core.submit_audio_review,
    "get_audio_review_detail": _core.get_audio_review_detail,
    "get_audio_review_case_detail": _core.get_audio_review_case_detail,
    "unassign_audio_review": _core.unassign_audio_review,
    "bulk_unassign_audio_reviews": _core.bulk_unassign_audio_reviews,
}


def _role(value: str | None) -> str:
    return normalize_role(value)


def assignment_roles_for_actor(role: str | None) -> set[str]:
    return set(_ASSIGNABLE_ROLES.get(_role(role), set()))


def can_manage_qc_assignments(role: str | None) -> bool:
    return bool(assignment_roles_for_actor(role))


def assignment_visible_to_actor(
    actor_role: str | None,
    actor_user_id: str | None,
    assigned_role: str | None,
    assigned_user_id: str | None,
) -> bool:
    """Return whether an assignment is visible under the agreed QC matrix."""
    role = _role(actor_role)
    assignee_role = _role(assigned_role)
    actor_id = str(actor_user_id or "").strip()
    assignee_id = str(assigned_user_id or "").strip()

    if role in FULL_QC_QUEUE_VISIBILITY_ROLES:
        return True
    if role == "INICIO-ADMIN":
        return assignee_role == "INICIO-QC" and bool(assignee_id)
    if role in QC_ROLES:
        return assignee_role == role and bool(actor_id) and actor_id == assignee_id
    return False


def _database_key(settings: Settings) -> str:
    return str(settings.database_url or "default")


def _table_exists(cur: Any, qualified_name: str) -> bool:
    cur.execute("SELECT to_regclass(%s) IS NOT NULL AS exists", (qualified_name,))
    return bool((cur.fetchone() or {}).get("exists"))


def bootstrap_qc_assignment_scope(settings: Settings) -> None:
    """Register INICIO-QC and add role metadata to both QC assignment queues."""
    if not settings.database_url:
        return

    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO app.role (role_code, role_name)
                VALUES ('INICIO-QC', 'INICIO-QC')
                ON CONFLICT (role_code) DO NOTHING
                """
            )

            if _table_exists(cur, "qc.callback_outcome"):
                cur.execute("ALTER TABLE qc.callback_outcome ADD COLUMN IF NOT EXISTS assigned_to_role text")
                cur.execute(
                    """
                    UPDATE qc.callback_outcome co
                    SET assigned_to_role = COALESCE(
                        (
                            SELECT ur.role_code
                            FROM app.user_role ur
                            WHERE ur.user_id = co.assigned_to_user_id
                              AND ur.role_code IN ('PDM-QC', 'INICIO-QC')
                            ORDER BY CASE ur.role_code WHEN 'INICIO-QC' THEN 0 ELSE 1 END
                            LIMIT 1
                        ),
                        'PDM-QC'
                    )
                    WHERE co.assigned_to_user_id IS NOT NULL
                      AND NULLIF(TRIM(COALESCE(co.assigned_to_role, '')), '') IS NULL
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_callback_outcome_assignment_scope
                    ON qc.callback_outcome (assigned_to_role, assigned_to_user_id, case_id)
                    """
                )

            if _table_exists(cur, "clean.audio_listening"):
                cur.execute("ALTER TABLE clean.audio_listening ADD COLUMN IF NOT EXISTS assigned_to_role text")
                cur.execute(
                    """
                    UPDATE clean.audio_listening al
                    SET assigned_to_role = COALESCE(
                        (
                            SELECT ur.role_code
                            FROM app.user_account ua
                            JOIN app.user_role ur USING (user_id)
                            WHERE ua.user_id::text = al.assigned_to_user_id
                              AND ur.role_code IN ('PDM-QC', 'INICIO-QC')
                            ORDER BY CASE ur.role_code WHEN 'INICIO-QC' THEN 0 ELSE 1 END
                            LIMIT 1
                        ),
                        'PDM-QC'
                    )
                    WHERE NULLIF(TRIM(COALESCE(al.assigned_to_user_id, '')), '') IS NOT NULL
                      AND NULLIF(TRIM(COALESCE(al.assigned_to_role, '')), '') IS NULL
                    """
                )
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS idx_audio_listening_assignment_scope
                    ON clean.audio_listening (assigned_to_role, assigned_to_user_id, case_id)
                    """
                )
        conn.commit()

    with _BOOTSTRAP_LOCK:
        _BOOTSTRAPPED_DATABASES.add(_database_key(settings))


def _ensure_bootstrapped(settings: Settings) -> None:
    if not settings.database_url:
        return
    key = _database_key(settings)
    if key in _BOOTSTRAPPED_DATABASES:
        return
    with _BOOTSTRAP_LOCK:
        if key not in _BOOTSTRAPPED_DATABASES:
            bootstrap_qc_assignment_scope(settings)


def _assert_assignment_manager(user: AuthUser) -> set[str]:
    allowed = assignment_roles_for_actor(user.role)
    if not allowed:
        raise HTTPException(status_code=403, detail="You do not have permission to assign QC cases.")
    return allowed


def _normalize_assignment_role(user: AuthUser, value: str | None) -> str:
    role = _role(value)
    allowed = _assert_assignment_manager(user)
    if role not in QC_ROLES:
        raise HTTPException(status_code=400, detail="Select either PDM-QC or INICIO-QC as the assignment role.")
    if role not in allowed:
        raise HTTPException(status_code=403, detail=f"Your account cannot assign cases to {role}.")
    return role


def _validate_assignee(settings: Settings, user_id: str | None, role: str) -> str:
    target_id = str(user_id or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail=f"Select an active {role} user before assigning cases.")
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT 1
                FROM app.user_account ua
                JOIN app.user_role ur USING (user_id)
                WHERE ua.user_id = %s::uuid
                  AND ua.is_active = true
                  AND ur.role_code = %s
                LIMIT 1
                """,
                (target_id, role),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=400, detail=f"Cases can only be assigned to an active {role} user.")
    return target_id


def _restricted_callback_ids(settings: Settings, user: AuthUser) -> tuple[set[str], set[str]]:
    role = _role(user.role)
    if role in FULL_QC_QUEUE_VISIBILITY_ROLES:
        return set(), set()
    if role == "INICIO-ADMIN":
        clause = "assigned_to_role = 'INICIO-QC' AND assigned_to_user_id IS NOT NULL"
        params: tuple[Any, ...] = ()
    elif role in QC_ROLES:
        clause = "assigned_to_role = %s AND assigned_to_user_id = %s::uuid"
        params = (role, user.id)
    else:
        return set(), set()

    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                WITH latest AS (
                    SELECT DISTINCT ON (case_id)
                        callback_id::text AS callback_id,
                        case_id,
                        assigned_to_role,
                        assigned_to_user_id
                    FROM qc.callback_outcome
                    ORDER BY case_id, attempt_no DESC, created_at DESC NULLS LAST
                )
                SELECT callback_id, case_id FROM latest WHERE {clause}
                """,
                params,
            )
            visible_case_ids = {str(row["case_id"]) for row in cur.fetchall()}
            cur.execute(
                f"SELECT callback_id::text AS callback_id FROM qc.callback_outcome WHERE {clause}",
                params,
            )
            visible_callback_ids = {str(row["callback_id"]) for row in cur.fetchall()}
    return visible_case_ids, visible_callback_ids


def list_callbacks_scoped(settings: Settings, user: AuthUser) -> list[dict[str, Any]]:
    _ensure_bootstrapped(settings)
    items = _ORIGINAL["list_callbacks"](settings, user)
    if _role(user.role) in FULL_QC_QUEUE_VISIBILITY_ROLES:
        return items

    case_ids, callback_ids = _restricted_callback_ids(settings, user)
    result: list[dict[str, Any]] = []
    for raw in items:
        item = dict(raw)
        if str(item.get("case_id") or "") not in case_ids:
            continue
        item["callback_history"] = [
            attempt for attempt in (item.get("callback_history") or [])
            if str(attempt.get("callback_id") or "") in callback_ids
        ]
        result.append(item)
    return result


def _latest_callback_assignment(settings: Settings, identifier: str) -> dict[str, Any] | None:
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            case_id = _core._resolve_main_case_id(cur, identifier) or identifier
            cur.execute(
                """
                SELECT callback_id::text AS callback_id, case_id,
                       assigned_to_user_id::text AS assigned_to_user_id,
                       assigned_to_role, outcome_code, attempt_no
                FROM qc.callback_outcome
                WHERE case_id = %s
                ORDER BY attempt_no DESC, created_at DESC NULLS LAST
                LIMIT 1
                """,
                (case_id,),
            )
            return cur.fetchone()


def _assert_callback_case_access(settings: Settings, user: AuthUser, case_id: str) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    row = _latest_callback_assignment(settings, case_id)
    if not row or not assignment_visible_to_actor(
        user.role, user.id, row.get("assigned_to_role"), row.get("assigned_to_user_id")
    ):
        raise HTTPException(status_code=404, detail="Recontact case not found.")
    return row


def _assert_callback_record_access(settings: Settings, user: AuthUser, callback_id: str) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT callback_id::text AS callback_id, case_id,
                       assigned_to_user_id::text AS assigned_to_user_id, assigned_to_role, outcome_code
                FROM qc.callback_outcome
                WHERE callback_id = %s::uuid
                """,
                (callback_id,),
            )
            row = cur.fetchone()
    if not row or not assignment_visible_to_actor(
        user.role, user.id, row.get("assigned_to_role"), row.get("assigned_to_user_id")
    ):
        raise HTTPException(status_code=404, detail="Recontact assignment not found.")
    return row


def _scoped_callback_history(settings: Settings, user: AuthUser, case_id: str) -> list[dict[str, Any]]:
    role = _role(user.role)
    params: list[Any] = [case_id]
    clause = ""
    if role == "INICIO-ADMIN":
        clause = "AND co.assigned_to_role = 'INICIO-QC' AND co.assigned_to_user_id IS NOT NULL"
    elif role in QC_ROLES:
        clause = "AND co.assigned_to_role = %s AND co.assigned_to_user_id = %s::uuid"
        params.extend([role, user.id])

    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT co.callback_id::text AS callback_id, co.attempt_no, co.outcome_code,
                       co.outcome_note, co.sampled_flag,
                       co.assigned_to_user_id::text AS assigned_to_user_id,
                       COALESCE(NULLIF(TRIM(ua.full_name), ''), NULLIF(TRIM(ua.username), '')) AS assigned_to_username,
                       co.completed_at, co.created_at
                FROM qc.callback_outcome co
                LEFT JOIN app.user_account ua ON ua.user_id = co.assigned_to_user_id
                WHERE co.case_id = %s {clause}
                ORDER BY co.attempt_no ASC, co.created_at ASC
                """,
                tuple(params),
            )
            return [dict(row) for row in cur.fetchall()]


def get_callback_case_detail_scoped(settings: Settings, user: AuthUser, case_id: str) -> dict[str, Any]:
    assignment = _assert_callback_case_access(settings, user, case_id)
    payload = _ORIGINAL["get_callback_case_detail"](settings, user, case_id)
    if _role(user.role) not in FULL_QC_QUEUE_VISIBILITY_ROLES:
        payload = dict(payload)
        payload["callback_history"] = _scoped_callback_history(settings, user, str(assignment["case_id"]))
    return payload


def create_callback_scoped(settings: Settings, user: AuthUser, case_id: str, sampled_flag: bool = False) -> dict[str, Any]:
    # This legacy endpoint has no target QC user. Reviewers must never be able to
    # claim arbitrary cases through it; role-aware assignment uses the bulk route.
    if _role(user.role) not in {"SUPERADMIN", "PDM-ADMIN"}:
        raise HTTPException(status_code=403, detail="Use the QC assignment action to push recontact cases.")
    return _ORIGINAL["create_callback"](settings, user, case_id, sampled_flag)


def bulk_push_to_callback_scoped(
    settings: Settings,
    user: AuthUser,
    submission_keys: list[str],
    assigned_to_role: str | None = None,
    assigned_to_user_id: str | None = None,
) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    if not submission_keys:
        raise HTTPException(status_code=400, detail="No submission keys provided.")
    if len(submission_keys) > 200:
        raise HTTPException(status_code=400, detail="Bulk limit is 200 cases per request.")

    target_role = _normalize_assignment_role(user, assigned_to_role)
    target_user_id = _validate_assignee(settings, assigned_to_user_id, target_role)
    keys = list(dict.fromkeys(str(key or "").strip() for key in submission_keys if str(key or "").strip()))
    created = 0
    already_flagged = 0
    not_found: list[str] = []
    touched_case_ids: list[str] = []

    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            for submission_key in keys:
                cur.execute(
                    "SELECT case_id FROM clean.main_case WHERE submission_key = %s",
                    (submission_key,),
                )
                case_row = cur.fetchone()
                if not case_row:
                    not_found.append(submission_key)
                    continue
                case_id = str(case_row["case_id"])
                touched_case_ids.append(case_id)
                cur.execute(
                    "UPDATE clean.main_case SET is_callback_required = true, updated_at = now() WHERE submission_key = %s",
                    (submission_key,),
                )
                cur.execute(
                    """
                    SELECT callback_id::text AS callback_id
                    FROM qc.callback_outcome
                    WHERE case_id = %s AND COALESCE(outcome_code, 'pending') = 'pending'
                    ORDER BY attempt_no DESC, created_at DESC NULLS LAST
                    LIMIT 1
                    """,
                    (case_id,),
                )
                existing = cur.fetchone()
                if existing:
                    cur.execute(
                        """
                        UPDATE qc.callback_outcome
                        SET assigned_to_user_id = %s::uuid, assigned_to_role = %s, updated_at = now()
                        WHERE callback_id = %s::uuid
                        """,
                        (target_user_id, target_role, existing["callback_id"]),
                    )
                    already_flagged += 1
                else:
                    cur.execute(
                        "SELECT COALESCE(MAX(attempt_no), 0) + 1 AS next_no FROM qc.callback_outcome WHERE case_id = %s",
                        (case_id,),
                    )
                    next_no = int((cur.fetchone() or {}).get("next_no") or 1)
                    cur.execute(
                        """
                        INSERT INTO qc.callback_outcome (
                            case_id, sampled_flag, attempt_no, outcome_code,
                            assigned_to_user_id, assigned_to_role, created_at, updated_at
                        ) VALUES (%s, false, %s, 'pending', %s::uuid, %s, now(), now())
                        """,
                        (case_id, next_no, target_user_id, target_role),
                    )
                    created += 1
            if touched_case_ids:
                _core._sync_main_case_queue_rows(cur, touched_case_ids)
        conn.commit()

    _core._clear_main_case_list_cache()
    return {
        "created": created,
        "alreadyFlagged": already_flagged,
        "notFound": not_found,
        "assigned_to_role": target_role,
        "assigned_to_user_id": target_user_id,
    }


def get_or_create_verification_questions_scoped(settings: Settings, user: AuthUser, case_id: str, mode: str = "qc") -> Any:
    _assert_callback_case_access(settings, user, case_id)
    return _ORIGINAL["get_or_create_verification_questions"](settings, user, case_id, mode)


def save_verification_response_scoped(
    settings: Settings,
    user: AuthUser,
    case_id: str,
    position: int,
    callback_answer: str,
    is_correct: bool,
) -> Any:
    _assert_callback_case_access(settings, user, case_id)
    return _ORIGINAL["save_verification_response"](settings, user, case_id, position, callback_answer, is_correct)


def save_accompaniment_verification_scoped(
    settings: Settings,
    user: AuthUser,
    review_context: str,
    case_id: str,
    submission_key: str | None,
    verification_status: str,
    verification_note: str | None,
) -> Any:
    context = str(review_context or "").strip().lower()
    if context == "callback":
        _assert_callback_case_access(settings, user, case_id)
    elif context == "audio":
        _assert_audio_case_access(settings, user, case_id)
    return _ORIGINAL["save_accompaniment_verification"](
        settings, user, review_context, case_id, submission_key, verification_status, verification_note
    )


def record_callback_outcome_scoped(
    settings: Settings,
    user: AuthUser,
    callback_id: str,
    outcome_code: str,
    outcome_note: str | None = None,
) -> dict[str, Any]:
    row = _assert_callback_record_access(settings, user, callback_id)
    if _role(user.role) != "INICIO-ADMIN":
        return _ORIGINAL["record_callback_outcome"](settings, user, callback_id, outcome_code, outcome_note)

    outcome = str(outcome_code or "").strip().lower()
    if outcome not in set(_core.CALLBACK_OUTCOME_CODES):
        raise HTTPException(status_code=400, detail=f"Unsupported callback outcome '{outcome_code}'.")
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE qc.callback_outcome
                SET outcome_code = %s, outcome_note = %s,
                    completed_by_user_id = %s::uuid,
                    completed_at = CASE WHEN %s = 'pending' THEN NULL ELSE now() END,
                    updated_at = now()
                WHERE callback_id = %s::uuid
                RETURNING callback_id::text AS callback_id, case_id, outcome_code,
                          outcome_note, completed_at, updated_at
                """,
                (outcome, outcome_note, user.id, outcome, callback_id),
            )
            updated = cur.fetchone()
            if not updated:
                raise HTTPException(status_code=404, detail="Recontact assignment not found.")
            _core._sync_main_case_queue_rows(cur, [str(row["case_id"])])
        conn.commit()
    _core._clear_main_case_list_cache()
    return dict(updated)


def _assert_unassign_scope(user: AuthUser, assigned_role: str | None) -> None:
    allowed = _assert_assignment_manager(user)
    if _role(user.role) == "SUPERADMIN":
        return
    if _role(assigned_role) not in allowed:
        raise HTTPException(status_code=403, detail="You cannot retrieve cases assigned to another QC role.")


def unassign_callback_scoped(settings: Settings, user: AuthUser, case_id: str) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    row = _latest_callback_assignment(settings, case_id)
    if not row:
        raise HTTPException(status_code=404, detail="Recontact case not found.")
    _assert_unassign_scope(user, row.get("assigned_to_role"))
    return _ORIGINAL["unassign_callback"](settings, user, str(row["case_id"]))


def bulk_unassign_callbacks_scoped(settings: Settings, user: AuthUser, submission_keys: list[str]) -> dict[str, Any]:
    if not submission_keys:
        raise HTTPException(status_code=400, detail="No submission keys provided.")
    _assert_assignment_manager(user)
    unassigned = 0
    not_found: list[str] = []
    keys = dict.fromkeys(str(value or "").strip() for value in submission_keys if str(value or "").strip())
    for key in keys:
        row = _latest_callback_assignment(settings, key)
        if not row:
            not_found.append(key)
            continue
        _assert_unassign_scope(user, row.get("assigned_to_role"))
        result = _ORIGINAL["unassign_callback"](settings, user, str(row["case_id"]))
        unassigned += int(result.get("unassigned") or 0)
    return {"unassigned": unassigned, "notFound": not_found}


def _visible_audio_ids(settings: Settings, user: AuthUser) -> set[str]:
    role = _role(user.role)
    if role in FULL_QC_QUEUE_VISIBILITY_ROLES:
        return set()
    if role == "INICIO-ADMIN":
        clause = "assigned_to_role = 'INICIO-QC' AND NULLIF(TRIM(COALESCE(assigned_to_user_id, '')), '') IS NOT NULL"
        params: tuple[Any, ...] = ()
    elif role in QC_ROLES:
        clause = "assigned_to_role = %s AND assigned_to_user_id = %s"
        params = (role, str(user.id))
    else:
        return set()
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(f"SELECT audio_id::text AS audio_id FROM clean.audio_listening WHERE {clause}", params)
            return {str(row["audio_id"]) for row in cur.fetchall()}


def list_audio_listening_scoped(settings: Settings, user: AuthUser) -> list[dict[str, Any]]:
    _ensure_bootstrapped(settings)
    items = _ORIGINAL["list_audio_listening"](settings, user)
    if _role(user.role) in FULL_QC_QUEUE_VISIBILITY_ROLES:
        return items
    allowed_ids = _visible_audio_ids(settings, user)
    return [dict(item) for item in items if str(item.get("audio_id") or "") in allowed_ids]


def _audio_assignment(settings: Settings, audio_id: str) -> dict[str, Any] | None:
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT audio_id::text AS audio_id, case_id, assigned_to_user_id, assigned_to_role, status
                FROM clean.audio_listening WHERE audio_id = %s::uuid
                """,
                (audio_id,),
            )
            return cur.fetchone()


def _assert_audio_access(settings: Settings, user: AuthUser, audio_id: str) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    row = _audio_assignment(settings, audio_id)
    if not row or not assignment_visible_to_actor(
        user.role, user.id, row.get("assigned_to_role"), row.get("assigned_to_user_id")
    ):
        raise HTTPException(status_code=404, detail="Silent listening assignment not found.")
    return row


def _visible_audio_for_case(settings: Settings, user: AuthUser, case_id: str) -> dict[str, Any] | None:
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            resolved = _core._resolve_main_case_id(cur, case_id) or case_id
            cur.execute(
                """
                SELECT audio_id::text AS audio_id, case_id, assigned_to_user_id,
                       assigned_to_role, status, created_at
                FROM clean.audio_listening
                WHERE case_id = %s
                ORDER BY CASE COALESCE(NULLIF(TRIM(status), ''), 'pending') WHEN 'pending' THEN 0 ELSE 1 END,
                         created_at DESC NULLS LAST
                """,
                (resolved,),
            )
            for row in cur.fetchall():
                if assignment_visible_to_actor(
                    user.role, user.id, row.get("assigned_to_role"), row.get("assigned_to_user_id")
                ):
                    return row
    return None


def _assert_audio_case_access(settings: Settings, user: AuthUser, case_id: str) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    row = _visible_audio_for_case(settings, user, case_id)
    if not row:
        raise HTTPException(status_code=404, detail="Silent listening case not found.")
    return row


def assign_audio_review_scoped(
    settings: Settings,
    user: AuthUser,
    case_id: str,
    assigned_to_role: str | None = None,
    assigned_to_user_id: str | None = None,
) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    target_role = _normalize_assignment_role(user, assigned_to_role)
    target_user_id = _validate_assignee(settings, assigned_to_user_id, target_role)
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            resolved_case_id = _core._resolve_main_case_id(cur, case_id)
            if not resolved_case_id:
                raise HTTPException(status_code=404, detail="Case not found.")
            cur.execute(
                """
                SELECT audio_id::text AS audio_id, assigned_to_user_id, assigned_to_role
                FROM clean.audio_listening
                WHERE case_id = %s AND COALESCE(status, 'pending') = 'pending'
                ORDER BY created_at DESC NULLS LAST LIMIT 1
                """,
                (resolved_case_id,),
            )
            existing = cur.fetchone()
            if existing:
                same = (
                    str(existing.get("assigned_to_user_id") or "") == target_user_id
                    and _role(existing.get("assigned_to_role")) == target_role
                )
                if not same:
                    cur.execute(
                        """
                        UPDATE clean.audio_listening
                        SET assigned_to_user_id = %s, assigned_to_role = %s,
                            status = 'pending', reviewed_at = NULL
                        WHERE audio_id = %s::uuid
                        """,
                        (target_user_id, target_role, existing["audio_id"]),
                    )
                audio_id = str(existing["audio_id"])
                already_assigned = same
            else:
                cur.execute(
                    """
                    INSERT INTO clean.audio_listening (
                        case_id, assigned_to_user_id, assigned_to_role, status, created_at
                    ) VALUES (%s, %s, %s, 'pending', now())
                    RETURNING audio_id::text AS audio_id
                    """,
                    (resolved_case_id, target_user_id, target_role),
                )
                audio_id = str((cur.fetchone() or {}).get("audio_id") or "")
                already_assigned = False
            _core._sync_main_case_queue_rows(cur, [resolved_case_id])
        conn.commit()
    _core._clear_main_case_list_cache()
    return {
        "audio_id": audio_id,
        "case_id": resolved_case_id,
        "assigned_to_user_id": target_user_id,
        "assigned_to_role": target_role,
        "already_assigned": already_assigned,
    }


def get_audio_review_detail_scoped(settings: Settings, user: AuthUser, audio_id: str) -> dict[str, Any]:
    _assert_audio_access(settings, user, audio_id)
    return _ORIGINAL["get_audio_review_detail"](settings, user, audio_id)


def get_audio_review_case_detail_scoped(settings: Settings, user: AuthUser, case_id: str) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    if _role(user.role) in FULL_QC_QUEUE_VISIBILITY_ROLES:
        return _ORIGINAL["get_audio_review_case_detail"](settings, user, case_id)
    row = _assert_audio_case_access(settings, user, case_id)
    return _ORIGINAL["get_audio_review_detail"](settings, user, str(row["audio_id"]))


def submit_audio_review_scoped(
    settings: Settings,
    user: AuthUser,
    audio_id: str,
    quality_rating: str,
    reviewer_note: str | None,
) -> dict[str, Any]:
    row = _assert_audio_access(settings, user, audio_id)
    if _role(user.role) != "INICIO-ADMIN":
        return _ORIGINAL["submit_audio_review"](settings, user, audio_id, quality_rating, reviewer_note)
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE clean.audio_listening
                SET quality_rating = %s, reviewer_note = %s,
                    status = 'reviewed', reviewed_at = now()
                WHERE audio_id = %s::uuid
                RETURNING audio_id::text AS audio_id
                """,
                (quality_rating, reviewer_note, audio_id),
            )
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Silent listening assignment not found.")
            _core._sync_main_case_queue_rows(cur, [str(row["case_id"])])
        conn.commit()
    _core._clear_main_case_list_cache()
    return {"audio_id": audio_id, "status": "reviewed", "quality_rating": quality_rating}


def unassign_audio_review_scoped(settings: Settings, user: AuthUser, audio_id: str) -> dict[str, Any]:
    _ensure_bootstrapped(settings)
    row = _audio_assignment(settings, audio_id)
    if not row:
        raise HTTPException(status_code=404, detail="Silent listening assignment not found.")
    _assert_unassign_scope(user, row.get("assigned_to_role"))
    return _ORIGINAL["unassign_audio_review"](settings, user, audio_id)


def bulk_unassign_audio_reviews_scoped(settings: Settings, user: AuthUser, submission_keys: list[str]) -> dict[str, Any]:
    if not submission_keys:
        raise HTTPException(status_code=400, detail="No submission keys provided.")
    _assert_assignment_manager(user)
    unassigned = 0
    not_found: list[str] = []
    keys = dict.fromkeys(str(value or "").strip() for value in submission_keys if str(value or "").strip())
    for key in keys:
        with db_connection(settings) as conn:
            with conn.cursor() as cur:
                resolved = _core._resolve_main_case_id(cur, key)
                if not resolved:
                    not_found.append(key)
                    continue
                cur.execute(
                    """
                    SELECT audio_id::text AS audio_id, assigned_to_role
                    FROM clean.audio_listening
                    WHERE case_id = %s AND COALESCE(status, 'pending') = 'pending'
                    ORDER BY created_at DESC NULLS LAST LIMIT 1
                    """,
                    (resolved,),
                )
                row = cur.fetchone()
        if not row:
            not_found.append(key)
            continue
        _assert_unassign_scope(user, row.get("assigned_to_role"))
        result = _ORIGINAL["unassign_audio_review"](settings, user, str(row["audio_id"]))
        if result.get("unassigned") or result.get("status") == "pending":
            unassigned += 1
    return {"unassigned": unassigned, "notFound": not_found}


def install_qc_assignment_scope() -> None:
    """Install scoped implementations before the FastAPI case router imports them."""
    replacements = {
        "list_callbacks": list_callbacks_scoped,
        "create_callback": create_callback_scoped,
        "bulk_push_to_callback": bulk_push_to_callback_scoped,
        "get_callback_case_detail": get_callback_case_detail_scoped,
        "get_or_create_verification_questions": get_or_create_verification_questions_scoped,
        "save_verification_response": save_verification_response_scoped,
        "save_accompaniment_verification": save_accompaniment_verification_scoped,
        "record_callback_outcome": record_callback_outcome_scoped,
        "unassign_callback": unassign_callback_scoped,
        "bulk_unassign_callbacks": bulk_unassign_callbacks_scoped,
        "list_audio_listening": list_audio_listening_scoped,
        "assign_audio_review": assign_audio_review_scoped,
        "submit_audio_review": submit_audio_review_scoped,
        "get_audio_review_detail": get_audio_review_detail_scoped,
        "get_audio_review_case_detail": get_audio_review_case_detail_scoped,
        "unassign_audio_review": unassign_audio_review_scoped,
        "bulk_unassign_audio_reviews": bulk_unassign_audio_reviews_scoped,
    }
    for name, implementation in replacements.items():
        setattr(_core, name, implementation)
