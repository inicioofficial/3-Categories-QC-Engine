from __future__ import annotations

import re
import os
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from survey_platform.config import MainSurveyPipelineConfig
from survey_platform.db import (
    SyncPreemptedError,
    get_last_successful_completion_utc,
    mark_sync_finished,
    raise_if_manual_sync_preempted,
)
from survey_platform.etl.listing import _fetch_submissions_request
from survey_platform.etl.main_dictionary import MainDictionaryLayout, load_main_dictionary_layout

MAIN_INSTRUMENT_CODE = "main"
DEFAULT_LOOKBACK_MINUTES = 10
MAX_RETRIES = 6

DROP_PATTERNS = ("_gf_",)
DATE_FORMAT = "%b %d, %Y %I:%M:%S %p"

MULTIPLE_RESPONSE_PARENTS = [
    "D2", "D3", "E1", "E2", "E9", "E13c", "F4a",
    "CP1", "CP1ba", "CP2", "CP10", "CP14b",
    "QF1",
    "QF6.1", "QF7c.1", "QF9.1",
    "QF6.2", "QF7c.2", "QF9.2",
    "QF6.3", "QF7c.3", "QF9.3",
    "QF6.4", "QF7c.4", "QF9.4",
    "QF6.5", "QF7c.5", "QF9.5",
    "QF6.6", "QF7c.6", "QF9.6",
    "QF6.7", "QF7c.7", "QF9.7",
    "QF6.8", "QF7c.8", "QF9.8",
    "QF6.9", "QF7c.9", "QF9.9",
    "QF6.10", "QF7c.10", "QF9.10",
    "QF6.11", "QF7c.11", "QF9.11",
    "QF6.12", "QF7c.12", "QF9.12",
    "QF6.13", "QF7c.13", "QF9.13",
    "QF6.14", "QF7c.14", "QF9.14",
    "QF6.15", "QF7c.15", "QF9.15",
    "QF6.16", "QF7c.16", "QF9.16",
    "QF6.17", "QF7c.17", "QF9.17",
    "BAA2", "BA1", "BA3a", "BA4",
    "MF2", "MF3",
    "NB2", "NB3",
    "PY1a.1", "PY1a.2", "PY1a.3", "PY1a.4", "PY3b",
    "TE3",
    "MM3b", "MM5", "MM9a", "MM10b", "MM11",
    "MT1", "MT2a", "MT5", "MT7a", "MT10", "MT12a", "MT15", "MT17a", "MT20",
    "SA2", "SA3a", "SA6", "SA7a", "SA8b", "SA11a", "SA16",
    "LC2a",
    "CC1", "CC4", "CC6",
    "RM1a", "RM6", "RM9", "RM13",
    "INF1a", "INF4",
    "PWD1",
    "interest",
]

