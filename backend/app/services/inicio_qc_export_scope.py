from __future__ import annotations

import io
import tempfile
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import Depends, Query
from fastapi.responses import StreamingResponse
from fastapi.routing import APIRoute

from backend.app.auth import AuthUser, get_current_user, normalize_role
from backend.app.services.inicio_qc_export_attribution import lookup_inicio_qc_decision_actors
from backend.app.services.main_survey import (
    _write_dataframe_to_xlsx,
    build_bht_overview_kpi_export_dataframe,
)
from backend.app.settings import Settings, get_settings


INICIO_QC_APPROVER_COLUMN = "Approved by(INICIO QC)"
INICIO_QC_APPROVER_VISIBLE_ROLES = {"SUPERADMIN", "INICIO-ADMIN", "INICIO-QC"}


def _can_view_inicio_qc_approver(user: AuthUser) -> bool:
    return normalize_role(user.role) in INICIO_QC_APPROVER_VISIBLE_ROLES


def add_inicio_qc_approver_column(
    settings: Settings,
    user: AuthUser,
    dataframe: pd.DataFrame,
) -> pd.DataFrame:
    """Add historical INICIO-QC decision attribution for permitted viewers."""
    if not _can_view_inicio_qc_approver(user):
        return dataframe

    out = dataframe.copy()
    if INICIO_QC_APPROVER_COLUMN in out.columns:
        out = out.drop(columns=[INICIO_QC_APPROVER_COLUMN])

    submission_keys = [
        str(value or "").strip()
        for value in out.get("Submission Key", pd.Series(dtype="object")).tolist()
        if str(value or "").strip()
    ]
    actor_by_submission = lookup_inicio_qc_decision_actors(settings, submission_keys)

    values = [
        actor_by_submission.get(str(value or "").strip(), "")
        for value in out.get("Submission Key", pd.Series(dtype="object")).tolist()
    ]
    approved_by_index = out.columns.get_loc("Approved By") + 1 if "Approved By" in out.columns else len(out.columns)
    out.insert(approved_by_index, INICIO_QC_APPROVER_COLUMN, values)
    return out


def bht_overview_kpi_export_scoped(
    kpi: str = Query(..., description="KPI export key: total_synced, approved, pending_approval, cancelled_rejected"),
    category: str = Query("all", description="BHT category slug"),
    months: Optional[str] = Query(None, description="Comma-separated YYYY-MM values"),
    regions: Optional[str] = Query(None, description="Comma-separated region names"),
    sectors: Optional[str] = Query(None, description="Comma-separated sector names"),
    categories: Optional[str] = Query(None, description="Comma-separated BHT category slugs"),
    user: AuthUser = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    mlist = [x.strip() for x in months.split(",") if x.strip()] if months else []
    rlist = [x.strip() for x in regions.split(",") if x.strip()] if regions else []
    slist = [x.strip() for x in sectors.split(",") if x.strip()] if sectors else []
    clist = [x.strip() for x in categories.split(",") if x.strip()] if categories else []

    df = build_bht_overview_kpi_export_dataframe(settings, kpi, category, mlist, rlist, slist, clist)
    df = add_inicio_qc_approver_column(settings, user, df)

    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        path = Path(tmp.name)
    _write_dataframe_to_xlsx(path, df, sheet_name="Overview KPI")
    data = path.read_bytes()
    path.unlink(missing_ok=True)

    safe_kpi = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in kpi.lower()).strip("-") or "overview"
    headers = {"Content-Disposition": f'attachment; filename="bht-overview-{safe_kpi}.xlsx"'}
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


def install_inicio_qc_export_scope(router) -> None:
    """Replace the existing Overview KPI export handler without adding a duplicate route."""
    for route in router.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.path != "/api/main-survey/bht-overview/export" or "GET" not in (route.methods or set()):
            continue
        route.endpoint = bht_overview_kpi_export_scoped
        route.dependant.call = bht_overview_kpi_export_scoped
        return
    raise RuntimeError("Unable to locate Main Survey BHT Overview export route.")
