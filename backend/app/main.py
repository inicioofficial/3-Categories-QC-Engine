from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

import requests as req_lib
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from backend.app.database import bootstrap_database, database_ready_for_startup, db_connection
from backend.app.routers.auth import router as auth_router
from backend.app.routers.listing import router as listing_router
from backend.app.routers.main_survey import router as main_survey_router
from backend.app.routers.main_survey_cases import router as main_survey_cases_router
from backend.app.routers.user_management import router as user_management_router
from backend.app.routers.integration import router as integration_router
from backend.app.activity_log import bootstrap_activity_log
from backend.app.services.listing import (
    bootstrap_listing_case_status_reconciliation,
    bootstrap_listing_export_dictionary,
    bootstrap_rule_definitions,
)
from backend.app.services.main_survey_cases import (
    bootstrap_main_case_status_reconciliation,
    bootstrap_main_rule_definitions,
)
from backend.app.services.surveycto_credentials import resolve_surveycto_credentials_for_media
from backend.app.settings import get_settings
from backend.app.workspace_context import ACTIVE_WORKSPACE, WORKSPACE_FORM_IDS

logger = logging.getLogger(__name__)


async def _run_post_startup_bootstraps() -> None:
    settings = get_settings()
    try:
        await asyncio.to_thread(bootstrap_database, settings)
    except Exception:
        logger.exception("Database bootstrap failed; skipping dependent post-startup bootstraps.")
        return

    try:
        database_ready = await asyncio.to_thread(database_ready_for_startup, settings)
    except Exception:
        logger.exception("Database readiness check failed after bootstrap; skipping dependent bootstraps.")
        return

    if not database_ready:
        logger.error("Database bootstrap finished but required tables are still missing; skipping dependent bootstraps.")
        return

    bootstrap_steps = [
        ("listing export dictionary", bootstrap_listing_export_dictionary),
        ("listing rule definitions", bootstrap_rule_definitions),
        ("listing case reconciliation", bootstrap_listing_case_status_reconciliation),
        ("main rule definitions", bootstrap_main_rule_definitions),
        ("main case reconciliation", bootstrap_main_case_status_reconciliation),
        ("activity log", bootstrap_activity_log),
    ]

    for label, func in bootstrap_steps:
        try:
            await asyncio.to_thread(func, settings)
        except Exception:
            logger.exception("Post-startup bootstrap failed for %s.", label)

    await _refresh_runtime_marts(settings)


async def _refresh_runtime_marts(settings) -> None:
    mart_steps = []
    try:
        from backend.app.services.main_survey import prewarm_bht_overview_cache, refresh_bht_map_mart
        from backend.app.services.main_survey_cases import refresh_main_operational_marts

        mart_steps = [
            ("main operational marts", refresh_main_operational_marts),
            ("BHT overview/map mart", refresh_bht_map_mart),
            ("BHT overview cache", prewarm_bht_overview_cache),
        ]
    except Exception:
        logger.exception("Unable to import runtime mart refreshers.")
        return

    for label, func in mart_steps:
        try:
            await asyncio.to_thread(func, settings)
        except Exception:
            logger.exception("Post-startup mart refresh failed for %s.", label)


async def _run_bootstraps_if_needed() -> None:
    settings = get_settings()
    try:
        database_ready = await asyncio.to_thread(database_ready_for_startup, settings)
    except Exception:
        logger.exception("Database readiness check failed after startup; attempting bootstraps in background.")
        database_ready = False

    if database_ready:
        logger.info("Database already initialized; runtime mart refresh is owned by the ETL worker.")
        return

    logger.info("Database not ready; running startup bootstraps in the background.")
    await _run_post_startup_bootstraps()


@asynccontextmanager
async def lifespan(app: FastAPI):
    bootstrap_task = asyncio.create_task(_run_bootstraps_if_needed())

    try:
        yield
    finally:
        if bootstrap_task and not bootstrap_task.done():
            bootstrap_task.cancel()
            try:
                await bootstrap_task
            except asyncio.CancelledError:
                pass


