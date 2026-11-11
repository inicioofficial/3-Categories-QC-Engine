from pathlib import Path

from backend.app.services.main_survey_cases import _choice_label_case_sql, _sector_label_sql

ROOT_DIR = str(Path(__file__).resolve().parents[2])


def test_label_sql_reads_the_raw_value_a_fixed_number_of_times():
    """The raw value reads a large JSONB record; repeating it per branch timed out exports."""
    sql = _sector_label_sql("export_mc.record", ROOT_DIR)
    assert sql.count("WHEN") > 100  # many per-form and fallback labels...
    assert sql.count("->>'Sector'") <= 3  # ...but the record is read at most 3 times


def test_label_sql_prefers_form_label_then_fallback_then_raw():
    sql = _choice_label_case_sql(
        "t.raw",
        "t.form",
        {"formA": {"3": "Kano"}, "formB": {"3": "Abuja"}},
        {"3": "Legacy", "9": "Enugu"},
    )
    assert "'formA|3' THEN 'Kano'" in sql
    assert "'formA|3.0' THEN 'Kano'" in sql
    assert "'formB|3' THEN 'Abuja'" in sql
    assert "WHEN '9' THEN 'Enugu'" in sql
    assert sql.endswith("ELSE t.raw END END")


def test_label_sql_without_maps_returns_raw_expression():
    assert _choice_label_case_sql("t.raw", "t.form", {}, {}) == "t.raw"
