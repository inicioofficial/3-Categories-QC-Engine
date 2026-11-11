"""Filters inside a category workspace must follow that category's own XLSForm.

The Wave 2 forms reuse choice codes with different labels: Region 3 is Abuja in
Edible Oil but Kano in Margarine and Breakfast Cereal, and most sector codes
differ per form. Global code maps therefore only ever look right for one form.
"""

from pathlib import Path

import pytest

from backend.app.services.main_custom_table import _filter_sql
from backend.app.services.main_survey import (
    _bht_region_filter_values,
    _workspace_choice_map,
)
from backend.app.services.main_survey_cases import _category_choice_label_maps
from backend.app.workspace_context import ACTIVE_WORKSPACE, WORKSPACE_FORM_IDS

ROOT_DIR = str(Path(__file__).resolve().parents[2])
WORKSPACES = sorted(WORKSPACE_FORM_IDS)


@pytest.fixture
def in_workspace():
    tokens = []

    def activate(slug: str | None) -> None:
        tokens.append(ACTIVE_WORKSPACE.set(slug))

    yield activate
    for token in reversed(tokens):
        ACTIVE_WORKSPACE.reset(token)


def test_forms_really_do_disagree_on_region_codes():
    assert _workspace_choice_map(ROOT_DIR, "edible-oil", "Region")["3"] == "Abuja"
    assert _workspace_choice_map(ROOT_DIR, "spread", "Region")["3"] == "Kano"
    assert _workspace_choice_map(ROOT_DIR, "breakfast-cereal", "Region")["3"] == "Kano"


@pytest.mark.parametrize("workspace", WORKSPACES)
@pytest.mark.parametrize("region", ["Abuja", "Kano"])
def test_region_filter_does_not_add_a_global_code_in_a_workspace(in_workspace, workspace, region):
    in_workspace(workspace)
    assert _bht_region_filter_values([region]) == [region]


def test_region_filter_keeps_legacy_code_mapping_outside_workspaces(in_workspace):
    in_workspace(None)
    assert _bht_region_filter_values(["Abuja"]) == ["3", "Abuja"]


@pytest.mark.parametrize("workspace", WORKSPACES)
@pytest.mark.parametrize(("list_name", "variable"), [("Region", "Region"), ("sector", "sector")])
def test_dashboard_filter_labels_match_export_sql_labels(workspace, list_name, variable):
    """The export matches on labels alone, so the dropdown text must match exactly."""
    dashboard_labels = _workspace_choice_map(ROOT_DIR, workspace, list_name)
    export_labels = _category_choice_label_maps(ROOT_DIR, variable)[WORKSPACE_FORM_IDS[workspace]]
    assert dashboard_labels
    assert dashboard_labels == export_labels


@pytest.mark.parametrize("workspace", WORKSPACES)
@pytest.mark.parametrize("category", ["breakfast-cereals", "edible-oil"])
def test_custom_table_ignores_legacy_panel_filter_in_a_workspace(in_workspace, workspace, category):
    in_workspace(workspace)
    sql_text, params = _filter_sql({"categories": [category]})
    assert "main_case_panel" not in sql_text
    assert not params


def test_custom_table_keeps_legacy_panel_filter_outside_workspaces(in_workspace):
    in_workspace(None)
    sql_text, params = _filter_sql({"categories": ["breakfast-cereals"]})
    assert "main_case_panel" in sql_text
    assert params == [["Panel_7"]]
