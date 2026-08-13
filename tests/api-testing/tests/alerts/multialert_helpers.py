"""Shared API plumbing for the Alerts 4.0 (multi-alert) API tests.

Python port of the Playwright `utils/alerts-api-helpers.js` — the single source
of truth for the v1/v2 alert endpoints, the canonical alert payloads, fixture
seeding, ingest, and the scheduler-outcome polling the firing/transitions tests
need. It deliberately contains NO assertions — those live in the test files.

Auth: routes through the framework `OpenObserveClient` (root Basic). Org is the
shared `default` (alerts are org-scoped but non-destructive here — every alert
is uniquely named and cleaned up, so tests coexist in one org).

Timing: the firing/transitions tests rely on a fast scheduler cadence
(`ZO_ALERT_SCHEDULE_INTERVAL=3`, already in the OSS api-testing baseline env)
plus a fast per-alert cadence (`fast_eval`), so an outcome shows up in ~15s.
"""
from __future__ import annotations

import random
import time
from typing import Any

import requests

from support.client import OpenObserveClient
from support.wait import wait_until

ORG_ID = "default"
STREAM = "alerts_p0_stream"
SINK = "alerts_notify_sink"  # dogfood destination target — this instance's own ingest
TMPL = "auto_p0_tmpl"
DEST = "auto_p0_dest"


def uniq(prefix: str) -> str:
    """Unique, human-readable name so parallel/repeat runs never collide."""
    return f"{prefix}_{int(time.time() * 1000):x}{''.join(random.choice('0123456789abcdef') for _ in range(4))}"


# ---- canonical payloads (mirror alerts-api-helpers.js) ----------------------

def simple_alert(name: str) -> dict[str, Any]:
    """A pre-feature scheduled alert: no aggregation, no priority/tags, no warning family."""
    return {
        "name": name,
        "stream_type": "logs",
        "stream_name": STREAM,
        "is_real_time": False,
        "query_condition": {
            "type": "custom",
            "conditions": {"version": 2, "conditions": {"filterType": "group", "logicalOperator": "AND", "conditions": []}},
            "sql": None, "promql": None, "promql_condition": None, "aggregation": None,
            "vrl_function": None, "search_event_type": None, "multi_time_range": [],
        },
        "trigger_condition": {
            "period": 10, "operator": ">=", "threshold": 3, "frequency": 10, "cron": "",
            "frequency_type": "minutes", "silence": 10, "timezone": "UTC", "align_time": True,
        },
        "destinations": [DEST], "context_attributes": {}, "row_template": "", "enabled": True,
    }


def multi_alert(name: str) -> dict[str, Any]:
    """A grouped alert with the per-group opt-in ON (the M-10 'any breaching group' shape)."""
    a = simple_alert(name)
    a["query_condition"]["aggregation"] = {
        "group_by": ["city"], "function": "avg",
        "having": {"column": "latency", "operator": ">", "value": 500},
        "multi_alert": True,
    }
    a["trigger_condition"]["threshold"] = 1  # the "any breaching group" gate (M-10)
    return a


def grouped_simple_alert(name: str) -> dict[str, Any]:
    """Grouped, but the multi_alert flag is deliberately absent — must stay a simple alert."""
    a = simple_alert(name)
    a["query_condition"]["aggregation"] = {
        "group_by": ["city"], "function": "avg",
        "having": {"column": "latency", "operator": ">", "value": 500},
    }
    return a


def realtime_alert(name: str) -> dict[str, Any]:
    """A realtime (is_real_time=True) alert — evaluated inline, no run-state persisted."""
    a = simple_alert(name)
    a["is_real_time"] = True
    return a


def fast_eval(alert: dict, stream: str) -> dict:
    """Fastest scheduler cadence so a firing shows up in ~15s, not a 10-minute cycle."""
    alert["stream_name"] = stream
    alert["trigger_condition"]["frequency"] = 1
    alert["trigger_condition"]["period"] = 5
    alert["trigger_condition"]["silence"] = 1
    return alert


