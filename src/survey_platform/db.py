from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
import hashlib
import json
import math
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd

from survey_platform.config import ListingPipelineConfig


LISTING_INSTRUMENT_CODE = "listing"
MAIN_INSTRUMENT_CODE = "main"
SURVEYCTO_SYNC_CONTROL_KEY = "surveycto_api"
EA_ID_CANDIDATES = ("ea_id", "ea_code", "EA_ID", "EA", "ea")
BOUNDARY_ID_CANDIDATES = ("boundary_id", "boundary_code", "polygon_id", "ea_boundary_id")
INTERVIEWER_ID_CANDIDATES = ("interviewer_id", "interviewer", "username", "enumerator_id")
SUPERVISOR_ID_CANDIDATES = ("supervisor_id", "supervisor", "team_supervisor_id")
HOUSEHOLD_UID_CANDIDATES = ("household_uid", "hh_uid")
SUBMISSION_KEY_CANDIDATES = ("submission_key", "KEY")
CASE_ID_CANDIDATES = ("case_id", "caseid", "qn")
FORMDEF_VERSION_CANDIDATES = ("formdef_version", "form_version", "FormDefVersion")
INSTANCE_ID_CANDIDATES = ("KEY", "instanceID", "instance_id", "SubmissionId")
CITY_CODE_CANDIDATES = ("city_code", "city", "CITY", "City")
SECTOR_CODE_CANDIDATES = ("sector_code", "sector", "SECTOR", "Sector")
ADDRESS_CANDIDATES = ("address", "hh_address", "Address", "location_address")
GPS_CANDIDATES = ("outlet_gps", "hh_gps", "gps", "GPS", "location_gps")
GPS_LAT_CANDIDATES = ("hh_gps_Latitude", "gps_Latitude", "latitude", "lat")
GPS_LONG_CANDIDATES = ("hh_gps_Longitude", "gps_Longitude", "longitude", "long", "lon")
REVIEW_STATUS_CANDIDATES = ("review_status", "ReviewStatus", "qc_status", "current_status")
REVIEW_QUALITY_CANDIDATES = ("review_quality", "ReviewQuality", "quality_status")
SURVEY_MONTH_DATE_CANDIDATES = ("CompletionDate", "SubmissionDate", "end", "start", "today")
# The July 2026 BHT fieldwork/reporting window was extended through August 4.
# Keep those spillover interviews in the July dashboard rather than creating a
# partial August reporting month.
JULY_2026_REPORTING_EXTENSION_START = datetime(2026, 8, 1)
JULY_2026_REPORTING_EXTENSION_END = datetime(2026, 8, 5)
OMNIBUS_PREFIXES = ("OB_", "omnibus")
PANEL_DEFINITIONS = {
    "Panel_1": {"label": "Noodles", "section_prefix": "N"},
    "Panel_2": {"label": "Toothpaste", "section_prefix": "TP"},
    "Panel_3": {"label": "Edible Oil", "section_prefix": "EO"},
    "Panel_4": {"label": "Bleach", "section_prefix": "BL"},
    "Panel_5": {"label": "Toilet Cleaner", "section_prefix": "TC"},
    "Panel_6": {"label": "Snacks", "section_prefix": "SK"},
    "Panel_7": {"label": "Breakfast Cereals", "section_prefix": "BC"},
    "Panel_8": {"label": "Condiment Mixes", "section_prefix": "CM"},
    "Panel_9": {"label": "Wet Hair", "section_prefix": "WH"},
    "Panel_10": {"label": "Dry Hair", "section_prefix": "DH"},
    "Panel_11": {"label": "Malt", "section_prefix": "ML"},
}
SECTION_PREFIX_TO_PANEL = {
    definition["section_prefix"]: panel_code
    for panel_code, definition in PANEL_DEFINITIONS.items()
}
METADATA_VARIABLES = {
    "KEY",
    "SubmissionDate",
    "CompletionDate",
    "start",
    "end",
    "today",
    "deviceid",
    "username",
    "caseid",
    "case_id",
    "formdef_version",
}
MEDIA_PREFIXES = ("audio_audit", "image", "photo", "picture")
MEDIA_EXTENSIONS = (".jpg", ".jpeg", ".png", ".gif", ".wav", ".mp3", ".m4a", ".amr", ".3gp", ".mp4")
BHT_MONTH_NAMES = {
    "JANUARY": "01",
    "FEBRUARY": "02",
    "MARCH": "03",
    "APRIL": "04",
    "MAY": "05",
    "JUNE": "06",
    "JULY": "07",
    "AUGUST": "08",
    "SEPTEMBER": "09",
    "OCTOBER": "10",
    "NOVEMBER": "11",
    "DECEMBER": "12",
}
REQUIRED_TABLES = (
    "raw.sync_state",
    "raw.sync_control",
    "raw.surveycto_submission",
    "clean.hh_sampling_ea",
    "clean.hh_selected_long",
    "clean.hh_listing_long",
    "clean.main_case",
    "clean.main_case_section",
)


class SyncPreemptedError(RuntimeError):
    """Raised when a manual sync preempts a non-manual SurveyCTO sync."""


def db_enabled(config: ListingPipelineConfig) -> bool:
    return bool(config.database_url)


def _import_psycopg():
    try:
        import psycopg
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "psycopg is required for PostgreSQL loading. Install dependencies from requirements.txt."
        ) from exc
    return psycopg


def _connect(config: ListingPipelineConfig):
    psycopg = _import_psycopg()
    return psycopg.connect(config.database_url, row_factory=psycopg.rows.dict_row)


@contextmanager
def advisory_lock(config: ListingPipelineConfig, lock_id: int) -> Iterator[bool]:
    if not db_enabled(config):
        yield False
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT pg_try_advisory_lock(%s) AS locked", (lock_id,))
            row = cur.fetchone() or {}
            locked = bool(row.get("locked", False))
        try:
            yield locked
        finally:
            if locked:
                with conn.cursor() as cur:
                    cur.execute("SELECT pg_advisory_unlock(%s)", (lock_id,))


def _is_manual_sync(config: ListingPipelineConfig) -> bool:
    return str(getattr(config, "sync_source", "") or "").lower().startswith("manual")


def _schema_file_path(config: ListingPipelineConfig) -> Path:
    return config.base_dir / "sql" / "platform_schema.sql"


def init_db(config: ListingPipelineConfig) -> None:
    if not db_enabled(config):
        raise RuntimeError("DATABASE_URL is not set.")

    schema_path = _schema_file_path(config)
    if not schema_path.exists():
        raise FileNotFoundError(f"Schema file not found: {schema_path}")

    sql_text = schema_path.read_text(encoding="utf-8")
    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(sql_text)
        conn.commit()

    print(f"Applied schema from {schema_path}")


def check_db(config: ListingPipelineConfig) -> None:
    if not db_enabled(config):
        raise RuntimeError("DATABASE_URL is not set.")

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    current_database() AS database_name,
                    current_user AS current_user,
                    version() AS version_text
                """
            )
            meta = cur.fetchone() or {}
            database_name = meta.get("database_name")
            current_user = meta.get("current_user")
            version_text = meta.get("version_text", "")

            cur.execute(
                """
                SELECT format('%s.%s', schemaname, tablename) AS full_name
                FROM pg_tables
                WHERE schemaname IN ('raw', 'clean')
                """
            )
            existing = {row["full_name"] for row in cur.fetchall()}

    missing = [table_name for table_name in REQUIRED_TABLES if table_name not in existing]
    print(f"Connected to database: {database_name}")
    print(f"Connected as user: {current_user}")
    print(f"PostgreSQL: {str(version_text).split(',')[0]}")

    if missing:
        raise RuntimeError(
            "Database check failed. Missing required tables: " + ", ".join(missing)
        )

    print("Database check passed. Required survey platform tables are present.")


def _ensure_sync_state_columns(config: ListingPipelineConfig) -> None:
    if not db_enabled(config):
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                ALTER TABLE IF EXISTS raw.sync_state
                ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz
                """
            )
            cur.execute(
                """
                ALTER TABLE IF EXISTS raw.sync_state
                ADD COLUMN IF NOT EXISTS last_successful_fetch_utc timestamptz
                """
            )
        conn.commit()


def request_manual_sync_override(
    config: ListingPipelineConfig,
    request_token: str,
    requested_by: str,
    note: str,
) -> None:
    if not db_enabled(config):
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO raw.sync_control (
                    control_key,
                    manual_override_active,
                    manual_override_token,
                    manual_override_requested_at,
                    manual_override_requested_by,
                    manual_override_note,
                    updated_at
                )
                VALUES (%s, true, %s, now(), %s, %s, now())
                ON CONFLICT (control_key) DO UPDATE SET
                    manual_override_active = true,
                    manual_override_token = EXCLUDED.manual_override_token,
                    manual_override_requested_at = EXCLUDED.manual_override_requested_at,
                    manual_override_requested_by = EXCLUDED.manual_override_requested_by,
                    manual_override_note = EXCLUDED.manual_override_note,
                    updated_at = EXCLUDED.updated_at
                """,
                (SURVEYCTO_SYNC_CONTROL_KEY, request_token, requested_by[:255], note[:1000]),
            )
        conn.commit()


def clear_manual_sync_override(config: ListingPipelineConfig, request_token: str) -> None:
    if not db_enabled(config):
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE raw.sync_control
                SET
                    manual_override_active = false,
                    manual_override_token = NULL,
                    manual_override_requested_at = NULL,
                    manual_override_requested_by = NULL,
                    manual_override_note = NULL,
                    updated_at = now()
                WHERE control_key = %s
                  AND manual_override_token = %s
                """,
                (SURVEYCTO_SYNC_CONTROL_KEY, request_token),
            )
        conn.commit()


