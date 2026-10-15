"""The Slack mock's own contract (spec section 3.3), so a mock bug never passes for an O2 bug."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import re
import threading
from collections.abc import Generator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

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


def test_the_socket_url_app_id_is_a_hash_like_live_slack(api: str) -> None:
    url = slack(api, "apps.connections.open", bearer="xapp-1-A000001-1-mock")["url"]
    query = parse_qs(urlparse(url).query)
    assert set(query) == {"ticket", "app_id"}
    assert re.fullmatch(r"[0-9a-f]{64}", query["app_id"][0]), url


def test_apps_uninstall_sends_tokens_revoked_then_app_uninstalled_before_it_answers(api: str) -> None:
    received: list[tuple[dict[str, str], bytes]] = []

    class Receiver(BaseHTTPRequestHandler):
        def do_POST(self) -> None:  # noqa: N802
            received.append((dict(self.headers), self.rfile.read(int(self.headers["Content-Length"]))))
            self.send_response(200)
            self.end_headers()

        def log_message(self, *_args: Any) -> None:
            pass

    receiver = ThreadingHTTPServer(("127.0.0.1", 0), Receiver)
    threading.Thread(target=receiver.serve_forever, daemon=True).start()
    try:
        requests.post(f"{api}/_mock/reset", json={}, timeout=5).raise_for_status()
        url = f"http://127.0.0.1:{receiver.server_address[1]}/api/slack/events"
        manifest = json.dumps({"settings": {"event_subscriptions": {"request_url": url}}})
        rotated = slack(api, "tooling.tokens.rotate", refresh_token="xoxe-1-uninstall")
        app = slack(api, "apps.manifest.create", bearer=rotated["token"], manifest=manifest)
        creds = app["credentials"]
        bot = slack(api, "oauth.v2.access", client_id=creds["client_id"], client_secret=creds["client_secret"],
                    code=mock_code(team_id="T0ACME"), redirect_uri="r")
        requests.post(f"{api}/_mock/uninstall_events", json={"settle": 0}, timeout=5).raise_for_status()
        slack(api, "apps.uninstall", bearer=bot["access_token"], client_id=creds["client_id"],
              client_secret=creds["client_secret"])
        assert [json.loads(body)["event"]["type"] for _, body in received] == ["tokens_revoked", "app_uninstalled"]
        headers, body = received[0]
        event = json.loads(body)
        assert (event["api_app_id"], event["team_id"]) == (app["app_id"], "T0ACME")
        assert event["event"]["tokens"] == {"oauth": [], "bot": ["U0BOT"]}
        base = b"v0:" + headers["X-Slack-Request-Timestamp"].encode() + b":" + body
        mac = hmac.new(creds["signing_secret"].encode(), base, hashlib.sha256).hexdigest()
        assert headers["X-Slack-Signature"] == "v0=" + mac
        assert slack(api, "auth.test", bearer=bot["access_token"])["error"] == "token_revoked"
    finally:
        requests.post(f"{api}/_mock/reset", json={}, timeout=5).raise_for_status()
        receiver.shutdown()


def bot_token(api: str) -> str:
    return slack(api, "oauth.v2.access", client_id="9.9", client_secret="s", code=mock_code(team_id="T0BLOCKS"),
                 redirect_uri="r")["access_token"]


def buttons(*action_ids: str, block_id: str = "o2_actions") -> dict[str, Any]:
    elements = [{"type": "button", "text": {"type": "plain_text", "text": a}, "action_id": a} for a in action_ids]
    return {"type": "actions", "block_id": block_id, "elements": elements}


def section(n: int) -> dict[str, Any]:
    return {"type": "section", "block_id": f"s{n}", "text": {"type": "mrkdwn", "text": f"line {n}"}}


MESSAGE_FORMS = {
    "chat.postMessage": {"channel": "C0OPS", "text": "t"},
    "chat.update": {"channel": "C0OPS", "ts": "1.1", "text": "t"},
    "chat.postEphemeral": {"channel": "C0OPS", "user": "U0ANN", "text": "t"},
    "chat.stopStream": {"channel": "C0OPS", "ts": "1.1"},
}


@pytest.mark.parametrize("method", list(MESSAGE_FORMS))
def test_messages_with_blocks_slack_refuses_answer_invalid_blocks(api: str, method: str) -> None:
    bot = bot_token(api)
    form = MESSAGE_FORMS[method]
    cases = [
        ([section(0), buttons("o2_ask", "o2_ask")],
         '[ERROR] `action_id` "o2_ask" already exists [json-pointer:blocks/1/elements/1/action_id]'),
        ([buttons("o2_a", block_id="o2_answer"), buttons("o2_b", block_id="o2_answer")],
         '[ERROR] `block_id` "o2_answer" already exists [json-pointer:blocks/1/block_id]'),
        ([section(n) for n in range(51)], "[ERROR] no more than 50 items allowed [json-pointer:blocks]"),
    ]
    for blocks, message in cases:
        body = slack(api, method, bearer=bot, blocks=json.dumps(blocks), **form)
        assert body["ok"] is False, (method, body)
        assert body["error"] == "invalid_blocks", body
        assert body["response_metadata"]["messages"] == [message], body
    valid = [section(n) for n in range(49)] + [buttons("o2_a", "o2_b")]
    assert slack(api, method, bearer=bot, blocks=json.dumps(valid), **form)["ok"] is True
    apart = [buttons("o2_ask", block_id="a"), buttons("o2_ask", block_id="b")]
    assert slack(api, method, bearer=bot, blocks=json.dumps(apart), **form)["ok"] is True, "unique per block only"


def test_a_home_view_slack_refuses_answers_invalid_arguments_as_live(api: str) -> None:
    bot = bot_token(api)
    home = [section(n) for n in range(5)] + [buttons("o2_home_ask", "o2_home_ask")]
    cases = [
        (home, '[ERROR] `action_id` "o2_home_ask" already exists [json-pointer:view/blocks/5/elements/1/action_id]'),
        ([buttons("o2_home_ask", block_id="a"), buttons("o2_home_ask", block_id="b")],
         '[ERROR] `action_id` "o2_home_ask" already exists [json-pointer:view/blocks/1/elements/0/action_id]'),
        ([section(0), section(0)], '[ERROR] `block_id` "s0" already exists [json-pointer:view/blocks/1/block_id]'),
        ([section(n) for n in range(101)], "[ERROR] no more than 100 items allowed [json-pointer:view/blocks]"),
    ]
    for blocks, message in cases:
        body = slack(api, "views.publish", bearer=bot, user_id="U0ANN",
                     view=json.dumps({"type": "home", "blocks": blocks}))
        assert body["ok"] is False, body
        assert body["error"] == "invalid_arguments", body
        assert body["response_metadata"]["messages"] == [message], body
    refused = requests.get(f"{api}/_mock/requests", params={"method": "views.publish"}, timeout=5).json()["requests"]
    assert refused[-1]["error"] == "invalid_arguments", "a refusal is visible to the tests"
    valid = [section(n) for n in range(99)] + [buttons("o2_home_ask_0", "o2_home_ask_1")]
    body = slack(api, "views.publish", bearer=bot, user_id="U0ANN", view=json.dumps({"type": "home", "blocks": valid}))
    assert body["ok"] is True, body


def test_files_delete_takes_a_file_the_bot_uploaded_once(api: str) -> None:
    bot = bot_token(api)
    file_id = slack(api, "files.getUploadURLExternal", bearer=bot, filename="chart.png", length="4")["file_id"]
    shared = slack(api, "files.completeUploadExternal", bearer=bot, channel_id="C0OPS", thread_ts="1.1",
                   files=json.dumps([{"id": file_id, "title": "errors"}]))
    assert shared["files"] == [{"id": file_id, "title": "errors"}]
    assert slack(api, "files.delete", bearer=bot, file=file_id) == {"ok": True}
    assert slack(api, "files.delete", bearer=bot, file=file_id)["error"] == "file_not_found"
    assert slack(api, "files.delete", file=file_id)["error"] == "not_authed"
