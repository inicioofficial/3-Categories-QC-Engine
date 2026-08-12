from __future__ import annotations

import hashlib
import re
from datetime import datetime, timezone
from typing import Any

import numpy as np
import pandas as pd

SUBMISSION_KEY_CANDIDATES = ("KEY", "submission_key")
CASE_ID_CANDIDATES = ("caseid", "case_id", "interview__id", "interview_id", "qn")
SPECIAL_CLEANING_VARIABLES = ("consent2", "TE1", "F4a", "F4b", "SA14.12", "TX4a")
SPECIAL_CLEANING_FLAG_COLUMNS = (
    "F4ACHK", "F4BCHK", "F4CHK", "CONCHK", "TE1CHK", "SA14CHK", "TX4ACHK", "TOTCHK",
    "consent2_IMPUTED", "TE1_IMPUTED", "F4a_IMPUTED", "F4b_IMPUTED", "SA14_12_IMPUTED", "TX4a_IMPUTED",
)
IMPUTED_TEXT_MARKERS = {"IMPUTED", "IMPUTED_VALUE", "IMPUTED VALUE"}


def _nonempty(value: Any) -> bool:
    if value is None:
        return False
    try:
        if pd.isna(value):
            return False
    except Exception:
        pass
    return str(value).strip() not in {"", "nan", "NaT", "None", "none", "null", "NULL", "<NA>"}


def _safe_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _first_nonempty(record: dict[str, Any], candidates: tuple[str, ...]):
    for candidate in candidates:
        value = record.get(candidate)
        if _nonempty(value):
            return value
    return None



def _make_columns_assignment_safe(out: pd.DataFrame, columns: list[str] | tuple[str, ...]) -> pd.DataFrame:
    """
    SurveyCTO/raw parquet columns may use pandas StringDtype.
    Pandas rejects assigning integers such as 1, 2, 99, or 0 into StringDtype columns.
    Cast only columns that the cleaner may modify to object so generated numeric codes
    can be assigned safely and then normalized by the existing database/export layer.
    """
    for col in columns:
        if col in out.columns:
            out[col] = out[col].astype("object")
    return out


def _blank_series(s: pd.Series) -> pd.Series:
    return (
        s.isna()
        | s.astype("string").str.strip().isin(["", "nan", "NaN", "None", "none", "null", "NULL", "<NA>"])
        | s.astype("string").str.strip().str.upper().isin(IMPUTED_TEXT_MARKERS)
    )


def _stable_row_key(row: pd.Series) -> str:
    for c in ("KEY", "caseid", "case_id", "instanceID", "submission_key"):
        if c in row.index and _nonempty(row[c]):
            return str(row[c]).strip()
    return str(row.name)


def _stable_weighted_choice(row_key: str, choices: list[Any], probabilities: list[float], salt: str = ""):
    if not choices:
        return np.nan
    key = f"{row_key}|{salt}"
    h = hashlib.md5(str(key).encode("utf-8")).hexdigest()
    u = int(h[:12], 16) / float(0xFFFFFFFFFFFF)
    cumulative = 0.0
    for choice, prob in zip(choices, probabilities):
        cumulative += float(prob)
        if u <= cumulative:
            return choice
    return choices[-1]


def _weighted_distribution(series: pd.Series, valid_values: list[int] | None = None) -> tuple[list[Any], list[float]]:
    s = pd.to_numeric(series, errors="coerce")
    if valid_values is not None:
        s = s[s.isin(valid_values)]
    dist = s.dropna().value_counts(normalize=True).sort_index()
    return dist.index.tolist(), dist.values.tolist()


def _response_code_sort_key(value: Any):
    s = str(value).strip()
    try:
        return (0, int(float(s)))
    except Exception:
        return (1, s)


def _sort_response_codes(codes: list[Any]) -> list[str]:
    return sorted([str(c).strip() for c in codes], key=_response_code_sort_key)


def _looks_like_response_pattern(value: Any) -> bool:
    return bool(re.match(r"^\d+(?:\.\d+)?(?:\s+\d+(?:\.\d+)?)*$", str(value).strip()))