def manual_sync_override_active(config: ListingPipelineConfig) -> bool:
    if not db_enabled(config):
        return False

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT manual_override_active
                FROM raw.sync_control
                WHERE control_key = %s
                """,
                (SURVEYCTO_SYNC_CONTROL_KEY,),
            )
            row = cur.fetchone() or {}
    return bool(row.get("manual_override_active"))


def raise_if_manual_sync_preempted(
    config: ListingPipelineConfig,
    context: str,
) -> None:
    if _is_manual_sync(config) or not db_enabled(config):
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    manual_override_active,
                    manual_override_requested_by,
                    manual_override_note
                FROM raw.sync_control
                WHERE control_key = %s
                """,
                (SURVEYCTO_SYNC_CONTROL_KEY,),
            )
            row = cur.fetchone() or {}

    if not row.get("manual_override_active"):
        return

    requested_by = str(row.get("manual_override_requested_by") or "manual-request")
    note = str(row.get("manual_override_note") or "").strip()
    detail = f"Manual sync override requested by {requested_by}; aborting {context}."
    if note:
        detail = f"{detail} {note}"
    raise SyncPreemptedError(detail)


def ensure_db_ready(config: ListingPipelineConfig) -> None:
    if not db_enabled(config):
        return
    check_db(config)
    _ensure_sync_state_columns(config)


def load_sync_checkpoint(config: ListingPipelineConfig, instrument_code: str) -> datetime | None:
    if not db_enabled(config):
        return None

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT COALESCE(
                    last_successful_sync_at,
                    last_successful_fetch_utc,
                    last_successful_completion_utc
                ) AS checkpoint_utc
                FROM raw.sync_state
                WHERE instrument_code = %s
                """,
                (instrument_code,),
            )
            row = cur.fetchone() or {}

    return _clean_scalar(row.get("checkpoint_utc"))


def get_last_successful_completion_utc(
    config: ListingPipelineConfig,
    instrument_code: str,
) -> datetime | None:
    if not db_enabled(config):
        return None

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT last_successful_completion_utc
                FROM raw.sync_state
                WHERE instrument_code = %s
                """,
                (instrument_code,),
            )
            row = cur.fetchone() or {}

    return _clean_scalar(row.get("last_successful_completion_utc"))


def save_sync_checkpoint(
    config: ListingPipelineConfig,
    instrument_code: str,
    checkpoint_utc: datetime,
) -> None:
    if not db_enabled(config):
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO raw.sync_state (
                    instrument_code,
                    last_successful_sync_at,
                    last_successful_fetch_utc,
                    updated_at
                )
                VALUES (%s, %s, %s, now())
                ON CONFLICT (instrument_code) DO UPDATE SET
                    last_successful_sync_at = EXCLUDED.last_successful_sync_at,
                    last_successful_fetch_utc = EXCLUDED.last_successful_fetch_utc,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    instrument_code,
                    _clean_scalar(checkpoint_utc),
                    _clean_scalar(checkpoint_utc),
                ),
            )
        conn.commit()


