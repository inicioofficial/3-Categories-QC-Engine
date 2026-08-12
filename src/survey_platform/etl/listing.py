from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import requests
from requests import exceptions as req_exc

from survey_platform.config import ListingPipelineConfig
from survey_platform.db import SyncPreemptedError, raise_if_manual_sync_preempted

LISTING_INSTRUMENT_CODE = "listing"
DEFAULT_LOOKBACK_MINUTES = 10
MAX_RETRIES = 6

DROP_PATTERNS = ("_gf_",)
FORCED_META_VARS = (
    "KEY",
    "formdef_version",
    "SubmissionDate",
    "CompletionDate",
    "start",
    "end",
    "deviceid",
    "devicephonenum",
    "username",
    "caseid",
)
SPSS_MAX_VAR_NAME_LEN = 64
SURVEYCTO_CONNECT_TIMEOUT_SECONDS = 30
SURVEYCTO_READ_TIMEOUT_SECONDS = 600
SURVEYCTO_MAX_RETRIES = 6
SURVEYCTO_TRANSIENT_STATUS_CODES = {408, 409, 429, 500, 502, 503, 504}
DEFAULT_LOOKBACK_MINUTES = 10

SELECTED_BLD_CANDIDATES = (
    "sel_building_serial",
    "sel_bld_index",
    "sel_hh_bld_serial",
)
SELECTED_HH_CANDIDATES = (
    "sel_household_serial",
    "sel_hhold_index",
    "sel_hh_index",
)
LISTING_BLD_CANDIDATES = (
    "hh_bld_serial",
    "bld_serial",
)
LISTING_HH_CANDIDATES = (
    "hh_hh_serial",
    "hh_index",
)


@dataclass
class ListingFetchResult:
    data: pd.DataFrame
    fetch_status: str
    message: str | None = None


def load_last_sync_time(path: Path) -> datetime | None:
    if not path.exists():
        return None

    data = json.loads(path.read_text(encoding="utf-8"))
    if "last_sync_utc" in data:
        return datetime.fromisoformat(data["last_sync_utc"])
    # Legacy checkpoints stored the maximum form completion time, which does not
    # match SurveyCTO's documented incremental filter semantics. Ignoring the old
    # key forces one corrective full pull after deployment.
    if "last_completion_utc" in data:
        return None
    return None


def save_last_sync_time(path: Path, dt: datetime) -> None:
    if isinstance(dt, pd.Timestamp):
        dt = dt.to_pydatetime()

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    dt_utc = dt.astimezone(timezone.utc)
    path.write_text(
        json.dumps({"last_sync_utc": dt_utc.isoformat()}, indent=2),
        encoding="utf-8",
    )


def apply_incremental_lookback(dt: datetime | None, lookback_minutes: int = DEFAULT_LOOKBACK_MINUTES) -> datetime | None:
    if dt is None or lookback_minutes <= 0:
        return dt

    if isinstance(dt, pd.Timestamp):
        dt = dt.to_pydatetime()

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    return dt.astimezone(timezone.utc) - timedelta(minutes=lookback_minutes)


def datetime_to_epoch_seconds(dt: datetime | None) -> int:
    if dt is None:
        return 0

    if isinstance(dt, pd.Timestamp):
        dt = dt.to_pydatetime()

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    return int(dt.astimezone(timezone.utc).timestamp())


def format_surveycto_after_date(dt: datetime | None) -> str | None:
    if dt is None:
        return None

    if isinstance(dt, pd.Timestamp):
        dt = dt.to_pydatetime()

    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)

    normalized = dt.astimezone(timezone.utc).replace(microsecond=0)
    return normalized.isoformat().replace("+00:00", "Z")


def _check_manual_preemption(config: ListingPipelineConfig, context: str) -> None:
    raise_if_manual_sync_preempted(config, context)


def _sleep_with_manual_preemption_check(
    config: ListingPipelineConfig,
    total_seconds: int,
    context: str,
) -> None:
    remaining_seconds = max(0, int(total_seconds))
    while remaining_seconds > 0:
        _check_manual_preemption(config, context)
        time.sleep(min(1, remaining_seconds))
        remaining_seconds -= 1


def load_existing_raw_master(path: Path) -> pd.DataFrame:
    if not path.exists():
        print("No existing raw master found. This will be the first full load.")
        return pd.DataFrame()

    print(f"Loading existing raw master from {path}...")
    df = pd.read_parquet(path)
    print(f"Existing raw master: {len(df)} rows, {len(df.columns)} columns.")
    return df


