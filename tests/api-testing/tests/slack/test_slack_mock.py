"""The Slack mock's own contract (spec section 3.3), so a mock bug never passes for an O2 bug."""
from __future__ import annotations

import base64
import json
import threading
from collections.abc import Generator

import pytest
import requests

from helpers.slack_mock import make_server, mock_code


@pytest.fixture(scope="module")
def api() -> Generator[str, None, None]:
    server = make_server("127.0.0.1", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()


def slack(api: str, method: str, bearer: str | None = None, **form: str) -> dict:
    headers = {"Authorization": f"Bearer {bearer}"} if bearer else {}
    resp = requests.post(f"{api}/api/{method}", data=form, headers=headers, timeout=5)
    assert resp.status_code == 200, resp.text
    return resp.json()


def claims_of(id_token: str) -> dict:
    payload = id_token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))


def test_the_code_carries_nonce_and_team_into_the_id_token(api: str) -> None:
    code = mock_code(nonce="n-1", state="s-1", team_id="T0ACME", user_id="U0DANA")
    body = slack(api, "openid.connect.token", client_id="1.2", client_secret="x", code=code,
                 grant_type="authorization_code", redirect_uri="https://o2.test/web/slack/connect/callback")
    assert body["ok"] is True
    claims = claims_of(body["id_token"])
    assert claims["iss"] == "https://slack.com"
    assert claims["aud"] == "1.2"
    assert claims["nonce"] == "n-1"
    assert claims["https://slack.com/user_id"] == "U0DANA"
    assert claims["https://slack.com/team_id"] == "T0ACME"


def test_oauth_returns_a_bot_token_that_auth_test_knows(api: str) -> None:
    code = mock_code(team_id="T0ACME", team_name="Acme", channel_id="C0ALERTS", channel="#alerts")
    body = slack(api, "oauth.v2.access", client_id="9.9", client_secret="s", code=code, redirect_uri="r")
    assert body["team"] == {"id": "T0ACME", "name": "Acme"}
    assert body["incoming_webhook"]["channel_id"] == "C0ALERTS"
    assert body["incoming_webhook"]["url"].startswith(api + "/services/T0ACME/")
    who = slack(api, "auth.test", bearer=body["access_token"])
    assert who["team_id"] == "T0ACME"
    slack(api, "auth.revoke", bearer=body["access_token"])
    assert slack(api, "auth.test", bearer=body["access_token"])["error"] == "token_revoked"


def test_refresh_tokens_are_single_use_and_expired_ones_refused(api: str) -> None:
    rotated = slack(api, "tooling.tokens.rotate", refresh_token="xoxe-1-a")
    assert rotated["ok"] is True
    assert slack(api, "tooling.tokens.rotate", refresh_token="xoxe-1-a")["error"] == "invalid_refresh_token"
    assert slack(api, "tooling.tokens.rotate", refresh_token="xoxe-1-expired")["error"] == "invalid_refresh_token"
    assert slack(api, "apps.manifest.create", bearer="xoxe.unknown", manifest="{}")["error"] == "invalid_auth"
    app = slack(api, "apps.manifest.create", bearer=rotated["token"], manifest='{"display_information":{"name":"O2"}}')
    creds = app["credentials"]
    wrong = slack(api, "openid.connect.token", client_id=creds["client_id"], client_secret="wrong", code=mock_code())
    assert wrong["error"] == "invalid_client"
    assert slack(api, "apps.manifest.delete", bearer=rotated["token"], app_id=app["app_id"])["ok"] is True


def test_failures_and_recordings(api: str) -> None:
    requests.post(f"{api}/_mock/reset", json={}, timeout=5).raise_for_status()
    requests.post(f"{api}/_mock/fail", json={"method": "auth.test", "error": "ratelimited", "http_status": 429,
                                              "retry_after": 1}, timeout=5).raise_for_status()
    limited = requests.post(f"{api}/api/auth.test", data={}, timeout=5)
    assert limited.status_code == 429
    assert limited.headers["Retry-After"] == "1"
    assert slack(api, "chat.unknownThing")["error"] == "unknown_method"
    calls = requests.get(f"{api}/_mock/requests", params={"method": "auth.test"}, timeout=5).json()["requests"]
    assert [c["method"] for c in calls] == ["auth.test"]


def test_a_harness_skip_fails_when_the_suite_is_required(monkeypatch: pytest.MonkeyPatch) -> None:
    from .slack_helpers import harness_skip

    monkeypatch.delenv("SLACK_SUITE_REQUIRED", raising=False)
    with pytest.raises(pytest.skip.Exception):
        harness_skip("mock unreachable")
    monkeypatch.setenv("SLACK_SUITE_REQUIRED", "1")
    with pytest.raises(pytest.fail.Exception, match="SLACK_SUITE_REQUIRED=1 but mock unreachable"):
        harness_skip("mock unreachable")
