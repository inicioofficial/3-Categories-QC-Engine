from __future__ import annotations

import hashlib
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import psycopg
import requests
from psycopg import sql
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from survey_platform.config import load_dotenv_file, read_env
from survey_platform.workspaces import SurveyWorkspace, load_survey_workspaces


SUBMISSION_KEY_FIELDS = ("KEY", "submission_key", "instanceID", "instance_id")
AUDIO_EXTENSIONS = (".m4a", ".mp3", ".wav", ".amr", ".aac", ".ogg", ".oga", ".opus", ".3gp", ".mp4", ".webm")
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif")
MEDIA_EXTENSIONS = AUDIO_EXTENSIONS + IMAGE_EXTENSIONS


def _submission_key(record: dict[str, Any]) -> str:
    for field in SUBMISSION_KEY_FIELDS:
        value = str(record.get(field) or "").strip()
        if value:
            return value
    canonical = json.dumps(record, sort_keys=True, default=str, separators=(",", ":"))
    return "sha256:" + hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _text(record: dict[str, Any], *fields: str) -> str | None:
    for field in fields:
        value = str(record.get(field) or "").strip()
        if value:
            return value
    return None


def ensure_workspace_schema(cur: psycopg.Cursor[Any], workspace: SurveyWorkspace) -> None:
    schema = sql.Identifier(workspace.schema)
    cur.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(schema))
    cur.execute(sql.SQL("""
        CREATE TABLE IF NOT EXISTS {}.surveycto_submission (
            submission_key text PRIMARY KEY,
            form_id text NOT NULL,
            formdef_version text,
            completion_date text,
            submission_date text,
            raw_payload jsonb NOT NULL,
            source_hash text NOT NULL,
            first_synced_at timestamptz NOT NULL DEFAULT now(),
            last_synced_at timestamptz NOT NULL DEFAULT now()
        )
    """).format(schema))
    cur.execute(sql.SQL("""
        CREATE INDEX IF NOT EXISTS {} ON {}.surveycto_submission (completion_date DESC)
    """).format(sql.Identifier(f"idx_{workspace.schema}_submission_completion"), schema))
    cur.execute(sql.SQL("""
        CREATE TABLE IF NOT EXISTS {}.sync_state (
            form_id text PRIMARY KEY,
            last_status text NOT NULL,
            last_message text,
            last_row_count integer NOT NULL DEFAULT 0,
            last_successful_sync_at timestamptz,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
    """).format(schema))


def sync_workspace(
    workspace: SurveyWorkspace,
    *,
    server: str,
    username: str,
    password: str,
    database_url: str,
) -> dict[str, Any]:
    url = f"https://{server}.surveycto.com/api/v2/forms/data/wide/json/{workspace.form_id}"
    # SurveyCTO's v2 endpoint requires a date parameter. Epoch zero requests the
    # complete history and is safe here because rows are upserted by submission key.
    response = requests.get(url, params={"date": "0"}, auth=(username, password), timeout=(30, 600))
    if not response.ok:
        try:
            detail = response.json().get("error", {}).get("message")
        except (TypeError, ValueError):
            detail = response.text[:500]
        raise RuntimeError(
            f"SurveyCTO rejected form {workspace.form_id} with HTTP {response.status_code}: "
            f"{detail or 'No error detail was returned.'}"
        )
    records = response.json()
    if not isinstance(records, list):
        raise RuntimeError(f"SurveyCTO returned an unexpected payload for {workspace.form_id}.")

    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            ensure_workspace_schema(cur, workspace)
            upsert = sql.SQL("""
                INSERT INTO {}.surveycto_submission (
                    submission_key, form_id, formdef_version, completion_date,
                    submission_date, raw_payload, source_hash
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (submission_key) DO UPDATE SET
                    form_id = EXCLUDED.form_id,
                    formdef_version = EXCLUDED.formdef_version,
                    completion_date = EXCLUDED.completion_date,
                    submission_date = EXCLUDED.submission_date,
                    raw_payload = EXCLUDED.raw_payload,
                    source_hash = EXCLUDED.source_hash,
                    last_synced_at = now()
            """).format(sql.Identifier(workspace.schema))
            for record in records:
                if not isinstance(record, dict):
                    continue
                canonical = json.dumps(record, sort_keys=True, default=str, separators=(",", ":"))
                cur.execute(upsert, (
                    _submission_key(record),
                    workspace.form_id,
                    _text(record, "formdef_version", "FormDefVersion"),
                    _text(record, "CompletionDate", "completion_date", "end"),
                    _text(record, "SubmissionDate", "submission_date"),
                    Jsonb(record),
                    hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
                ))
            cur.execute(sql.SQL("""
                INSERT INTO {}.sync_state (
                    form_id, last_status, last_message, last_row_count,
                    last_successful_sync_at, updated_at
                ) VALUES (%s, 'success', %s, %s, now(), now())
                ON CONFLICT (form_id) DO UPDATE SET
                    last_status = EXCLUDED.last_status,
                    last_message = EXCLUDED.last_message,
                    last_row_count = EXCLUDED.last_row_count,
                    last_successful_sync_at = now(),
                    updated_at = now()
            """).format(sql.Identifier(workspace.schema)), (
                workspace.form_id,
                f"Loaded {len(records)} SurveyCTO submissions.",
                len(records),
            ))
        conn.commit()
    return {"workspace": workspace.slug, "formId": workspace.form_id, "rows": len(records), "status": "success"}


