from __future__ import annotations

import asyncio
import contextlib

from backend.app.database import bootstrap_database
from backend.app.services.main_survey import refresh_bht_map_mart, refresh_main_verbatim_answer_mart
from backend.app.services.main_survey_cases import (
    bootstrap_main_case_status_reconciliation,
    bootstrap_main_rule_definitions,
    refresh_main_operational_marts,
    run_main_qc,
)
from backend.app.settings import get_settings
from survey_platform.etl.category_forms import sync_all_category_forms


def run_category_sync_cycle(settings) -> dict:
    """Pull all category forms, rebuild operational data, then refresh marts."""
    result = sync_all_category_forms(settings.root_dir)
    result["automaticQc"] = run_main_qc(settings, only_pending=False, batch_limit=None)
    result["operationalMarts"] = refresh_main_operational_marts(settings)
    result["mapMart"] = refresh_bht_map_mart(settings)
    result["verbatimMart"] = refresh_main_verbatim_answer_mart(settings)
    return result


async def scheduled_category_sync_loop() -> None:
    """Run immediately at startup, then keep sync starts on the configured cadence."""
    loop = asyncio.get_running_loop()
    while True:
        settings = get_settings()
        interval = max(300, int(settings.sync_interval_seconds or 3600))
        cycle_started = loop.time()
        try:
            print("ETL worker: starting scheduled three-category SurveyCTO sync.", flush=True)
            result = await asyncio.to_thread(run_category_sync_cycle, settings)
            counts = ", ".join(
                f"{item['workspace']}={item['rows']}"
                for item in result.get("workspaces", [])
            )
            print(f"ETL worker: category sync completed successfully ({counts}).", flush=True)
        except Exception as exc:
            print(f"ETL worker: scheduled category sync failed: {type(exc).__name__}: {exc}", flush=True)

        elapsed = loop.time() - cycle_started
        delay = max(0.0, interval - elapsed)
        if delay:
            print(
                f"ETL worker: next category sync in {delay:.0f} seconds "
                f"(start-to-start interval {interval} seconds).",
                flush=True,
            )
            await asyncio.sleep(delay)
        else:
            print(
                f"ETL worker: category sync took {elapsed:.0f} seconds, exceeding the "
                f"{interval}-second interval; starting the next cycle immediately.",
                flush=True,
            )


async def main() -> None:
    settings = get_settings()
    bootstrap_database(settings)
    bootstrap_main_rule_definitions(settings)
    bootstrap_main_case_status_reconciliation(settings)

    tasks: list[asyncio.Task[None]] = []

    if settings.auto_sync_enabled:
        print(f"ETL worker: three-category SurveyCTO sync enabled every {settings.sync_interval_seconds} seconds.")
        tasks.append(asyncio.create_task(scheduled_category_sync_loop()))
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
