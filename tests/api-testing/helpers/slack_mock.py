"""Slack Web API mock for the Slack app tests (spec section 3.3).

OpenObserve reaches it through ``O2_SLACK_API_BASE_URL=http://127.0.0.1:<port>/api``; only
server-side calls come here. Browser navigations to ``slack.com/oauth/v2/authorize`` and
``slack.com/openid/connect/authorize`` are intercepted by the tests, which fold what Slack would
know into the mock ``code``:

    code = "mock." + base64url(json({"nonce": ..., "state": ..., "team_id": ..., ...}))

``oauth.v2.access`` and ``openid.connect.token`` decode it, so a test decides the workspace, the
channel of the incoming webhook, the Slack user and the ``nonce`` the id_token carries. A code that
is not ``mock.``-prefixed gets the defaults (team ``T0MOCK``, user ``U0MOCK``).

Run it standalone::

    python3 tests/api-testing/helpers/slack_mock.py --port 5099

Control endpoints (JSON):

- ``GET  /_mock/health``                 liveness
- ``GET  /_mock/requests[?method=m]``    every recorded call: method, form, bearer, at, response (ok calls)
- ``POST /_mock/reset``                  forget calls, apps, tokens and failures; reseed the team
- ``POST /_mock/fail``                   ``{"method", "error", "times"?, "http_status"?, "retry_after"?}``
- ``POST /_mock/apps``                   register an app: ``{"app_id", "client_id", "client_secret", "signing_secret"?}``
- ``POST /_mock/teams``                  add or replace a team: ``{"team_id", "team_name", "channels"?, "members"?}``
- ``GET  /_mock/code?claims=<json>``     the ``mock.`` code for those claims
- ``GET  /_mock/state``                  apps, issued bot tokens (redacted), refresh tokens used

Incoming webhooks are served at ``POST /services/<team>/<id>`` and recorded as method
``incoming_webhook``. Uploads from ``files.getUploadURLExternal`` go to ``POST /upload/<file_id>``.
"""
from __future__ import annotations

import argparse
import base64
import itertools
import json
import logging
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.parse import parse_qs, urlparse

log = logging.getLogger("slack-mock")

DEFAULT_TEAM = "T0MOCK"
DEFAULT_TEAM_NAME = "Mock Workspace"
DEFAULT_USER = "U0MOCK"
SLACK_ISSUER = "https://slack.com"


