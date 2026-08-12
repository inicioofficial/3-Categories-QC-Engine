"""
One-shot ETL sync: main survey only. Exits with 0 on success, 1 on failure.
Designed to be called by a Render Cron Job or Windows Task Scheduler every 1 hour.
Successful syncs run Main QC for newly added cases through run_main_survey_sync_job().
"""
from __future__ import annotations

import sys

from backend.app.database import bootstrap_database
from backend.app.etl_bridge import run_main_survey_sync_job
from backend.app.services.main_survey_cases import bootstrap_main_rule_definitions
from backend.app.settings import get_settings


def main() -> int:
    settings = get_settings()
    bootstrap_database(settings)
    bootstrap_main_rule_definitions(settings)

    try:
        result = run_main_survey_sync_job(source="cron")
        status = result.get("status", "unknown")
        print(f"Main survey sync complete - status: {status}")
        if status == "failed":
            print(f"Main survey sync error: {result.get('reason')}", file=sys.stderr)
            return 1
        if status == "preempted":
            print(result.get("reason") or "Cron main survey sync was preempted.")
        return 0
    except Exception as exc:
        print(f"Main survey sync failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