def _run_startup_bootstraps_sync(settings) -> None:
    bootstrap_database(settings)
    if not database_ready_for_startup(settings):
        raise RuntimeError("Database bootstrap finished but required tables are still missing.")

    bootstrap_steps = [
        ("listing export dictionary", bootstrap_listing_export_dictionary),
        ("listing rule definitions", bootstrap_rule_definitions),
        ("listing case reconciliation", bootstrap_listing_case_status_reconciliation),
        ("main rule definitions", bootstrap_main_rule_definitions),
        ("main case reconciliation", bootstrap_main_case_status_reconciliation),
        ("activity log", bootstrap_activity_log),
    ]

    for label, func in bootstrap_steps:
        func(settings)

    from backend.app.services.main_survey import prewarm_bht_overview_cache, refresh_bht_map_mart, refresh_main_verbatim_answer_mart
    from backend.app.services.main_survey_cases import refresh_main_operational_marts

    refresh_main_operational_marts(settings)
    refresh_bht_map_mart(settings)
    prewarm_bht_overview_cache(settings)
    refresh_main_verbatim_answer_mart(settings)


def _fetch_server_managed_surveycto_media(settings, media_ref: str, workspace: str | None) -> tuple[bytes, str]:
    surveycto_username, surveycto_password = resolve_surveycto_credentials_for_media(settings)
    expected_host = f"{settings.surveycto_server}.surveycto.com".lower()
    media_ref = unquote(media_ref).strip()
    if not media_ref:
        raise HTTPException(status_code=400, detail="Media reference is required.")

    candidate_urls: list[str] = []
    parsed = urlparse(media_ref)
    if parsed.scheme or parsed.netloc:
        if parsed.scheme.lower() != "https" or (parsed.hostname or "").lower() != expected_host:
            raise HTTPException(status_code=400, detail="Only media from the configured SurveyCTO server can be proxied.")
        candidate_urls.append(media_ref)
    else:
        bare_filename = media_ref.replace("\\", "/").split("/")[-1].strip()
        if not bare_filename:
            raise HTTPException(status_code=400, detail="Media filename is required.")

        form_ids: list[str] = []
        if workspace and workspace in WORKSPACE_FORM_IDS:
            form_ids.append(WORKSPACE_FORM_IDS[workspace])
        form_ids.extend(WORKSPACE_FORM_IDS.values())
        if settings.surveycto_main_form_id:
            form_ids.append(settings.surveycto_main_form_id)
        if settings.surveycto_listing_form_id:
            form_ids.append(settings.surveycto_listing_form_id)

        seen: set[str] = set()
        for form_id in form_ids:
            normalized_form_id = str(form_id or "").strip()
            if not normalized_form_id or normalized_form_id in seen:
                continue
            seen.add(normalized_form_id)
            candidate_urls.append(
                f"https://{expected_host}/api/v1/forms/{quote(normalized_form_id, safe='')}"
                f"/files/multimedia/{quote(bare_filename, safe='')}"
            )

    last_status: int | None = None
    authorization_failed = False
    for media_url in candidate_urls:
        try:
            resp = req_lib.get(
                media_url,
                auth=(surveycto_username, surveycto_password),
                timeout=30,
            )
        except req_lib.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach SurveyCTO: {exc}") from exc

        if resp.status_code == 200:
            return resp.content, resp.headers.get("content-type", "application/octet-stream")
        if resp.status_code in {401, 403}:
            authorization_failed = True
            last_status = resp.status_code
            continue
        if resp.status_code == 404:
            last_status = 404
            continue
        last_status = resp.status_code

    if authorization_failed and last_status in {401, 403}:
        raise HTTPException(status_code=last_status, detail="The server SurveyCTO credentials cannot access this media file.")
    if last_status and last_status != 404:
        raise HTTPException(status_code=last_status, detail=f"SurveyCTO returned HTTP {last_status}.")
    raise HTTPException(status_code=404, detail="Media file not found in the configured SurveyCTO forms.")


