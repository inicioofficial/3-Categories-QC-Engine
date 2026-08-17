from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app import main as app_main


def _settings():
    return SimpleNamespace(
        surveycto_server="edvoimpacts",
        surveycto_username="render-user",
        surveycto_password="render-password",
        surveycto_main_form_id="Season_survey",
        surveycto_listing_form_id="hh_listing_sampling",
    )


def test_bare_media_filename_tries_category_forms_with_server_credentials(monkeypatch) -> None:
    calls: list[tuple[str, tuple[str, str]]] = []

    def fake_get(url, auth, timeout):
        calls.append((url, auth))
        if "BHT_3_Category_Survey_Edible_oil_Wave_1" in url:
            return SimpleNamespace(
                status_code=200,
                content=b"media-bytes",
                headers={"content-type": "image/jpeg"},
            )
        return SimpleNamespace(status_code=404, content=b"", headers={})

    monkeypatch.setattr(app_main.req_lib, "get", fake_get)

    content, content_type = app_main._fetch_server_managed_surveycto_media(
        _settings(),
        "photo.jpg",
        None,
    )

    assert content == b"media-bytes"
    assert content_type == "image/jpeg"
    assert calls
    assert all(auth == ("render-user", "render-password") for _, auth in calls)
    assert any("BHT_3_Category_Survey_Spread_Wave_1" in url for url, _ in calls)
    assert any("BHT_3_Category_Survey_Edible_oil_Wave_1" in url for url, _ in calls)


def test_media_proxy_rejects_external_hosts_before_sending_credentials(monkeypatch) -> None:
    def fail_get(*args, **kwargs):
        raise AssertionError("External URL must not be requested")

    monkeypatch.setattr(app_main.req_lib, "get", fail_get)

    with pytest.raises(HTTPException) as exc_info:
        app_main._fetch_server_managed_surveycto_media(
            _settings(),
            "https://example.com/private.jpg",
            None,
        )

    assert exc_info.value.status_code == 400
    assert "configured SurveyCTO server" in str(exc_info.value.detail)