class SlackError(Exception):
    """An ``ok: false`` answer with Slack's error code."""

    def __init__(self, error: str, http_status: int = 200, retry_after: int | None = None):
        super().__init__(error)
        self.error = error
        self.http_status = http_status
        self.retry_after = retry_after


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def unb64url(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def mock_code(**claims: Any) -> str:
    """The OAuth or Sign in with Slack code that carries ``claims`` to the mock."""
    return "mock." + b64url(json.dumps(claims, separators=(",", ":")).encode())


def decode_code(code: str) -> dict[str, Any]:
    if not code.startswith("mock."):
        return {}
    try:
        value = json.loads(unb64url(code[len("mock."):]))
    except (ValueError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def id_token(claims: dict[str, Any]) -> str:
    """An unsigned JWT; O2 reads the claims of a token it fetched from Slack over TLS."""
    header = b64url(b'{"alg":"none","typ":"JWT"}')
    return f"{header}.{b64url(json.dumps(claims).encode())}.mock-signature"


def default_team(team_id: str = DEFAULT_TEAM, team_name: str = DEFAULT_TEAM_NAME) -> dict[str, Any]:
    """A workspace with recorded-shape channels and members (ids and names anonymized)."""
    return {
        "team_id": team_id,
        "team_name": team_name,
        "channels": [
            {"id": "C0ALERTS", "name": "alerts", "is_private": False, "is_member": True, "is_shared": False},
            {"id": "C0GENERAL", "name": "general", "is_private": False, "is_member": False, "is_shared": False},
            {"id": "C0OPS", "name": "ops-private", "is_private": True, "is_member": True, "is_shared": False},
            {"id": "C0SHARED", "name": "vendor-shared", "is_private": False, "is_member": True, "is_shared": True},
        ],
        "members": [
            member("U0DANA", team_id, "dana", "dana@acme.test"),
            member("U0LEE", team_id, "lee", "lee@acme.test"),
            member("U0GUEST", team_id, "guest", "guest@vendor.test", is_restricted=True),
            {**member("U0BOT", team_id, "o2bot", None), "is_bot": True},
        ],
    }


def member(user_id: str, team_id: str, name: str, email: str | None, **flags: Any) -> dict[str, Any]:
    profile: dict[str, Any] = {"real_name": name.title(), "display_name": name}
    if email:
        profile["email"] = email
    return {
        "id": user_id,
        "team_id": team_id,
        "name": name,
        "deleted": False,
        "is_bot": False,
        "is_app_user": False,
        "is_restricted": False,
        "is_ultra_restricted": False,
        "is_email_confirmed": bool(email),
        "profile": profile,
        **flags,
    }


class MockState:
    """Everything the mock remembers; one lock guards it all."""

    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        self.lock = threading.Lock()
        self.ids = itertools.count(1)
        self.reset()

    def reset(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self.failures: dict[str, list[dict[str, Any]]] = {}
        self.apps: dict[str, dict[str, Any]] = {}
        self.teams: dict[str, dict[str, Any]] = {DEFAULT_TEAM: default_team()}
        self.bot_tokens: dict[str, dict[str, Any]] = {}
        self.config_tokens: set[str] = set()
        self.used_refresh_tokens: set[str] = set()
        self.revoked: set[str] = set()

    def next_id(self, prefix: str) -> str:
        return f"{prefix}{next(self.ids):06d}"

    def record(self, method: str, form: dict[str, str], bearer: str | None) -> None:
        self.calls.append({"method": method, "form": form, "bearer": bearer, "at": time.time()})

    def take_failure(self, method: str) -> None:
        queue = self.failures.get(method) or []
        if not queue:
            return
        failure = queue[0]
        failure["times"] -= 1
        if failure["times"] <= 0:
            queue.pop(0)
        raise SlackError(failure["error"], failure.get("http_status", 200), failure.get("retry_after"))

    def app_by_client(self, client_id: str) -> dict[str, Any] | None:
        return next((a for a in self.apps.values() if a["client_id"] == client_id), None)

    def check_client(self, client_id: str, client_secret: str) -> dict[str, Any] | None:
        app = self.app_by_client(client_id)
        if app is not None and app["client_secret"] != client_secret:
            raise SlackError("invalid_client")
        return app

    def team(self, team_id: str) -> dict[str, Any]:
        return self.teams.setdefault(team_id, default_team(team_id, f"Workspace {team_id}"))

    def bot(self, bearer: str | None) -> dict[str, Any]:
        if not bearer or bearer in self.revoked:
            raise SlackError("token_revoked" if bearer in self.revoked else "not_authed")
        grant = self.bot_tokens.get(bearer)
        if grant is None:
            raise SlackError("invalid_auth")
        return grant

    def config_token(self, bearer: str | None) -> None:
        if not bearer or bearer not in self.config_tokens:
            raise SlackError("invalid_auth")


Handler = Any


def m_oauth_v2_access(st: MockState, form: dict[str, str], _bearer: str | None) -> dict[str, Any]:
    claims = decode_code(form.get("code", ""))
    if not form.get("code") or claims.get("error"):
        raise SlackError(claims.get("error") or "invalid_code")
    app = st.check_client(form.get("client_id", ""), form.get("client_secret", ""))
    team_id = claims.get("team_id", DEFAULT_TEAM)
    team = st.team(team_id)
    if "team_name" in claims:
        team["team_name"] = claims["team_name"]
    app_id = claims.get("app_id") or (app["app_id"] if app else "A0CLOUD")
    token = f"xoxb-mock-{team_id}-{st.next_id('')}"
    st.bot_tokens[token] = {"team_id": team_id, "app_id": app_id, "user_id": claims.get("bot_user_id", "U0BOT")}
    body: dict[str, Any] = {
        "access_token": token,
        "token_type": "bot",
        "scope": "app_mentions:read,chat:write,im:history",
        "bot_user_id": claims.get("bot_user_id", "U0BOT"),
        "app_id": app_id,
        "team": {"id": team_id, "name": team["team_name"]},
        "enterprise": {"id": claims["enterprise_id"], "name": "Mock Grid"} if claims.get("enterprise_id") else None,
        "is_enterprise_install": bool(claims.get("is_enterprise_install")),
        "authed_user": {"id": claims.get("user_id", DEFAULT_USER)},
    }
    if claims.get("channel_id"):
        hook = st.next_id("B")
        body["incoming_webhook"] = {
            "channel": claims.get("channel", "#alerts"),
            "channel_id": claims["channel_id"],
            "configuration_url": f"https://{team_id.lower()}.slack.com/services/{hook}",
            "url": f"{st.base_url}/services/{team_id}/{hook}",
        }
    if claims.get("rotation"):
        body["refresh_token"] = f"xoxe-1-mock-{st.next_id('')}"
        body["expires_in"] = 43200
    return body


def m_openid_connect_token(st: MockState, form: dict[str, str], _bearer: str | None) -> dict[str, Any]:
    claims = decode_code(form.get("code", ""))
    if not form.get("code") or claims.get("error"):
        raise SlackError(claims.get("error") or "invalid_code")
    st.check_client(form.get("client_id", ""), form.get("client_secret", ""))
    team_id = claims.get("team_id", DEFAULT_TEAM)
    user_id = claims.get("user_id", DEFAULT_USER)
    token_claims = {
        "iss": SLACK_ISSUER,
        "sub": user_id,
        "aud": form.get("client_id", ""),
        "exp": int(time.time()) + 300,
        "iat": int(time.time()),
        "nonce": claims.get("nonce", ""),
        "email": claims.get("email", "dana@acme.test"),
        "email_verified": True,
        "https://slack.com/user_id": user_id,
        "https://slack.com/team_id": team_id,
        "https://slack.com/team_name": st.team(team_id)["team_name"],
    }
    if claims.get("enterprise_id"):
        token_claims["https://slack.com/enterprise_id"] = claims["enterprise_id"]
    user_token = f"xoxp-mock-{st.next_id('')}"
    return {"access_token": user_token, "token_type": "Bearer", "id_token": id_token(token_claims)}


def m_auth_test(st: MockState, _form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    if bearer and bearer.startswith("xoxp-mock-") and bearer not in st.revoked:
        return {"url": "https://mock.slack.com/", "team": DEFAULT_TEAM_NAME, "team_id": DEFAULT_TEAM, "user_id": DEFAULT_USER}
    grant = st.bot(bearer)
    team = st.team(grant["team_id"])
    return {
        "url": f"https://{grant['team_id'].lower()}.slack.com/",
        "team": team["team_name"],
        "team_id": grant["team_id"],
        "user_id": grant["user_id"],
        "bot_id": "B0BOT",
        "is_enterprise_install": False,
    }


def m_auth_revoke(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    token = bearer or form.get("token")
    if not token:
        raise SlackError("not_authed")
    st.revoked.add(token)
    return {"revoked": True}


def m_tooling_tokens_rotate(st: MockState, form: dict[str, str], _bearer: str | None) -> dict[str, Any]:
    refresh = form.get("refresh_token", "")
    if not refresh or "expired" in refresh or refresh in st.used_refresh_tokens:
        raise SlackError("invalid_refresh_token")
    st.used_refresh_tokens.add(refresh)
    token = f"xoxe.xoxp-1-mock-{st.next_id('')}"
    st.config_tokens.add(token)
    now = int(time.time())
    return {
        "token": token,
        "refresh_token": f"xoxe-1-mock-{st.next_id('')}",
        "team_id": DEFAULT_TEAM,
        "user_id": DEFAULT_USER,
        "iat": now,
        "exp": now + 43200,
    }


def m_apps_manifest_create(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.config_token(bearer)
    try:
        manifest = json.loads(form.get("manifest", ""))
    except json.JSONDecodeError as e:
        raise SlackError("invalid_manifest") from e
    app_id = st.next_id("A")
    app = {
        "app_id": app_id,
        "client_id": f"{next(st.ids)}.{next(st.ids)}",
        "client_secret": f"secret-{app_id}",
        "signing_secret": f"signing-{app_id}",
        "manifest": manifest,
    }
    st.apps[app_id] = app
    return {
        "app_id": app_id,
        "credentials": {
            "client_id": app["client_id"],
            "client_secret": app["client_secret"],
            "verification_token": f"verify-{app_id}",
            "signing_secret": app["signing_secret"],
        },
        "oauth_authorize_url": f"https://slack.com/oauth/v2/authorize?client_id={app['client_id']}&scope=commands",
    }


def m_apps_manifest_update(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.config_token(bearer)
    app = st.apps.get(form.get("app_id", ""))
    if app is None:
        raise SlackError("app_not_found")
    app["manifest"] = json.loads(form.get("manifest", "{}"))
    return {"app_id": app["app_id"], "permissions_updated": False}


def m_apps_manifest_delete(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.config_token(bearer)
    if st.apps.pop(form.get("app_id", ""), None) is None:
        raise SlackError("app_not_found")
    return {}


def m_apps_uninstall(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    grant = st.bot(bearer)
    st.check_client(form.get("client_id", ""), form.get("client_secret", ""))
    for token, g in st.bot_tokens.items():
        if g["app_id"] == grant["app_id"] and g["team_id"] == grant["team_id"]:
            st.revoked.add(token)
    return {}


def m_apps_connections_open(_st: MockState, _form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    if not bearer or not bearer.startswith("xapp-"):
        raise SlackError("invalid_auth")
    return {"url": "wss://wss-primary.slack.com/link/?ticket=mock-ticket&app_id=A0MOCK"}


def page(items: list[dict[str, Any]], form: dict[str, str]) -> tuple[list[dict[str, Any]], str]:
    start = int(form.get("cursor") or 0)
    limit = max(1, int(form.get("limit") or 100))
    chunk = items[start:start + limit]
    nxt = str(start + limit) if start + limit < len(items) else ""
    return chunk, nxt


def m_conversations_list(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    grant = st.bot(bearer)
    chunk, nxt = page(st.team(grant["team_id"])["channels"], form)
    return {"channels": chunk, "response_metadata": {"next_cursor": nxt}}


def m_users_list(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    grant = st.bot(bearer)
    chunk, nxt = page(st.team(grant["team_id"])["members"], form)
    return {"members": chunk, "response_metadata": {"next_cursor": nxt}}


def m_users_info(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    grant = st.bot(bearer)
    user = next((m for m in st.team(grant["team_id"])["members"] if m["id"] == form.get("user")), None)
    if user is None:
        raise SlackError("user_not_found")
    return {"user": user}


def m_conversations_info(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    grant = st.bot(bearer)
    channel = next((c for c in st.team(grant["team_id"])["channels"] if c["id"] == form.get("channel")), None)
    if channel is None:
        raise SlackError("channel_not_found")
    return {"channel": channel}


def m_chat_post_message(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    if not form.get("channel"):
        raise SlackError("channel_not_found")
    ts = f"{time.time():.6f}"
    # Posting to a user id lands in the DM, and Slack answers with the DM's own channel id.
    channel = "D" + form["channel"][1:] if form["channel"].startswith("U") else form["channel"]
    return {"channel": channel, "ts": ts, "message": {"text": form.get("text", ""), "ts": ts}}


def m_chat_update(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    return {"channel": form.get("channel", ""), "ts": form.get("ts", ""), "text": form.get("text", "")}


def m_chat_post_ephemeral(st: MockState, _form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    return {"message_ts": f"{time.time():.6f}"}


def m_agents_sessions_set_status(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    if form.get("status") not in ("active", "processing", "suspended", "closed"):
        raise SlackError("invalid_status")
    if not form.get("thread_ts"):
        raise SlackError("thread_ts_required")
    return {"status": form["status"], "agent_status": form["status"]}


def m_chat_start_stream(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    if not form.get("channel") or not form.get("thread_ts"):
        raise SlackError("invalid_arguments")
    return {"channel": form["channel"], "ts": f"{time.time():.6f}"}


def m_chat_append_stream(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    return {"channel": form.get("channel", ""), "ts": form.get("ts", "")}


def m_chat_stop_stream(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    return {"channel": form.get("channel", ""), "ts": form.get("ts", "")}


def m_chat_delete(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    if not form.get("channel") or not form.get("ts"):
        raise SlackError("message_not_found")
    return {"channel": form["channel"], "ts": form["ts"]}


def m_views_publish(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    return {"view": {"id": st.next_id("V"), "type": "home", "user_id": form.get("user_id", "")}}


def m_files_get_upload_url_external(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    file_id = st.next_id("F")
    return {"upload_url": f"{st.base_url}/upload/{file_id}", "file_id": file_id, "filename": form.get("filename", "")}


def m_files_complete_upload_external(st: MockState, form: dict[str, str], bearer: str | None) -> dict[str, Any]:
    st.bot(bearer)
    files = json.loads(form.get("files", "[]"))
    return {"files": [{"id": f.get("id", ""), "title": f.get("title", "")} for f in files]}


METHODS: dict[str, Handler] = {
    "oauth.v2.access": m_oauth_v2_access,
    "openid.connect.token": m_openid_connect_token,
    "auth.test": m_auth_test,
    "auth.revoke": m_auth_revoke,
    "tooling.tokens.rotate": m_tooling_tokens_rotate,
    "apps.manifest.create": m_apps_manifest_create,
    "apps.manifest.update": m_apps_manifest_update,
    "apps.manifest.delete": m_apps_manifest_delete,
    "apps.uninstall": m_apps_uninstall,
    "apps.connections.open": m_apps_connections_open,
    "conversations.list": m_conversations_list,
    "conversations.info": m_conversations_info,
    "users.list": m_users_list,
    "users.info": m_users_info,
    "chat.postMessage": m_chat_post_message,
    "chat.update": m_chat_update,
    "chat.postEphemeral": m_chat_post_ephemeral,
    "chat.startStream": m_chat_start_stream,
    "chat.appendStream": m_chat_append_stream,
    "chat.stopStream": m_chat_stop_stream,
    "chat.delete": m_chat_delete,
    "agents.sessions.setStatus": m_agents_sessions_set_status,
    "views.publish": m_views_publish,
    "files.getUploadURLExternal": m_files_get_upload_url_external,
    "files.completeUploadExternal": m_files_complete_upload_external,
}


class SlackMockHandler(BaseHTTPRequestHandler):
    server_version = "SlackMock/1"
    state: MockState

    def log_message(self, fmt: str, *args: Any) -> None:
        log.debug(fmt, *args)

    def do_GET(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        query = {k: v[-1] for k, v in parse_qs(url.query).items()}
        if url.path == "/_mock/health":
            return self.reply(200, {"ok": True})
        if url.path == "/_mock/requests":
            with self.state.lock:
                calls = [c for c in self.state.calls if "method" not in query or c["method"] == query["method"]]
            return self.reply(200, {"ok": True, "requests": calls})
        if url.path == "/_mock/code":
            return self.reply(200, {"ok": True, "code": mock_code(**json.loads(query.get("claims", "{}")))})
        if url.path == "/_mock/state":
            with self.state.lock:
                snapshot = {
                    "apps": list(self.state.apps.values()),
                    "bot_tokens": len(self.state.bot_tokens),
                    "revoked": len(self.state.revoked),
                    "used_refresh_tokens": len(self.state.used_refresh_tokens),
                }
            return self.reply(200, {"ok": True, **snapshot})
        return self.reply(404, {"ok": False, "error": "unknown_path"})

    def do_POST(self) -> None:  # noqa: N802
        url = urlparse(self.path)
        raw = self.rfile.read(int(self.headers.get("Content-Length") or 0))
        if url.path.startswith("/_mock/"):
            return self.control(url.path, json.loads(raw or b"{}"))
        if url.path.startswith("/services/") or url.path.startswith("/upload/"):
            kind = "incoming_webhook" if url.path.startswith("/services/") else "file_upload"
            with self.state.lock:
                self.state.record(kind, {"path": url.path, "body": raw.decode(errors="replace")}, None)
            return self.reply(200, "ok")
        if not url.path.startswith("/api/"):
            return self.reply(404, {"ok": False, "error": "unknown_path"})
        self.slack_method(url.path[len("/api/"):], raw)

    def slack_method(self, method: str, raw: bytes) -> None:
        form = self.parse_form(raw)
        bearer = self.bearer() or form.get("token")
        with self.state.lock:
            self.state.record(method, form, bearer)
            handler = METHODS.get(method)
            try:
                if handler is None:
                    raise SlackError("unknown_method")
                self.state.take_failure(method)
                body = handler(self.state, form, bearer)
                self.state.calls[-1]["response"] = body
            except SlackError as e:
                if e.http_status != 200:
                    headers = {"Retry-After": str(e.retry_after)} if e.retry_after is not None else {}
                    return self.reply(e.http_status, {"ok": False, "error": e.error}, headers)
                return self.reply(200, {"ok": False, "error": e.error})
        self.reply(200, {"ok": True, **{k: v for k, v in body.items() if v is not None}})

    def control(self, path: str, body: dict[str, Any]) -> None:
        st = self.state
        with st.lock:
            if path == "/_mock/reset":
                st.reset()
            elif path == "/_mock/fail":
                failure = {"times": 1, **body}
                st.failures.setdefault(body["method"], []).append(failure)
            elif path == "/_mock/apps":
                st.apps[body["app_id"]] = {"signing_secret": "", "manifest": {}, **body}
            elif path == "/_mock/teams":
                team = default_team(body["team_id"], body.get("team_name", body["team_id"]))
                st.teams[body["team_id"]] = {**team, **body}
            else:
                return self.reply(404, {"ok": False, "error": "unknown_path"})
        self.reply(200, {"ok": True})

    def parse_form(self, raw: bytes) -> dict[str, str]:
        ctype = self.headers.get("Content-Type", "")
        if ctype.startswith("application/json"):
            value = json.loads(raw or b"{}")
            return {k: v if isinstance(v, str) else json.dumps(v) for k, v in value.items()}
        return {k: v[-1] for k, v in parse_qs(raw.decode(), keep_blank_values=True).items()}

    def bearer(self) -> str | None:
        auth = self.headers.get("Authorization", "")
        return auth[len("Bearer "):] if auth.startswith("Bearer ") else None

    def reply(self, status: int, body: Any, headers: dict[str, str] | None = None) -> None:
        data = body.encode() if isinstance(body, str) else json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain" if isinstance(body, str) else "application/json")
        self.send_header("Content-Length", str(len(data)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)


def make_server(host: str = "127.0.0.1", port: int = 0) -> ThreadingHTTPServer:
    """A server bound to ``host:port`` (0 picks a free port); call ``serve_forever`` to run it."""
    server = ThreadingHTTPServer((host, port), SlackMockHandler)
    state = MockState(f"http://{host}:{server.server_address[1]}")
    server.RequestHandlerClass = type("BoundSlackMockHandler", (SlackMockHandler,), {"state": state})
    return server


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=5099)
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s slack-mock %(message)s")
    server = make_server(args.host, args.port)
    sys.stderr.write(f"slack mock listening on http://{args.host}:{server.server_address[1]}/api\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
