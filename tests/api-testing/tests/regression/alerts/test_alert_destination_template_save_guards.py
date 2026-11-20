"""o2-enterprise#3431 B22-B24 (openobserve#16700): saves refuse an unknown template, names over 256 characters and a blank Content title."""
from __future__ import annotations

from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from tests.alerts.multialert_helpers import uniq

NAME_MAX = 256


@pytest.fixture
def cleanup(client: OpenObserveClient) -> Generator[dict[str, list[str]], None, None]:
    made: dict[str, list[str]] = {"destinations": [], "templates": []}
    yield made
    for name in made["destinations"]:
        client.alerts.delete_destination(name)
    for name in made["templates"]:
        client.alerts.delete_template(name)


def _post(client: OpenObserveClient, path: str, payload: dict, cleanup: dict[str, list[str]], kind: str):
    resp = client.post(path, json=payload, raise_for_status=False)
    if resp.status_code == 200:
        cleanup[kind].append(payload["name"])
    return resp


def _dest(name: str, template: str | None) -> dict:
    return {"name": name, "url": "http://localhost:1/sink", "method": "post", "template": template, "type": "http",
            "headers": {}}


def test_a_destination_naming_a_template_the_org_lacks_is_refused(client: OpenObserveClient, cleanup):
    """Pre-fix the save stored a null template, so the destination silently sent the default body."""
    missing = uniq("e2e_b22_no_tpl")
    resp = _post(client, "alerts/destinations", _dest(uniq("e2e_b22_dest"), missing), cleanup, "destinations")
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    assert f"template '{missing}' does not exist" in resp.text, resp.text


@pytest.mark.parametrize("kind", ["destinations", "templates"])
def test_a_name_over_256_characters_is_a_400_and_256_still_saves(client: OpenObserveClient, cleanup, kind: str):
    """Pre-fix SQLite stored an over-long name that Postgres refuses with a raw database error."""
    def payload(name: str) -> dict:
        if kind == "destinations":
            return _dest(name, None)
        return {"name": name, "body": '{"text":"{alert_name}"}', "type": "http", "title": ""}

    stem = uniq("e2e_b23")
    noun = "Destination" if kind == "destinations" else "Template"
    long = _post(client, f"alerts/{kind}", payload(stem + "x" * (NAME_MAX + 1 - len(stem))), cleanup, kind)
    assert long.status_code == 400, f"{long.status_code} {long.text[:300]}"
    assert f"{noun} name cannot be longer than {NAME_MAX} characters" in long.text, long.text[:300]
    fits = _post(client, f"alerts/{kind}", payload(stem + "x" * (NAME_MAX - len(stem))), cleanup, kind)
    assert fits.status_code == 200, f"{fits.status_code} {fits.text[:300]}"


@pytest.mark.parametrize("title", ["", "   "])
def test_a_content_template_with_a_blank_title_is_refused(client: OpenObserveClient, cleanup, title: str):
    payload = {"name": uniq("e2e_b24_tpl"), "type": "http", "kind": "content",
               "body": f'{{"title": "{title}", "body": "hi"}}'}
    resp = _post(client, "alerts/templates", payload, cleanup, "templates")
    assert resp.status_code == 400, f"{resp.status_code} {resp.text}"
    assert "Template title cannot be empty" in resp.text, resp.text
