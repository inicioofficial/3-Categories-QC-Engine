from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg
from psycopg.rows import dict_row

from survey_platform.config import load_dotenv_file, read_env


CATEGORY_WORKSPACES = ("spread", "edible-oil", "breakfast-cereal")


def _workspace_slug_for_xlsform(path: Path) -> str | None:
    name = path.name.lower()
    if "margarine" in name or "spread" in name:
        return "spread"
    if "edible" in name and "oil" in name:
        return "edible-oil"
    if "breakfast" in name or "cereal" in name:
        return "breakfast-cereal"
    return None


def _clean_label(value: Any) -> str:
    text = str(value or "").strip()
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _usable_question_label(value: Any, variable: str) -> str:
    label = _clean_label(value)
    if not label:
        return ""
    if re.fullmatch(r"(?i)silent\s+recording\d*", label):
        return ""
    if label.lower() == variable.strip().lower():
        return ""
    return label


def _parameter_variable(parameters: Any, key: str) -> str:
    raw = str(parameters or "").strip()
    if not raw:
        return ""
    match = re.search(rf"(?:^|[;\s,]){re.escape(key)}\s*=\s*([^;\s,]+)", raw, flags=re.IGNORECASE)
    return match.group(1).strip() if match else ""


def _normalize_survey_columns(survey_df: pd.DataFrame) -> pd.DataFrame:
    """Normalize legacy XLSForm headings without changing cell values.

    Some of the category workbooks originated from older Excel files and carry
    headings such as ``parameters `` or differently-cased variants.  Pandas keeps
    those headings literally, which made ``row.get('parameters')`` silently return
    an empty value even though SurveyCTO's ``s=``/``d=`` expression was present.
    """
    normalized: dict[Any, str] = {}
    used: set[str] = set()
    for column in survey_df.columns:
        base = re.sub(r"\s+", " ", str(column or "").strip()).lower()
        if not base:
            base = str(column)
        candidate = base
        index = 2
        while candidate in used:
            candidate = f"{base}__{index}"
            index += 1
        used.add(candidate)
        normalized[column] = candidate
    return survey_df.rename(columns=normalized)


def _fallback_source_variable(workspace_slug: str, variable_name: str) -> str:
    """Recover known SurveyCTO audit sources when legacy parameter cells are blank.

    This is intentionally conservative.  Most audio-audit variables encode their
    source question after ``audio_audit_``.  Only the historical aliases that do
    not match their source variable are handled explicitly.
    """
    variable = str(variable_name or "").strip()
    lower = variable.lower()
    if lower == "audiorecord1":
        return "Q1a"
    if not lower.startswith("audio_audit_"):
        return ""

    suffix = variable[len("audio_audit_") :]
    alias_map = {
        ("spread", "b1"): "B1",
        ("spread", "CO_BAO1a"): "SP_BAU1a",
        ("spread", "N_QC1"): "N_QC1",
        ("edible-oil", "b1"): "B1",
        ("edible-oil", "CO_BAO1a"): "CO_BAO1a",
        ("edible-oil", "N_QC1"): "N_QC1",
        ("breakfast-cereal", "b1"): "B1",
        ("breakfast-cereal", "bau1y"): "SN_BAU1a",
        ("breakfast-cereal", "N_QC1"): "N_QC1",
    }
    return alias_map.get((workspace_slug, suffix), suffix)


@lru_cache(maxsize=4)
def category_audio_definitions(root_dir: str) -> dict[str, list[dict[str, str]]]:
    """Load the Silent Listening audio variables directly from the three XLSForms.

    SurveyCTO's ``audio audit`` rows are the source of truth.  The ``s=`` parameter
    identifies the question at which a recording starts, so its question label is
    also the best reviewer-facing label for the resulting attachment.
    """
    category_dir = Path(root_dir) / "data" / "category_xlsforms"
    definitions: dict[str, list[dict[str, str]]] = {slug: [] for slug in CATEGORY_WORKSPACES}

    for xlsform in sorted(path for path in category_dir.glob("*.xlsx") if not path.name.startswith("~$")):
        workspace_slug = _workspace_slug_for_xlsform(xlsform)
        if not workspace_slug:
            continue
        try:
            survey_df = pd.read_excel(xlsform, sheet_name="survey").fillna("")
            survey_df = _normalize_survey_columns(survey_df)
        except Exception:
            continue
        columns = {str(column) for column in survey_df.columns}
        if not {"type", "name"}.issubset(columns):
            continue

        rows = survey_df.to_dict(orient="records")
        variable_names = {str(row.get("name") or "").strip() for row in rows if str(row.get("name") or "").strip()}
        question_labels: dict[str, str] = {}
        for row in rows:
            variable = str(row.get("name") or "").strip()
            if not variable:
                continue
            label = _usable_question_label(row.get("label"), variable)
            if label:
                question_labels[variable] = label

        seen: set[str] = set()
        for row in rows:
            qtype = str(row.get("type") or "").strip().lower()
            if qtype != "audio audit":
                continue
            variable = str(row.get("name") or "").strip()
            if not variable or variable in seen:
                continue

            source_variable = _parameter_variable(row.get("parameters"), "s")
            destination_variable = _parameter_variable(row.get("parameters"), "d")
            if not source_variable:
                source_variable = _fallback_source_variable(workspace_slug, variable)

            # A stale cross-category audit row occasionally survives in an XLSForm.
            # If its declared/recovered source variable does not exist in that same
            # instrument, it cannot produce a meaningful category recording.
            if source_variable and source_variable not in variable_names:
                continue

            label = (
                question_labels.get(source_variable)
                or _usable_question_label(row.get("label"), variable)
                or source_variable
                or variable
            )
            definitions[workspace_slug].append(
                {
                    "variable_name": variable,
                    "source_variable": source_variable,
                    "destination_variable": destination_variable,
                    "label": label,
                }
            )
            seen.add(variable)

    return definitions


