from __future__ import annotations

import asyncio
import json
import logging
import re
from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from urllib.parse import parse_qsl, quote, unquote, urlencode, urlparse

import pandas as pd
import requests as req_lib
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response

from backend.app.activity_log import bootstrap_activity_log
from backend.app.auth import AuthUser, require_roles
from backend.app.database import bootstrap_database, database_ready_for_startup, db_connection
from backend.app.routers.auth import router as auth_router
from backend.app.routers.integration import router as integration_router
from backend.app.routers.listing import router as listing_router
from backend.app.routers.main_survey import router as main_survey_router
from backend.app.routers.main_survey_cases import router as main_survey_cases_router
from backend.app.routers.user_management import router as user_management_router
from backend.app.services.listing import (
    bootstrap_listing_case_status_reconciliation,
    bootstrap_listing_export_dictionary,
    bootstrap_rule_definitions,
)
from backend.app.services.main_survey_cases import (
    bootstrap_main_case_status_reconciliation,
    bootstrap_main_rule_definitions,
    get_audio_review_case_detail,
)
from backend.app.services.surveycto_credentials import resolve_surveycto_credentials_for_media
from backend.app.settings import get_settings
from backend.app.workspace_context import ACTIVE_WORKSPACE, WORKSPACE_FORM_IDS

logger = logging.getLogger(__name__)

WORKSPACE_SCHEMA_BY_SLUG = {
    "spread": "spread",
    "edible-oil": "edible_oil",
    "breakfast-cereal": "breakfast_cereal",
}

WORKSPACE_XLSFORM_BY_SLUG = {
    "spread": "data/category_xlsforms/BHT_3_Categories_Margarine_Wave_1_Updated_Script.xlsx",
    "edible-oil": "data/category_xlsforms/BHT_3_Categories_Edible_Oil_Wave_1_Updated_Script.xlsx",
    "breakfast-cereal": "data/category_xlsforms/BHT_3_Categories_Breakfast_Cereal_Wave_1_Updated_Script.xlsx",
}


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


def _clean_question_label(value: object) -> str:
    text = str(value or "").strip()
    if not text:
        return ""
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\$\{[^}]+\}", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _usable_question_label(label: str, variable: str = "") -> bool:
    cleaned = _clean_question_label(label)
    if not cleaned:
        return False
    normalized = cleaned.lower().strip(" .:_-")
    variable_normalized = str(variable or "").lower().strip(" .:_-")
    if variable_normalized and normalized == variable_normalized:
        return False
    if re.fullmatch(r"(silent\s+)?recording\s*\d*", normalized):
        return False
    if normalized in {"audio", "audio audit", "radioplay", "record audio", "play audio"}:
        return False
    return True


@lru_cache(maxsize=8)
def _category_audio_label_map(root_dir: str, workspace: str) -> dict[str, str]:
    relative_path = WORKSPACE_XLSFORM_BY_SLUG.get(workspace)
    if not relative_path:
        return {}
    path = Path(root_dir) / relative_path
    if not path.exists():
        logger.warning("Category XLSForm not found for audio labels: %s", path)
        return {}

    try:
        survey_df = pd.read_excel(path, sheet_name="survey").fillna("")
    except Exception:
        logger.exception("Unable to load category XLSForm audio labels from %s", path)
        return {}

    columns = list(survey_df.columns)
    name_col = next((col for col in columns if str(col).strip().lower() == "name"), None)
    type_col = next((col for col in columns if str(col).strip().lower() == "type"), None)
    label_cols = [
        col
        for col in columns
        if str(col).strip().lower() == "label" or str(col).strip().lower().startswith("label::")
    ]
    if name_col is None:
        return {}

    labels: dict[str, str] = {}
    direct_question_labels: dict[str, str] = {}
    previous_question_label = ""

    def put(key: str, label: str) -> None:
        normalized_key = str(key or "").strip()
        if not normalized_key or not label:
            return
        labels[normalized_key] = label
        labels[normalized_key.lower()] = label

    for row in survey_df.to_dict(orient="records"):
        variable = str(row.get(name_col) or "").strip()
        if not variable:
            continue
        question_type = str(row.get(type_col) or "").strip().lower() if type_col is not None else ""
        raw_label = ""
        for label_col in label_cols:
            candidate = _clean_question_label(row.get(label_col))
            if candidate:
                raw_label = candidate
                break

        variable_lower = variable.lower()
        source_variable = variable_lower.removeprefix("audio_audit_")
        is_audio_field = (
            "audio" in question_type
            or "audio" in variable_lower
            or variable_lower in {"radioplay", "radio_play", "recording", "record_audio"}
        )
        is_structural = any(
            token in question_type
            for token in ("begin group", "end group", "begin repeat", "end repeat", "calculate", "note")
        )

        if not is_audio_field and not is_structural and _usable_question_label(raw_label, variable):
            direct_question_labels[variable_lower] = raw_label
            previous_question_label = raw_label
            put(variable, raw_label)
            put(f"audio_audit_{variable}", raw_label)
            continue

        if is_audio_field:
            source_label = direct_question_labels.get(source_variable)
            chosen_label = source_label
            if not chosen_label and _usable_question_label(raw_label, variable):
                chosen_label = raw_label
            if not chosen_label:
                chosen_label = previous_question_label
            if chosen_label:
                put(variable, chosen_label)
                if source_variable and source_variable != variable_lower:
                    put(source_variable, chosen_label)
                    put(f"audio_audit_{source_variable}", chosen_label)

    for variable, label in direct_question_labels.items():
        put(variable, label)
        put(f"audio_audit_{variable}", label)
    return labels