def get_sync_state(config: ListingPipelineConfig, instrument_code: str) -> dict | None:
    if not db_enabled(config):
        return None

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT *
                FROM raw.sync_state
                WHERE instrument_code = %s
                """,
                (instrument_code,),
            )
            return cur.fetchone()


def load_latest_raw_submissions(
    config: ListingPipelineConfig,
    instrument_code: str,
    form_id: str | None = None,
) -> pd.DataFrame:
    if not db_enabled(config):
        return pd.DataFrame()

    with _connect(config) as conn:
        with conn.cursor() as cur:
            form_clause = ""
            params: list[Any] = [instrument_code]
            if str(form_id or "").strip():
                form_clause = "AND form_id = %s"
                params.append(str(form_id).strip())
            cur.execute(
                f"""
                SELECT latest.raw_payload
                FROM (
                    SELECT DISTINCT ON (submission_key)
                        submission_key,
                        raw_payload
                    FROM raw.surveycto_submission
                    WHERE instrument_code = %s
                      {form_clause}
                    ORDER BY submission_key, fetched_at DESC, submission_version DESC
                ) AS latest
                ORDER BY latest.submission_key
                """,
                tuple(params),
            )
            rows = cur.fetchall()

    if not rows:
        return pd.DataFrame()

    payloads = []
    for row in rows:
        payload = row.get("raw_payload") or {}
        if isinstance(payload, str):
            payload = json.loads(payload)
        payloads.append(payload)
    return pd.DataFrame(payloads)


def load_latest_raw_submissions_with_sync_metadata(
    config: ListingPipelineConfig,
    instrument_code: str,
    synced_at_column: str = "__db_synced_at",
    limit: int | None = None,
    offset: int = 0,
) -> pd.DataFrame:
    """Load latest raw payloads from DB and include the DB fetch timestamp per case."""
    if not db_enabled(config):
        return pd.DataFrame()

    with _connect(config) as conn:
        with conn.cursor() as cur:
            pagination_sql = ""
            params: list[Any] = [instrument_code]
            if limit is not None:
                pagination_sql = "LIMIT %s OFFSET %s"
                params.extend([int(limit), int(offset)])

            cur.execute(
                f"""
                SELECT latest.raw_payload, latest.fetched_at
                FROM (
                    SELECT DISTINCT ON (submission_key)
                        submission_key,
                        raw_payload,
                        fetched_at,
                        submission_version
                    FROM raw.surveycto_submission
                    WHERE instrument_code = %s
                    ORDER BY submission_key, fetched_at DESC, submission_version DESC
                ) AS latest
                ORDER BY latest.submission_key
                {pagination_sql}
                """,
                tuple(params),
            )
            rows = cur.fetchall()

    if not rows:
        return pd.DataFrame()

    payloads = []
    for row in rows:
        payload = row.get("raw_payload") or {}
        if isinstance(payload, str):
            payload = json.loads(payload)
        else:
            payload = dict(payload)
        payload[synced_at_column] = row.get("fetched_at")
        payloads.append(payload)
    return pd.DataFrame(payloads)


def load_main_clean_cases_for_backfill(
    config: ListingPipelineConfig,
    synced_at_column: str = "__db_synced_at",
    only_without_raw: bool = False,
    limit: int | None = None,
    offset: int = 0,
) -> pd.DataFrame:
    """Reconstruct Main Survey rows from existing clean tables for backfills.

    Older deployments may already have records in clean.main_case without a
    matching raw.surveycto_submission row. The special-cleaning backfill needs a
    row-shaped payload, so use the stored case JSON and merge section/roster
    JSON as a fallback source.
    """
    if not db_enabled(config):
        return pd.DataFrame()

    with _connect(config) as conn:
        with conn.cursor() as cur:
            raw_missing_filter = """
                AND NOT EXISTS (
                    SELECT 1
                    FROM raw.surveycto_submission raw
                    WHERE raw.instrument_code = %s
                      AND raw.submission_key = m.submission_key
                )
            """ if only_without_raw else ""
            params: list[Any] = [MAIN_INSTRUMENT_CODE] if only_without_raw else []
            pagination_sql = ""
            if limit is not None:
                pagination_sql = "LIMIT %s OFFSET %s"
                params.extend([int(limit), int(offset)])
            cur.execute(
                f"""
                SELECT
                    m.submission_key,
                    m.case_id,
                    m.record AS case_record,
                    m.created_at,
                    m.updated_at,
                    COALESCE(sections.records, '{{}}'::jsonb) AS section_records,
                    COALESCE(rosters.records, '{{}}'::jsonb) AS roster_records
                FROM clean.main_case m
                LEFT JOIN LATERAL (
                    SELECT jsonb_object_agg(
                        s.section_name || '[' || s.row_no::text || ']',
                        s.record
                    ) AS records
                    FROM clean.main_case_section s
                    WHERE s.case_id = m.case_id
                ) sections ON true
                LEFT JOIN LATERAL (
                    SELECT jsonb_object_agg(
                        r.roster_type || '[' || r.row_no::text || ']',
                        r.record
                    ) AS records
                    FROM clean.main_case_roster r
                    WHERE r.case_id = m.case_id
                ) rosters ON true
                WHERE m.submission_key IS NOT NULL
                {raw_missing_filter}
                ORDER BY m.submission_key
                {pagination_sql}
                """,
                tuple(params),
            )
            rows = cur.fetchall()

    payloads = []
    for row in rows:
        payload = row.get("case_record") or {}
        if isinstance(payload, str):
            payload = json.loads(payload)
        else:
            payload = dict(payload)

        section_records = row.get("section_records") or {}
        if isinstance(section_records, str):
            section_records = json.loads(section_records)
        for section_payload in dict(section_records).values():
            if isinstance(section_payload, str):
                section_payload = json.loads(section_payload)
            if isinstance(section_payload, dict):
                payload.update({str(k): v for k, v in section_payload.items()})

        roster_records = row.get("roster_records") or {}
        if isinstance(roster_records, str):
            roster_records = json.loads(roster_records)
        for roster_key, roster_payload in dict(roster_records).items():
            if isinstance(roster_payload, str):
                roster_payload = json.loads(roster_payload)
            if isinstance(roster_payload, dict):
                for key, value in roster_payload.items():
                    payload.setdefault(str(key), value)
                payload.setdefault(str(roster_key), roster_payload)

        payload.setdefault("KEY", row.get("submission_key"))
        payload.setdefault("submission_key", row.get("submission_key"))
        payload.setdefault("caseid", row.get("case_id"))
        payload.setdefault("case_id", row.get("case_id"))
        payload[synced_at_column] = row.get("updated_at") or row.get("created_at")
        payloads.append(payload)

    return pd.DataFrame(payloads)


def _is_missing(value) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    try:
        return bool(pd.isna(value))
    except Exception:
        return False


def _clean_scalar(value):
    if _is_missing(value):
        return None
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value.to_pydatetime()
    if isinstance(value, datetime):
        return value
    if isinstance(value, os.PathLike):
        return str(value)
    return value


def _jsonable(value):
    if _is_missing(value):
        return None
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(k): _jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonable(v) for v in value]
    return value


def _record_to_dict(row) -> dict:
    if isinstance(row, pd.Series):
        data = row.to_dict()
    else:
        data = dict(row)
    compact = {}
    for key, value in data.items():
        if _is_missing(value):
            continue
        if isinstance(value, str) and not value.strip():
            continue
        compact[str(key)] = _jsonable(value)
    return compact


def _first_nonempty(record: dict, candidates: tuple[str, ...]):
    for candidate in candidates:
        value = record.get(candidate)
        if value not in (None, ""):
            return value
    return None


def _clean_submission_key(record: dict) -> str | None:
    value = _first_nonempty(record, SUBMISSION_KEY_CANDIDATES)
    return str(value).strip() if value not in (None, "") else None


def _clean_case_id(record: dict) -> str | None:
    value = _first_nonempty(record, CASE_ID_CANDIDATES)
    return str(value).strip() if value not in (None, "") else None


def _json_text(record: dict) -> str:
    return json.dumps(record, sort_keys=True, ensure_ascii=True)


def _executemany_chunks(cur, sql: str, rows: list[tuple], chunk_size: int = 1000) -> None:
    for start in range(0, len(rows), chunk_size):
        cur.executemany(sql, rows[start:start + chunk_size])


def _parse_datetime(value) -> datetime | None:
    value = _clean_scalar(value)
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    try:
        parsed = pd.to_datetime(value, errors="coerce")
    except Exception:
        return None
    if pd.isna(parsed):
        return None
    return parsed.to_pydatetime()


def _derive_survey_month(record: dict, override: str | None = None) -> str | None:
    for candidate in SURVEY_MONTH_DATE_CANDIDATES:
        parsed = _parse_datetime(record.get(candidate))
        if parsed is not None:
            comparable = parsed.replace(tzinfo=None) if parsed.tzinfo is not None else parsed
            if JULY_2026_REPORTING_EXTENSION_START <= comparable < JULY_2026_REPORTING_EXTENSION_END:
                return "2026-07"
    if override:
        return override
    for candidate in SURVEY_MONTH_DATE_CANDIDATES:
        parsed = _parse_datetime(record.get(candidate))
        if parsed is not None:
            return parsed.strftime("%Y-%m")
    return None


def _extract_month_from_text(text: str) -> str | None:
    normalized = str(text or "").upper()
    match = re.search(
        r"(JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER)\s+((?:20)?\d{2})",
        normalized,
    )
    if not match:
        return None
    year = match.group(2)
    if len(year) == 2:
        year = f"20{year}"
    return f"{year}-{BHT_MONTH_NAMES[match.group(1)]}"


def _infer_config_survey_month(config: ListingPipelineConfig) -> str | None:
    explicit = os.environ.get("SURVEYCTO_MAIN_SURVEY_MONTH")
    if explicit and re.fullmatch(r"\d{4}-\d{2}", explicit.strip()):
        return explicit.strip()

    dictionary_file = getattr(config, "dictionary_file", None)
    if dictionary_file:
        path = Path(dictionary_file)
        if path.exists():
            try:
                settings_df = pd.read_excel(path, sheet_name="settings", header=0, nrows=1).fillna("")
                if not settings_df.empty and "form_title" in settings_df.columns:
                    inferred = _extract_month_from_text(str(settings_df.iloc[0].get("form_title", "")))
                    if inferred:
                        return inferred
            except Exception:
                pass
            inferred = _extract_month_from_text(path.name)
            if inferred:
                return inferred

    return None


def _clean_text_value(value) -> str | None:
    if _is_missing(value):
        return None
    text = str(value).strip()
    return text if text else None


def _clean_numeric_value(value):
    if _is_missing(value):
        return None
    try:
        numeric = pd.to_numeric(value, errors="coerce")
    except Exception:
        return None
    if _is_missing(numeric):
        return None
    return float(numeric)


def _clean_boolean_value(value) -> bool | None:
    if _is_missing(value):
        return None
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "y", "selected"}:
        return True
    if text in {"0", "false", "no", "n", "not selected"}:
        return False
    return None


def _is_truthy_panel_flag(value) -> bool:
    return _clean_boolean_value(value) is True or str(value).strip().lower() in {"required", "asked"}


def _section_prefix(variable_name: str) -> str | None:
    if variable_name in METADATA_VARIABLES:
        return None
    if variable_name.startswith("OB_") or variable_name == "omnibus":
        return "OB"
    return str(variable_name).split("_", 1)[0].split(".", 1)[0] or None


def _answer_scope(variable_name: str) -> tuple[str, str | None, str | None]:
    prefix = _section_prefix(variable_name)
    if variable_name.startswith(OMNIBUS_PREFIXES) or prefix == "OB":
        return "omnibus", None, prefix
    panel_code = SECTION_PREFIX_TO_PANEL.get(prefix or "")
    if panel_code:
        return "panel", panel_code, prefix
    return "common", None, prefix


def _media_type(variable_name: str, value) -> str | None:
    text = str(value or "").strip().lower()
    name = variable_name.lower()
    if name.startswith("audio_audit") or text.endswith((".wav", ".mp3", ".m4a", ".amr")):
        return "audio"
    if any(name.startswith(prefix) for prefix in ("image", "photo", "picture")) or text.endswith((".jpg", ".jpeg", ".png", ".gif")):
        return "image"
    if text.endswith((".3gp", ".mp4")):
        return "video"
    return None


def _extract_gps(record: dict) -> tuple[float | None, float | None]:
    lat = _clean_numeric_value(_first_nonempty(record, GPS_LAT_CANDIDATES))
    lon = _clean_numeric_value(_first_nonempty(record, GPS_LONG_CANDIDATES))
    if lat is not None and lon is not None:
        return lat, lon
    gps_value = _first_nonempty(record, GPS_CANDIDATES)
    if gps_value is None:
        return lat, lon
    parts = str(gps_value).strip().split()
    if len(parts) >= 2:
        return _clean_numeric_value(parts[0]), _clean_numeric_value(parts[1])
    return lat, lon


def _mark_sync_started(config: ListingPipelineConfig, instrument_code: str, message: str) -> None:
    if not db_enabled(config):
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO raw.sync_state (
                    instrument_code,
                    last_run_started_at,
                    last_status,
                    last_message,
                    updated_at
                )
                VALUES (%s, now(), %s, %s, now())
                ON CONFLICT (instrument_code) DO UPDATE SET
                    last_run_started_at = EXCLUDED.last_run_started_at,
                    last_status = EXCLUDED.last_status,
                    last_message = EXCLUDED.last_message,
                    updated_at = EXCLUDED.updated_at
                """,
                (instrument_code, "running", message),
            )
        conn.commit()


