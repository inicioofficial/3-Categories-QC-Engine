from datetime import datetime, timezone

import pandas as pd
from openpyxl import load_workbook

from backend.app.services.main_survey import _write_dataframe_to_xlsx


def test_xlsx_export_strips_control_characters_instead_of_failing(tmp_path):
    """One stray control character in field data used to fail the whole download."""
    df = pd.DataFrame(
        {
            "Username": ["int\x0b1", "clean"],
            "Approved By": ["admin\x1f", None],
            "Submission Date/Time": [datetime(2026, 11, 9, 10, tzinfo=timezone.utc), None],
        }
    )
    path = tmp_path / "export.xlsx"

    _write_dataframe_to_xlsx(path, df, sheet_name="Overview KPI")

    rows = list(load_workbook(path).active.iter_rows(values_only=True))
    assert rows[0] == ("Username", "Approved By", "Submission Date/Time")
    assert rows[1][:2] == ("int1", "admin")
    assert rows[1][2] == datetime(2026, 11, 9, 10)
    assert rows[2] == ("clean", None, None)