DROP_NOTE_VARS = [
    "HHIFO", "C_intro", "note.1", "C3a.note", "C3b.note",
    "hh.sel.note1", "hh.sel.note2", "Selectedmember_note",
    "E.0.1.note", "E.0.2.note", "E14", "F9.note", "F12.note",
    "F12b.note", "F14.note", "CP.note", "CP8.note", "CP12",
    "QF3", "BA.note", "MF.note", "NB.note", "PY1a.note",
    "MM.note", "MM.Def", "MT.note", "DMT", "IMT", "MON",
    "MPC.note", "SA14", "SA15", "LC.note", "LC1.note",
    "LC1b.note", "CC2", "RM1.note", "RM1d.note", "RM11.note",
    "RM10.note", "RM2a.note", "INF.note", "INF1b.note",
    "INF2.note", "INF3.note", "PC1", "PC2.note", "PC3.note",
    "IE.note", "Gen1.note", "Gen1.note2", "Gen1a.note",
    "Gen3.note", "Gen5.note", "Efina.note", "B.note", "Thank",
]
CASE_ID_CANDIDATES = ("caseid", "case_id", "interview__id", "interview_id", "qn")
SUBMISSION_KEY_CANDIDATES = ("KEY", "submission_key")
EA_ID_CANDIDATES = ("ea_id", "ea_code", "EA_ID")
INTERVIEWER_ID_CANDIDATES = ("interviewer_id", "interviewer", "username", "enumerator_id")
SUPERVISOR_ID_CANDIDATES = ("supervisor_id", "supervisor", "team_supervisor_id")
STATUS_CANDIDATES = ("current_status", "final_status", "qc_status")
APPROVAL_STAGE_CANDIDATES = ("approval_stage",)
SUBMITTED_AT_CANDIDATES = ("SubmissionDate", "CompletionDate", "end", "start")
REVIEWED_AT_CANDIDATES = ("reviewed_at", "review_date", "reviewed_on", "qc_reviewed_at")
APPROVED_AT_CANDIDATES = ("approved_at", "approval_date", "approved_on")
CALLBACK_CANDIDATES = ("callback_required", "is_callback_required", "callback", "revisit_required")
REPEAT_KEY_PATTERNS = (
    re.compile(r"^(.+?)__(\d+)__(.+)$"),
    re.compile(r"^(.+?)\[(\d+)\]__(.+)$"),
)
DEFAULT_LOOKBACK_MINUTES = 10


@dataclass
class MainSurveyFetchResult:
    data: pd.DataFrame
    fetch_status: str
    message: str | None = None


def _check_manual_preemption(config: MainSurveyPipelineConfig, context: str) -> None:
    raise_if_manual_sync_preempted(config, context)


def _nonempty(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, float) and pd.isna(value):
        return False
    return str(value).strip() not in {"", "nan", "NaT"}


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _is_truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    text = _safe_text(value).lower()
    return text in {"1", "true", "yes", "y", "required"}


def _clean_case_scalar(value: Any):
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value.to_pydatetime()
    return None if not _nonempty(value) else value


def _record_to_dict(row) -> dict[str, Any]:
    if isinstance(row, pd.Series):
        data = row.to_dict()
    else:
        data = dict(row)
    return {str(key): value for key, value in data.items() if _nonempty(value)}


def _first_nonempty(record: dict[str, Any], candidates: tuple[str, ...]):
    for candidate in candidates:
        value = record.get(candidate)
        if _nonempty(value):
            return value
    return None


def _stable_unique_case_id(base_case_id: str, submission_key: str, seen: dict[str, int]) -> str:
    """Return a clean.main_case case_id that is unique per SurveyCTO submission.

    Some completed Main Survey submissions can share the same household/case id
    because of replacement records, callbacks, or re-submissions.  The database
    uses clean.main_case.case_id as the primary key, so using the raw household
    id directly would collapse those submissions during the ETL rebuild.

    Keep the first occurrence as the original id for compatibility, and suffix
    later duplicates with a short, stable part of the SurveyCTO submission KEY.
    The original SurveyCTO values remain available in the JSON `record` column.
    """
    base = _safe_text(base_case_id) or _safe_text(submission_key)
    key = _safe_text(submission_key)
    if not base:
        return key

    occurrence = seen.get(base, 0)
    seen[base] = occurrence + 1
    if occurrence == 0:
        return base

    suffix_source = re.sub(r"[^A-Za-z0-9]+", "", key) or str(occurrence + 1)
    suffix = suffix_source[-16:]
    candidate = f"{base}__{suffix}"
    while candidate in seen:
        occurrence += 1
        candidate = f"{base}__{suffix}_{occurrence + 1}"
    seen[candidate] = 1
    return candidate


def _should_drop(name: str) -> bool:
    return any(pattern.lower() in str(name).lower() for pattern in DROP_PATTERNS)


def _drop_unnecessary_columns(df: pd.DataFrame) -> pd.DataFrame:
    pattern_drop = [column for column in df.columns if _should_drop(str(column))]
    explicit_drop = [column for column in DROP_NOTE_VARS if column in df.columns]
    cols_to_drop = sorted(set(pattern_drop + explicit_drop))
    return df.drop(columns=cols_to_drop, errors="ignore")