app = FastAPI(
    title="INICIO SurveyCTO ETL QC Platform",
    version="0.1.0",
    summary="Listing ETL, QC, dashboards, exports, and map APIs for INICIO.",
    lifespan=lifespan,
)


@app.middleware("http")
async def server_managed_surveycto_media_middleware(request, call_next):
    raw_path = request.scope.get("raw_path") or b""
    prefix = b"/api/main-survey/media-proxy/"
    if raw_path.startswith(prefix):
        encoded_media_ref = raw_path[len(prefix):].decode("utf-8", errors="replace")
        workspace = str(request.headers.get("x-workspace") or "").strip().lower() or None
        settings = get_settings()
        try:
            content, content_type = await asyncio.to_thread(
                _fetch_server_managed_surveycto_media,
                settings,
                encoded_media_ref,
                workspace,
            )
        except HTTPException as exc:
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
        return Response(content=content, media_type=content_type)
    return await call_next(request)


@app.middleware("http")
async def workspace_context_middleware(request, call_next):
    workspace = str(request.headers.get("x-workspace") or "").strip().lower()
    token = ACTIVE_WORKSPACE.set(workspace if workspace in WORKSPACE_FORM_IDS else None)
    try:
        return await call_next(request)
    finally:
        ACTIVE_WORKSPACE.reset(token)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin, "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/sync/status")
def sync_status():
    """
    Tiny health endpoint exposing latest listing/main sync timestamps and status.
    """
    default_state = {
        "lastSuccessfulCompletionUtc": None,
        "lastRunStartedAt": None,
        "lastRunFinishedAt": None,
        "lastStatus": "unknown",
        "lastMessage": None,
    }
    status_payload = {
        "listing": dict(default_state),
        "main": dict(default_state),
    }

    try:
        with db_connection(settings) as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT instrument_code, last_successful_completion_utc, last_run_started_at,
                           last_run_finished_at, last_status, last_message
                    FROM raw.sync_state
                    WHERE instrument_code IN ('listing', 'main')
                    """
                )
                for row in cur.fetchall():
                    instrument = str(row.get("instrument_code") or "").strip().lower()
                    if instrument not in status_payload:
                        continue
                    status_payload[instrument] = {
                        "lastSuccessfulCompletionUtc": row.get("last_successful_completion_utc"),
                        "lastRunStartedAt": row.get("last_run_started_at"),
                        "lastRunFinishedAt": row.get("last_run_finished_at"),
                        "lastStatus": row.get("last_status") or "unknown",
                        "lastMessage": row.get("last_message"),
                    }
    except Exception as exc:
        return {
            "status": "degraded",
            "error": str(exc),
            **status_payload,
        }

    return {
        "status": "ok",
        **status_payload,
    }


app.include_router(auth_router)
app.include_router(listing_router)
app.include_router(main_survey_router)
app.include_router(main_survey_cases_router)
app.include_router(user_management_router)
app.include_router(integration_router)

PROJECT_ROOT = Path(__file__).parent.parent.parent
FRONTEND_BUILD_DIR = PROJECT_ROOT / "frontend" / "dist"
FRONTEND_SOURCE_DIR = PROJECT_ROOT / "frontend"


def _resolve_spa_index_path() -> Path:
    dist_index = FRONTEND_BUILD_DIR / "index.html"
    if dist_index.exists():
        return dist_index
    source_index = FRONTEND_SOURCE_DIR / "index.html"
    if source_index.exists():
        return source_index
    raise HTTPException(status_code=404, detail="SPA index not found")


@app.get("/api/spa")
def spa_health():
    return {"spa": "enabled"}


if FRONTEND_BUILD_DIR.exists():
    @app.get("/", include_in_schema=False)
    async def serve_spa_root():
        return FileResponse(FRONTEND_BUILD_DIR / "index.html")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_spa(full_path: str):
        # Let API 404s remain API 404s (instead of returning index.html payloads).
        if full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")

        asset_path = FRONTEND_BUILD_DIR / full_path
        if asset_path.exists() and asset_path.is_file():
            return FileResponse(asset_path)

        return FileResponse(FRONTEND_BUILD_DIR / "index.html")
