from __future__ import annotations

from contextvars import ContextVar


ACTIVE_WORKSPACE: ContextVar[str | None] = ContextVar("active_workspace", default=None)

WORKSPACE_FORM_IDS = {
    "spread": "BHT_3_Category_Survey_Spread_Wave_1",
    "edible-oil": "BHT_3_Category_Survey_Edible_oil_Wave_1",
    "breakfast-cereal": "BHT_3_Category_Survey_Breakfast_wave_1",
}


def active_workspace_form_id() -> str | None:
    return WORKSPACE_FORM_IDS.get(str(ACTIVE_WORKSPACE.get() or "").strip().lower())
