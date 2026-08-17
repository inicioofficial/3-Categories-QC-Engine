from pathlib import Path

from survey_platform.category_audio_media import category_audio_definitions


ROOT = Path(__file__).resolve().parents[2]


def _by_name(items):
    return {item["variable_name"]: item for item in items}


def test_spread_audio_definitions_follow_margarine_xlsform():
    definitions = category_audio_definitions(str(ROOT))
    spread = _by_name(definitions["spread"])

    assert "audiorecord1" in spread
    assert "audio_audit_b1" in spread
    assert "audio_audit_CO_BAO1a" in spread
    assert "audio_audit_SP_M1a" in spread
    assert "audio_audit_SP_BAU5a" in spread
    assert "audio_audit_SP_BAU7" in spread
    assert "audio_audit_SP_R1a" in spread
    assert "audio_audit_SP_BAR5a" in spread
    assert "audio_audit_SP_BAR7" in spread
    assert "audio_audit_N_QC1" in spread

    # The uploaded Margarine script contains a stale EO_BAU7 audit row but no EO_BAU7
    # source question.  It must not leak into the Spread dashboard.
    assert "audio_audit_EO_BAU7" not in spread
    assert spread["audio_audit_CO_BAO1a"]["source_variable"] == "SP_BAU1a"
    assert "Margarine" in spread["audio_audit_CO_BAO1a"]["label"]


def test_breakfast_audio_definitions_follow_breakfast_xlsform():
    definitions = category_audio_definitions(str(ROOT))
    breakfast = _by_name(definitions["breakfast-cereal"])

    expected = {
        "audio_audit_b1",
        "audio_audit_bau1y",
        "audio_audit_SN_BAU5a",
        "audio_audit_SN_BAU7",
        "audio_audit_SN_RE1a",
        "audio_audit_SN_RE5a",
        "audio_audit_SN_2BAU7",
        "audio_audit_N_QC1",
    }
    assert expected.issubset(breakfast)
    assert breakfast["audio_audit_bau1y"]["source_variable"] == "SN_BAU1a"
    assert breakfast["audio_audit_bau1y"]["label"] != "Silent recording"


def test_edible_oil_audio_definitions_follow_edible_oil_xlsform():
    definitions = category_audio_definitions(str(ROOT))
    edible_oil = _by_name(definitions["edible-oil"])

    expected = {
        "audio_audit_b1",
        "audio_audit_EO_BAU5a",
        "audio_audit_EO_BAU7",
        "audio_audit_EO_BAR5a",
        "audio_audit_EO_BAR7",
        "audio_audit_N_QC1",
    }
    assert expected.issubset(edible_oil)
    assert all(item["label"] != "Silent recording" for item in edible_oil.values())
