from survey_platform.db import _derive_survey_month


def test_august_1_through_4_are_included_in_july_2026_reporting_month():
    for day in range(1, 5):
        assert _derive_survey_month({"CompletionDate": f"2026-08-{day:02d} 12:00:00"}) == "2026-07"


def test_august_5_starts_august_2026_reporting_month():
    assert _derive_survey_month({"CompletionDate": "2026-08-05 00:00:00"}) == "2026-08"


def test_july_extension_takes_precedence_over_form_month_override():
    assert _derive_survey_month(
        {"SubmissionDate": "2026-08-04T23:59:59+01:00"},
        override="2026-08",
    ) == "2026-07"
