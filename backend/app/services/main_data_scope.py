from __future__ import annotations

from typing import Any

from backend.app.settings import Settings
from backend.app.workspace_context import active_workspace_form_id


def main_data_formdef_versions(settings: Settings) -> list[str]:
    raw = str(settings.main_survey_formdef_version or "")
    # Preserve the configured order while ignoring whitespace, empty entries,
    # and duplicates so the value is safe to pass as a PostgreSQL text array.
    return list(dict.fromkeys(part.strip() for part in raw.split(",") if part.strip()))


def main_data_form_id(settings: Settings) -> str | None:
    workspace_form_id = active_workspace_form_id()
    if workspace_form_id:
        return workspace_form_id
    return str(settings.surveycto_main_form_id or "").strip() or None


def main_case_effective_datetime_sql(alias: str) -> str:
    def value_expr(field: str) -> str:
        return f"NULLIF(TRIM({alias}.record->>'{field}'), '')"

    candidates = [value_expr("starttime")]
    parsed = []
    for expr in candidates:
        parsed.extend(
            [
                f"CASE WHEN {expr} ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}' THEN {expr}::timestamptz ELSE NULL END",
                f"CASE WHEN {expr} ~ '^[A-Za-z]{{3}}\\s+\\d{{1,2}},\\s+\\d{{4}}\\s+\\d{{1,2}}:\\d{{2}}:\\d{{2}}\\s+(AM|PM)$' THEN to_timestamp({expr}, 'Mon DD, YYYY HH12:MI:SS AM') ELSE NULL END",
            ]
        )
    return "COALESCE(" + ", ".join(parsed) + ")"


def main_row_effective_datetime_sql(
    alias: str,
    *,
    start_column: str = "start_time",
    submitted_column: str = "submitted_at",
) -> str:
    prefix = f"{alias}." if alias else ""
    start_expr = f"NULLIF(TRIM({prefix}{start_column}), '')"
    return (
        "COALESCE("
        f"CASE WHEN {start_expr} ~ '^\\d{{4}}-\\d{{2}}-\\d{{2}}' THEN {start_expr}::timestamptz ELSE NULL END, "
        f"CASE WHEN {start_expr} ~ '^[A-Za-z]{{3}}\\s+\\d{{1,2}},\\s+\\d{{4}}\\s+\\d{{1,2}}:\\d{{2}}:\\d{{2}}\\s+(AM|PM)$' THEN to_timestamp({start_expr}, 'Mon DD, YYYY HH12:MI:SS AM') ELSE NULL END"
        ")"
    )


def _append_audio_reviewer_scope(alias: str, conditions: list[str], params: list[Any]) -> None:
    """Scope the Silent Listening collection to the signed-in PDM-QC reviewer."""
    try:
        from backend.app.auth import current_request_path, current_request_user, normalize_role

        user = current_request_user()
        path = current_request_path().rstrip("/")
        if not user or normalize_role(user.role) != "PDM-QC":
            return
        if path != "/api/main-survey/audio-listening":
            return
        conditions.append(
            f"EXISTS (SELECT 1 FROM clean.audio_listening scoped_al "
            f"WHERE scoped_al.case_id = {alias}.case_id AND scoped_al.assigned_to_user_id = %s)"
        )
        params.append(str(user.id))
    except Exception:
        # Data scoping must remain usable for offline jobs and tests where there
        # is no HTTP request context.
        return


def main_case_scope_clause(settings: Settings, alias: str, *, prefix: str = "AND") -> tuple[str, list[Any]]:
    formdef_versions = main_data_formdef_versions(settings)
    form_id = main_data_form_id(settings)
    conditions: list[str] = []
    params: list[Any] = []
    if form_id:
        conditions.append(f"{alias}.form_id = %s")
        params.append(form_id)
    if formdef_versions and not active_workspace_form_id():
        conditions.append(f"{alias}.formdef_version = ANY(%s)")
        params.append(formdef_versions)
    _append_audio_reviewer_scope(alias, conditions, params)
    if not conditions:
        return "", []
    return f"{prefix} {' AND '.join(conditions)}", params


def main_row_scope_clause(
    settings: Settings,
    alias: str,
    *,
    prefix: str = "AND",
    start_column: str = "start_time",
    submitted_column: str = "submitted_at",
) -> tuple[str, list[Any]]:
    formdef_versions = main_data_formdef_versions(settings)
    workspace_form_id = active_workspace_form_id()
    conditions: list[str] = []
    params: list[Any] = []
    if workspace_form_id:
        conditions.append("scope_mc.form_id = %s")
        params.append(workspace_form_id)
    if formdef_versions and not active_workspace_form_id():
        conditions.append("scope_mc.formdef_version = ANY(%s)")
        params.append(formdef_versions)
    if not conditions:
        return "", []
    prefix_sql = f"{alias}." if alias else ""
    return (
        f"{prefix} EXISTS (SELECT 1 FROM clean.main_case scope_mc "
        f"WHERE scope_mc.case_id = {prefix_sql}case_id AND {' AND '.join(conditions)})",
        params,
    )


def main_case_scope_condition(settings: Settings, alias: str) -> tuple[str, list[Any]]:
    formdef_versions = main_data_formdef_versions(settings)
    form_id = main_data_form_id(settings)
    conditions: list[str] = []
    params: list[Any] = []
    if form_id:
        conditions.append(f"{alias}.form_id = %s")
        params.append(form_id)
    if formdef_versions and not active_workspace_form_id():
        conditions.append(f"{alias}.formdef_version = ANY(%s)")
        params.append(formdef_versions)
    if not conditions:
        return "TRUE", []
    return " AND ".join(conditions), params
