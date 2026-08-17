from __future__ import annotations

import asyncio
import contextlib
import re
import time
from datetime import datetime, timezone

from backend.app.database import bootstrap_database
from backend.app.services.main_survey import refresh_bht_map_mart, refresh_main_verbatim_answer_mart
from backend.app.services.main_survey_cases import (
    bootstrap_main_case_status_reconciliation,
    bootstrap_main_rule_definitions,
    refresh_main_operational_marts,
    run_main_qc,
)
from backend.app.settings import get_settings
from survey_platform.config import load_dotenv_file, read_env
from survey_platform.etl.category_forms import rebuild_category_operational_data, sync_workspace
from survey_platform.workspaces import load_survey_workspaces


SURVEYCTO_THROTTLE_MAX_RETRIES = 5
SURVEYCTO_THROTTLE_BUFFER_SECONDS = 5
SURVEYCTO_THROTTLE_FALLBACK_WAIT_SECONDS = 15


def _category_cooldown_seconds(settings) -> int:
    dotenv = load_dotenv_file(settings.root_dir / ".env")
    try:
        return max(
            0,
            int(read_env("CATEGORY_SYNC_COOLDOWN_SECONDS", dotenv, "270") or "270"),
        )
    except ValueError as exc:
        raise RuntimeError("CATEGORY_SYNC_COOLDOWN_SECONDS must be a whole number of seconds.") from exc


def _surveycto_throttle_wait_seconds(exc: BaseException) -> int | None:
    """Return SurveyCTO's requested wait for HTTP 417 throttling, if present."""
    message = str(exc)
    if not re.search(r"HTTP\s+417\b", message, flags=re.IGNORECASE):
        return None
    match = re.search(r"wait\s+for\s+(\d+)\s+seconds?", message, flags=re.IGNORECASE)
    if not match:
        return SURVEYCTO_THROTTLE_FALLBACK_WAIT_SECONDS
    return max(1, int(match.group(1)))


def _published_workspace_case_count(operational: dict, workspace_slug: str) -> int | None:
    for item in operational.get("workspaces", []):
        if str(item.get("workspace") or "") == workspace_slug:
            try:
                return int(item.get("cases") or 0)
            except (TypeError, ValueError):
                return None
    return None


def sync_category_forms_with_retry(settings) -> dict:
    """Pull category forms in sequence, retry throttles, and publish each successful pull immediately."""
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is required for category-sync.")
    if not settings.surveycto_username or not settings.surveycto_password:
        raise RuntimeError("SURVEYCTO_USERNAME and SURVEYCTO_PASSWORD are required for category-sync.")

    cooldown_seconds = _category_cooldown_seconds(settings)
    workspaces = load_survey_workspaces(settings.root_dir)
    results: list[dict] = []
    latest_operational: dict = {"status": "success", "workspaces": []}

    for index, workspace in enumerate(workspaces):
        started = datetime.now(timezone.utc)
        throttle_retries = 0

        while True:
            try:
                result = sync_workspace(
                    workspace,
                    server=settings.surveycto_server,
                    username=settings.surveycto_username,
                    password=settings.surveycto_password,
                    database_url=settings.database_url,
                )
                break
            except RuntimeError as exc:
                requested_wait = _surveycto_throttle_wait_seconds(exc)
                if requested_wait is None:
                    raise
                if throttle_retries >= SURVEYCTO_THROTTLE_MAX_RETRIES:
                    raise RuntimeError(
                        f"SurveyCTO kept throttling {workspace.form_id} after "
                        f"{SURVEYCTO_THROTTLE_MAX_RETRIES} retries: {exc}"
                    ) from exc

                throttle_retries += 1
                retry_wait = max(
                    SURVEYCTO_THROTTLE_FALLBACK_WAIT_SECONDS,
                    requested_wait + SURVEYCTO_THROTTLE_BUFFER_SECONDS,
                )
                print(
                    f"SurveyCTO throttle: {workspace.slug} requested a {requested_wait}-second wait; "
                    f"waiting {retry_wait} seconds before retry "
                    f"{throttle_retries}/{SURVEYCTO_THROTTLE_MAX_RETRIES}.",
                    flush=True,
                )
                time.sleep(retry_wait)

        # Publish the newly pulled submissions to clean.main_case immediately.
        # This keeps Main Data Explorer aligned with the category's latest successful
        # SurveyCTO pull even while the worker is waiting to pull later categories.
        latest_operational = rebuild_category_operational_data(settings.root_dir)
        published_cases = _published_workspace_case_count(latest_operational, workspace.slug)
        result["startedAt"] = started.isoformat()
        result["throttleRetries"] = throttle_retries
        result["publishedCases"] = published_cases
        results.append(result)
        published_text = str(published_cases) if published_cases is not None else "unknown"
        print(
            f"ETL worker: published {workspace.slug} to operational tables "
            f"({published_text} cases available to Data Explorer).",
            flush=True,
        )

        if index < len(workspaces) - 1 and cooldown_seconds:
            next_workspace = workspaces[index + 1]
            print(
                f"SurveyCTO cooldown: waiting {cooldown_seconds} seconds before pulling {next_workspace.slug}.",
                flush=True,
            )
            time.sleep(cooldown_seconds)

    return {"status": "success", "workspaces": results, "operational": latest_operational}


def run_category_sync_cycle(settings) -> dict:
    """Pull and publish all category forms, then run QC and refresh marts."""
    result = sync_category_forms_with_retry(settings)
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
            retries = sum(int(item.get("throttleRetries") or 0) for item in result.get("workspaces", []))
            retry_note = f"; throttle retries={retries}" if retries else ""
            print(
                f"ETL worker: category sync completed successfully ({counts}{retry_note}).",
                flush=True,
            )
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
