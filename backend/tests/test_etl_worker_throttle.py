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


def test_category_sync_retries_throttled_form_and_publishes_to_explorer(monkeypatch, tmp_path) -> None:
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
    rebuilds = []

    monkeypatch.setattr(worker, "load_survey_workspaces", lambda root: [workspace])
    monkeypatch.setattr(worker, "_category_cooldown_seconds", lambda settings: 270)
    monkeypatch.setattr(worker.time, "sleep", lambda seconds: sleeps.append(seconds))

    def fake_rebuild(root):
        rebuilds.append(root)
        return {
            "status": "success",
            "workspaces": [{"workspace": "edible-oil", "cases": 1012, "media": 0}],
        }

    monkeypatch.setattr(worker, "rebuild_category_operational_data", fake_rebuild)

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
    assert rebuilds == [tmp_path]
    assert result["status"] == "success"
    assert result["workspaces"][0]["rows"] == 1012
    assert result["workspaces"][0]["throttleRetries"] == 1
    assert result["workspaces"][0]["publishedCases"] == 1012


def test_each_successful_category_is_published_before_next_pull(monkeypatch, tmp_path) -> None:
    workspaces = [
        SimpleNamespace(slug="spread", form_id="spread-form"),
        SimpleNamespace(slug="edible-oil", form_id="oil-form"),
        SimpleNamespace(slug="breakfast-cereal", form_id="cereal-form"),
    ]
    settings = SimpleNamespace(
        root_dir=tmp_path,
        database_url="postgresql://example",
        surveycto_server="edvoimpacts",
        surveycto_username="render-user",
        surveycto_password="render-password",
    )
    events = []

    monkeypatch.setattr(worker, "load_survey_workspaces", lambda root: workspaces)
    monkeypatch.setattr(worker, "_category_cooldown_seconds", lambda settings: 0)

    def fake_sync(workspace, **kwargs):
        events.append(f"sync:{workspace.slug}")
        return {"workspace": workspace.slug, "formId": workspace.form_id, "rows": 10, "status": "success"}

    def fake_rebuild(root):
        synced = [event.split(":", 1)[1] for event in events if event.startswith("sync:")]
        events.append(f"publish:{synced[-1]}")
        return {
            "status": "success",
            "workspaces": [{"workspace": slug, "cases": 10, "media": 0} for slug in synced],
        }

    monkeypatch.setattr(worker, "sync_workspace", fake_sync)
    monkeypatch.setattr(worker, "rebuild_category_operational_data", fake_rebuild)

    result = worker.sync_category_forms_with_retry(settings)

    assert events == [
        "sync:spread",
        "publish:spread",
        "sync:edible-oil",
        "publish:edible-oil",
        "sync:breakfast-cereal",
        "publish:breakfast-cereal",
    ]
    assert [item["publishedCases"] for item in result["workspaces"]] == [10, 10, 10]