def _workspace_for_form_id(form_id: str | None) -> str | None:
    normalized = str(form_id or "").strip()
    if not normalized:
        return None
    for workspace, workspace_form_id in WORKSPACE_FORM_IDS.items():
        if normalized == workspace_form_id:
            return workspace
    return None


def _proxy_media_url(media_ref: str) -> str:
    raw = str(media_ref or "").strip()
    if not raw:
        return ""
    if raw.startswith("data:") or raw.startswith("/"):
        return raw
    return f"/api/main-survey/media-proxy/{quote(raw, safe='')}"


def _resolve_audio_label(label_map: dict[str, str], variable: str, existing_label: str | None, index: int) -> str:
    variable_text = str(variable or "").strip()
    keys = [
        variable_text,
        variable_text.lower(),
        variable_text.lower().removeprefix("audio_audit_"),
    ]
    for key in keys:
        label = label_map.get(key)
        if label:
            return label
    if existing_label and _usable_question_label(existing_label, variable_text):
        return _clean_question_label(existing_label)
    return f"Interview recording {index}"


def _enrich_category_audio_detail(settings, workspace: str | None, payload: dict) -> dict:
    case_id = str(payload.get("case_id") or "").strip()
    media_rows: list[dict] = []
    form_id: str | None = None

    if case_id:
        with db_connection(settings) as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT form_id FROM clean.main_case WHERE case_id = %s LIMIT 1", (case_id,))
                case_row = cur.fetchone()
                if case_row:
                    form_id = str(case_row.get("form_id") or "").strip() or None
                cur.execute(
                    """
                    SELECT variable_name, file_name, surveycto_path, created_at
                    FROM clean.main_case_media
                    WHERE case_id = %s
                      AND media_type = 'audio'
                      AND NULLIF(TRIM(COALESCE(surveycto_path, file_name, '')), '') IS NOT NULL
                    ORDER BY created_at NULLS LAST, variable_name, file_name
                    """,
                    (case_id,),
                )
                media_rows = [dict(row) for row in cur.fetchall()]

    resolved_workspace = workspace if workspace in WORKSPACE_FORM_IDS else _workspace_for_form_id(form_id)
    label_map = _category_audio_label_map(str(settings.root_dir), resolved_workspace) if resolved_workspace else {}

    merged_items: list[dict] = []
    seen_refs: set[str] = set()

    def add_item(variable_name: str, media_ref: str, file_name: str | None = None, existing_label: str | None = None) -> None:
        ref = str(media_ref or "").strip()
        if not ref:
            return
        dedupe_key = ref.replace("\\", "/").strip().lower()
        if dedupe_key in seen_refs:
            return
        seen_refs.add(dedupe_key)
        variable = str(variable_name or "audio").strip() or "audio"
        clean_file_name = str(file_name or "").strip()
        if not clean_file_name:
            clean_file_name = ref.replace("\\", "/").split("/")[-1]
        merged_items.append(
            {
                "variable_name": variable,
                "label": _resolve_audio_label(label_map, variable, existing_label, len(merged_items) + 1),
                "file_name": clean_file_name,
                "media_url": _proxy_media_url(ref),
            }
        )

    for row in media_rows:
        media_ref = str(row.get("surveycto_path") or row.get("file_name") or "").strip()
        add_item(
            str(row.get("variable_name") or "audio"),
            media_ref,
            str(row.get("file_name") or "").strip() or None,
        )

    for item in payload.get("audio_file_items") or []:
        if not isinstance(item, dict):
            continue
        media_ref = str(item.get("media_url") or item.get("file_name") or "").strip()
        add_item(
            str(item.get("variable_name") or "audio"),
            media_ref,
            str(item.get("file_name") or "").strip() or None,
            str(item.get("label") or "").strip() or None,
        )

    for variable, media_ref in (payload.get("audio_files") or {}).items():
        add_item(str(variable), str(media_ref or ""))

    fallback_audio_url = str(payload.get("audio_url") or "").strip()
    if fallback_audio_url:
        add_item("audio_url", fallback_audio_url, existing_label="Interview audio")

    payload["audio_file_items"] = merged_items
    payload["audio_files"] = {
        item["variable_name"]: item["media_url"]
        for item in merged_items
    }
    if merged_items:
        payload["audio_url"] = merged_items[0]["media_url"]
    return payload


