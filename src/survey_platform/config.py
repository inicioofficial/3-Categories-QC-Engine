from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def load_dotenv_file(path: Path) -> dict[str, str]:
    if not path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            values[key] = value

    return values


def read_env(name: str, dotenv: dict[str, str], default: str | None = None) -> str | None:
    return os.environ.get(name, dotenv.get(name, default))


@dataclass(slots=True)
class ListingPipelineConfig:
    base_dir: Path
    database_url: str | None
    sync_source: str
    sync_request_token: str | None
    server: str
    form_id: str
    username: str | None
    password: str | None
    xlsform_file: Path
    raw_master_parquet: Path
    last_sync_file: Path
    listing_parquet: Path
    sampling_parquet: Path
    selected_parquet: Path
    listing_sav: Path
    sampling_sav: Path
    selected_sav: Path
    listing_var_map: Path
    sampling_var_map: Path
    selected_var_map: Path

    def ensure_directories(self) -> None:
        for path in [
            self.raw_master_parquet,
            self.last_sync_file,
            self.listing_parquet,
            self.sampling_parquet,
            self.selected_parquet,
            self.listing_sav,
            self.sampling_sav,
            self.selected_sav,
            self.listing_var_map,
            self.sampling_var_map,
            self.selected_var_map,
        ]:
            path.parent.mkdir(parents=True, exist_ok=True)


def load_listing_pipeline_config(
    base_dir: Path | None = None,
    sync_source: str = "system",
    sync_request_token: str | None = None,
) -> ListingPipelineConfig:
    root = base_dir.resolve() if base_dir else Path.cwd().resolve()
    dotenv = load_dotenv_file(root / ".env")

    data_dir = root / "data"
    raw_dir = data_dir / "raw"
    state_dir = data_dir / "state"
    output_dir = root / "output" / "listing"

    config = ListingPipelineConfig(
        base_dir=root,
        database_url=read_env("DATABASE_URL", dotenv),
        sync_source=sync_source,
        sync_request_token=sync_request_token,
        server=read_env("SURVEYCTO_SERVER", dotenv, "edvoimpacts") or "edvoimpacts",
        form_id=read_env("SURVEYCTO_LISTING_FORM_ID", dotenv, "hh_listing_sampling") or "hh_listing_sampling",
        username=read_env("SURVEYCTO_USERNAME", dotenv),
        password=read_env("SURVEYCTO_PASSWORD", dotenv),
        xlsform_file=root / (read_env("SURVEYCTO_LISTING_XLSFORM", dotenv, "HH_Listing_Systematic_Sampling_Final Verson 3.xlsx") or "HH_Listing_Systematic_Sampling_Final Verson 3.xlsx"),
        raw_master_parquet=raw_dir / "HH_listing_raw.parquet",
        last_sync_file=state_dir / "listing_last_sync.json",
        listing_parquet=output_dir / "HH_listing_long.parquet",
        sampling_parquet=output_dir / "HH_sampling_ea.parquet",
        selected_parquet=output_dir / "HH_selected_long.parquet",
        listing_sav=output_dir / "HH_listing_long.sav",
        sampling_sav=output_dir / "HH_sampling_ea.sav",
        selected_sav=output_dir / "HH_selected_long.sav",
        listing_var_map=output_dir / "HH_listing_long_variable_map.csv",
        sampling_var_map=output_dir / "HH_sampling_ea_variable_map.csv",
        selected_var_map=output_dir / "HH_selected_long_variable_map.csv",
    )
    config.ensure_directories()
    return config


@dataclass(slots=True)
class MainSurveyPipelineConfig:
    base_dir: Path
    database_url: str | None
    sync_source: str
    sync_request_token: str | None
    force_full: bool
    server: str
    form_id: str
    username: str | None
    password: str | None
    dictionary_file: Path
    raw_master_parquet: Path
    last_sync_file: Path

    def ensure_directories(self) -> None:
        for path in [
            self.dictionary_file,
            self.raw_master_parquet,
            self.last_sync_file,
        ]:
            if path.suffix:
                path.parent.mkdir(parents=True, exist_ok=True)
            else:
                path.mkdir(parents=True, exist_ok=True)


def load_main_survey_pipeline_config(
    base_dir: Path | None = None,
    sync_source: str = "system",
    sync_request_token: str | None = None,
    force_full: bool = False,
) -> MainSurveyPipelineConfig:
    root = base_dir.resolve() if base_dir else Path.cwd().resolve()
    dotenv = load_dotenv_file(root / ".env")

    data_dir = root / "data"
    raw_dir = data_dir / "raw"
    state_dir = data_dir / "state"

    config = MainSurveyPipelineConfig(
        base_dir=root,
        database_url=read_env("DATABASE_URL", dotenv),
        sync_source=sync_source,
        sync_request_token=sync_request_token,
        force_full=force_full,
        server=read_env("SURVEYCTO_SERVER", dotenv, "edvoimpacts") or "edvoimpacts",
        form_id=read_env("SURVEYCTO_MAIN_FORM_ID", dotenv, "") or "",
        username=read_env("SURVEYCTO_USERNAME", dotenv),
        password=read_env("SURVEYCTO_PASSWORD", dotenv),
        dictionary_file=root / (read_env("SURVEYCTO_MAIN_DICTIONARY", dotenv, "MAIN_data_dictionary.xlsx") or "MAIN_data_dictionary.xlsx"),
        raw_master_parquet=raw_dir / "MAIN_survey_raw.parquet",
        last_sync_file=state_dir / "main_survey_last_sync.json",
    )
    config.ensure_directories()
    return config
