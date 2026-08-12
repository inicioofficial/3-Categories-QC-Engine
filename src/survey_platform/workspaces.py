from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from survey_platform.config import load_dotenv_file, read_env


@dataclass(frozen=True, slots=True)
class SurveyWorkspace:
    slug: str
    label: str
    schema: str
    form_id: str
    dictionary_file: Path


WORKSPACE_DEFINITIONS = (
    ("spread", "Spread Category", "spread", "BHT_3_Category_Survey_Spread_Wave_1", "BHT_3_Categories_Margarine_Wave_1_Updated_Script.xlsx"),
    ("edible-oil", "Edible Oil Category", "edible_oil", "BHT_3_Category_Survey_Edible_oil_Wave_1", "BHT_3_Categories_Edible_Oil_Wave_1_Updated_Script.xlsx"),
    ("breakfast-cereal", "Breakfast Cereal Category", "breakfast_cereal", "BHT_3_Category_Survey_Breakfast_wave_1", "BHT_3_Categories_Breakfast_Cereal_Wave_1_Updated_Script.xlsx"),
)


def load_survey_workspaces(base_dir: Path | None = None) -> list[SurveyWorkspace]:
    root = (base_dir or Path.cwd()).resolve()
    dotenv = load_dotenv_file(root / ".env")
    result: list[SurveyWorkspace] = []
    for slug, label, schema, default_form_id, filename in WORKSPACE_DEFINITIONS:
        env_prefix = schema.upper()
        form_id = read_env(f"SURVEYCTO_{env_prefix}_FORM_ID", dotenv, default_form_id) or default_form_id
        dictionary = read_env(
            f"SURVEYCTO_{env_prefix}_XLSFORM",
            dotenv,
            f"data/category_xlsforms/{filename}",
        ) or f"data/category_xlsforms/{filename}"
        result.append(SurveyWorkspace(slug, label, schema, form_id, root / dictionary))
    return result