def _parse_byte_range(range_header: str, total_length: int) -> tuple[int, int] | None:
    if total_length <= 0:
        return None
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", str(range_header or "").strip())
    if not match:
        return None
    start_text, end_text = match.groups()
    if not start_text and not end_text:
        return None
    if not start_text:
        suffix_length = min(int(end_text), total_length)
        return total_length - suffix_length, total_length - 1
    start = int(start_text)
    if start >= total_length:
        raise HTTPException(status_code=416, detail="Requested media range is outside the file.")
    end = int(end_text) if end_text else total_length - 1
    end = min(end, total_length - 1)
    if end < start:
        raise HTTPException(status_code=416, detail="Requested media range is invalid.")
    return start, end


def _fetch_server_managed_surveycto_media(
    settings,
    media_ref: str,
    workspace: str | None,
    range_header: str | None = None,
) -> tuple[bytes, str, int, dict[str, str]]:
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
    request_headers = {"Range": range_header} if range_header else None
    for media_url in candidate_urls:
        try:
            resp = req_lib.get(
                media_url,
                auth=(surveycto_username, surveycto_password),
                headers=request_headers,
                timeout=30,
            )
        except req_lib.RequestException as exc:
            raise HTTPException(status_code=502, detail=f"Could not reach SurveyCTO: {exc}") from exc

        if resp.status_code in {200, 206}:
            content = resp.content
            content_type = resp.headers.get("content-type", "application/octet-stream")
            response_status = resp.status_code
            response_headers = {
                "Accept-Ranges": "bytes",
                "Content-Encoding": "identity",
            }

            upstream_content_range = resp.headers.get("content-range")
            if range_header and resp.status_code == 200:
                requested_range = _parse_byte_range(range_header, len(content))
                if requested_range is not None:
                    start, end = requested_range
                    full_length = len(content)
                    content = content[start : end + 1]
                    response_status = 206
                    response_headers["Content-Range"] = f"bytes {start}-{end}/{full_length}"
            elif upstream_content_range:
                response_headers["Content-Range"] = upstream_content_range

            response_headers["Content-Length"] = str(len(content))
            return content, content_type, response_status, response_headers

        if resp.status_code in {401, 403}:
            authorization_failed = True
            last_status = resp.status_code
            continue
        if resp.status_code == 404:
            last_status = 404
            continue
        if resp.status_code == 416:
            last_status = 416
            continue
        last_status = resp.status_code

    if authorization_failed and last_status in {401, 403}:
        raise HTTPException(status_code=last_status, detail="The server SurveyCTO credentials cannot access this media file.")
    if last_status == 416:
        raise HTTPException(status_code=416, detail="Requested media range is outside the file.")
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
        range_header = request.headers.get("range")
        settings = get_settings()
        try:
            content, content_type, status_code, response_headers = await asyncio.to_thread(
                _fetch_server_managed_surveycto_media,
                settings,
                encoded_media_ref,
                workspace,
                range_header,
            )
        except HTTPException as exc:
            headers = {"Accept-Ranges": "bytes"}
            if exc.status_code == 416:
                headers["Content-Encoding"] = "identity"
            return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=headers)
        return Response(
            content=content,
            status_code=status_code,
            media_type=content_type,
            headers=response_headers,
        )
    return await call_next(request)