def _case_workspace_slug(case_id: str, record: dict[str, Any]) -> str:
    explicit = str(record.get("workspace_slug") or "").strip().lower()
    if explicit in CATEGORY_WORKSPACES:
        return explicit
    prefix = str(case_id or "").split(":", 1)[0].strip().lower()
    return prefix if prefix in CATEGORY_WORKSPACES else ""


def _record_value(record: dict[str, Any], variable_name: str) -> str:
    if variable_name in record:
        value = record.get(variable_name)
    else:
        lower_key_map = {str(key).lower(): key for key in record}
        key = lower_key_map.get(variable_name.lower())
        value = record.get(key) if key is not None else None
    text = str(value or "").strip()
    if text.lower() in {"", "nan", "none", "null", "false", "0", "0.0"}:
        return ""
    return text


def _media_file_name(value: str) -> str:
    raw = str(value or "").strip()
    if "File skipped from exports:" in raw:
        raw = re.sub(r"(?i)^File skipped from exports:\s*", "", raw).strip()
    raw = raw.replace("\\", "/")
    return raw.rsplit("/", 1)[-1].split("?", 1)[0].split("#", 1)[0].strip()


def repair_category_audio_media(
    base_dir: Path | None = None,
    *,
    database_url: str | None = None,
) -> dict[str, Any]:
    """Reconcile ``clean.main_case_media`` with each category XLSForm.

    This does two things required by Silent Listening:
    * removes rows marked as audio that are not actual ``audio audit`` variables for
      that category (for example radio assets or other attachment fields), and
    * recreates missing audit-media rows directly from ``clean.main_case.record`` so
      older cases still surface their SurveyCTO recordings without a manual reload.
    """
    root = (base_dir or Path.cwd()).resolve()
    definitions_by_workspace = category_audio_definitions(str(root))
    if not any(definitions_by_workspace.values()):
        return {"status": "skipped", "reason": "No category audio definitions found.", "workspaces": []}

    if not database_url:
        dotenv = load_dotenv_file(root / ".env")
        database_url = read_env("DATABASE_URL", dotenv)
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for category audio reconciliation.")

    totals = {"cases": 0, "audio": 0, "removed": 0}
    workspace_stats: list[dict[str, Any]] = []

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            for workspace_slug in CATEGORY_WORKSPACES:
                definitions = definitions_by_workspace.get(workspace_slug) or []
                if not definitions:
                    workspace_stats.append(
                        {"workspace": workspace_slug, "cases": 0, "audio": 0, "removed": 0, "definitionCount": 0}
                    )
                    continue

                expected_names = [item["variable_name"] for item in definitions]
                cur.execute(
                    """
                    SELECT case_id, submission_key, survey_month, formdef_version, record
                    FROM clean.main_case
                    WHERE COALESCE(record->>'workspace_slug', '') = %s
                       OR split_part(case_id, ':', 1) = %s
                    ORDER BY case_id
                    """,
                    (workspace_slug, workspace_slug),
                )
                cases = cur.fetchall()
                stats = {
                    "workspace": workspace_slug,
                    "cases": 0,
                    "audio": 0,
                    "removed": 0,
                    "definitionCount": len(definitions),
                }

                for row in cases:
                    case_id = str(row.get("case_id") or "").strip()
                    record = dict(row.get("record") or {})
                    if not case_id or _case_workspace_slug(case_id, record) != workspace_slug:
                        continue

                    stats["cases"] += 1
                    cur.execute(
                        """
                        DELETE FROM clean.main_case_media
                        WHERE case_id = %s
                          AND media_type = 'audio'
                          AND NOT (variable_name = ANY(%s::text[]))
                        """,
                        (case_id, expected_names),
                    )
                    stats["removed"] += max(cur.rowcount or 0, 0)

                    for definition in definitions:
                        variable_name = definition["variable_name"]
                        media_ref = _record_value(record, variable_name)
                        if not media_ref:
                            cur.execute(
                                "DELETE FROM clean.main_case_media WHERE case_id = %s AND variable_name = %s AND media_type = 'audio'",
                                (case_id, variable_name),
                            )
                            stats["removed"] += max(cur.rowcount or 0, 0)
                            continue

                        cur.execute(
                            """
                            INSERT INTO clean.main_case_media (
                                case_id, submission_key, survey_month, formdef_version,
                                variable_name, media_type, file_name, surveycto_path
                            ) VALUES (%s, %s, %s, %s, %s, 'audio', %s, %s)
                            ON CONFLICT (case_id, variable_name) DO UPDATE SET
                                submission_key = EXCLUDED.submission_key,
                                survey_month = EXCLUDED.survey_month,
                                formdef_version = EXCLUDED.formdef_version,
                                media_type = 'audio',
                                file_name = EXCLUDED.file_name,
                                surveycto_path = EXCLUDED.surveycto_path,
                                updated_at = now()
                            """,
                            (
                                case_id,
                                row.get("submission_key"),
                                row.get("survey_month"),
                                row.get("formdef_version"),
                                variable_name,
                                _media_file_name(media_ref),
                                media_ref,
                            ),
                        )
                        stats["audio"] += 1

                totals["cases"] += stats["cases"]
                totals["audio"] += stats["audio"]
                totals["removed"] += stats["removed"]
                workspace_stats.append(stats)
        conn.commit()

    return {"status": "success", "workspaces": workspace_stats, **totals}
