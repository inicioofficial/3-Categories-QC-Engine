from types import SimpleNamespace

import run_etl_worker as worker


def test_surveycto_throttle_wait_seconds_parses_requested_delay() -> None:
    exc = RuntimeError(
        "SurveyCTO rejected form example with HTTP 417: "
        "Please wait for 10 seconds before retrying to pull all submissions for this form."
    )
    assert worker._surveycto_throttle_wait_seconds(exc) == 10


def test_surveycto_throttle_wait_seconds_uses_fallback_for_unstructured_417() -> None:
    assert worker._surveycto_throttle_wait_seconds(RuntimeError("HTTP 417: throttled")) == 15
    assert worker._surveycto_throttle_wait_seconds(RuntimeError("HTTP 500: failed")) is None


def test_category_sync_retries_throttled_form_and_continues(monkeypatch, tmp_path) -> None:
    workspace = SimpleNamespace(
        slug="edible-oil",
        form_id="BHT_3_Category_Survey_Edible_oil_Wave_1",
    )
    settings = SimpleNamespace(
        root_dir=tmp_path,
        database_url="postgresql://example",
        surveycto_server="edvoimpacts",
        surveycto_username="render-user",
        surveycto_password="render-password",
    )
    calls = []
    sleeps = []

    monkeypatch.setattr(worker, "load_survey_workspaces", lambda root: [workspace])
    monkeypatch.setattr(worker, "_category_cooldown_seconds", lambda settings: 270)
    monkeypatch.setattr(worker.time, "sleep", lambda seconds: sleeps.append(seconds))
    monkeypatch.setattr(
        worker,
        "rebuild_category_operational_data",
        lambda root: {"status": "success", "workspaces": []},
    )

    def fake_sync_workspace(*args, **kwargs):
        calls.append((args, kwargs))
        if len(calls) == 1:
            raise RuntimeError(
                "SurveyCTO rejected form BHT_3_Category_Survey_Edible_oil_Wave_1 "
                "with HTTP 417: Please wait for 10 seconds before retrying to pull all submissions for this form."
            )
        return {
            "workspace": "edible-oil",
            "formId": workspace.form_id,
            "rows": 1012,
            "status": "success",
        }

    monkeypatch.setattr(worker, "sync_workspace", fake_sync_workspace)

    result = worker.sync_category_forms_with_retry(settings)

    assert len(calls) == 2
    assert sleeps == [15]
    assert result["status"] == "success"
    assert result["workspaces"][0]["rows"] == 1012
    assert result["workspaces"][0]["throttleRetries"] == 1