@app.middleware("http")
async def workspace_context_middleware(request, call_next):
    workspace = str(request.headers.get("x-workspace") or "").strip().lower()
    active_workspace = workspace if workspace in WORKSPACE_FORM_IDS else None

    # A selected category workspace is already fully scoped by form_id. The old
    # category query parameter maps Edible Oil/Breakfast/Spread to legacy panel
    # codes and can incorrectly filter every workspace record out of the explorer.
    if active_workspace and request.method.upper() == "GET" and request.url.path == "/api/main-survey/cases":
        query_pairs = parse_qsl(request.scope.get("query_string", b"").decode("utf-8"), keep_blank_values=True)
        filtered_pairs = [(key, value) for key, value in query_pairs if key != "category"]
        request.scope["query_string"] = urlencode(filtered_pairs, doseq=True).encode("utf-8")

    if active_workspace and request.method.upper() == "POST" and request.url.path == "/api/main-survey/cases/bulk-search":
        raw_body = await request.body()
        try:
            body_payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            body_payload = None
        if isinstance(body_payload, dict) and "category" in body_payload:
            body_payload.pop("category", None)
            replacement_body = json.dumps(body_payload).encode("utf-8")

            async def receive_replacement_body():
                return {"type": "http.request", "body": replacement_body, "more_body": False}

            request._receive = receive_replacement_body

    token = ACTIVE_WORKSPACE.set(active_workspace)
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


def _empty_sync_state() -> dict[str, object | None]:
    return {
        "lastSuccessfulCompletionUtc": None,
        "lastRunStartedAt": None,
        "lastRunFinishedAt": None,
        "lastStatus": "unknown",
        "lastMessage": None,
    }


def _workspace_sync_state(settings, workspace: str) -> dict[str, object | None] | None:
    schema = WORKSPACE_SCHEMA_BY_SLUG.get(workspace)
    form_id = WORKSPACE_FORM_IDS.get(workspace)
    if not schema or not form_id:
        return None
    with db_connection(settings) as conn:
        with conn.cursor() as cur:
            cur.execute(
                f"""
                SELECT last_status, last_message, last_row_count,
                       last_successful_sync_at, updated_at
                FROM {schema}.sync_state
                WHERE form_id = %s
                LIMIT 1
                """,
                (form_id,),
            )
            row = cur.fetchone()
    if not row:
        return None
    successful_at = row.get("last_successful_sync_at")
    updated_at = row.get("updated_at")
    return {
        "lastSuccessfulCompletionUtc": successful_at,
        "lastRunStartedAt": successful_at,
        "lastRunFinishedAt": updated_at or successful_at,
        "lastStatus": row.get("last_status") or "unknown",
        "lastMessage": row.get("last_message"),
        "lastRowCount": row.get("last_row_count") or 0,
    }


@app.get("/api/sync/status")
def sync_status(request: Request):
    """Expose the selected category's real SurveyCTO sync timestamp."""
    workspace = str(request.headers.get("x-workspace") or "").strip().lower()
    default_state = _empty_sync_state()
    status_payload = {
        "listing": dict(default_state),
        "main": dict(default_state),
    }

    if workspace in WORKSPACE_FORM_IDS:
        try:
            workspace_state = _workspace_sync_state(settings, workspace)
            if workspace_state:
                status_payload["main"] = workspace_state
            return {
                "status": "ok",
                "workspace": workspace,
                **status_payload,
            }
        except Exception as exc:
            logger.exception("Unable to read workspace sync state for %s", workspace)
            return {
                "status": "degraded",
                "workspace": workspace,
                "error": str(exc),
                **status_payload,
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


@app.get("/api/main-survey/audio-listening/cases/{case_id}/detail")
def category_audio_review_case_detail(
    case_id: str,
    request: Request,
    user: AuthUser = Depends(require_roles("SUPERADMIN", "INICIO-ADMIN", "PDM-ADMIN", "PDM-QC")),
    settings=Depends(get_settings),
):
    """Return every category audio attachment with reviewer-friendly XLSForm labels."""
    payload = get_audio_review_case_detail(settings, user, case_id)
    workspace = str(request.headers.get("x-workspace") or "").strip().lower() or None
    return _enrich_category_audio_detail(settings, workspace, payload)


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