def _clear_imputed_text_markers(out: pd.DataFrame, columns: list[str] | tuple[str, ...]) -> pd.DataFrame:
    for col in columns:
        if col not in out.columns:
            continue
        marker_mask = out[col].astype("string").str.strip().str.upper().isin(IMPUTED_TEXT_MARKERS)
        out.loc[marker_mask, col] = np.nan
    return out


def _rebuild_single_mr_parent(out: pd.DataFrame, parent: str) -> pd.DataFrame:
    option_cols: list[tuple[str, str]] = []
    for parent_alias in {parent, parent.replace(".", "_")}:
        pattern = re.compile(rf"^{re.escape(parent_alias)}_(\d+(?:\.\d+)?)$")
        for c in out.columns:
            m = pattern.match(str(c))
            if m:
                option_cols.append((c, m.group(1)))
    seen = set()
    option_cols = [(col, code) for col, code in option_cols if not (col in seen or seen.add(col))]
    if not option_cols:
        return out

    parent_col = parent if parent in out.columns else None
    if parent_col is None:
        for parent_alias in {parent, parent.replace(".", "_")}:
            if parent_alias in out.columns:
                parent_col = parent_alias
                break
    if parent_col is None:
        parent_col = parent
        out[parent_col] = np.nan

    def build_value(row: pd.Series):
        selected_codes = []
        for col, code in option_cols:
            val = row[col]
            try:
                if pd.notna(val) and float(val) == 1:
                    selected_codes.append(str(code))
            except Exception:
                if str(val).strip() == "1":
                    selected_codes.append(str(code))
        if selected_codes:
            return " ".join(_sort_response_codes(selected_codes))
        return np.nan

    out[parent_col] = out.apply(build_value, axis=1)
    return out


def _build_audit_row(row: pd.Series, variable: str, old_value: Any, new_value: Any, check_flag: str, imputation_flag: str, reason: str, cleaning_rule: str, synced_at: datetime, cleaned_at: datetime) -> dict[str, Any]:
    record = row.to_dict()
    submission_key = _safe_text(_first_nonempty(record, SUBMISSION_KEY_CANDIDATES))
    return {
        "submission_key": submission_key,
        "case_id": _safe_text(_first_nonempty(record, CASE_ID_CANDIDATES)) or submission_key,
        "caseid": _safe_text(record.get("caseid")),
        "variable_name": variable,
        "old_value": None if not _nonempty(old_value) else str(old_value),
        "new_value": None if not _nonempty(new_value) else str(new_value),
        "check_flag": check_flag,
        "imputation_flag": imputation_flag,
        "reason": reason,
        "cleaning_rule": cleaning_rule,
        "synced_at": synced_at,
        "cleaned_at": cleaned_at,
    }


def _impute_f4a_patterns(out: pd.DataFrame, mask: pd.Series) -> pd.DataFrame:
    f4a_cols = [c for c in out.columns if re.match(r"^F4a_(\d+)$", str(c))]
    if not f4a_cols or "F4a" not in out.columns:
        print("F4a imputation skipped: F4a parent/child columns not found.")
        return out

    out = _make_columns_assignment_safe(out, ["F4a", *f4a_cols])

    observed_parent = out["F4a"].astype("string").str.strip()
    observed = observed_parent[
        ~observed_parent.isin(["", "nan", "NaN", "None", "none", "null", "NULL", "<NA>"])
        & observed_parent.map(_looks_like_response_pattern)
    ]
    if observed.empty:
        print("F4a imputation skipped: no observed F4a response patterns found.")
        return out

    pattern_dist = observed.value_counts(normalize=True).sort_index()
    patterns = pattern_dist.index.tolist()
    probs = pattern_dist.values.tolist()

    for idx, row in out.loc[mask].iterrows():
        chosen_pattern = _stable_weighted_choice(_stable_row_key(row), patterns, probs, salt="F4a_PATTERN")
        selected_codes = [code for code in str(chosen_pattern).strip().split() if _looks_like_response_pattern(code)]
        if not selected_codes:
            continue
        out.loc[idx, f4a_cols] = 0
        for code in selected_codes:
            col = f"F4a_{code}"
            if col in out.columns:
                out.loc[idx, col] = 1
        out.loc[idx, "F4a"] = " ".join(_sort_response_codes(selected_codes))
    return out


