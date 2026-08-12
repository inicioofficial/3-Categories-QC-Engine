"""Load MAIN_data_dictionary.xlsx layout for Main Survey ETL and exports."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd

REQUIRED_COLUMNS = ("variable_name", "Section")


@dataclass
class MainDictionaryLayout:
    """Workbook-driven section lists, export order, and lookups."""

    sections: dict[str, list[str]]
    export_order: list[str]
    variable_section: dict[str, str] = field(default_factory=dict)
    roster_variables: dict[str, str] = field(default_factory=dict)  # var -> roster_type (optional sheet col)
    variable_labels: dict[str, str] = field(default_factory=dict)
    choice_labels: dict[str, dict[str, str]] = field(default_factory=dict)

    @property
    def all_variables(self) -> set[str]:
        return set(self.variable_section.keys())


def _safe_text(value: Any) -> str:
    return str(value or "").strip()


def _load_xlsform_layout(dictionary_path: Path) -> MainDictionaryLayout:
    sheets = pd.read_excel(dictionary_path, sheet_name=None).copy()
    survey = sheets["survey"].fillna("")
    choices = sheets.get("choices", pd.DataFrame()).fillna("")

    normalized = {str(c).strip(): c for c in survey.columns}
    missing = [c for c in ("type", "name") if c not in normalized]
    if missing:
        raise RuntimeError("XLSForm survey sheet is missing required columns: " + ", ".join(missing))

    type_col = normalized["type"]
    name_col = normalized["name"]
    label_col = normalized.get("label")

    sections: dict[str, list[str]] = {}
    export_order: list[str] = []
    variable_section: dict[str, str] = {}
    variable_labels: dict[str, str] = {}
    roster_variables: dict[str, str] = {}
    section_stack: list[str] = []
    repeat_stack: list[str] = []

    for row in survey.to_dict(orient="records"):
        qtype = _safe_text(row.get(type_col))
        variable_name = _safe_text(row.get(name_col))
        label = _safe_text(row.get(label_col)) if label_col else ""
        if not variable_name:
            continue

        if qtype in {"begin group", "begin repeat"}:
            section_label = label or variable_name
            section_stack.append(section_label)
            if qtype == "begin repeat":
                repeat_stack.append(variable_name)
            continue

        if qtype in {"end group", "end repeat"}:
            if section_stack:
                section_stack.pop()
            if qtype == "end repeat" and repeat_stack:
                repeat_stack.pop()
            continue

        if qtype in {"start", "end", "today", "deviceid", "subscriberid", "simserial", "phonenumber"}:
            section_name = "(metadata)"
        else:
            section_name = section_stack[-1] if section_stack else "(ungrouped)"

        if variable_name not in variable_section:
            variable_section[variable_name] = section_name
        if label:
            variable_labels[variable_name] = label
        sections.setdefault(section_name, [])
        if variable_name not in sections[section_name]:
            sections[section_name].append(variable_name)
        if variable_name not in export_order:
            export_order.append(variable_name)
        if repeat_stack:
            roster_variables[variable_name] = repeat_stack[-1]

    choice_labels: dict[str, dict[str, str]] = {}
    if not choices.empty:
        choices_normalized = {str(c).strip(): c for c in choices.columns}
        list_col = choices_normalized.get("list_name")
        code_col = choices_normalized.get("name")
        choice_label_col = choices_normalized.get("label")
        if list_col and code_col:
            for row in choices.to_dict(orient="records"):
                list_name = _safe_text(row.get(list_col))
                code = _safe_text(row.get(code_col))
                choice_label = _safe_text(row.get(choice_label_col)) if choice_label_col else code
                if list_name and code:
                    choice_labels.setdefault(list_name, {})[code] = choice_label or code

    print(f"Loaded Main Survey XLSForm: {len(sections)} sections, {len(export_order)} variables, {sum(len(v) for v in choice_labels.values())} choices.")
    return MainDictionaryLayout(
        sections=sections,
        export_order=export_order,
        variable_section=variable_section,
        roster_variables=roster_variables,
        variable_labels=variable_labels,
        choice_labels=choice_labels,
    )


def load_main_dictionary_layout(dictionary_path: Path) -> MainDictionaryLayout:
    if not dictionary_path.exists():
        raise FileNotFoundError(f"Main Survey dictionary file not found: {dictionary_path}")

    workbook = pd.ExcelFile(dictionary_path)
    sheet_names = {name.lower(): name for name in workbook.sheet_names}
    if "survey" in sheet_names and "choices" in sheet_names:
        return _load_xlsform_layout(dictionary_path)

    df = pd.read_excel(dictionary_path).fillna("")
    normalized = {str(c).strip(): c for c in df.columns}
    missing = [c for c in REQUIRED_COLUMNS if c not in normalized]
    if missing:
        raise RuntimeError("Main Survey dictionary is missing required columns: " + ", ".join(missing))

    roster_col = next(
        (normalized[c] for c in ("roster_type", "RosterType", "roster", "Roster") if c in normalized),
        None,
    )

    sections: dict[str, list[str]] = {}
    export_order: list[str] = []
    variable_section: dict[str, str] = {}
    roster_variables: dict[str, str] = {}

    for row in df.to_dict(orient="records"):
        section_name = _safe_text(row.get(normalized["Section"]))
        variable_name = _safe_text(row.get(normalized["variable_name"]))
        if not variable_name:
            continue
        if not section_name:
            section_name = "(ungrouped)"

        if variable_name not in variable_section:
            variable_section[variable_name] = section_name

        sections.setdefault(section_name, [])
        if variable_name not in sections[section_name]:
            sections[section_name].append(variable_name)

        if variable_name not in export_order:
            export_order.append(variable_name)

        if roster_col:
            rt = _safe_text(row.get(roster_col))
            if rt:
                roster_variables[variable_name] = rt

    print(f"Loaded Main Survey dictionary: {len(sections)} sections, {len(export_order)} export slots.")
    return MainDictionaryLayout(
        sections=sections,
        export_order=export_order,
        variable_section=variable_section,
        roster_variables=roster_variables,
    )