def save_raw_master(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    print(f"Saved raw master to {path}.")


def load_best_available_raw_master(config: ListingPipelineConfig) -> pd.DataFrame:
    master_df = load_existing_raw_master(config.raw_master_parquet)
    if not master_df.empty:
        return master_df

    from survey_platform.db import LISTING_INSTRUMENT_CODE, load_latest_raw_submissions

    master_df = load_latest_raw_submissions(config, LISTING_INSTRUMENT_CODE)
    if master_df.empty:
        return master_df

    print(
        "Restored listing raw master from PostgreSQL cache because the local parquet snapshot was missing."
    )
    save_raw_master(master_df, config.raw_master_parquet)
    return master_df


def resolve_listing_sync_checkpoint(config: ListingPipelineConfig) -> datetime | None:
    from survey_platform.db import get_last_successful_completion_utc

    db_checkpoint = get_last_successful_completion_utc(config, "listing")
    print("Last sync time from database:", db_checkpoint)
    return db_checkpoint


def should_drop(name: str) -> bool:
    s = str(name)
    return any(pattern.lower() in s.lower() for pattern in DROP_PATTERNS)


def drop_unnecessary_columns(df: pd.DataFrame) -> pd.DataFrame:
    cols_to_drop = [c for c in df.columns if should_drop(c)]
    if cols_to_drop:
        print(f"Dropping {len(cols_to_drop)} unnecessary columns...")
    return df.drop(columns=cols_to_drop, errors="ignore")


def nonempty(val) -> bool:
    if pd.isna(val):
        return False
    s = str(val).strip()
    return s != "" and s.lower() != "nan"


def safe_get(row: pd.Series, col_name: str):
    return row[col_name] if col_name in row.index else None


def choose_first_nonempty(record: dict, candidates: tuple[str, ...]):
    for candidate in candidates:
        if candidate in record and nonempty(record[candidate]):
            return record[candidate]
    return None


def normalize_intish(val):
    if not nonempty(val):
        return None
    try:
        return str(int(float(val)))
    except Exception:
        return str(val).strip()


def make_join_key(bld_val, hh_val):
    b = normalize_intish(bld_val)
    h = normalize_intish(hh_val)
    if not b or not h:
        return None
    return f"{b}_{h}"


def dedupe_keep_order(items):
    seen = set()
    out = []
    for item in items:
        if item not in seen:
            seen.add(item)
            out.append(item)
    return out


def parse_date_columns(df: pd.DataFrame) -> pd.DataFrame:
    fmt = "%b %d, %Y %I:%M:%S %p"
    date_cols = ["CompletionDate", "SubmissionDate", "starttime", "endtime", "start", "end"]

    out = df.copy()
    for col in date_cols:
        if col in out.columns:
            out[col] = pd.to_datetime(out[col], format=fmt, errors="coerce")
    return out


def extract_lat_long(gps_value):
    if not nonempty(gps_value):
        return None, None

    parts = str(gps_value).strip().split()
    if len(parts) < 2:
        return None, None

    try:
        return float(parts[0]), float(parts[1])
    except Exception:
        return None, None


def _fetch_submissions_request(
    config: ListingPipelineConfig, since_dt: datetime | None
) -> requests.Response:
    url = f"https://{config.server}.surveycto.com/api/v2/forms/data/wide/json/{config.form_id}"
    params = {"date": str(datetime_to_epoch_seconds(since_dt))}

    for attempt in range(1, SURVEYCTO_MAX_RETRIES + 1):
        _check_manual_preemption(config, f"{config.sync_source} listing SurveyCTO v2 fetch attempt {attempt}")
        try:
            print(
                f"Requesting: {url}"
                + f" with params {params}"
                + f" (attempt {attempt}/{SURVEYCTO_MAX_RETRIES})"
            )
            resp = requests.get(
                url,
                params=params or None,
                auth=(config.username, config.password),
                timeout=(SURVEYCTO_CONNECT_TIMEOUT_SECONDS, SURVEYCTO_READ_TIMEOUT_SECONDS),
            )
            print("Status code:", resp.status_code)

            if resp.status_code in SURVEYCTO_TRANSIENT_STATUS_CODES and attempt < SURVEYCTO_MAX_RETRIES:
                if resp.status_code == 409:
                    wait_seconds = min(90, 15 * attempt)
                    print("SurveyCTO API is busy (409).")
                else:
                    wait_seconds = 2 ** attempt
                print(f"Transient HTTP {resp.status_code}; retrying in {wait_seconds}s...")
                _sleep_with_manual_preemption_check(
                    config,
                    wait_seconds,
                    f"{config.sync_source} listing SurveyCTO v2 retry wait",
                )
                continue
            return resp
        except (req_exc.ReadTimeout, req_exc.ConnectTimeout, req_exc.ConnectionError) as exc:
            if attempt >= SURVEYCTO_MAX_RETRIES:
                raise
            wait_seconds = 2 ** attempt
            print(f"Network timeout/error: {exc}. Retrying in {wait_seconds}s...")
            _sleep_with_manual_preemption_check(
                config,
                wait_seconds,
                f"{config.sync_source} listing SurveyCTO v2 network retry wait",
            )
        except req_exc.ChunkedEncodingError as exc:
            if attempt >= SURVEYCTO_MAX_RETRIES:
                raise
            wait_seconds = min(90, 15 * attempt)
            print(f"SurveyCTO response ended prematurely: {exc}. Retrying in {wait_seconds}s...")
            _sleep_with_manual_preemption_check(
                config,
                wait_seconds,
                f"{config.sync_source} listing SurveyCTO v2 chunked retry wait",
            )

    raise RuntimeError("Failed to fetch submissions after retries.")


def fetch_new_submissions(config: ListingPipelineConfig, since_dt: datetime | None) -> ListingFetchResult:
    if not config.username or not config.password:
        raise RuntimeError(
            "SURVEYCTO_USERNAME and SURVEYCTO_PASSWORD are required for listing-sync. "
            "Use listing-rebuild if you only want to rebuild outputs from cached raw data."
        )

    _check_manual_preemption(config, f"{config.sync_source} listing sync before SurveyCTO fetch")
    resp = _fetch_submissions_request(config, since_dt)

    if resp.status_code in {400, 404} and since_dt is not None:
        _check_manual_preemption(config, f"{config.sync_source} listing sync before full v2 retry")
        print(
            f"SurveyCTO rejected incremental listing sync with HTTP {resp.status_code}. "
            "Retrying with a full pull using the v2 form export endpoint."
        )
        resp = _fetch_submissions_request(config, None)

    if resp.status_code in {409, 417}:
        try:
            msg = resp.json().get("error", {}).get("message", "")
        except Exception:
            msg = resp.text[:500]
        print(f"SurveyCTO {resp.status_code} response:", msg)
        print("No data fetched this run due to API constraint.")
        return ListingFetchResult(
            pd.DataFrame(),
            "upstream_busy",
            "SurveyCTO is already serving another request",
        )

    if resp.status_code != 200:
        print("Response text (first 500 chars):")
        print(resp.text[:500])
        resp.raise_for_status()

    data = resp.json()
    df = pd.DataFrame(data)
    print(f"Fetched {len(df)} rows, {len(df.columns)} columns before cleaning.")

    df = drop_unnecessary_columns(df)
    print(f"After cleaning: {len(df.columns)} columns remain.")
    return ListingFetchResult(df, "fetched")


def parse_select_list_name(qtype: str) -> str | None:
    qtype = str(qtype).strip()
    match = re.match(r"^select_one\s+(.+)$", qtype)
    if match:
        return match.group(1).strip()

    match = re.match(r"^select_multiple\s+(.+)$", qtype)
    if match:
        return match.group(1).strip()

    return None


def load_xlsform_spec(xlsform_path: Path) -> dict:
    if not xlsform_path.exists():
        raise FileNotFoundError(f"XLSForm file not found: {xlsform_path}")

    survey = pd.read_excel(xlsform_path, sheet_name="survey").fillna("")
    choices = pd.read_excel(xlsform_path, sheet_name="choices").fillna("")

    survey.columns = [str(c).strip() for c in survey.columns]
    choices.columns = [str(c).strip() for c in choices.columns]

    if "type" not in survey.columns or "name" not in survey.columns:
        raise ValueError("XLSForm survey sheet must contain 'type' and 'name' columns.")

    label_col = "label" if "label" in survey.columns else None
    choice_label_col = "label" if "label" in choices.columns else None

    meta_vars = []
    sampling_vars = []
    bld_vars = []
    hh_vars = []
    selected_vars = []

    var_labels = {}
    value_labels_by_var = {}

    stack = []
    seen_nbld = False

    def is_real_field(qtype: str, name: str) -> bool:
        normalized_type = str(qtype).strip().lower()
        normalized_name = str(name).strip()
        if not normalized_name:
            return False
        if normalized_type.startswith("begin ") or normalized_type.startswith("end "):
            return False
        if normalized_type == "note":
            return False
        if should_drop(normalized_name):
            return False
        return True

    choices_map = {}
    if {"list_name", "name"}.issubset(set(choices.columns)):
        for _, row in choices.iterrows():
            list_name = str(row.get("list_name", "")).strip()
            code = row.get("name", "")
            label = row.get(choice_label_col, "") if choice_label_col else ""

            if not list_name or str(code).strip() == "":
                continue

            choices_map.setdefault(list_name, {})
            choices_map[list_name][str(code)] = str(label) if label is not None else ""

    for _, row in survey.iterrows():
        qtype = str(row["type"]).strip()
        name = str(row["name"]).strip()
        label = str(row.get(label_col, "")).strip() if label_col else ""

        if qtype.startswith("begin repeat"):
            stack.append(("repeat", name))
            continue
        if qtype.startswith("end repeat"):
            for idx in range(len(stack) - 1, -1, -1):
                if stack[idx][0] == "repeat":
                    stack.pop(idx)
                    break
            continue
        if qtype.startswith("begin group"):
            stack.append(("group", name))
            continue
        if qtype.startswith("end group"):
            for idx in range(len(stack) - 1, -1, -1):
                if stack[idx][0] == "group":
                    stack.pop(idx)
                    break
            continue

        if not is_real_field(qtype, name):
            continue

        repeat_path = [x[1] for x in stack if x[0] == "repeat"]

        var_labels[name] = label if label else name
        choice_list = parse_select_list_name(qtype)
        if choice_list and choice_list in choices_map:
            value_labels_by_var[name] = choices_map[choice_list]

        if name == "NBLD" and not repeat_path:
            meta_vars.append(name)
            seen_nbld = True
            continue

        if repeat_path == ["bld"]:
            bld_vars.append(name)
        elif repeat_path == ["bld", "hhold"]:
            hh_vars.append(name)
        elif repeat_path == ["selected"]:
            selected_vars.append(name)
        elif not repeat_path:
            if not seen_nbld:
                meta_vars.append(name)
            else:
                sampling_vars.append(name)

    for var_name in FORCED_META_VARS:
        if var_name not in meta_vars:
            meta_vars.append(var_name)
        if var_name not in var_labels:
            var_labels[var_name] = var_name

    meta_vars = dedupe_keep_order(meta_vars)
    sampling_vars = dedupe_keep_order(sampling_vars)
    bld_vars = dedupe_keep_order(bld_vars)
    hh_vars = dedupe_keep_order(hh_vars)
    selected_vars = dedupe_keep_order(selected_vars)

    print("Loaded XLSForm structure:")
    print(f"  meta_vars: {len(meta_vars)}")
    print(f"  sampling_vars: {len(sampling_vars)}")
    print(f"  bld_vars: {len(bld_vars)}")
    print(f"  hh_vars: {len(hh_vars)}")
    print(f"  selected_vars: {len(selected_vars)}")

    return {
        "meta_vars": meta_vars,
        "sampling_vars": sampling_vars,
        "bld_vars": bld_vars,
        "hh_vars": hh_vars,
        "selected_vars": selected_vars,
        "var_labels": var_labels,
        "value_labels_by_var": value_labels_by_var,
    }


def parse_export_column(col_name: str):
    col = str(col_name)

    hh_match = re.match(r"^(.*)_(\d+)_(\d+)$", col)
    if hh_match:
        return ("hh", hh_match.group(1), int(hh_match.group(2)), int(hh_match.group(3)))

    bld_match = re.match(r"^(.*)_(\d+)$", col)
    if bld_match:
        return ("bld", bld_match.group(1), int(bld_match.group(2)), None)

    return ("top", col, None, None)


def discover_structure_from_xlsform(df: pd.DataFrame, xls_spec: dict) -> dict:
    cols = [c for c in df.columns if not should_drop(c)]
    meta_cols = [c for c in cols if c in xls_spec["meta_vars"]]
    sampling_cols = [c for c in cols if c in xls_spec["sampling_vars"]]

    max_bld = 0
    max_hh_by_bld = {}
    max_selected = 0

    for col in cols:
        kind, base, bld_no, hh_no = parse_export_column(col)
        if kind == "bld":
            if base in xls_spec["bld_vars"]:
                max_bld = max(max_bld, bld_no)
            elif base in xls_spec["selected_vars"]:
                max_selected = max(max_selected, bld_no)
        elif kind == "hh" and base in xls_spec["hh_vars"]:
            max_bld = max(max_bld, bld_no)
            max_hh_by_bld[bld_no] = max(max_hh_by_bld.get(bld_no, 0), hh_no)

    return {
        "meta_cols": meta_cols,
        "sampling_cols": sampling_cols,
        "listing_bld_bases": list(xls_spec["bld_vars"]),
        "listing_hh_bases": list(xls_spec["hh_vars"]),
        "selected_bases": list(xls_spec["selected_vars"]),
        "max_bld": max_bld,
        "max_hh_by_bld": max_hh_by_bld,
        "max_selected": max_selected,
    }


def convert_value_label_keys_to_numeric_if_possible(labels_dict: dict):
    out = {}
    for key, value in labels_dict.items():
        key_str = str(key).strip()
        try:
            num = float(key_str)
            out[int(num) if num.is_integer() else num] = str(value)
        except Exception:
            out[key_str] = str(value)
    return out


def build_output_metadata(output_df: pd.DataFrame, xls_spec: dict) -> tuple[list[str], dict]:
    var_labels = xls_spec["var_labels"]
    value_labels_by_var = xls_spec["value_labels_by_var"]
    column_labels = []
    variable_value_labels = {}

    special_labels = {
        "building_no": "Building loop number",
        "household_no_within_building": "Household loop number within building",
        "selected_repeat_no": "Selected repeat loop number",
        "listing_join_key": "Listing join key",
        "selected_join_key": "Selected join key",
        "row_type": "Row type",
        "sample_flag": "Selected household flag",
        "sample_status": "Sample selection status",
        "sample_case_id": "Sample case ID",
        "sample_case_label": "Sample case label",
        "gps_lat": "GPS latitude",
        "gps_long": "GPS longitude",
        "gps_source": "GPS source",
    }

    for col in output_df.columns:
        column_labels.append(special_labels.get(col, var_labels.get(col, col)))
        if col == "sample_flag":
            variable_value_labels[col] = {0: "Not Sampled", 1: "Sampled"}
        elif col in value_labels_by_var:
            variable_value_labels[col] = convert_value_label_keys_to_numeric_if_possible(value_labels_by_var[col])

    return column_labels, variable_value_labels


def build_selected_long(df: pd.DataFrame, structure: dict) -> pd.DataFrame:
    records = []
    meta_cols = structure["meta_cols"]
    selected_bases = structure["selected_bases"]
    max_selected = structure["max_selected"]

    if max_selected == 0:
        return pd.DataFrame()

    for _, row in df.iterrows():
        meta = {c: safe_get(row, c) for c in meta_cols}
        for selected_no in range(1, max_selected + 1):
            rec = meta.copy()
            any_data = False
            for base in selected_bases:
                col = f"{base}_{selected_no}"
                if col in df.columns:
                    val = safe_get(row, col)
                    rec[base] = val
                    if nonempty(val):
                        any_data = True

            if any_data:
                rec["selected_repeat_no"] = selected_no
                sel_bld = choose_first_nonempty(rec, SELECTED_BLD_CANDIDATES)
                sel_hh = choose_first_nonempty(rec, SELECTED_HH_CANDIDATES)
                rec["selected_join_key"] = make_join_key(sel_bld, sel_hh)
                records.append(rec)

    return pd.DataFrame(records)


def build_listing_long(df: pd.DataFrame, structure: dict, selected_long: pd.DataFrame) -> pd.DataFrame:
    records = []
    meta_cols = structure["meta_cols"]
    bld_bases = structure["listing_bld_bases"]
    hh_bases = structure["listing_hh_bases"]
    max_bld = structure["max_bld"]

    selected_lookup = {}
    if not selected_long.empty and "selected_join_key" in selected_long.columns:
        tmp = selected_long.dropna(subset=["selected_join_key"]).copy()
        if "KEY" in tmp.columns:
            for _, row in tmp.iterrows():
                key = (row.get("KEY"), row.get("selected_join_key"))
                if key not in selected_lookup:
                    selected_lookup[key] = {
                        "slot_type": row.get("slot_type"),
                        "case_id": row.get("case_id"),
                        "case_label": row.get("case_label"),
                    }
        else:
            for _, row in tmp.iterrows():
                key = row.get("selected_join_key")
                if key not in selected_lookup:
                    selected_lookup[key] = {
                        "slot_type": row.get("slot_type"),
                        "case_id": row.get("case_id"),
                        "case_label": row.get("case_label"),
                    }

    for _, row in df.iterrows():
        meta = {c: safe_get(row, c) for c in meta_cols}
        for bld_no in range(1, max_bld + 1):
            bld_vals = {}
            has_bld_data = False

            for base in bld_bases:
                col = f"{base}_{bld_no}"
                if col in df.columns:
                    val = safe_get(row, col)
                    bld_vals[base] = val
                    if nonempty(val):
                        has_bld_data = True
                else:
                    bld_vals[base] = None

            hh_indices_with_data = set()
            for base in hh_bases:
                pattern = re.compile(rf"^{re.escape(base)}_{bld_no}_(\d+)$")
                for col in df.columns:
                    match = pattern.match(str(col))
                    if match:
                        val = safe_get(row, col)
                        if nonempty(val):
                            hh_indices_with_data.add(int(match.group(1)))

            if not has_bld_data and not hh_indices_with_data:
                continue

            if not hh_indices_with_data:
                rec = meta.copy()
                rec.update(bld_vals)
                for base in hh_bases:
                    rec[base] = None

                rec["building_no"] = bld_no
                rec["household_no_within_building"] = None
                rec["row_type"] = "building_only"

                hh_gps_val = rec.get("hh_gps")
                bld_gps_val = rec.get("bld_gps")
                if nonempty(hh_gps_val):
                    lat, lon = extract_lat_long(hh_gps_val)
                    rec["gps_source"] = "household"
                elif nonempty(bld_gps_val):
                    lat, lon = extract_lat_long(bld_gps_val)
                    rec["gps_source"] = "building"
                else:
                    lat, lon = None, None
                    rec["gps_source"] = None

                rec["gps_lat"] = lat
                rec["gps_long"] = lon
                rec["listing_join_key"] = make_join_key(
                    choose_first_nonempty(rec, LISTING_BLD_CANDIDATES) or bld_no,
                    choose_first_nonempty(rec, LISTING_HH_CANDIDATES),
                )
                rec["selected_join_key"] = None
                rec["sample_flag"] = 0
                rec["sample_status"] = "Not Sampled"
                rec["sample_case_id"] = None
                rec["sample_case_label"] = None
                records.append(rec)
                continue

            for hh_no in sorted(hh_indices_with_data):
                hh_vals = {}
                for base in hh_bases:
                    col = f"{base}_{bld_no}_{hh_no}"
                    hh_vals[base] = safe_get(row, col) if col in df.columns else None

                rec = meta.copy()
                rec.update(bld_vals)
                rec.update(hh_vals)
                rec["building_no"] = bld_no
                rec["household_no_within_building"] = hh_no
                rec["row_type"] = "household"

                hh_uid = rec.get("hh_uid")
                if nonempty(hh_uid):
                    join_key = str(hh_uid).strip()
                else:
                    join_key = make_join_key(
                        choose_first_nonempty(rec, LISTING_BLD_CANDIDATES) or bld_no,
                        choose_first_nonempty(rec, LISTING_HH_CANDIDATES) or hh_no,
                    )
                rec["listing_join_key"] = join_key

                hh_gps_val = rec.get("hh_gps")
                bld_gps_val = rec.get("bld_gps")
                if nonempty(hh_gps_val):
                    lat, lon = extract_lat_long(hh_gps_val)
                    rec["gps_source"] = "household"
                elif nonempty(bld_gps_val):
                    lat, lon = extract_lat_long(bld_gps_val)
                    rec["gps_source"] = "building"
                else:
                    lat, lon = None, None
                    rec["gps_source"] = None

                rec["gps_lat"] = lat
                rec["gps_long"] = lon

                hit = selected_lookup.get((rec.get("KEY"), join_key)) if "KEY" in rec else None
                if hit is None:
                    hit = selected_lookup.get(join_key)

                if hit:
                    rec["selected_join_key"] = join_key
                    rec["sample_flag"] = 1
                    rec["sample_status"] = hit.get("slot_type", "Sampled")
                    rec["sample_case_id"] = hit.get("case_id")
                    rec["sample_case_label"] = hit.get("case_label")
                else:
                    rec["selected_join_key"] = None
                    rec["sample_flag"] = 0
                    rec["sample_status"] = "Not Sampled"
                    rec["sample_case_id"] = None
                    rec["sample_case_label"] = None

                records.append(rec)

    return pd.DataFrame(records)


def build_sampling_ea(df: pd.DataFrame, structure: dict) -> pd.DataFrame:
    keep = [c for c in structure["meta_cols"] + structure["sampling_cols"] if c in df.columns]
    if not keep:
        return pd.DataFrame()
    return df[keep].copy()


def save_parquet(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)
    print(f"Saved {path}")


def make_spss_safe_name(name: str, used_names: set[str]) -> str:
    safe = re.sub(r"[^A-Za-z0-9_]", "_", str(name))
    if not safe:
        safe = "var"
    if safe[0].isdigit():
        safe = f"v_{safe}"

    if len(safe) <= SPSS_MAX_VAR_NAME_LEN and safe not in used_names:
        used_names.add(safe)
        return safe

    hash_suffix = hashlib.md5(str(name).encode("utf-8")).hexdigest()[:8]
    max_base_len = SPSS_MAX_VAR_NAME_LEN - len(hash_suffix) - 1
    safe = f"{safe[:max_base_len]}_{hash_suffix}"

    counter = 1
    original_safe = safe
    while safe in used_names:
        suffix = f"_{counter}"
        max_base_len = SPSS_MAX_VAR_NAME_LEN - len(suffix)
        safe = f"{original_safe[:max_base_len]}{suffix}"
        counter += 1

    used_names.add(safe)
    return safe


def rename_columns_for_spss(df: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    used_names = set()
    rename_map = {col: make_spss_safe_name(col, used_names) for col in df.columns}
    return df.rename(columns=rename_map), rename_map


def save_variable_map(rename_map: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    pd.DataFrame(
        [{"original_name": old_name, "spss_name": new_name} for old_name, new_name in rename_map.items()]
    ).to_csv(path, index=False, encoding="utf-8")
    print(f"Saved variable name map to {path}")


def coerce_series_for_value_labels(series: pd.Series, labels_map: dict):
    if not labels_map:
        return series
    numeric_keys = all(isinstance(key, (int, float)) for key in labels_map.keys())
    if numeric_keys:
        return pd.to_numeric(series, errors="coerce")
    return series.astype(str)


def save_sav(
    df: pd.DataFrame,
    sav_path: Path,
    map_path: Path,
    column_labels: list[str] | None = None,
    variable_value_labels: dict | None = None,
) -> None:
    try:
        import pyreadstat
    except ModuleNotFoundError as exc:
        raise RuntimeError(
            "pyreadstat is required to write SPSS .sav outputs. Install dependencies from requirements.txt."
        ) from exc

    out = df.copy()
    variable_value_labels = variable_value_labels or {}

    for col in out.columns:
        if col in variable_value_labels:
            out[col] = coerce_series_for_value_labels(out[col], variable_value_labels[col])
        if pd.api.types.is_object_dtype(out[col]):
            out[col] = out[col].astype(str).replace("nan", "")
        elif pd.api.types.is_bool_dtype(out[col]):
            out[col] = out[col].astype(int)

    out, rename_map = rename_columns_for_spss(out)
    save_variable_map(rename_map, map_path)

    renamed_value_labels = {}
    for old_name, labels_map in variable_value_labels.items():
        if old_name in rename_map:
            renamed_value_labels[rename_map[old_name]] = labels_map

    pyreadstat.write_sav(
        out,
        str(sav_path),
        column_labels=column_labels,
        variable_value_labels=renamed_value_labels,
    )
    print(f"Saved {sav_path}")


def restructure_outputs(raw_df: pd.DataFrame, xls_spec: dict, config: ListingPipelineConfig):
    raw_df = drop_unnecessary_columns(raw_df)
    raw_df = parse_date_columns(raw_df)
    structure = discover_structure_from_xlsform(raw_df, xls_spec)

    print("Meta columns found:", len(structure["meta_cols"]))
    print("Sampling columns found:", len(structure["sampling_cols"]))
    print("Building vars from XLSForm:", len(structure["listing_bld_bases"]))
    print("Household vars from XLSForm:", len(structure["listing_hh_bases"]))
    print("Selected vars from XLSForm:", len(structure["selected_bases"]))
    print("Max buildings detected from export:", structure["max_bld"])
    print("Max selected slots detected from export:", structure["max_selected"])

    selected_long = build_selected_long(raw_df, structure)
    listing_long = build_listing_long(raw_df, structure, selected_long)
    sampling_ea = build_sampling_ea(raw_df, structure)

    print(f"listing_long rows: {len(listing_long)}")
    print(f"sampling_ea rows: {len(sampling_ea)}")
    print(f"selected_long rows: {len(selected_long)}")

    listing_col_labels, listing_value_labels = build_output_metadata(listing_long, xls_spec)
    sampling_col_labels, sampling_value_labels = build_output_metadata(sampling_ea, xls_spec)
    selected_col_labels, selected_value_labels = build_output_metadata(selected_long, xls_spec)

    save_parquet(listing_long, config.listing_parquet)
    save_parquet(sampling_ea, config.sampling_parquet)
    save_parquet(selected_long, config.selected_parquet)

    save_sav(listing_long, config.listing_sav, config.listing_var_map, listing_col_labels, listing_value_labels)
    save_sav(sampling_ea, config.sampling_sav, config.sampling_var_map, sampling_col_labels, sampling_value_labels)
    save_sav(selected_long, config.selected_sav, config.selected_var_map, selected_col_labels, selected_value_labels)

    return listing_long, sampling_ea, selected_long


def rebuild_listing_outputs(config: ListingPipelineConfig):
    from survey_platform.db import ensure_db_ready, mark_sync_failed, mark_sync_started, persist_listing_snapshot

    print("Rebuilding Listing Survey outputs from cached raw master...")
    ensure_db_ready(config)
    mark_sync_started(config, "listing-rebuild started")

    try:
        xls_spec = load_xlsform_spec(config.xlsform_file)
        master_df = load_best_available_raw_master(config)
        if master_df.empty:
            raise RuntimeError("No cached raw master found. Run listing-sync first.")

        master_df = drop_unnecessary_columns(master_df)
        master_df = parse_date_columns(master_df)
        result = restructure_outputs(master_df, xls_spec, config)

        sync_completed_at = datetime.now(timezone.utc)
        persist_listing_snapshot(
            config,
            master_df,
            result[0],
            result[1],
            result[2],
            sync_completed_at,
            f"listing-rebuild loaded {len(result[0])} listing rows",
        )
        return result
    except Exception as exc:
        mark_sync_failed(config, str(exc))
        raise


def run_listing_sync(config: ListingPipelineConfig):
    from survey_platform.db import (
        ensure_db_ready,
        mark_sync_failed,
        mark_sync_started,
        persist_listing_snapshot,
    )

    print("Listing Survey sync started")
    ensure_db_ready(config)
    mark_sync_started(config, "listing-sync started")

    try:
        _check_manual_preemption(config, f"{config.sync_source} listing sync startup")
        xls_spec = load_xlsform_spec(config.xlsform_file)

        master_df = load_best_available_raw_master(config)
        if not master_df.empty:
            master_df = drop_unnecessary_columns(master_df)
            master_df = parse_date_columns(master_df)

        last_sync_dt = resolve_listing_sync_checkpoint(config)
        request_since_dt = apply_incremental_lookback(last_sync_dt)
        print("Effective listing checkpoint:", last_sync_dt)
        print(
            f"Listing incremental request time after {DEFAULT_LOOKBACK_MINUTES}m lookback:",
            request_since_dt,
        )

        fetch_result = fetch_new_submissions(config, request_since_dt)
        new_df = fetch_result.data
        _check_manual_preemption(config, f"{config.sync_source} listing sync after SurveyCTO fetch")
        if fetch_result.fetch_status == "upstream_busy":
            return {
                "status": "upstream_busy",
                "reason": fetch_result.message or "SurveyCTO is already serving another request",
                "fetchStatus": fetch_result.fetch_status,
            }
        if new_df.empty:
            print("No new submissions fetched this run.")
            sync_completed_at = datetime.now(timezone.utc)
            if not master_df.empty:
                save_raw_master(master_df, config.raw_master_parquet)
                print("Rebuilding outputs from existing raw master...")
                _check_manual_preemption(config, f"{config.sync_source} listing sync before snapshot rebuild")
                listing_long, sampling_ea, selected_long = restructure_outputs(master_df, xls_spec, config)
                snapshot_message = (
                    f"listing-sync rebuilt snapshot with {len(listing_long)} listing rows"
                )
                status = "success"
                persist_listing_snapshot(
                    config,
                    master_df,
                    listing_long,
                    sampling_ea,
                    selected_long,
                    sync_completed_at,
                    snapshot_message,
                )
                return {
                    "status": status,
                    "syncMode": "rebuilt_snapshot",
                    "fetchStatus": fetch_result.fetch_status,
                    "message": snapshot_message,
                    "counts": {
                        "listingRows": len(listing_long),
                        "samplingEas": len(sampling_ea),
                        "selectedRows": len(selected_long),
                    },
                }
            snapshot_message = "listing-sync found no submissions and no cached raw master"
            status = "success"
            persist_listing_snapshot(
                config,
                pd.DataFrame(),
                pd.DataFrame(),
                pd.DataFrame(),
                pd.DataFrame(),
                sync_completed_at,
                snapshot_message,
            )
            return {
                "status": status,
                "syncMode": "empty_snapshot",
                "fetchStatus": fetch_result.fetch_status,
                "message": snapshot_message,
                "counts": {
                    "listingRows": 0,
                    "samplingEas": 0,
                    "selectedRows": 0,
                },
            }

        new_df = parse_date_columns(new_df)
        combined = pd.concat([master_df, new_df], ignore_index=True, sort=False) if not master_df.empty else new_df.copy()
        combined = drop_unnecessary_columns(combined)

        if "KEY" in combined.columns:
            combined = combined.drop_duplicates(subset="KEY", keep="last")
            print("Dropped duplicates based on KEY.")

        print(f"Combined raw master now has {len(combined)} rows and {len(combined.columns)} columns.")

        sync_completed_at = datetime.now(timezone.utc)
        print("Updated listing sync checkpoint to:", sync_completed_at)

        save_raw_master(combined, config.raw_master_parquet)
        _check_manual_preemption(config, f"{config.sync_source} listing sync before output restructuring")
        result = restructure_outputs(combined, xls_spec, config)
        _check_manual_preemption(config, f"{config.sync_source} listing sync before snapshot persist")
        persist_listing_snapshot(
            config,
            combined,
            result[0],
            result[1],
            result[2],
            sync_completed_at,
            f"listing-sync loaded {len(result[0])} listing rows, {len(result[1])} sampling rows, {len(result[2])} selected rows",
        )
        print("Listing Survey sync finished")
        return {
            "status": "success",
            "syncMode": "loaded_new_submissions",
            "fetchStatus": fetch_result.fetch_status,
            "message": (
                f"listing-sync loaded {len(result[0])} listing rows, {len(result[1])} sampling rows, "
                f"{len(result[2])} selected rows"
            ),
            "counts": {
                "listingRows": len(result[0]),
                "samplingEas": len(result[1]),
                "selectedRows": len(result[2]),
            },
        }
    except SyncPreemptedError:
        raise
    except Exception as exc:
        mark_sync_failed(config, str(exc))
        raise
