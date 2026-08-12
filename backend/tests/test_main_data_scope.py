from pathlib import Path
from unittest import TestCase

from backend.app.services.main_data_scope import (
    main_data_formdef_versions,
    main_case_scope_clause,
    main_row_scope_clause,
)
from backend.app.settings import Settings


def _settings(formdef_version: str | None) -> Settings:
    return Settings(
        root_dir=Path("."),
        database_url="",
        boundary_zip_path=Path("boundaries.zip"),
        state_boundary_geojson_path=Path("states.geojson"),
        frontend_origin="http://localhost",
        export_dir=Path("exports"),
        auto_sync_enabled=False,
        sync_interval_seconds=3600,
        auto_export_enabled=False,
        export_regen_interval_seconds=86400,
        sparse_min_point_count=3,
        sparse_min_unique_buildings=2,
        sparse_min_bbox_coverage_ratio=0.05,
        sparse_min_quadrants=2,
        sparse_static_max_step_distance=0.00005,
        admin_seed_username="admin",
        admin_seed_password="secret",
        surveycto_server="server",
        surveycto_listing_form_id="listing",
        surveycto_main_form_id="main-form",
        surveycto_username=None,
        surveycto_password=None,
        main_survey_formdef_version=formdef_version,
    )


class MainDataScopeTests(TestCase):
    def test_case_scope_filters_form_id_and_exact_formdef_version(self) -> None:
        sql, params = main_case_scope_clause(_settings("2607011200"), "mc")

        self.assertEqual(sql, "AND mc.form_id = %s AND mc.formdef_version = ANY(%s)")
        self.assertEqual(params, ["main-form", ["2607011200"]])

    def test_multiple_versions_are_parsed_from_comma_separated_setting(self) -> None:
        settings = _settings("2608060937, 2608060938,2608060937,,")

        self.assertEqual(main_data_formdef_versions(settings), ["2608060937", "2608060938"])
        sql, params = main_case_scope_clause(settings, "mc")
        self.assertIn("mc.formdef_version = ANY(%s)", sql)
        self.assertEqual(params, ["main-form", ["2608060937", "2608060938"]])

    def test_mart_scope_resolves_version_through_clean_case(self) -> None:
        sql, params = main_row_scope_clause(_settings("2607011200"), "mq")

        self.assertIn("scope_mc.case_id = mq.case_id", sql)
        self.assertIn("scope_mc.formdef_version = ANY(%s)", sql)
        self.assertEqual(params, [["2607011200"]])

    def test_blank_version_keeps_only_existing_form_id_scope(self) -> None:
        case_sql, case_params = main_case_scope_clause(_settings("  "), "mc")
        row_sql, row_params = main_row_scope_clause(_settings(None), "mq")

        self.assertEqual(case_sql, "AND mc.form_id = %s")
        self.assertEqual(case_params, ["main-form"])
        self.assertEqual((row_sql, row_params), ("", []))