def sync_all_category_forms(
    base_dir: Path | None = None,
    workspace_slug: str | None = None,
) -> dict[str, Any]:
    root = (base_dir or Path.cwd()).resolve()
    dotenv = load_dotenv_file(root / ".env")
    database_url = read_env("DATABASE_URL", dotenv)
    server = read_env("SURVEYCTO_SERVER", dotenv, "edvoimpacts") or "edvoimpacts"
    username = read_env("SURVEYCTO_USERNAME", dotenv)
    password = read_env("SURVEYCTO_PASSWORD", dotenv)
    try:
        cooldown_seconds = max(0, int(read_env("CATEGORY_SYNC_COOLDOWN_SECONDS", dotenv, "250") or "250"))
    except ValueError as exc:
        raise RuntimeError("CATEGORY_SYNC_COOLDOWN_SECONDS must be a whole number of seconds.") from exc
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for category-sync.")
    if not username or not password:
        raise RuntimeError("SURVEYCTO_USERNAME and SURVEYCTO_PASSWORD are required for category-sync.")

    workspaces = load_survey_workspaces(root)
    if workspace_slug:
        workspaces = [workspace for workspace in workspaces if workspace.slug == workspace_slug]
        if not workspaces:
            raise RuntimeError(f"Unknown category workspace: {workspace_slug}")

    results = []
    for index, workspace in enumerate(workspaces):
        started = datetime.now(timezone.utc)
        result = sync_workspace(
            workspace,
            server=server,
            username=username,
            password=password,
            database_url=database_url,
        )
        result["startedAt"] = started.isoformat()
        results.append(result)
        if index < len(workspaces) - 1 and cooldown_seconds:
            next_workspace = workspaces[index + 1]
            print(
                f"SurveyCTO cooldown: waiting {cooldown_seconds} seconds before pulling {next_workspace.slug}.",
                flush=True,
            )
            time.sleep(cooldown_seconds)
    operational = rebuild_category_operational_data(root)
    return {"status": "success", "workspaces": results, "operational": operational}


def _gps_parts(value: Any) -> tuple[float | None, float | None]:
    parts = str(value or "").replace(",", " ").split()
    if len(parts) < 2:
        return None, None
    try:
        lat, lon = float(parts[0]), float(parts[1])
        return (lat, lon) if -90 <= lat <= 90 and -180 <= lon <= 180 else (None, None)
    except (TypeError, ValueError):
        return None, None


def _timestamp(value: Any) -> datetime | None:
    parsed = pd.to_datetime(value, errors="coerce", utc=True)
    return None if pd.isna(parsed) else parsed.to_pydatetime()


def _media_type(variable: str, value: str) -> str | None:
    variable_lower = str(variable or "").strip().lower()
    value_lower = str(value or "").strip().lower()
    path_lower = value_lower.split("?", 1)[0].split("#", 1)[0]
    has_attachment_marker = "/attachments/" in value_lower or "file skipped from exports:" in value_lower
    has_media_extension = path_lower.endswith(MEDIA_EXTENSIONS)
    looks_like_audio_variable = any(token in variable_lower for token in ("audio", "recording", "radioplay", "radio_play"))

    if not value_lower:
        return None
    if looks_like_audio_variable:
        return "audio"
    if path_lower.endswith(AUDIO_EXTENSIONS):
        return "audio"
    if path_lower.endswith(IMAGE_EXTENSIONS):
        return "image"
    if has_attachment_marker and has_media_extension:
        return "audio" if path_lower.endswith(AUDIO_EXTENSIONS) else "image"
    if "/attachments/" in value_lower:
        # SurveyCTO attachment URLs occasionally omit a conventional extension.
        # Keep them available instead of silently dropping reviewer evidence.
        return "audio" if looks_like_audio_variable else "image"
    return None


def _media_file_name(value: str) -> str:
    raw = str(value or "").strip()
    if "File skipped from exports:" in raw:
        raw = raw.split(":", 1)[1].strip()
    return raw.replace("\\", "/").rsplit("/", 1)[-1].split("?", 1)[0].strip()


