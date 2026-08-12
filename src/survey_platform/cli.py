from __future__ import annotations

import argparse
from pathlib import Path

from survey_platform.config import load_listing_pipeline_config, load_main_survey_pipeline_config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SurveyCTO ETL and QC platform CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("listing-sync", help="Fetch new Listing Survey submissions and rebuild outputs")
    subparsers.add_parser("listing-rebuild", help="Rebuild Listing Survey outputs from cached raw data")
    subparsers.add_parser("main-sync", help="Fetch new Main Survey submissions and rebuild case tables")
    category_sync_parser = subparsers.add_parser(
        "category-sync",
        help="Pull category forms into their PostgreSQL schemas",
    )
    category_sync_parser.add_argument(
        "--workspace",
        choices=("spread", "edible-oil", "breakfast-cereal"),
        help="Sync only one workspace (default: sync all three).",
    )
    subparsers.add_parser("category-rebuild", help="Transform downloaded category JSON into operational case and media tables")
    subparsers.add_parser("main-rebuild", help="Rebuild Main Survey case tables from cached raw data")
    subparsers.add_parser("main-backfill-cleaning", help="Backfill Main Survey special cleaning/imputation for existing database records")
    subparsers.add_parser("sync-all", help="Run Listing and Main Survey sync in one command")
    subparsers.add_parser("db-init", help="Apply the local PostgreSQL schema to DATABASE_URL")
    subparsers.add_parser("db-check", help="Validate DATABASE_URL and confirm required survey platform tables exist")
    return parser


def main(argv: list[str] | None = None, base_dir: Path | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    config = load_listing_pipeline_config(base_dir)

    if args.command == "listing-sync":
        from survey_platform.etl.listing import run_listing_sync

        run_listing_sync(config)
        return 0

    if args.command == "listing-rebuild":
        from survey_platform.etl.listing import rebuild_listing_outputs

        rebuild_listing_outputs(config)
        return 0

    if args.command == "main-sync":
        from survey_platform.etl.main_survey import run_main_survey_sync

        run_main_survey_sync(load_main_survey_pipeline_config(base_dir))
        return 0

    if args.command == "category-sync":
        from survey_platform.etl.category_forms import sync_all_category_forms

        result = sync_all_category_forms(base_dir, workspace_slug=args.workspace)
        for workspace in result["workspaces"]:
            print(f"{workspace['workspace']}: loaded {workspace['rows']} rows from {workspace['formId']}")
        print("Operational dashboard tables rebuilt; new cases are pending review.")
        return 0

    if args.command == "category-rebuild":
        from survey_platform.etl.category_forms import rebuild_category_operational_data

        result = rebuild_category_operational_data(base_dir)
        for workspace in result["workspaces"]:
            print(f"{workspace['workspace']}: rebuilt {workspace['cases']} cases and {workspace['media']} media rows")
        return 0

    if args.command == "main-rebuild":
        from survey_platform.etl.main_survey import rebuild_main_survey_outputs

        rebuild_main_survey_outputs(load_main_survey_pipeline_config(base_dir))
        return 0

    if args.command == "main-backfill-cleaning":
        from survey_platform.etl.main_survey import backfill_main_special_cleaning

        backfill_main_special_cleaning(load_main_survey_pipeline_config(base_dir))
        return 0

    if args.command == "sync-all":
        from survey_platform.etl.listing import run_listing_sync
        from survey_platform.etl.main_survey import run_main_survey_sync

        listing_config = load_listing_pipeline_config(base_dir)
        main_config = load_main_survey_pipeline_config(base_dir)

        run_listing_sync(listing_config)
        if main_config.form_id or main_config.raw_master_parquet.exists():
            run_main_survey_sync(main_config)
        else:
            print("Main Survey sync skipped: SURVEYCTO_MAIN_FORM_ID is not configured and no cached Main Survey raw master was found.")
        return 0

    if args.command == "db-init":
        from survey_platform.db import init_db

        init_db(config)
        return 0

    if args.command == "db-check":
        from survey_platform.db import check_db

        check_db(config)
        return 0

    parser.error(f"Unsupported command: {args.command}")
    return 2
