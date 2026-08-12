from __future__ import annotations

import asyncio
import contextlib

from backend.app.database import bootstrap_database
from backend.app.etl_bridge import run_main_survey_sync_job
from backend.app.services.main_survey_cases import (
    bootstrap_main_case_status_reconciliation,
    bootstrap_main_rule_definitions,
)
from backend.app.settings import get_settings


async def scheduled_main_survey_sync_loop() -> None:
    """Runs unified main SurveyCTO sync, then QC for newly added cases."""
    while True:
        settings = get_settings()
        try:
            print("ETL worker: starting scheduled Main Survey sync. QC will run for newly added cases after a successful sync.")
            result = await asyncio.to_thread(run_main_survey_sync_job, "scheduler")
            qc_result = result.get("qcResult") if isinstance(result, dict) else None
            print(f"ETL worker: scheduled sync finished: {result.get('status') if isinstance(result, dict) else 'unknown'}; QC: {qc_result or 'no new cases'}")
        except Exception as exc:
            print(f"Scheduled Main Survey sync failed: {exc}")
        await asyncio.sleep(settings.sync_interval_seconds)


async def main() -> None:
    settings = get_settings()
    bootstrap_database(settings)
    bootstrap_main_rule_definitions(settings)
    bootstrap_main_case_status_reconciliation(settings)

    tasks: list[asyncio.Task[None]] = []

    if settings.auto_sync_enabled:
        print(f"ETL worker: main SurveyCTO sync loop enabled every {settings.sync_interval_seconds} seconds.")
        print("ETL worker: every successful sync will run Main QC on newly added cases.")
        tasks.append(asyncio.create_task(scheduled_main_survey_sync_loop()))
    else:
        print("ETL worker: sync loops disabled by AUTO_SYNC_ENABLED=false.")

    if not tasks:
        print("ETL worker: no background loops enabled. Exiting.")
        return

    try:
        await asyncio.gather(*tasks)
    finally:
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError):
                await task


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("ETL worker stopped.")