def rebuild_category_operational_data(base_dir: Path | None = None) -> dict[str, Any]:
    root = (base_dir or Path.cwd()).resolve()
    dotenv = load_dotenv_file(root / ".env")
    database_url = read_env("DATABASE_URL", dotenv)
    if not database_url:
        raise RuntimeError("DATABASE_URL is required for category-rebuild.")
    results: list[dict[str, Any]] = []
    with psycopg.connect(database_url, row_factory=dict_row) as conn:
        with conn.cursor() as cur:
            for workspace in load_survey_workspaces(root):
                cur.execute(
                    sql.SQL("SELECT submission_key, form_id, formdef_version, raw_payload FROM {}.surveycto_submission").format(
                        sql.Identifier(workspace.schema)
                    )
                )
                rows = cur.fetchall()
                pipeline = conn.pipeline()
                pipeline.__enter__()
                case_count = media_count = 0
                for row in rows:
                    record = dict(row.get("raw_payload") or {})
                    submission_key = str(row.get("submission_key") or "").strip()
                    if not submission_key:
                        continue
                    case_id = f"{workspace.slug}:{submission_key}"
                    form_version = str(row.get("formdef_version") or record.get("formdef_version") or record.get("FormDefVersion") or "").strip() or None
                    submitted_at = _timestamp(record.get("CompletionDate") or record.get("SubmissionDate") or record.get("endtime"))
                    survey_month = submitted_at.strftime("%Y-%m") if submitted_at else None
                    lat, lon = _gps_parts(record.get("gps"))
                    record["workspace_slug"] = workspace.slug
                    record["workspace_label"] = workspace.label
                    record["source_form_id"] = workspace.form_id
                    cur.execute("""
                        INSERT INTO clean.main_case (
                            submission_key, case_id, form_id, formdef_version, survey_month,
                            instance_id, ea_id, interviewer_id, supervisor_id, username,
                            city_code, sector_code, address, gps_lat, gps_long,
                            current_status, approval_stage, submitted_at, is_callback_required, record
                        ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'submitted','pending_review',%s,false,%s)
                        ON CONFLICT (submission_key) DO UPDATE SET
                            case_id=EXCLUDED.case_id, form_id=EXCLUDED.form_id,
                            formdef_version=EXCLUDED.formdef_version, survey_month=EXCLUDED.survey_month,
                            ea_id=EXCLUDED.ea_id, interviewer_id=EXCLUDED.interviewer_id,
                            supervisor_id=EXCLUDED.supervisor_id, username=EXCLUDED.username,
                            city_code=EXCLUDED.city_code, sector_code=EXCLUDED.sector_code,
                            address=EXCLUDED.address, gps_lat=EXCLUDED.gps_lat, gps_long=EXCLUDED.gps_long,
                            submitted_at=EXCLUDED.submitted_at, record=EXCLUDED.record, updated_at=now()
                    """, (
                        submission_key, case_id, workspace.form_id, form_version, survey_month,
                        record.get("instanceID") or record.get("instance_id"), record.get("sector"),
                        record.get("intname") or record.get("INT_NAME") or record.get("username"),
                        record.get("SUP_NAME"), record.get("username"), record.get("Region"), record.get("sector"),
                        record.get("Address"), lat, lon, submitted_at, Jsonb(record),
                    ))
                    cur.execute("""
                        INSERT INTO clean.main_case_section (case_id, section_name, row_no, record)
                        VALUES (%s, %s, 1, %s)
                        ON CONFLICT (case_id, section_name, row_no) DO UPDATE SET record=EXCLUDED.record, updated_at=now()
                    """, (case_id, f"{workspace.label} Responses", Jsonb(record)))
                    cur.execute("""
                        INSERT INTO clean.main_case_panel (case_id, survey_month, formdef_version, panel_code, panel_label, section_prefix)
                        VALUES (%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (case_id, panel_code) DO UPDATE SET panel_label=EXCLUDED.panel_label, updated_at=now()
                    """, (case_id, survey_month, form_version, workspace.slug, workspace.label, workspace.slug.upper().replace('-', '_')))
                    for variable, value in record.items():
                        text_value = str(value or "").strip()
                        media_type = _media_type(str(variable), text_value)
                        if media_type is None:
                            continue
                        cur.execute("""
                            INSERT INTO clean.main_case_media (case_id, submission_key, survey_month, formdef_version, variable_name, media_type, file_name, surveycto_path)
                            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
                            ON CONFLICT (case_id, variable_name) DO UPDATE SET
                                media_type=EXCLUDED.media_type,
                                file_name=EXCLUDED.file_name,
                                surveycto_path=EXCLUDED.surveycto_path,
                                updated_at=now()
                        """, (
                            case_id,
                            submission_key,
                            survey_month,
                            form_version,
                            variable,
                            media_type,
                            _media_file_name(text_value),
                            text_value,
                        ))
                        media_count += 1
                    case_count += 1
                pipeline.__exit__(None, None, None)
                results.append({"workspace": workspace.slug, "cases": case_count, "media": media_count})
            conn.commit()
    return {"status": "success", "workspaces": results}