def _row_synced_at(row: pd.Series, default_synced_at: datetime, synced_at_column: str | None) -> datetime:
    if synced_at_column and synced_at_column in row.index and _nonempty(row[synced_at_column]):
        try:
            value = pd.to_datetime(row[synced_at_column], errors="coerce")
            if pd.notna(value):
                if isinstance(value, pd.Timestamp):
                    value = value.to_pydatetime()
                if value.tzinfo is None:
                    value = value.replace(tzinfo=timezone.utc)
                return value.astimezone(timezone.utc)
        except Exception:
            pass
    return default_synced_at


def _impute_from_distribution(out: pd.DataFrame, column: str, mask: pd.Series, salt: str, valid_values: list[int] | None = None, fallback: tuple[list[Any], list[float]] | None = None) -> pd.DataFrame:
    if column not in out.columns:
        print(f"{column} imputation skipped: column not found.")
        return out
    out = _make_columns_assignment_safe(out, [column])
    choices, probs = _weighted_distribution(out[column], valid_values=valid_values)
    if not choices and fallback is not None:
        choices, probs = fallback
    if not choices:
        print(f"{column} imputation skipped: no observed distribution found.")
        return out
    out.loc[mask, column] = out.loc[mask].apply(
        lambda r: _stable_weighted_choice(_stable_row_key(r), choices, probs, salt=salt), axis=1
    )
    return out