def _mark_sync_failed(config: ListingPipelineConfig, instrument_code: str, message: str) -> None:
    if not db_enabled(config):
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO raw.sync_state (
                    instrument_code,
                    last_run_finished_at,
                    last_status,
                    last_message,
                    updated_at
                )
                VALUES (%s, now(), %s, %s, now())
                ON CONFLICT (instrument_code) DO UPDATE SET
                    last_run_finished_at = EXCLUDED.last_run_finished_at,
                    last_status = EXCLUDED.last_status,
                    last_message = EXCLUDED.last_message,
                    updated_at = EXCLUDED.updated_at
                """,
                (instrument_code, "failed", message[:1000]),
            )
        conn.commit()


def mark_sync_started(
    config: ListingPipelineConfig,
    instrument_or_message: str,
    message: str | None = None,
) -> None:
    instrument_code = instrument_or_message if message is not None else LISTING_INSTRUMENT_CODE
    sync_message = message if message is not None else instrument_or_message
    _mark_sync_started(config, instrument_code, sync_message)


def mark_main_sync_started(config: ListingPipelineConfig, message: str) -> None:
    _mark_sync_started(config, MAIN_INSTRUMENT_CODE, message)


def mark_sync_failed(config: ListingPipelineConfig, message: str) -> None:
    _mark_sync_failed(config, LISTING_INSTRUMENT_CODE, message)


def mark_main_sync_failed(config: ListingPipelineConfig, message: str) -> None:
    _mark_sync_failed(config, MAIN_INSTRUMENT_CODE, message)


def mark_sync_finished(
    config: ListingPipelineConfig,
    instrument_code: str,
    status: str,
    message: str | None = None,
) -> None:
    if not db_enabled(config):
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            if status == "success":
                cur.execute(
                    """
                    INSERT INTO raw.sync_state (
                        instrument_code,
                        last_successful_completion_utc,
                        last_successful_sync_at,
                        last_successful_fetch_utc,
                        last_run_finished_at,
                        last_status,
                        last_message,
                        updated_at
                    )
                    VALUES (%s, NOW(), NOW(), NOW(), NOW(), %s, %s, NOW())
                    ON CONFLICT (instrument_code) DO UPDATE SET
                        last_successful_completion_utc = NOW(),
                        last_successful_sync_at = NOW(),
                        last_successful_fetch_utc = NOW(),
                        last_run_finished_at = NOW(),
                        last_status = EXCLUDED.last_status,
                        last_message = EXCLUDED.last_message,
                        updated_at = NOW()
                    """,
                    (instrument_code, status, message),
                )
            else:
                cur.execute(
                    """
                    INSERT INTO raw.sync_state (
                        instrument_code,
                        last_run_finished_at,
                        last_status,
                        last_message,
                        updated_at
                    )
                    VALUES (%s, NOW(), %s, %s, NOW())
                    ON CONFLICT (instrument_code) DO UPDATE SET
                        last_run_finished_at = NOW(),
                        last_status = EXCLUDED.last_status,
                        last_message = EXCLUDED.last_message,
                        updated_at = NOW()
                    """,
                    (instrument_code, status, message),
                )
        conn.commit()


def persist_listing_snapshot(
    config: ListingPipelineConfig,
    raw_df: pd.DataFrame,
    listing_long: pd.DataFrame,
    sampling_ea: pd.DataFrame,
    selected_long: pd.DataFrame,
    last_completion_utc: datetime | None,
    message: str,
) -> None:
    if not db_enabled(config):
        print("DATABASE_URL not set; skipping PostgreSQL load.")
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            _persist_raw_submissions(cur, raw_df)
            _replace_clean_snapshot(cur, raw_df, listing_long, sampling_ea, selected_long)
            cur.execute(
                """
                INSERT INTO raw.sync_state (
                    instrument_code,
                    last_successful_completion_utc,
                    last_run_finished_at,
                    last_status,
                    last_message,
                    updated_at
                )
                VALUES (%s, %s, now(), %s, %s, now())
                ON CONFLICT (instrument_code) DO UPDATE SET
                    last_successful_completion_utc = EXCLUDED.last_successful_completion_utc,
                    last_run_finished_at = EXCLUDED.last_run_finished_at,
                    last_status = EXCLUDED.last_status,
                    last_message = EXCLUDED.last_message,
                    updated_at = EXCLUDED.updated_at
                """,
                (LISTING_INSTRUMENT_CODE, _clean_scalar(last_completion_utc), "success", message[:1000]),
            )
        conn.commit()


def _persist_raw_submissions(cur, raw_df: pd.DataFrame) -> None:
    rows = []
    for _, row in raw_df.iterrows():
        record = _record_to_dict(row)
        submission_key = _clean_submission_key(record)
        if not submission_key:
            continue

        record_json = _json_text(record)
        rows.append(
            (
                LISTING_INSTRUMENT_CODE,
                submission_key,
                1,
                _clean_scalar(row.get("SubmissionDate")),
                _clean_scalar(row.get("CompletionDate")),
                _first_nonempty(record, INTERVIEWER_ID_CANDIDATES),
                record.get("deviceid") or record.get("device_id"),
                hashlib.sha256(record_json.encode("utf-8")).hexdigest(),
                record_json,
            )
        )

    if not rows:
        return

    cur.executemany(
        """
        INSERT INTO raw.surveycto_submission (
            instrument_code,
            submission_key,
            submission_version,
            submission_date,
            completion_date,
            interviewer_username,
            device_id,
            source_hash,
            raw_payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (instrument_code, submission_key, source_hash) DO NOTHING
        """,
        rows,
    )


def _persist_main_raw_submissions(
    cur,
    raw_df: pd.DataFrame,
    form_id: str | None = None,
    survey_month_override: str | None = None,
) -> None:
    rows = []
    for _, row in raw_df.iterrows():
        record = _record_to_dict(row)
        submission_key = _clean_submission_key(record)
        if not submission_key:
            continue

        record_json = _json_text(record)
        rows.append(
            (
                MAIN_INSTRUMENT_CODE,
                form_id,
                _clean_text_value(_first_nonempty(record, FORMDEF_VERSION_CANDIDATES)),
                _derive_survey_month(record, survey_month_override),
                submission_key,
                1,
                _clean_scalar(_first_nonempty(record, ("SubmissionDate", "start"))),
                _clean_scalar(_first_nonempty(record, ("CompletionDate", "end"))),
                _first_nonempty(record, INTERVIEWER_ID_CANDIDATES),
                record.get("deviceid") or record.get("device_id"),
                hashlib.sha256(record_json.encode("utf-8")).hexdigest(),
                record_json,
            )
        )

    if not rows:
        return

    _executemany_chunks(
        cur,
        """
        INSERT INTO raw.surveycto_submission (
            instrument_code,
            form_id,
            formdef_version,
            survey_month,
            submission_key,
            submission_version,
            submission_date,
            completion_date,
            interviewer_username,
            device_id,
            source_hash,
            raw_payload
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        ON CONFLICT (instrument_code, submission_key, source_hash) DO NOTHING
        """,
        rows,
        250,
    )


def _seed_panel_dictionary(cur) -> None:
    rows = [
        (panel_code, definition["label"], definition["section_prefix"], index)
        for index, (panel_code, definition) in enumerate(PANEL_DEFINITIONS.items(), start=1)
    ]
    cur.executemany(
        """
        INSERT INTO reference.panel_dictionary (
            panel_code, panel_label, section_prefix, sort_order, is_active, updated_at
        )
        VALUES (%s, %s, %s, %s, true, now())
        ON CONFLICT (panel_code) DO UPDATE SET
            panel_label = EXCLUDED.panel_label,
            section_prefix = EXCLUDED.section_prefix,
            sort_order = EXCLUDED.sort_order,
            is_active = true,
            updated_at = now()
        """,
        rows,
    )


def _upsert_main_form_versions(
    cur,
    raw_df: pd.DataFrame,
    form_id: str | None,
    survey_month_override: str | None = None,
) -> dict[tuple[str, str], str]:
    form_versions: dict[tuple[str, str], str] = {}
    if raw_df is None or raw_df.empty:
        return form_versions

    seen: set[tuple[str, str]] = set()
    for _, row in raw_df.iterrows():
        record = _record_to_dict(row)
        survey_month = _derive_survey_month(record, survey_month_override)
        formdef_version = _clean_text_value(_first_nonempty(record, FORMDEF_VERSION_CANDIDATES))
        if not survey_month or not formdef_version:
            continue
        seen.add((formdef_version, survey_month))

    for formdef_version, survey_month in sorted(seen):
        cur.execute(
            """
            INSERT INTO reference.form_version (
                instrument_code, form_id, formdef_version, survey_month, metadata, is_active
            )
            VALUES (%s, %s, %s, %s, %s::jsonb, true)
            ON CONFLICT (instrument_code, form_id, formdef_version, survey_month) DO UPDATE SET
                is_active = true,
                metadata = EXCLUDED.metadata,
                uploaded_at = now()
            RETURNING form_version_id
            """,
            (
                MAIN_INSTRUMENT_CODE,
                form_id or "unknown",
                formdef_version,
                survey_month,
                _json_text({"source": "surveycto_api", "column_count": len(raw_df.columns)}),
            ),
        )
        row = cur.fetchone() or {}
        form_versions[(formdef_version, survey_month)] = str(row.get("form_version_id"))

    return form_versions


def _upsert_main_question_versions(cur, raw_df: pd.DataFrame, form_versions: dict[tuple[str, str], str]) -> None:
    if not form_versions or raw_df is None or raw_df.empty:
        return

    variable_names = [str(column) for column in raw_df.columns]
    for form_version_id in form_versions.values():
        rows = []
        for sort_order, variable_name in enumerate(variable_names, start=1):
            answer_scope, panel_code, section_prefix = _answer_scope(variable_name)
            rows.append(
                (
                    form_version_id,
                    variable_name,
                    section_prefix,
                    panel_code,
                    answer_scope,
                    sort_order,
                    _json_text({"source": "surveycto_api"}),
                )
            )
        _executemany_chunks(
            cur,
            """
            INSERT INTO reference.question_version (
                form_version_id, variable_name, section_prefix, panel_code,
                answer_scope, sort_order, metadata
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (form_version_id, variable_name) DO UPDATE SET
                section_prefix = EXCLUDED.section_prefix,
                panel_code = EXCLUDED.panel_code,
                answer_scope = EXCLUDED.answer_scope,
                sort_order = EXCLUDED.sort_order,
                metadata = EXCLUDED.metadata
            """,
            rows,
            1000,
        )


def _replace_clean_snapshot(
    cur,
    raw_df: pd.DataFrame,
    listing_long: pd.DataFrame,
    sampling_ea: pd.DataFrame,
    selected_long: pd.DataFrame,
) -> None:
    submission_keys = sorted(
        {
            submission_key
            for submission_key in (_clean_submission_key(_record_to_dict(row)) for _, row in raw_df.iterrows())
            if submission_key
        }
    )

    if submission_keys:
        cur.execute("DELETE FROM clean.hh_listing_long WHERE submission_key = ANY(%s)", (submission_keys,))
        cur.execute("DELETE FROM clean.hh_selected_long WHERE submission_key = ANY(%s)", (submission_keys,))
        cur.execute("DELETE FROM clean.hh_sampling_ea WHERE submission_key = ANY(%s)", (submission_keys,))
        cur.execute("DELETE FROM clean.deleted_listing_rows WHERE submission_key = ANY(%s)", (submission_keys,))

    sampling_rows = []
    for _, row in sampling_ea.iterrows():
        record = _record_to_dict(row)
        submission_key = _clean_submission_key(record)
        if not submission_key:
            continue

        sampling_rows.append(
            (
                submission_key,
                _first_nonempty(record, EA_ID_CANDIDATES),
                _first_nonempty(record, BOUNDARY_ID_CANDIDATES),
                _first_nonempty(record, INTERVIEWER_ID_CANDIDATES),
                _first_nonempty(record, SUPERVISOR_ID_CANDIDATES),
                _clean_scalar(row.get("SubmissionDate")),
                _clean_scalar(row.get("CompletionDate")),
                str(record.get("approval_status") or "submitted"),
                _json_text(record),
            )
        )

    if sampling_rows:
        cur.executemany(
            """
            INSERT INTO clean.hh_sampling_ea (
                submission_key,
                ea_id,
                boundary_id,
                interviewer_id,
                supervisor_id,
                submission_date,
                completion_date,
                approval_status,
                record
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (submission_key) DO UPDATE SET
                ea_id = EXCLUDED.ea_id,
                boundary_id = EXCLUDED.boundary_id,
                interviewer_id = EXCLUDED.interviewer_id,
                supervisor_id = EXCLUDED.supervisor_id,
                submission_date = EXCLUDED.submission_date,
                completion_date = EXCLUDED.completion_date,
                approval_status = EXCLUDED.approval_status,
                record = EXCLUDED.record,
                updated_at = now()
            """,
            sampling_rows,
        )

    selected_rows = []
    for _, row in selected_long.iterrows():
        record = _record_to_dict(row)
        submission_key = _clean_submission_key(record)
        selected_repeat_no = row.get("selected_repeat_no")
        if not submission_key or _is_missing(selected_repeat_no):
            continue

        selected_rows.append(
            (
                submission_key,
                int(selected_repeat_no),
                record.get("selected_join_key"),
                record.get("sample_case_id") or record.get("case_id"),
                record.get("sample_case_label") or record.get("case_label"),
                record.get("slot_type") or record.get("sample_status"),
                _json_text(record),
            )
        )

    if selected_rows:
        cur.executemany(
            """
            INSERT INTO clean.hh_selected_long (
                submission_key,
                selected_repeat_no,
                selected_join_key,
                sample_case_id,
                sample_case_label,
                slot_type,
                record
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (submission_key, selected_repeat_no) DO UPDATE SET
                selected_join_key = EXCLUDED.selected_join_key,
                sample_case_id = EXCLUDED.sample_case_id,
                sample_case_label = EXCLUDED.sample_case_label,
                slot_type = EXCLUDED.slot_type,
                record = EXCLUDED.record
            """,
            selected_rows,
        )

    listing_rows = []
    discarded_listing_rows = []
    for _, row in listing_long.iterrows():
        record = _record_to_dict(row)
        submission_key = _clean_submission_key(record)
        if not submission_key:
            continue

        building_no = None if _is_missing(row.get("building_no")) else int(row.get("building_no"))
        household_no = None if _is_missing(row.get("household_no_within_building")) else int(row.get("household_no_within_building"))
        sample_flag = bool(row.get("sample_flag")) if not _is_missing(row.get("sample_flag")) else False
        bld_last_another = str(record.get("bld_last_another") or "").strip()

        if bld_last_another in {"0", "0.0"}:
            discarded_listing_rows.append(
                (
                    submission_key,
                    str(record.get("row_type") or "household"),
                    building_no,
                    household_no,
                    "bld_last_another=0",
                    _json_text(record),
                )
            )
            continue

        listing_rows.append(
            (
                submission_key,
                _first_nonempty(record, EA_ID_CANDIDATES),
                _first_nonempty(record, BOUNDARY_ID_CANDIDATES),
                _first_nonempty(record, INTERVIEWER_ID_CANDIDATES),
                _first_nonempty(record, SUPERVISOR_ID_CANDIDATES),
                building_no,
                household_no,
                record.get("listing_join_key"),
                record.get("selected_join_key"),
                record.get("sample_case_id"),
                _first_nonempty(record, HOUSEHOLD_UID_CANDIDATES),
                str(record.get("row_type") or "household"),
                sample_flag,
                _clean_scalar(row.get("gps_lat")),
                _clean_scalar(row.get("gps_long")),
                record.get("gps_source"),
                str(record.get("approval_status") or "submitted"),
                _json_text(record),
            )
        )

    if discarded_listing_rows:
        cur.executemany(
            """
            INSERT INTO clean.deleted_listing_rows (
                submission_key,
                row_type,
                building_no,
                household_no_within_building,
                discard_reason,
                record
            )
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            """,
            discarded_listing_rows,
        )

    if listing_rows:
        cur.executemany(
            """
            INSERT INTO clean.hh_listing_long (
                submission_key,
                ea_id,
                boundary_id,
                interviewer_id,
                supervisor_id,
                building_no,
                household_no_within_building,
                listing_join_key,
                selected_join_key,
                sample_case_id,
                household_uid,
                row_type,
                sample_flag,
                gps_lat,
                gps_long,
                gps_source,
                approval_status,
                record
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (submission_key, row_type, building_no, household_no_within_building) DO UPDATE SET
                ea_id = EXCLUDED.ea_id,
                boundary_id = EXCLUDED.boundary_id,
                interviewer_id = EXCLUDED.interviewer_id,
                supervisor_id = EXCLUDED.supervisor_id,
                listing_join_key = EXCLUDED.listing_join_key,
                selected_join_key = EXCLUDED.selected_join_key,
                sample_case_id = EXCLUDED.sample_case_id,
                household_uid = EXCLUDED.household_uid,
                sample_flag = EXCLUDED.sample_flag,
                gps_lat = EXCLUDED.gps_lat,
                gps_long = EXCLUDED.gps_long,
                gps_source = EXCLUDED.gps_source,
                approval_status = EXCLUDED.approval_status,
                record = EXCLUDED.record,
                updated_at = now()
            """,
            listing_rows,
        )


def _persist_main_data_error_audit(cur, audit_df: pd.DataFrame, replace_case_ids: list[str] | None = None) -> None:
    cur.execute("""
        CREATE TABLE IF NOT EXISTS clean.main_data_error_audit (
            audit_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            submission_key text,
            case_id text,
            caseid text,
            variable_name text NOT NULL,
            old_value text,
            new_value text,
            check_flag text,
            imputation_flag text,
            reason text,
            cleaning_rule text,
            synced_at timestamptz,
            cleaned_at timestamptz NOT NULL DEFAULT now(),
            created_at timestamptz NOT NULL DEFAULT now()
        )
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_main_data_error_audit_case
            ON clean.main_data_error_audit (case_id, variable_name)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_main_data_error_audit_synced
            ON clean.main_data_error_audit (synced_at)
    """)

    if replace_case_ids is not None:
        case_ids = sorted({str(v).strip() for v in replace_case_ids if str(v).strip()})
    elif audit_df is not None and not audit_df.empty:
        case_ids = sorted({str(v).strip() for v in audit_df.get("case_id", pd.Series(dtype=object)).dropna() if str(v).strip()})
    else:
        case_ids = []

    if case_ids:
        cur.execute("DELETE FROM clean.main_data_error_audit WHERE case_id = ANY(%s)", (case_ids,))

    if audit_df is None or audit_df.empty:
        return

    rows = []
    for _, row in audit_df.iterrows():
        rows.append((
            _clean_scalar(row.get("submission_key")),
            _clean_scalar(row.get("case_id")),
            _clean_scalar(row.get("caseid")),
            str(row.get("variable_name") or ""),
            _clean_scalar(row.get("old_value")),
            _clean_scalar(row.get("new_value")),
            _clean_scalar(row.get("check_flag")),
            _clean_scalar(row.get("imputation_flag")),
            _clean_scalar(row.get("reason")),
            _clean_scalar(row.get("cleaning_rule")),
            _clean_scalar(row.get("synced_at")),
            _clean_scalar(row.get("cleaned_at")),
        ))

    if rows:
        cur.executemany("""
            INSERT INTO clean.main_data_error_audit (
                submission_key, case_id, caseid, variable_name, old_value, new_value,
                check_flag, imputation_flag, reason, cleaning_rule, synced_at, cleaned_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, rows)


def persist_main_snapshot(
    config: ListingPipelineConfig,
    raw_df: pd.DataFrame,
    main_case_df: pd.DataFrame,
    main_section_df: pd.DataFrame,
    main_roster_df: pd.DataFrame,
    cleaning_audit_df: pd.DataFrame | None,
    last_completion_utc: datetime | None,
    message: str,
    *,
    refresh_aggregate_marts: bool = True,
) -> None:
    if not db_enabled(config):
        print("DATABASE_URL not set; skipping PostgreSQL load.")
        return

    survey_month_override = _infer_config_survey_month(config)
    if survey_month_override:
        print(f"Using tracker survey_month from XLSForm/config: {survey_month_override}")

    with _connect(config) as conn:
        with conn.cursor() as cur:
            _persist_main_raw_submissions(cur, raw_df, getattr(config, "form_id", None), survey_month_override)
            _seed_panel_dictionary(cur)
            form_versions = _upsert_main_form_versions(cur, raw_df, getattr(config, "form_id", None), survey_month_override)
            _upsert_main_question_versions(cur, raw_df, form_versions)
            _replace_main_snapshot(
                cur,
                main_case_df,
                main_section_df,
                main_roster_df,
                getattr(config, "form_id", None),
                survey_month_override,
            )
            _persist_main_data_error_audit(cur, cleaning_audit_df)
            incremental_case_ids = None
            if not refresh_aggregate_marts and main_case_df is not None and not main_case_df.empty:
                incremental_case_ids = main_case_df["case_id"].dropna().astype(str).tolist()
            _refresh_mart_main_case_dim(cur, incremental_case_ids)
            # These legacy aggregate tables repeatedly scan the full answer
            # dataset. The active dashboard is refreshed from
            # mart.bht_case_overview_dim after a successful sync, so hourly
            # incremental runs do not need to rebuild them. Keep the full
            # refresh for explicit reconciliation/rebuild jobs.
            if refresh_aggregate_marts:
                _refresh_bht_marts(cur)
                _refresh_bht_overview_distribution(cur)
                _refresh_bht_category_kpi(cur)
            cur.execute(
                """
                INSERT INTO raw.sync_state (
                    instrument_code,
                    last_successful_completion_utc,
                    last_run_finished_at,
                    last_status,
                    last_message,
                    updated_at
                )
                VALUES (%s, %s, now(), %s, %s, now())
                ON CONFLICT (instrument_code) DO UPDATE SET
                    last_successful_completion_utc = EXCLUDED.last_successful_completion_utc,
                    last_run_finished_at = EXCLUDED.last_run_finished_at,
                    last_status = EXCLUDED.last_status,
                    last_message = EXCLUDED.last_message,
                    updated_at = EXCLUDED.updated_at
                """,
                (MAIN_INSTRUMENT_CODE, _clean_scalar(last_completion_utc), "success", message[:1000]),
            )
        conn.commit()


def persist_main_cleaning_backfill(
    config: ListingPipelineConfig,
    main_case_df: pd.DataFrame,
    main_section_df: pd.DataFrame,
    main_roster_df: pd.DataFrame,
    cleaning_audit_df: pd.DataFrame | None,
    message: str,
) -> None:
    """Persist a Main Survey cleaning backfill without moving SurveyCTO sync checkpoints."""
    if not db_enabled(config):
        print("DATABASE_URL not set; skipping PostgreSQL backfill load.")
        return

    with _connect(config) as conn:
        with conn.cursor() as cur:
            _replace_main_snapshot(cur, main_case_df, main_section_df, main_roster_df)
            replace_case_ids = []
            if main_case_df is not None and not main_case_df.empty and "case_id" in main_case_df.columns:
                replace_case_ids = main_case_df["case_id"].dropna().astype(str).tolist()
            _persist_main_data_error_audit(cur, cleaning_audit_df, replace_case_ids=replace_case_ids)
            _refresh_mart_main_case_dim(cur)
            cur.execute(
                """
                INSERT INTO raw.sync_state (
                    instrument_code,
                    last_run_finished_at,
                    last_status,
                    last_message,
                    updated_at
                )
                VALUES (%s, now(), %s, %s, now())
                ON CONFLICT (instrument_code) DO UPDATE SET
                    last_run_finished_at = EXCLUDED.last_run_finished_at,
                    last_status = EXCLUDED.last_status,
                    last_message = EXCLUDED.last_message,
                    updated_at = EXCLUDED.updated_at
                """,
                (MAIN_INSTRUMENT_CODE, "success", message[:1000]),
            )
        conn.commit()


def _refresh_mart_main_case_dim(cur, case_ids: list[str] | None = None) -> None:
    """Refresh mart.main_case_dim, optionally only for selected cases."""
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS mart.main_case_dim (
            case_id text PRIMARY KEY REFERENCES clean.main_case (case_id) ON DELETE CASCADE,
            submission_key text,
            approval_stage text,
            state_name text,
            gender text,
            age_group text,
            sec_class text,
            interview_month text,
            ea_id text,
            ea_name text,
            final_outcome_code text,
            slot_type text,
            supacc_confirm text,
            updated_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    for column_sql in (
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS survey_month text",
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS formdef_version text",
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS city_code text",
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS sector_code text",
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS ea_id text",
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS ea_name text",
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS final_outcome_code text",
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS slot_type text",
        "ALTER TABLE IF EXISTS mart.main_case_dim ADD COLUMN IF NOT EXISTS supacc_confirm text",
    ):
        cur.execute(column_sql)

    selected_case_ids = [str(case_id).strip() for case_id in (case_ids or []) if str(case_id).strip()]
    if selected_case_ids:
        cur.execute("DELETE FROM mart.main_case_dim WHERE case_id = ANY(%s)", (selected_case_ids,))
        case_scope_sql = "WHERE m.case_id = ANY(%s)"
        case_scope_params: tuple[Any, ...] = (selected_case_ids,)
    else:
        cur.execute("TRUNCATE mart.main_case_dim")
        case_scope_sql = ""
        case_scope_params = ()
    cur.execute(
        f"""
        INSERT INTO mart.main_case_dim (
            case_id, submission_key, approval_stage, state_name,
            gender, age_group, sec_class, interview_month,
            survey_month, formdef_version, city_code, sector_code,
            ea_id, ea_name, final_outcome_code, slot_type, supacc_confirm,
            updated_at
        )
        SELECT
            m.case_id,
            m.submission_key,
            m.approval_stage,
            COALESCE(
                NULLIF(TRIM(m.record->>'state_name'), ''),
                NULLIF(TRIM(m.record->>'sd_STATE_NAME'), ''),
                NULLIF(TRIM(m.record->>'STATE_NA'), ''),
                NULLIF(TRIM(g.state_name), ''),
                NULLIF(TRIM(g.properties->>'sd_STATE_NAME'), ''),
                'Unknown'
            ),
            NULLIF(TRIM(ed.record->>'E1'), ''),
            NULLIF(TRIM(ed.record->>'E_agegroup'), ''),
            NULLIF(TRIM(ed.record->>'sec'), ''),
            to_char(m.submitted_at AT TIME ZONE 'UTC', 'YYYY-MM'),
            m.survey_month,
            m.formdef_version,
            m.city_code,
            m.sector_code,
            COALESCE(NULLIF(TRIM(m.ea_id), ''), NULLIF(TRIM(m.record->>'ea_id'), '')),
            COALESCE(
                NULLIF(TRIM(m.record->>'ea_name'), ''),
                NULLIF(TRIM(m.record->>'sd_EA_NAME'), ''),
                NULLIF(TRIM(m.record->>'EA_NAME'), ''),
                NULLIF(TRIM(g.properties->>'sd_EA_NAME'), ''),
                NULLIF(TRIM(m.record->>'name'), ''),
                REGEXP_REPLACE(COALESCE(NULLIF(TRIM(m.ea_id), ''), NULLIF(TRIM(m.record->>'ea_id'), '')), '\\.0+$', '')
            ),
            TRIM(LOWER(COALESCE(m.record->>'final_outcome_code', ''))),
            TRIM(LOWER(COALESCE(m.record->>'slot_type', ''))),
            LOWER(COALESCE(NULLIF(TRIM(m.record->>'accomp'), ''), NULLIF(TRIM(m.record->>'supacc_confirm'), ''), '')),
            now()
        FROM clean.main_case m
        LEFT JOIN reference.geo_boundaries_ea g
            ON g.ea_id = REGEXP_REPLACE(COALESCE(NULLIF(TRIM(m.ea_id), ''), NULLIF(TRIM(m.record->>'ea_id'), '')), '\\.0+$', '')
        LEFT JOIN LATERAL (
            SELECT s.record
            FROM clean.main_case_section s
            WHERE s.case_id = m.case_id
              AND s.section_name = 'E. DEMOGRAPHICS'
              AND s.row_no = 1
            LIMIT 1
        ) ed ON true
        {case_scope_sql}
        """,
        case_scope_params,
    )


def _refresh_bht_marts(cur) -> None:
    cur.execute(
        """
        INSERT INTO mart.bht_monthly_kpi (
            survey_month, total_cases, complete_cases, reviewed_cases,
            approved_cases, rejected_cases, unique_interviewers, updated_at
        )
        SELECT
            COALESCE(survey_month, 'unknown') AS survey_month,
            COUNT(*)::int AS total_cases,
            COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::int AS complete_cases,
            COUNT(*) FILTER (
                WHERE current_status IN ('in_review', 'approved', 'rejected')
                   OR approval_stage IN ('under_review', 'approved', 'rejected')
            )::int AS reviewed_cases,
            COUNT(*) FILTER (
                WHERE current_status = 'approved' OR approval_stage = 'approved'
            )::int AS approved_cases,
            COUNT(*) FILTER (
                WHERE current_status = 'rejected' OR approval_stage = 'rejected'
            )::int AS rejected_cases,
            COUNT(DISTINCT COALESCE(NULLIF(interviewer_id, ''), NULLIF(username, '')))::int AS unique_interviewers,
            now()
        FROM clean.main_case
        GROUP BY COALESCE(survey_month, 'unknown')
        ON CONFLICT (survey_month) DO UPDATE SET
            total_cases = EXCLUDED.total_cases,
            complete_cases = EXCLUDED.complete_cases,
            reviewed_cases = EXCLUDED.reviewed_cases,
            approved_cases = EXCLUDED.approved_cases,
            rejected_cases = EXCLUDED.rejected_cases,
            unique_interviewers = EXCLUDED.unique_interviewers,
            updated_at = now()
        """
    )
    cur.execute(
        """
        INSERT INTO mart.bht_panel_summary (
            survey_month, panel_code, panel_label, case_count, updated_at
        )
        SELECT
            COALESCE(survey_month, 'unknown') AS survey_month,
            panel_code,
            COALESCE(MAX(panel_label), panel_code) AS panel_label,
            COUNT(DISTINCT case_id)::int AS case_count,
            now()
        FROM clean.main_case_panel
        WHERE is_selected
        GROUP BY COALESCE(survey_month, 'unknown'), panel_code
        ON CONFLICT (survey_month, panel_code) DO UPDATE SET
            panel_label = EXCLUDED.panel_label,
            case_count = EXCLUDED.case_count,
            updated_at = now()
        """
    )
    cur.execute(
        """
        INSERT INTO mart.bht_omnibus_summary (
            survey_month, variable_name, answer_value, case_count, updated_at
        )
        SELECT
            COALESCE(survey_month, 'unknown') AS survey_month,
            variable_name,
            COALESCE(NULLIF(value_text, ''), '[missing]') AS answer_value,
            COUNT(DISTINCT case_id)::int AS case_count,
            now()
        FROM clean.main_case_answer
        WHERE answer_scope = 'omnibus'
          AND value_text IS NOT NULL
        GROUP BY COALESCE(survey_month, 'unknown'), variable_name, COALESCE(NULLIF(value_text, ''), '[missing]')
        ON CONFLICT (survey_month, variable_name, answer_value) DO UPDATE SET
            case_count = EXCLUDED.case_count,
            updated_at = now()
        """
    )


def _refresh_bht_overview_distribution(cur) -> None:
    category_rows = [
        ("omnibus", "Omnibus", None),
        ("noodles", "Noodles", "Panel_1"),
        ("toothpaste", "Toothpaste", "Panel_2"),
        ("edible-oil", "Edible Oil", "Panel_3"),
        ("bleach", "Bleach", "Panel_4"),
        ("toilet-cleaner", "Toilet Cleaner", "Panel_5"),
        ("snacks", "Snacks", "Panel_6"),
        ("breakfast-cereals", "Breakfast Cereals", "Panel_7"),
        ("condiment-mixes", "Condiment Mixes", "Panel_8"),
        ("wet-hair", "Wet Hair", "Panel_9"),
        ("dry-hair", "Dry Hair", "Panel_10"),
        ("malt", "Malt", "Panel_11"),
    ]
    distribution_rows = [
        ("region", "Region", "City_1", {"1": "Lagos", "2": "Ibadan", "3": "Abuja", "4": "Kano", "5": "Kaduna", "6": "PHC", "7": "Benin", "8": "Onitsha", "9": "Enugu", "10": "Owerri", "11": "Jos", "12": "Uyo", "13": "Ilorin", "14": "Sokoto", "15": "Warri"}),
        ("income", "Income", "d3_q", {"1": "Less than N150,000", "2": "N150,001 - N300,000", "3": "N300,001 - N500,000", "4": "N500,001 - N800,000", "5": "N800,001 - N1,000,000", "6": "Above 1,000,000", "7": "Have no income", "8": "Don't know/refused"}),
        ("sec", "SEC", "SEC", {}),
        ("week", "Week", "Week", {"1": "Week 1", "2": "Week 2", "3": "Week 3", "4": "Week 4"}),
        ("gender", "Gender", "Gender", {"1": "Male", "2": "Female"}),
        ("age", "Age", "Age_cal", {}),
    ]

    cur.execute("TRUNCATE mart.bht_overview_distribution")
    insert_sql = """
        WITH scoped AS (
            SELECT
                COALESCE(m.survey_month, 'unknown') AS survey_month,
                m.case_id,
                COALESCE(NULLIF(TRIM(m.record->>%s), ''), '(No response)') AS answer_value
            FROM clean.main_case m
            WHERE m.record ? %s
              AND (%s::text IS NULL OR EXISTS (
                  SELECT 1
                  FROM clean.main_case_panel p
                  WHERE p.case_id = m.case_id
                    AND p.panel_code = %s
                    AND p.is_selected
              ))
        ),
        counts AS (
            SELECT survey_month, answer_value, COUNT(DISTINCT case_id)::int AS case_count
            FROM scoped
            GROUP BY survey_month, answer_value
        ),
        bases AS (
            SELECT survey_month, SUM(case_count)::int AS base_count
            FROM counts
            GROUP BY survey_month
        )
        INSERT INTO mart.bht_overview_distribution (
            survey_month, category_slug, panel_code, distribution_key,
            distribution_title, variable_name, answer_value, answer_label,
            case_count, base_count, pct, updated_at
        )
        SELECT
            c.survey_month,
            %s,
            %s,
            %s,
            %s,
            %s,
            c.answer_value,
            COALESCE(%s::jsonb ->> regexp_replace(c.answer_value, '\\.0$', ''), %s::jsonb ->> c.answer_value, c.answer_value),
            c.case_count,
            b.base_count,
            CASE WHEN b.base_count > 0 THEN ROUND((c.case_count::numeric / b.base_count::numeric) * 100, 4) ELSE 0 END,
            now()
        FROM counts c
        JOIN bases b ON b.survey_month = c.survey_month
    """
    for category_slug, _category_label, panel_code in category_rows:
        for distribution_key, distribution_title, variable_name, labels in distribution_rows:
            labels_json = _json_text(labels)
            cur.execute(
                insert_sql,
                (
                    variable_name,
                    variable_name,
                    panel_code,
                    panel_code,
                    category_slug,
                    panel_code,
                    distribution_key,
                    distribution_title,
                    variable_name,
                    labels_json,
                    labels_json,
                ),
            )


def _refresh_bht_category_kpi(cur) -> None:
    category_rows = [
        ("omnibus", None),
        ("noodles", "Panel_1"),
        ("toothpaste", "Panel_2"),
        ("edible-oil", "Panel_3"),
        ("bleach", "Panel_4"),
        ("toilet-cleaner", "Panel_5"),
        ("snacks", "Panel_6"),
        ("breakfast-cereals", "Panel_7"),
        ("condiment-mixes", "Panel_8"),
        ("wet-hair", "Panel_9"),
        ("dry-hair", "Panel_10"),
        ("malt", "Panel_11"),
    ]
    cur.execute("TRUNCATE mart.bht_category_kpi")
    insert_sql = """
        WITH months AS (
            SELECT survey_month, COUNT(*)::int AS total_case_count
            FROM clean.main_case
            GROUP BY survey_month
        ),
        scoped_cases AS (
            SELECT m.survey_month, m.case_id
            FROM clean.main_case m
            WHERE %s::text IS NULL OR EXISTS (
                SELECT 1
                FROM clean.main_case_panel p
                WHERE p.case_id = m.case_id
                  AND p.panel_code = %s
                  AND p.is_selected
            )
        ),
        case_counts AS (
            SELECT survey_month, COUNT(DISTINCT case_id)::int AS category_case_count
            FROM scoped_cases
            GROUP BY survey_month
        ),
        answer_counts AS (
            SELECT a.survey_month, COUNT(*)::int AS omnibus_answer_count
            FROM clean.main_case_answer a
            WHERE a.answer_scope = 'omnibus'
              AND (%s::text IS NULL OR EXISTS (
                  SELECT 1
                  FROM clean.main_case_panel p
                  WHERE p.case_id = a.case_id
                    AND p.panel_code = %s
                    AND p.is_selected
              ))
            GROUP BY a.survey_month
        ),
        media_counts AS (
            SELECT media.survey_month, COUNT(*)::int AS media_file_count
            FROM clean.main_case_media media
            WHERE %s::text IS NULL OR EXISTS (
                SELECT 1
                FROM clean.main_case_panel p
                WHERE p.case_id = media.case_id
                  AND p.panel_code = %s
                  AND p.is_selected
            )
            GROUP BY media.survey_month
        )
        INSERT INTO mart.bht_category_kpi (
            survey_month, category_slug, panel_code, total_case_count,
            category_case_count, omnibus_answer_count, media_file_count, updated_at
        )
        SELECT
            months.survey_month,
            %s,
            %s,
            months.total_case_count,
            COALESCE(case_counts.category_case_count, 0),
            COALESCE(answer_counts.omnibus_answer_count, 0),
            COALESCE(media_counts.media_file_count, 0),
            now()
        FROM months
        LEFT JOIN case_counts ON case_counts.survey_month = months.survey_month
        LEFT JOIN answer_counts ON answer_counts.survey_month = months.survey_month
        LEFT JOIN media_counts ON media_counts.survey_month = months.survey_month
    """
    for category_slug, panel_code in category_rows:
        cur.execute(
            insert_sql,
            (panel_code, panel_code, panel_code, panel_code, panel_code, panel_code, category_slug, panel_code),
        )


def _replace_main_snapshot(
    cur,
    main_case_df: pd.DataFrame,
    main_section_df: pd.DataFrame,
    main_roster_df: pd.DataFrame,
    form_id: str | None = None,
    survey_month_override: str | None = None,
) -> None:
    """Refresh ETL-owned Main Survey data while preserving app workflow state.

    This sync intentionally keeps live review/workflow fields already stored on
    clean.main_case, such as approval_stage, current_status, callback flags, and
    review timestamps. Only source-owned fields from SurveyCTO are refreshed.
    """
    case_ids = sorted(
        {
            case_id
            for case_id in (
                _clean_case_id(_record_to_dict(row)) or _clean_submission_key(_record_to_dict(row))
                for _, row in main_case_df.iterrows()
            )
            if case_id
        }
    )

    if case_ids:
        # Section/roster snapshots are ETL-owned and can be rebuilt safely.
        # The live clean.main_case row itself must be preserved because it also
        # stores application workflow state for already-reviewed cases.
        cur.execute("DELETE FROM clean.main_case_media WHERE case_id = ANY(%s)", (case_ids,))
        cur.execute("DELETE FROM clean.main_case_answer WHERE case_id = ANY(%s)", (case_ids,))
        cur.execute("DELETE FROM clean.main_case_panel WHERE case_id = ANY(%s)", (case_ids,))
        cur.execute("DELETE FROM clean.main_case_roster WHERE case_id = ANY(%s)", (case_ids,))
        cur.execute("DELETE FROM clean.main_case_section WHERE case_id = ANY(%s)", (case_ids,))

    case_rows = []
    panel_rows = []
    answer_rows = []
    media_rows = []
    for _, row in main_case_df.iterrows():
        record = _record_to_dict(row)
        submission_key = _clean_submission_key(record)
        case_id = _clean_case_id(record) or submission_key
        if not submission_key or not case_id:
            continue

        source_record = _record_to_dict(row.get("record") or {})
        survey_month = _derive_survey_month(source_record, survey_month_override)
        formdef_version = _clean_text_value(_first_nonempty(source_record, FORMDEF_VERSION_CANDIDATES))
        gps_lat, gps_long = _extract_gps(source_record)

        case_rows.append(
            (
                submission_key,
                case_id,
                _clean_text_value(source_record.get("form_id")) or form_id,
                formdef_version,
                survey_month,
                _clean_text_value(_first_nonempty(source_record, INSTANCE_ID_CANDIDATES)),
                record.get("ea_id"),
                record.get("interviewer_id"),
                record.get("supervisor_id"),
                _clean_text_value(source_record.get("username")),
                _clean_text_value(_first_nonempty(source_record, CITY_CODE_CANDIDATES)),
                _clean_text_value(_first_nonempty(source_record, SECTOR_CODE_CANDIDATES)),
                _clean_text_value(_first_nonempty(source_record, ADDRESS_CANDIDATES)),
                gps_lat,
                gps_long,
                _clean_text_value(_first_nonempty(source_record, REVIEW_STATUS_CANDIDATES)),
                _clean_text_value(_first_nonempty(source_record, REVIEW_QUALITY_CANDIDATES)),
                str(record.get("current_status") or "submitted"),
                str(record.get("approval_stage") or "pending_review"),
                _clean_scalar(row.get("submitted_at")),
                _clean_scalar(row.get("reviewed_at")),
                _clean_scalar(row.get("approved_at")),
                bool(row.get("is_callback_required")) if not _is_missing(row.get("is_callback_required")) else False,
                _json_text(_record_to_dict(row.get("record") or {})),
            )
        )

        for panel_code, definition in PANEL_DEFINITIONS.items():
            if not _is_truthy_panel_flag(source_record.get(panel_code)):
                continue
            panel_rows.append(
                (
                    case_id,
                    survey_month,
                    formdef_version,
                    panel_code,
                    definition["label"],
                    definition["section_prefix"],
                    True,
                )
            )

        for variable_name, value in source_record.items():
            if _is_missing(value):
                continue
            variable_name = str(variable_name)
            text_value = _clean_text_value(value)
            if text_value is None:
                continue
            media_type = _media_type(variable_name, value)
            if media_type:
                media_rows.append(
                    (
                        case_id,
                        submission_key,
                        survey_month,
                        formdef_version,
                        variable_name,
                        media_type,
                        Path(text_value).name,
                        text_value,
                    )
                )
            answer_scope, panel_code, section_prefix = _answer_scope(variable_name)
            if answer_scope != "omnibus":
                continue
            answer_rows.append(
                (
                    case_id,
                    submission_key,
                    survey_month,
                    formdef_version,
                    answer_scope,
                    panel_code,
                    section_prefix,
                    variable_name,
                    text_value,
                    _clean_numeric_value(value),
                    _clean_boolean_value(value),
                    _json_text({"value": _jsonable(value)}),
                    False,
                )
            )

    if case_rows:
        _executemany_chunks(
            cur,
            """
            INSERT INTO clean.main_case (
                submission_key,
                case_id,
                form_id,
                formdef_version,
                survey_month,
                instance_id,
                ea_id,
                interviewer_id,
                supervisor_id,
                username,
                city_code,
                sector_code,
                address,
                gps_lat,
                gps_long,
                review_status,
                review_quality,
                current_status,
                approval_stage,
                submitted_at,
                reviewed_at,
                approved_at,
                is_callback_required,
                record
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (case_id) DO UPDATE SET
                submission_key = EXCLUDED.submission_key,
                form_id = EXCLUDED.form_id,
                formdef_version = EXCLUDED.formdef_version,
                survey_month = EXCLUDED.survey_month,
                instance_id = EXCLUDED.instance_id,
                ea_id = EXCLUDED.ea_id,
                interviewer_id = EXCLUDED.interviewer_id,
                supervisor_id = EXCLUDED.supervisor_id,
                username = EXCLUDED.username,
                city_code = EXCLUDED.city_code,
                sector_code = EXCLUDED.sector_code,
                address = EXCLUDED.address,
                gps_lat = EXCLUDED.gps_lat,
                gps_long = EXCLUDED.gps_long,
                review_status = EXCLUDED.review_status,
                review_quality = EXCLUDED.review_quality,
                -- Preserve app-owned workflow fields on live projects.
                current_status = clean.main_case.current_status,
                approval_stage = clean.main_case.approval_stage,
                submitted_at = COALESCE(clean.main_case.submitted_at, EXCLUDED.submitted_at),
                reviewed_at = clean.main_case.reviewed_at,
                approved_at = clean.main_case.approved_at,
                is_callback_required = clean.main_case.is_callback_required,
                record = EXCLUDED.record,
                updated_at = now()
            """,
            case_rows,
            500,
        )

    if panel_rows:
        _executemany_chunks(
            cur,
            """
            INSERT INTO clean.main_case_panel (
                case_id, survey_month, formdef_version, panel_code,
                panel_label, section_prefix, is_selected
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (case_id, panel_code) DO UPDATE SET
                survey_month = EXCLUDED.survey_month,
                formdef_version = EXCLUDED.formdef_version,
                panel_label = EXCLUDED.panel_label,
                section_prefix = EXCLUDED.section_prefix,
                is_selected = EXCLUDED.is_selected,
                updated_at = now()
            """,
            panel_rows,
            1000,
        )

    if answer_rows:
        _executemany_chunks(
            cur,
            """
            INSERT INTO clean.main_case_answer (
                case_id, submission_key, survey_month, formdef_version,
                answer_scope, panel_code, section_prefix, variable_name,
                value_text, value_numeric, value_boolean, value_json, is_missing
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
            ON CONFLICT (case_id, variable_name) DO UPDATE SET
                submission_key = EXCLUDED.submission_key,
                survey_month = EXCLUDED.survey_month,
                formdef_version = EXCLUDED.formdef_version,
                answer_scope = EXCLUDED.answer_scope,
                panel_code = EXCLUDED.panel_code,
                section_prefix = EXCLUDED.section_prefix,
                value_text = EXCLUDED.value_text,
                value_numeric = EXCLUDED.value_numeric,
                value_boolean = EXCLUDED.value_boolean,
                value_json = EXCLUDED.value_json,
                is_missing = EXCLUDED.is_missing,
                updated_at = now()
            """,
            answer_rows,
            1000,
        )

    if media_rows:
        _executemany_chunks(
            cur,
            """
            INSERT INTO clean.main_case_media (
                case_id, submission_key, survey_month, formdef_version,
                variable_name, media_type, file_name, surveycto_path
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (case_id, variable_name) DO UPDATE SET
                submission_key = EXCLUDED.submission_key,
                survey_month = EXCLUDED.survey_month,
                formdef_version = EXCLUDED.formdef_version,
                media_type = EXCLUDED.media_type,
                file_name = EXCLUDED.file_name,
                surveycto_path = EXCLUDED.surveycto_path,
                updated_at = now()
            """,
            media_rows,
            1000,
        )

    section_rows = []
    for _, row in main_section_df.iterrows():
        case_id = None if _is_missing(row.get("case_id")) else str(row.get("case_id")).strip()
        section_name = None if _is_missing(row.get("section_name")) else str(row.get("section_name")).strip()
        row_no = row.get("row_no")
        payload = row.get("record") or {}
        if not case_id or _is_missing(row_no) or not section_name:
            continue

        section_rows.append(
            (
                str(case_id).strip(),
                str(section_name).strip(),
                int(row_no),
                _json_text(_record_to_dict(payload)),
            )
        )

    if section_rows:
        cur.executemany(
            """
            INSERT INTO clean.main_case_section (
                case_id,
                section_name,
                row_no,
                record
            )
            VALUES (%s, %s, %s, %s::jsonb)
            ON CONFLICT (case_id, section_name, row_no) DO UPDATE SET
                record = EXCLUDED.record,
                updated_at = now()
            """,
            section_rows,
        )

    roster_rows = []
    if main_roster_df is not None and not main_roster_df.empty:
        for _, row in main_roster_df.iterrows():
            case_id = None if _is_missing(row.get("case_id")) else str(row.get("case_id")).strip()
            roster_type = None if _is_missing(row.get("roster_type")) else str(row.get("roster_type")).strip()
            row_no = row.get("row_no")
            payload = row.get("record") or {}
            if not case_id or not roster_type or _is_missing(row_no):
                continue
            roster_rows.append(
                (
                    case_id,
                    roster_type,
                    int(row_no),
                    _json_text(_record_to_dict(payload)),
                )
            )

    if roster_rows:
        cur.executemany(
            """
            INSERT INTO clean.main_case_roster (case_id, roster_type, row_no, record)
            VALUES (%s, %s, %s, %s::jsonb)
            ON CONFLICT (case_id, roster_type, row_no) DO UPDATE SET
                record = EXCLUDED.record,
                updated_at = now()
            """,
            roster_rows,
        )