class AlertsClient:
    """Per-org wrapper exposing the v1/v2 alert API (mirror of the JS helper)."""

    def __init__(self, client: OpenObserveClient, org: str = ORG_ID):
        self._c = client
        self.org = org

    # -- URL prefixes: v1 = api/{org}/, v2 = api/v2/{org}/ --------------------
    def _v1(self, method: str, path: str, **kw) -> requests.Response:
        return self._c.request(method, path, org=self.org, prefix="api/", **kw)

    def _v2(self, method: str, path: str, **kw) -> requests.Response:
        return self._c.request(method, path, org=self.org, prefix="api/v2/", **kw)

    # -- CRUD ----------------------------------------------------------------
    def create_alert(self, payload: dict) -> requests.Response:
        return self._v2("POST", "alerts?folder=default", json=payload)

    def list_alerts(self) -> list[dict]:
        r = self._v2("GET", "alerts?folder=default&page_size=100")
        return (r.json().get("list") or []) if r.status_code == 200 else []

    def find_alert_id(self, name: str) -> str | None:
        for a in self.list_alerts():
            if a.get("name") == name:
                return a.get("alert_id")
        return None

    def get_alert(self, alert_id: str) -> dict | None:
        r = self._v2("GET", f"alerts/{alert_id}?folder=default")
        return r.json() if r.status_code == 200 else None

    def get_alert_detail(self, alert_id: str) -> dict:
        """GET v2 /alerts/{id} (no folder qs) — the round-trip type contract read."""
        return self._v2("GET", f"alerts/{alert_id}").json()

    def get_alert_groups_resp(self, alert_id: str) -> requests.Response:
        return self._v2("GET", f"alerts/{alert_id}/groups")

    def get_alert_groups(self, alert_id: str) -> dict:
        """Per-group state of a multi-alert (empty list on a simple alert)."""
        r = self.get_alert_groups_resp(alert_id)
        return r.json() if r.status_code == 200 else {"list": []}

    def get_alert_transitions_resp(self, alert_id: str, limit: int = 5) -> requests.Response:
        return self._v2("GET", f"alerts/{alert_id}/groups/transitions?limit={limit}")

    def get_alert_transitions(self, alert_id: str, limit: int = 20) -> dict:
        """Durable level-change history (from_level -> to_level, newest first)."""
        r = self.get_alert_transitions_resp(alert_id, limit)
        return r.json() if r.status_code == 200 else {"list": []}

    def get_tags(self) -> list[dict]:
        r = self._v2("GET", "alerts/tags")
        body = r.json() if r.status_code == 200 else []
        return body if isinstance(body, list) else []

    def list_alerts_filtered(self, query: str) -> dict:
        """GET v2 /alerts?<query> — returns the raw envelope (has .list)."""
        return self._v2("GET", f"alerts?{query}").json()

    def delete_alerts(self, ids: list[str]) -> None:
        """Best-effort delete of the given alert_ids (used in teardown)."""
        for i in ids:
            if i:
                try:
                    self._v2("DELETE", f"alerts/{i}?folder=default")
                except requests.RequestException:
                    pass

    # -- fixtures + ingest ---------------------------------------------------
    def seed_alert_fixtures(self) -> None:
        """Idempotently seed template + dogfood destination + a 3-group stream.

        The destination points back at THIS instance's own ingest endpoint (a
        dedicated sink stream) rather than an external webhook, so a firing
        alert delivers with no third-party dependency. The self-call carries the
        same Basic-auth header the tests use.
        """
        auth = {"Authorization": self._c.session.headers["Authorization"]}
        self._v1("POST", "alerts/templates", json={
            "name": TMPL, "body": '{"text":"{alert_name} {alert_level}"}', "type": "http", "title": "",
        })
        base = self._c.base_url.rstrip("/")
        destination = {
            "name": DEST,
            "url": f"{base}/api/{self.org}/{SINK}/_json",  # self-ingest -> self-contained delivery
            "method": "post", "template": TMPL, "type": "http",
            "headers": auth,
        }
        # create-if-absent, then update so a stale definition on a persistent env is corrected.
        self._v1("POST", "alerts/destinations", json=destination)
        self._v1("PUT", f"alerts/destinations/{DEST}", json=destination)

        # city = group key, latency = the measure; three groups so a multi-alert can fan out.
        self._v1("POST", f"{STREAM}/_json", json=[
            {"city": "bangalore", "latency": 890, "status": 500},
            {"city": "mumbai", "latency": 950, "status": 500},
            {"city": "delhi", "latency": 990, "status": 500},
        ])

    def ingest(self, stream: str, rows: list[dict]) -> requests.Response:
        """Ingest rows into a stream (creates it on first write)."""
        return self._v1("POST", f"{stream}/_json", json=rows)

    # -- scheduler-outcome polling ------------------------------------------
    def wait_for_alert_outcome(self, name: str, timeout_s: float = 60, poll_s: float = 5) -> dict | None:
        """Poll the alert list until `name` has a run outcome (scheduler evaluated it)."""
        last = {"item": None}

        def _check():
            item = next((a for a in self.list_alerts() if a.get("name") == name), None)
            last["item"] = item
            return item if (item and item.get("last_outcome")) else None

        try:
            return wait_until(_check, timeout=timeout_s, interval=poll_s, msg=f"alert {name} outcome")
        except AssertionError:
            return last["item"]

    def wait_for_alert_level(self, name: str, level: str, timeout_s: float = 120, poll_s: float = 5) -> dict | None:
        """Poll the alert list until `name` reaches `level` (ok|warning|critical|no_data)."""
        last = {"item": None}

        def _check():
            item = next((a for a in self.list_alerts() if a.get("name") == name), None)
            last["item"] = item
            return item if (item and item.get("level") == level) else None

        try:
            return wait_until(_check, timeout=timeout_s, interval=poll_s, msg=f"alert {name} level={level}")
        except AssertionError:
            return last["item"]


def is_firing_outcome(outcome: Any) -> bool:
    """True for outcomes that mean the alert fired (delivery success is a separate axis)."""
    return outcome in ("firing", "notify_failed")