def apply_special_data_error_cleaning(
    df: pd.DataFrame,
    synced_at: datetime | None = None,
    *,
    synced_at_column: str | None = None,
    cleaning_rule_prefix: str | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    out = df.copy()
    synced_at = synced_at or datetime.now(timezone.utc)
    cleaned_at = datetime.now(timezone.utc)

    for c in ["final_outcome_code", "F3", "F4a", "F4b", "consent2", "TE1", "SA14.12", "TX4a"]:
        if c not in out.columns:
            out[c] = np.nan
    for c in ["E9_6", "E9_7", "E9_8", "E9_10", "E9_11", "E9_12", "TX3"]:
        if c not in out.columns:
            out[c] = np.nan

    f4a_child_cols = [c for c in out.columns if re.match(r"^F4a_(\d+)$", str(c))]
    out = _make_columns_assignment_safe(
        out,
        ["consent2", "TE1", "F4a", "F4b", "SA14.12", "TX4a", *f4a_child_cols],
    )
    out = _clear_imputed_text_markers(out, ["consent2", "TE1", "F4a", "F4b", "SA14.12", "TX4a"])

    successful = out["final_outcome_code"].astype("string").str.strip().eq("Successful")
    f3_num = pd.to_numeric(out["F3"], errors="coerce")

    for c in ["F4ACHK", "F4BCHK", "F4CHK", "CONCHK", "TE1CHK", "SA14CHK", "TX4ACHK", "TOTCHK"]:
        out[c] = 0

    out.loc[successful & (f3_num < 14) & _blank_series(out["F4a"]), "F4ACHK"] = 1
    out.loc[successful & (f3_num < 14) & _blank_series(out["F4b"]), "F4BCHK"] = 1
    out.loc[successful & _blank_series(out["consent2"]), "CONCHK"] = 1
    out.loc[successful & _blank_series(out["TE1"]), "TE1CHK"] = 1
    out.loc[successful & _blank_series(out["SA14.12"]), "SA14CHK"] = 1

    tx_condition = (
        (pd.to_numeric(out["E9_6"], errors="coerce") == 1)
        | (pd.to_numeric(out["E9_7"], errors="coerce") == 1)
        | (pd.to_numeric(out["E9_8"], errors="coerce") == 1)
        | (pd.to_numeric(out["E9_10"], errors="coerce") == 1)
        | (pd.to_numeric(out["E9_11"], errors="coerce") == 1)
        | (pd.to_numeric(out["E9_12"], errors="coerce") == 1)
        | (pd.to_numeric(out["TX3"], errors="coerce").isin([1, 2]))
    )
    out.loc[successful & tx_condition & _blank_series(out["TX4a"]), "TX4ACHK"] = 1
    out["F4CHK"] = ((out["F4ACHK"] == 1) | (out["F4BCHK"] == 1)).astype(int)
    out["TOTCHK"] = (
        (out["F4CHK"] == 1)
        | (out["CONCHK"] == 1)
        | (out["TE1CHK"] == 1)
        | (out["SA14CHK"] == 1)
        | (out["TX4ACHK"] == 1)
    ).astype(int)

    for c in ["consent2_IMPUTED", "TE1_IMPUTED", "F4a_IMPUTED", "F4b_IMPUTED", "SA14_12_IMPUTED", "TX4a_IMPUTED"]:
        out[c] = 0

    old_values = {var: out[var].copy() for var in SPECIAL_CLEANING_VARIABLES if var in out.columns}

    con_mask = out["CONCHK"] == 1
    out.loc[con_mask, "consent2"] = 1
    out.loc[con_mask, "consent2_IMPUTED"] = 1

    te1_mask = out["TE1CHK"] == 1
    out = _impute_from_distribution(out, "TE1", te1_mask, salt="TE1", valid_values=[2, 3], fallback=([2, 3], [0.5, 0.5]))
    out.loc[te1_mask, "TE1_IMPUTED"] = 1

    f4a_mask = out["F4ACHK"] == 1
    out = _impute_f4a_patterns(out, f4a_mask)
    out.loc[f4a_mask, "F4a_IMPUTED"] = 1

    f4b_mask = out["F4BCHK"] == 1
    out = _impute_from_distribution(out, "F4b", f4b_mask, salt="F4b")
    out.loc[f4b_mask, "F4b_IMPUTED"] = 1

    sa14_mask = out["SA14CHK"] == 1
    out.loc[sa14_mask, "SA14.12"] = 2
    out.loc[sa14_mask, "SA14_12_IMPUTED"] = 1

    tx4a_mask = out["TX4ACHK"] == 1
    out.loc[tx4a_mask, "TX4a"] = 99
    out.loc[tx4a_mask, "TX4a_IMPUTED"] = 1

    out = _rebuild_single_mr_parent(out, "F4a")

    audit_rows: list[dict[str, Any]] = []
    audit_specs = [
        ("consent2", "CONCHK", "consent2_IMPUTED", "Successful case had missing consent2", "Set consent2 to 1"),
        ("TE1", "TE1CHK", "TE1_IMPUTED", "Successful case had missing TE1", "Stable weighted imputation from observed TE1 values 2/3"),
        ("F4a", "F4ACHK", "F4a_IMPUTED", "Successful case with F3 < 14 had missing F4a", "Stable weighted imputation from observed F4a response patterns"),
        ("F4b", "F4BCHK", "F4b_IMPUTED", "Successful case with F3 < 14 had missing F4b", "Stable weighted imputation from observed F4b distribution"),
        ("SA14.12", "SA14CHK", "SA14_12_IMPUTED", "Successful case had missing SA14.12", "Set SA14.12 to 2"),
        ("TX4a", "TX4ACHK", "TX4a_IMPUTED", "Successful case met transaction condition and had missing TX4a", "Set TX4a to 99"),
    ]
    for variable, check_flag, imputation_flag, reason, cleaning_rule in audit_specs:
        if variable not in out.columns or variable not in old_values:
            continue
        effective_rule = f"{cleaning_rule_prefix}: {cleaning_rule}" if cleaning_rule_prefix else cleaning_rule
        mask = out[imputation_flag] == 1
        for idx, row in out.loc[mask].iterrows():
            audit_rows.append(
                _build_audit_row(
                    row,
                    variable,
                    old_values[variable].loc[idx],
                    out.at[idx, variable],
                    check_flag,
                    imputation_flag,
                    reason,
                    effective_rule,
                    _row_synced_at(row, synced_at, synced_at_column),
                    cleaned_at,
                )
            )

    print("\nMain Survey special data-error cleaning summary:")
    for c in ["F4ACHK", "F4BCHK", "F4CHK", "CONCHK", "TE1CHK", "SA14CHK", "TX4ACHK", "TOTCHK"]:
        print(f"{c}: {int(out[c].sum())}")
    print(f"Special cleaning audit rows generated: {len(audit_rows)}")

    return out, pd.DataFrame(audit_rows)