def _split_hh_gps(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if "hh_gps" not in out.columns:
        return out

    gps_parts = out["hh_gps"].astype("string").str.strip().str.split(r"\s+", expand=True)
    out["hh_gps_Latitude"] = pd.to_numeric(gps_parts[0], errors="coerce") if 0 in gps_parts.columns else np.nan
    out["hh_gps_Longitude"] = pd.to_numeric(gps_parts[1], errors="coerce") if 1 in gps_parts.columns else np.nan
    out["hh_gps_Altitude"] = pd.to_numeric(gps_parts[2], errors="coerce") if 2 in gps_parts.columns else np.nan
    out["hh_gps_Accuracy"] = pd.to_numeric(gps_parts[3], errors="coerce") if 3 in gps_parts.columns else np.nan
    return out


def _fix_multiple_response_nulls(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    blank_values = {
        None: np.nan,
        "": np.nan,
        "nan": np.nan,
        "NaN": np.nan,
        "None": np.nan,
        "none": np.nan,
        "null": np.nan,
        "NULL": np.nan,
        "<NA>": np.nan,
    }

    for parent in MULTIPLE_RESPONSE_PARENTS:
        pattern = re.compile(rf"^{re.escape(parent)}_(.+)$")
        option_cols = [c for c in out.columns if pattern.match(str(c))]
        if not option_cols:
            continue

        temp = out[option_cols].astype("object").replace(blank_values)
        asked_mask = temp.notna().any(axis=1)
        temp.loc[asked_mask] = temp.loc[asked_mask].fillna(0)
        for col in option_cols:
            out[col] = pd.to_numeric(temp[col], errors="coerce")

    return out


def _clean_main_raw(df: pd.DataFrame) -> pd.DataFrame:
    out = _drop_unnecessary_columns(df)
    out = _split_hh_gps(out)
    out = _fix_multiple_response_nulls(out)
    out = _parse_date_columns(out)
    return out


def _drop_special_cleaning_helper_columns(df: pd.DataFrame) -> pd.DataFrame:
    return df


def _load_existing_raw_master(path: Path) -> pd.DataFrame:
    if not path.exists():
        print("No existing Main Survey raw master found. This will be the first full load.")
        return pd.DataFrame()

    print(f"Loading existing Main Survey raw master from {path}...")
    df = pd.read_parquet(path)
    print(f"Existing Main Survey raw master: {len(df)} rows, {len(df.columns)} columns.")
    return df


def _save_raw_master(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    print(f"Saved Main Survey raw master to {path}.")


def _parse_date_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for column in ("SubmissionDate", "CompletionDate", "start", "end", "today"):
        if column in out.columns:
            parsed = pd.to_datetime(out[column], format=DATE_FORMAT, errors="coerce")
            missing_mask = parsed.isna() & out[column].notna()
            if missing_mask.any():
                parsed.loc[missing_mask] = pd.to_datetime(out.loc[missing_mask, column], errors="coerce")
            out[column] = parsed
    return out


def _extract_roster_rows(case_id: str, record: dict[str, Any], layout: MainDictionaryLayout) -> list[dict[str, Any]]:
    """Split SurveyCTO-style repeat keys and explicit roster variables into roster rows."""
    buckets: dict[tuple[str, int], dict[str, Any]] = {}
    consumed_keys: set[str] = set()

    for key, value in record.items():
        if not _nonempty(value):
            continue
        sk = str(key)
        if _should_drop(sk):
            continue
        matched = False
        for pat in REPEAT_KEY_PATTERNS:
            m = pat.match(sk)
            if not m:
                continue
            group_prefix, idx_raw, field_suffix = m.group(1), m.group(2), m.group(3)
            row_no = int(idx_raw) + 1
            roster_type = group_prefix
            buckets.setdefault((roster_type, row_no), {})[field_suffix] = value
            consumed_keys.add(sk)
            matched = True
            break
        if matched:
            continue

        if sk in layout.roster_variables:
            rt = layout.roster_variables[sk]
            buckets.setdefault((rt, 1), {})[sk] = value

    rows: list[dict[str, Any]] = []
    for (roster_type, row_no) in sorted(buckets.keys(), key=lambda x: (x[0], x[1])):
        payload = buckets[(roster_type, row_no)]
        if payload:
            rows.append(
                {
                    "case_id": case_id,
                    "roster_type": roster_type,
                    "row_no": row_no,
                    "record": payload,
                }
            )
    return rows


def _fetch_new_submissions(config: MainSurveyPipelineConfig, since_dt: datetime | None) -> MainSurveyFetchResult:
    if not config.form_id:
        raise RuntimeError("SURVEYCTO_MAIN_FORM_ID is required for main-sync.")
    if not config.username or not config.password:
        raise RuntimeError(
            "SURVEYCTO_USERNAME and SURVEYCTO_PASSWORD are required for main-sync. "
            "Use main-rebuild if you only want to rebuild outputs from cached raw data."
        )

    _check_manual_preemption(config, f"{config.sync_source} main survey sync before SurveyCTO fetch")
    response = _fetch_submissions_request(config, since_dt)

    if response.status_code in {400, 404} and since_dt is not None:
        _check_manual_preemption(config, f"{config.sync_source} main survey sync before full v2 retry")
        print(
            f"SurveyCTO rejected incremental main survey sync with HTTP {response.status_code}. "
            "Retrying with a full pull using the v2 form export endpoint."
        )
        response = _fetch_submissions_request(config, None)

    if response.status_code in {409, 417}:
        try:
            message = response.json().get("error", {}).get("message", "")
        except Exception:
            message = response.text[:500]
        print(f"SurveyCTO {response.status_code} response:", message)
        print("No Main Survey data fetched this run due to API constraint.")
        return MainSurveyFetchResult(
            pd.DataFrame(),
            "upstream_busy",
            "SurveyCTO is already serving another request",
        )

    if response.status_code != 200:
        print("Response text (first 500 chars):")
        print(response.text[:500])
        response.raise_for_status()

    data = response.json()
    df = pd.DataFrame(data)
    print(f"Fetched {len(df)} Main Survey rows, {len(df.columns)} columns before cleaning.")
    return MainSurveyFetchResult(_drop_unnecessary_columns(df), "fetched")


def _load_main_layout_for_sync(config: MainSurveyPipelineConfig) -> MainDictionaryLayout:
    try:
        return load_main_dictionary_layout(config.dictionary_file)
    except FileNotFoundError:
        print(
            f"Main Survey dictionary file not found: {config.dictionary_file}. "
            "Continuing with raw/panel/answer/media sync; section and roster tables will be empty."
        )
        return MainDictionaryLayout(sections={}, export_order=[], variable_section={}, roster_variables={})


def _derive_status(record: dict[str, Any]) -> tuple[str, str]:
    approval_stage_raw = _safe_text(_first_nonempty(record, APPROVAL_STAGE_CANDIDATES)).lower()
    status_raw = _safe_text(_first_nonempty(record, STATUS_CANDIDATES)).lower()
    combined = " ".join(part for part in (approval_stage_raw, status_raw) if part)

    if "approved" in combined:
        return "approved", "approved"
    if "review" in combined:
        return "in_review", "under_review"
    if "reject" in combined:
        return "rejected", "rejected"
    return "submitted", "pending_review"


def _build_main_outputs(
    raw_df: pd.DataFrame, layout: MainDictionaryLayout
) -> tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    if raw_df.empty:
        return pd.DataFrame(), pd.DataFrame(), pd.DataFrame()

    working = _drop_unnecessary_columns(raw_df)
    working = _parse_date_columns(working)

    sort_columns = [column for column in ("CompletionDate", "SubmissionDate", "end", "start") if column in working.columns]
    if sort_columns:
        working = working.sort_values(by=sort_columns, na_position="last")

    sections = layout.sections
    case_rows: list[dict[str, Any]] = []
    section_rows: list[dict[str, Any]] = []
    roster_rows: list[dict[str, Any]] = []
    seen_case_ids: dict[str, int] = {}
    duplicate_case_id_count = 0

    for _, row in working.iterrows():
        record = _record_to_dict(row)
        submission_key = _safe_text(_first_nonempty(record, SUBMISSION_KEY_CANDIDATES))
        if not submission_key:
            continue

        source_case_id = _safe_text(_first_nonempty(record, CASE_ID_CANDIDATES)) or submission_key
        previous_occurrences = seen_case_ids.get(source_case_id, 0)
        case_id = _stable_unique_case_id(source_case_id, submission_key, seen_case_ids)
        if previous_occurrences:
            duplicate_case_id_count += 1

        # Preserve the original household/case id in JSON for analysts while using
        # a unique case_id column so clean.main_case and mart.main_case_dim do not
        # collapse multiple completed submissions into one row.
        record.setdefault("source_case_id", source_case_id)
        record.setdefault("etl_case_id", case_id)

        current_status, approval_stage = _derive_status(record)

        case_rows.append({
            "submission_key": submission_key,
            "case_id": case_id,
            "ea_id": _first_nonempty(record, EA_ID_CANDIDATES),
            "interviewer_id": _first_nonempty(record, INTERVIEWER_ID_CANDIDATES),
            "supervisor_id": _first_nonempty(record, SUPERVISOR_ID_CANDIDATES),
            "current_status": current_status,
            "approval_stage": approval_stage,
            "submitted_at": _clean_case_scalar(_first_nonempty(record, SUBMITTED_AT_CANDIDATES)),
            "reviewed_at": _clean_case_scalar(_first_nonempty(record, REVIEWED_AT_CANDIDATES)),
            "approved_at": _clean_case_scalar(_first_nonempty(record, APPROVED_AT_CANDIDATES)),
            "is_callback_required": _is_truthy(_first_nonempty(record, CALLBACK_CANDIDATES)),
            "record": record,
        })

        for section_name, variables in sections.items():
            section_record = {
                variable: record.get(variable)
                for variable in variables
                if (not _should_drop(variable)) and variable in record and _nonempty(record.get(variable))
            }
            if not section_record:
                continue
            section_rows.append({
                "case_id": case_id,
                "section_name": section_name,
                "row_no": 1,
                "record": section_record,
            })

        roster_rows.extend(_extract_roster_rows(case_id, record, layout))

    case_df = pd.DataFrame(case_rows)
    section_df = pd.DataFrame(section_rows)
    roster_df = pd.DataFrame(roster_rows)

    if duplicate_case_id_count:
        print(
            f"Preserved {duplicate_case_id_count} duplicate Main Survey case_id submissions "
            "by suffixing duplicate clean.main_case.case_id values with their submission KEY."
        )

    print(f"main_case rows: {len(case_df)}")
    print(f"main_case_section rows: {len(section_df)}")
    print(f"main_case_roster rows: {len(roster_df)}")
    return case_df, section_df, roster_df


def rebuild_main_survey_outputs(config: MainSurveyPipelineConfig):
    from survey_platform.db import ensure_db_ready, mark_main_sync_failed, mark_main_sync_started, persist_main_snapshot

    print("Rebuilding Main Survey outputs from cached raw master...")
    ensure_db_ready(config)
    mark_main_sync_started(config, "main-rebuild started")

    try:
        layout = _load_main_layout_for_sync(config)
        master_df = _load_existing_raw_master(config.raw_master_parquet)
        if master_df.empty:
            raise RuntimeError("No cached Main Survey raw master found. Run main-sync first.")

        master_df = _clean_main_raw(master_df)
        main_case_df, main_section_df, main_roster_df = _build_main_outputs(master_df, layout)
        last_completion = None
        if "CompletionDate" in master_df.columns:
            last_completion = master_df["CompletionDate"].max()

        persist_main_snapshot(
            config,
            master_df,
            main_case_df,
            main_section_df,
            main_roster_df,
            pd.DataFrame(),
            None if last_completion is None or pd.isna(last_completion) else last_completion,
            f"main-rebuild loaded {len(main_case_df)} cases, {len(main_section_df)} section rows, {len(main_roster_df)} roster rows",
        )
        return main_case_df, main_section_df, main_roster_df
    except Exception as exc:
        mark_main_sync_failed(config, str(exc))
        raise


def _resolve_main_sync_checkpoint(config: MainSurveyPipelineConfig) -> datetime | None:
    db_checkpoint = get_last_successful_completion_utc(config, "main")
    print("Last Main Survey sync time from database:", db_checkpoint)
    return db_checkpoint


def _apply_main_lookback(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if isinstance(dt, pd.Timestamp):
        dt = dt.to_pydatetime()
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc) - timedelta(minutes=DEFAULT_LOOKBACK_MINUTES)


def backfill_main_special_cleaning(config: MainSurveyPipelineConfig):
    message = "Main Survey special cleaning/imputation is disabled; no records were changed."
    print(message, flush=True)
    return {
        "status": "skipped",
        "syncMode": "special_cleaning_disabled",
        "message": message,
        "counts": {"cases": 0, "sections": 0, "rosterRows": 0, "auditRows": 0},
    }


def run_main_survey_sync(config: MainSurveyPipelineConfig):
    from survey_platform.db import (
        ensure_db_ready,
        load_latest_raw_submissions,
        mark_main_sync_failed,
        mark_main_sync_started,
        persist_main_snapshot,
    )

    print("Main Survey sync started")
    ensure_db_ready(config)
    mark_main_sync_started(config, "main-sync started")

    try:
        _check_manual_preemption(config, f"{config.sync_source} main survey sync startup")
        force_full = bool(getattr(config, "force_full", False))
        last_sync_dt = None if force_full else _resolve_main_sync_checkpoint(config)
        if force_full:
            print("Force-full Main Survey sync requested; ignoring database checkpoint for this run.")
        request_since_dt = _apply_main_lookback(last_sync_dt)
        print("Effective Main Survey checkpoint:", last_sync_dt)
        print(
            f"Main Survey incremental request time after {DEFAULT_LOOKBACK_MINUTES}m lookback:",
            request_since_dt,
        )

        fetch_result = _fetch_new_submissions(config, request_since_dt)
        new_df = fetch_result.data
        _check_manual_preemption(config, f"{config.sync_source} main survey sync after SurveyCTO fetch")
        if fetch_result.fetch_status == "upstream_busy":
            return {
                "status": "upstream_busy",
                "reason": fetch_result.message or "SurveyCTO is already serving another request",
                "fetchStatus": fetch_result.fetch_status,
            }
        if new_df.empty:
            print("No new Main Survey submissions fetched this run.")
            snapshot_message = "main-sync found no new submissions; existing snapshot left unchanged"
            mark_sync_finished(config, MAIN_INSTRUMENT_CODE, "success", snapshot_message)
            return {
                "status": "success",
                "syncMode": "no_new_submissions",
                "fetchStatus": fetch_result.fetch_status,
                "message": snapshot_message,
                "counts": {
                    "cases": 0,
                    "sections": 0,
                    "rosterRows": 0,
                },
            }

        layout = _load_main_layout_for_sync(config)

        master_df = pd.DataFrame()
        db_master_df = load_latest_raw_submissions(config, "main", form_id=config.form_id)
        if not db_master_df.empty:
            print(
                f"Loaded existing Main Survey raw master from database for form {config.form_id}: "
                f"{len(db_master_df)} rows, {len(db_master_df.columns)} columns."
            )
            master_df = db_master_df
        else:
            master_df = _load_existing_raw_master(config.raw_master_parquet)
        if not master_df.empty:
            master_df = _clean_main_raw(master_df)

        existing_submission_keys: set[str] = set()
        if not master_df.empty:
            for key_column in SUBMISSION_KEY_CANDIDATES:
                if key_column in master_df.columns:
                    existing_submission_keys.update(
                        str(value).strip()
                        for value in master_df[key_column].dropna().tolist()
                        if str(value).strip()
                    )

        new_df = _clean_main_raw(new_df)
        fetched_submission_keys: set[str] = set()
        for key_column in SUBMISSION_KEY_CANDIDATES:
            if key_column in new_df.columns:
                fetched_submission_keys.update(
                    str(value).strip()
                    for value in new_df[key_column].dropna().tolist()
                    if str(value).strip()
                )
                if fetched_submission_keys:
                    break
        newly_added_submission_keys: list[str] = []
        for key_column in SUBMISSION_KEY_CANDIDATES:
            if key_column not in new_df.columns:
                continue
            for value in new_df[key_column].dropna().tolist():
                key = str(value).strip()
                if key and key not in existing_submission_keys and key not in newly_added_submission_keys:
                    newly_added_submission_keys.append(key)
            if newly_added_submission_keys:
                break

        combined = pd.concat([master_df, new_df], ignore_index=True, sort=False) if not master_df.empty else new_df.copy()
        combined = _clean_main_raw(combined)

        if "KEY" in combined.columns:
            combined = combined.drop_duplicates(subset="KEY", keep="last")
            print("Dropped duplicate Main Survey submissions based on KEY.")

        sync_completed_at = datetime.now(timezone.utc)
        print("Updated Main Survey sync checkpoint to:", sync_completed_at)

        _save_raw_master(combined, config.raw_master_parquet)
        _check_manual_preemption(config, f"{config.sync_source} main survey sync before output restructuring")
        main_case_df, main_section_df, main_roster_df = _build_main_outputs(combined, layout)
        persist_raw_df = combined
        if not force_full and fetched_submission_keys:
            # Preserve full-master case-id de-duplication, then write only the
            # submissions returned by this incremental SurveyCTO request.
            persist_raw_df = new_df
            incremental_case_df = main_case_df[
                main_case_df["submission_key"].astype(str).isin(fetched_submission_keys)
            ].copy()
            incremental_case_ids = set(incremental_case_df["case_id"].astype(str).tolist())
            main_case_df = incremental_case_df
            main_section_df = main_section_df[
                main_section_df["case_id"].astype(str).isin(incremental_case_ids)
            ].copy() if not main_section_df.empty else main_section_df
            main_roster_df = main_roster_df[
                main_roster_df["case_id"].astype(str).isin(incremental_case_ids)
            ].copy() if not main_roster_df.empty else main_roster_df
            print(
                f"Incremental Main Survey persistence scoped to {len(main_case_df)} fetched cases; "
                "full aggregate rebuild skipped."
            )
        _check_manual_preemption(config, f"{config.sync_source} main survey sync before snapshot persist")
        persist_main_snapshot(
            config,
            persist_raw_df,
            main_case_df,
            main_section_df,
            main_roster_df,
            pd.DataFrame(),
            sync_completed_at,
            f"main-sync loaded {len(main_case_df)} cases, {len(main_section_df)} sections, {len(main_roster_df)} roster rows",
            refresh_aggregate_marts=force_full,
        )
        print("Main Survey sync finished")
        return {
            "status": "success",
            "syncMode": "loaded_new_submissions",
            "fetchStatus": fetch_result.fetch_status,
            "message": (
                f"main-sync loaded {len(main_case_df)} cases, {len(main_section_df)} sections, "
                f"{len(main_roster_df)} roster rows"
            ),
            "counts": {
                "cases": len(main_case_df),
                "sections": len(main_section_df),
                "rosterRows": len(main_roster_df),
            },
            "newSubmissionKeys": newly_added_submission_keys,
            "newSubmissionCount": len(newly_added_submission_keys),
        }
    except SyncPreemptedError:
        raise
    except Exception as exc:
        mark_main_sync_failed(config, str(exc))
        raise
