"""Shared API plumbing for the On-Call (paging, escalation, routing) tests.

The single source of truth for the `/api/{org}/oncall/*` surface, the alert
payloads that page a team, the fixture seeding those tests need (teams, rosters,
rotations, escalation policies, ownership rules, seeded log data, a destination
that always delivers and one that never does), and the bounded polling that
turns "an alert fires about a minute from now" into a value a test can assert
on. It deliberately contains NO assertions — those live in the test files.

**Enterprise-gated.** Every route here exists only when `O2_ONCALL_ENABLED` is
on in an enterprise build; the router does not even register them otherwise, so
an OSS instance answers 404 rather than 403. `oncall_enabled()` reads the
server's own `/config` flag so the specs skip cleanly instead of failing.

Org addressing: on a multi-tenant deployment an org is addressed by its
**identifier** (a ksuid), not by its display name. `resolve_org` maps whichever
of the two the environment supplied onto the identifier the API wants; on a
single-node build both are `default` and it is a no-op.

Timing: a page exists only after the alert scheduler has evaluated the rule, so
every wait here is a bounded poll (`support.wait.wait_until`), never a sleep.
The suite's baseline env already runs a fast scheduler
(`ZO_ALERT_SCHEDULE_INTERVAL=3`); `fast_eval` asks for the fastest per-alert
cadence on top of it, which puts a firing ~15-60s out.

Two facts about the wire worth keeping in front of you, because both have
already cost somebody an afternoon:

  * every timestamp is **microseconds**, including `shift_micros`, `anchor_micros`
    and the `from`/`to` of `/resolved-schedule`;
  * the member roster **lowercases the email on write**, so a roster read back
    never matches a mixed-case address by `==`.
"""
from __future__ import annotations

import logging
import os
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import requests

from support.client import OpenObserveClient
from support.wait import wait_until

log = logging.getLogger("o2-api.oncall")

# Names are prefixed so a sweep can recognise its own litter, and suffixed with
# a uuid4 so parallel xdist workers never collide on one.
PREFIX = "oncall_pt"

# A page is only real once the scheduler has evaluated the alert. 180s is three
# of the slowest plausible evaluation cycles — long enough that a loaded CI
# runner does not produce a false negative, short enough to fail inside a job.
PAGE_TIMEOUT = 180.0
PAGE_POLL = 5.0

# Escalation state (`exhausted`, `next_targets`) settles on the escalation
# scheduler's own lane, which is separate from the alert scheduler's.
LADDER_TIMEOUT = 120.0
LADDER_POLL = 3.0

MICROS = 1_000_000
MINUTES_PER_DAY = 1440

# A rung at +0s fires with the record; the second is far enough out that a test
# asserting "still climbing" cannot race it, and `escalate` reaches it on demand.
RUNG_NOW = 0
RUNG_LATER = 30 * 60 * MICROS

# Column names chosen from the shipped semantic field groups: `namespace` reads
# as the `k8s-namespace` dimension and `service` as `service`. Ownership rules
# name the hyphenated ALIAS, never the column.
DIM_NAMESPACE = "k8s-namespace"
DIM_SERVICE = "service"

# Alert Destinations the paging channel resolves through. The sink points back
# at this instance's own ingest, so a webhook page delivers with no third party
# and no SMTP; the dead one points at a closed port on loopback, so a page down
# it is a RECORDED failure rather than an absence — which is the only way to
# exercise the delivery ledger's failure paths in a hermetic environment.
SINK_STREAM = f"{PREFIX}_sink"
TMPL = f"{PREFIX}_tmpl"
SINK_DEST = f"{PREFIX}_dest_sink"
DEAD_DEST = f"{PREFIX}_dest_dead"
DEAD_URL = "http://127.0.0.1:1/never-listens"


def uniq(prefix: str = PREFIX) -> str:
    """A unique, human-readable name. uuid4, not a timestamp: two xdist workers
    starting in the same millisecond would share a timestamp."""
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def now_micros() -> int:
    return int(datetime.now(UTC).timestamp() * MICROS)


def micros_from_now(*, minutes: int = 0, hours: int = 0, days: int = 0) -> int:
    delta = timedelta(minutes=minutes, hours=hours, days=days)
    return int((datetime.now(UTC) + delta).timestamp() * MICROS)


def resolve_org(client: OpenObserveClient, wanted: str) -> str:
    """Map an org display name onto the identifier the API addresses it by.

    Returns `wanted` unchanged when the listing cannot be read or nothing
    matches — the caller is then no worse off than if this helper did not exist.
    """
    try:
        resp = client.get("api/organizations", prefix="")
        orgs = resp.json().get("data", []) if resp.status_code == 200 else []
    except (requests.RequestException, ValueError):
        return wanted
    for org in orgs:
        if wanted in (org.get("identifier"), org.get("name")) and org.get("identifier"):
            return org["identifier"]
    return wanted


def oncall_enabled(client: OpenObserveClient, org: str) -> bool:
    """Whether this build serves the on-call routes.

    Probes `GET {org}/oncall/teams` rather than reading a flag off `/config`.
    An earlier version read `config.oncall_enabled`, which is what the issue
    report quoted — but a current enterprise build does not publish that key at
    all, so the gate skipped all 104 tests against a server that was serving
    on-call perfectly well. A 200 (or a 403, which is still the route answering)
    means the feature is there; a 404 means this build does not carry it.
    """
    try:
        resp = client.get("oncall/teams", org=org)
    except requests.RequestException:
        return False
    return resp.status_code in (200, 403)


def shift_rule(name: str, members: list[str], *, priority: int = 0,
               restrictions: list[dict[str, Any]] | None = None,
               shift_micros: int = 7 * 24 * 60 * 60 * MICROS,
               anchor_micros: int | None = None) -> dict[str, Any]:
    """One layer of a rotation: a roster, a cadence, and when it applies.

    The anchor is pinned a week in the past so `members[0]` is the one on call
    right now — a rotation anchored in the future puts nobody on call at all,
    which looks configured on a calendar and pages no one.
    """
    rule: dict[str, Any] = {
        "name": name,
        "members": members,
        "shift_micros": shift_micros,
        "anchor_micros": anchor_micros if anchor_micros is not None
        else micros_from_now(days=-7),
        "priority": priority,
        "restrictions": restrictions or [],
    }
    return rule


def rotation(rotation_id: str, name: str, rules: list[dict[str, Any]]) -> dict[str, Any]:
    """A named rotation. `id` is required on write: an escalation level stores
    the id, so renaming a rotation must not move who gets paged."""
    return {"id": rotation_id, "name": name, "shift_rules": rules}


def ladder(targets: list[dict[str, Any]], *, priority: int = 1,
           channels: list[str] | None = None,
           delays: list[int] | None = None) -> dict[str, Any]:
    """One priority's ladder. `priority` travels as an integer 1-5 on the wire,
    never as the string `P1` the UI renders."""
    delays = delays if delays is not None else [RUNG_NOW]
    return {
        "priority": priority,
        "steps": [{"after_micros": d, "targets": targets} for d in delays],
        "channels": channels or ["webhook"],
    }


def user_target(email: str) -> dict[str, Any]:
    return {"kind": "user", "email": email}


def rotation_target(rotation_id: str) -> dict[str, Any]:
    return {"kind": "rotation", "rotation_id": rotation_id}


def paging_alert(name: str, stream: str, *, oncall_team: str | None = None,
                 destinations: list[str] | None = None,
                 aggregation: dict[str, Any] | None = None,
                 priority: int | None = 1,
                 threshold: int = 1) -> dict[str, Any]:
    """A scheduled alert that pages.

    `aggregation=None` is a Simple alert — its help text reads "Groups are
    collapsed into a single result", which is why one page from a multi-group
    result set is correct rather than a bug (plan §5.2).
    """
    alert: dict[str, Any] = {
        "name": name,
        "stream_type": "logs",
        "stream_name": stream,
        "is_real_time": False,
        "query_condition": {
            "type": "custom",
            "conditions": {
                "version": 2,
                "conditions": {
                    "filterType": "group",
                    "logicalOperator": "AND",
                    "conditions": [],
                },
            },
            "sql": None,
            "promql": None,
            "promql_condition": None,
            "aggregation": aggregation,
            "vrl_function": None,
            "search_event_type": None,
            "multi_time_range": [],
        },
        "trigger_condition": {
            "period": 5,
            "operator": ">=",
            "threshold": threshold,
            "frequency": 1,
            "cron": "",
            "frequency_type": "minutes",
            "silence": 1,
            "timezone": "UTC",
            "align_time": True,
        },
        "destinations": destinations if destinations is not None else [],
        "context_attributes": {},
        "row_template": "",
        "enabled": True,
    }
    if oncall_team is not None:
        alert["oncall_team"] = oncall_team
    if priority is not None:
        alert["priority"] = priority
    return alert


def group_aggregation(group_by: list[str], *, multi_alert: bool,
                      column: str = "latency", operator: str = ">",
                      value: int = 0) -> dict[str, Any]:
    """A grouped aggregation. `multi_alert` is the whole distinction plan §5
    exists to pin: True fans out one page per breaching group, absent/False
    collapses the groups into a single result and so a single page."""
    return {
        "group_by": group_by,
        "function": "count",
        "having": {"column": column, "operator": operator, "value": value},
        "multi_alert": multi_alert,
    }


class OnCallClient:
    """Per-org wrapper over the on-call surface, plus the alert and ingest
    plumbing the paging tests need to make a page happen.

    Everything created through `create_*` is remembered so teardown can sweep it
    without a name-prefix scan that would race another worker's resources.
    """

    def __init__(self, client: OpenObserveClient, org: str):
        self._c = client
        self.org = org
        self.teams: list[str] = []
        self.alerts: list[str] = []
        self.rules: list[str] = []
        self.users: list[str] = []

    # ---- request plumbing ---------------------------------------------------

    def oc(self, method: str, path: str, **kw: Any) -> requests.Response:
        """An `/api/{org}/oncall/...` call."""
        return self._c.request(method, f"oncall/{path.lstrip('/')}", org=self.org, **kw)

    def v1(self, method: str, path: str, **kw: Any) -> requests.Response:
        return self._c.request(method, path, org=self.org, prefix="api/", **kw)

    def v2(self, method: str, path: str, **kw: Any) -> requests.Response:
        return self._c.request(method, path, org=self.org, prefix="api/v2/", **kw)

    def base_url(self) -> str:
        return self._c.base_url.rstrip("/")

    def auth_header(self) -> dict[str, str]:
        return {"Authorization": self._c.session.headers["Authorization"]}

    # ---- teams and rosters --------------------------------------------------

    def create_team(self, name: str | None = None, *, timezone: str = "UTC",
                    description: str = "api test") -> requests.Response:
        body = {"name": name or uniq(f"{PREFIX}_team"), "timezone": timezone,
                "description": description}
        resp = self.oc("POST", "teams", json=body)
        if resp.status_code == 200:
            team_id = resp.json().get("id")
            if team_id:
                self.teams.append(team_id)
        return resp

    def team_id(self, name: str | None = None, **kw: Any) -> str:
        """Create a team and return its id, raising if the create did not take."""
        resp = self.create_team(name, **kw)
        if resp.status_code != 200:
            raise AssertionError(f"team create failed: {resp.status_code} {resp.text}")
        return resp.json()["id"]

    def delete_team(self, team_id: str) -> requests.Response:
        return self.oc("DELETE", f"teams/{team_id}")

    def add_member(self, team_id: str, email: str) -> requests.Response:
        return self.oc("POST", f"teams/{team_id}/members", json={"user_email": email})

    def remove_member(self, team_id: str, email: str) -> requests.Response:
        """The path-style DELETE is a 404 — the email travels as a query param."""
        return self.oc("DELETE", f"teams/{team_id}/members", params={"user_email": email})

    def members(self, team_id: str) -> list[dict[str, Any]]:
        resp = self.oc("GET", f"teams/{team_id}/members")
        return resp.json() if resp.status_code == 200 else []

    def staffed_team(self, emails: list[str], **kw: Any) -> str:
        """A team with a roster — the state most of these tests start from.

        Creating a team auto-creates `Primary` and `Secondary` rotations once
        members exist, so after this the team resolves somebody on call without
        a schedule ever being PUT.
        """
        tid = self.team_id(**kw)
        for email in emails:
            resp = self.add_member(tid, email)
            if resp.status_code != 200:
                raise AssertionError(
                    f"adding {email} to {tid} failed: {resp.status_code} {resp.text}")
        return tid

    # ---- schedule, rotations, covers ---------------------------------------

    def get_schedule(self, team_id: str) -> requests.Response:
        return self.oc("GET", f"teams/{team_id}/schedule")

    def set_schedule(self, team_id: str, rotations: list[dict[str, Any]], *,
                     timezone: str = "UTC") -> requests.Response:
        """A FULL replace: a rotation absent from the body is removed, not left
        standing. That is what makes plan §8.5 reachable at all."""
        return self.oc("PUT", f"teams/{team_id}/schedule",
                       json={"timezone": timezone, "rotations": rotations,
                             "overrides": [], "unavailability": []})

    def rotation_ids(self, team_id: str) -> list[str]:
        resp = self.get_schedule(team_id)
        if resp.status_code != 200:
            return []
        body = resp.json() or {}
        return [r.get("id") for r in body.get("rotations", []) if r.get("id")]

    def primary_rotation_id(self, team_id: str) -> str | None:
        resp = self.get_schedule(team_id)
        if resp.status_code != 200:
            return None
        for rot in (resp.json() or {}).get("rotations", []):
            if rot.get("name") == "Primary":
                return rot.get("id")
        ids = self.rotation_ids(team_id)
        return ids[0] if ids else None

    def create_override(self, team_id: str, email: str, *,
                        start_at: int | None = None, end_at: int | None = None,
                        **extra: Any) -> requests.Response:
        """A cover. The body says `start_at`/`end_at` — NOT `starts_at`, which
        deserialises as an absent required field and answers 422."""
        body = {
            "user_email": email,
            "start_at": start_at if start_at is not None else micros_from_now(minutes=-5),
            "end_at": end_at if end_at is not None else micros_from_now(hours=4),
        }
        body.update(extra)
        return self.oc("POST", f"teams/{team_id}/overrides", json=body)

    def list_overrides(self, team_id: str, **params: Any) -> requests.Response:
        return self.oc("GET", f"teams/{team_id}/overrides", params=params or None)

    def resolved_schedule(self, team_id: str, *, hours: int = 24) -> requests.Response:
        """Both bounds are required and both are microseconds."""
        return self.oc("GET", f"teams/{team_id}/resolved-schedule",
                       params={"from": now_micros(), "to": micros_from_now(hours=hours)})

    def on_call(self, team_id: str) -> requests.Response:
        return self.oc("GET", f"teams/{team_id}/on-call")

    def load(self, team_id: str) -> requests.Response:
        return self.oc("GET", f"teams/{team_id}/load")

    # ---- policy, reachability, preview -------------------------------------

    def get_policy(self, team_id: str) -> requests.Response:
        return self.oc("GET", f"teams/{team_id}/policy")

    def set_policy(self, team_id: str, rungs: list[dict[str, Any]], *,
                   destinations: list[str] | None = None) -> requests.Response:
        body: dict[str, Any] = {"rungs": rungs}
        if destinations is not None:
            body["destinations"] = destinations
        return self.oc("PUT", f"teams/{team_id}/policy", json=body)

    def reachability(self, team_id: str) -> requests.Response:
        return self.oc("GET", f"teams/{team_id}/reachability")

    def config_risks(self, team_id: str) -> requests.Response:
        return self.oc("GET", f"teams/{team_id}/config-risks")

    def escalation_preview(self, team_id: str, *, priority: int = 1) -> requests.Response:
        return self.oc("GET", f"teams/{team_id}/escalation-preview",
                       params={"priority": priority})

    # ---- ownership and routing ---------------------------------------------

    def create_ownership(self, team_id: str, dimensions: dict[str, str]) -> requests.Response:
        """Dimension keys are the hyphenated ALIAS ids (`k8s-namespace`), not the
        underscored column names the rows carry."""
        resp = self.oc("POST", "ownership",
                       json={"team_id": team_id, "dimensions": dimensions})
        if resp.status_code == 200:
            rule_id = (resp.json() or {}).get("id")
            if rule_id:
                self.rules.append(rule_id)
        return resp

    def delete_ownership(self, rule_id: str) -> requests.Response:
        return self.oc("DELETE", f"ownership/{rule_id}")

    def list_ownership(self, **params: Any) -> requests.Response:
        return self.oc("GET", "ownership", params=params or None)

    def routing_config(self) -> requests.Response:
        return self.oc("GET", "routing/config")

    def default_team_id(self) -> str | None:
        resp = self.routing_config()
        if resp.status_code != 200:
            return None
        return (resp.json() or {}).get("default_team_id") or None

    def preview_routing(self, dimensions: dict[str, str], *,
                        oncall_team: str | None = None) -> requests.Response:
        """A dry run of the routing decision. Changes nothing, needs no alert to
        fire, and reports the rules that matched and lost — the only way to
        assert precedence without waiting on a scheduler."""
        body: dict[str, Any] = {"dimensions": dimensions}
        if oncall_team is not None:
            body["oncall_team"] = oncall_team
        return self.oc("POST", "routing/preview", json=body)

    # ---- pages (responses) --------------------------------------------------

    def list_responses(self, **params: Any) -> list[dict[str, Any]]:
        """List pages, optionally filtered server-side.

        Booleans are lowercased on the way out: `requests` renders Python `True`
        as `"True"`, and the query deserializer answers
        `400 provided string was not \u0060true\u0060 or \u0060false\u0060`. Left as a bool this
        returned 400 on every poll, and the old `return []` on non-200 made that
        read as "no pages yet" — so every wait burned its full timeout and
        reported a product failure that never happened.
        """
        clean = {k: ("true" if v is True else "false" if v is False else v)
                 for k, v in params.items() if v is not None}
        resp = self.oc("GET", "responses", params=clean or None)
        if resp.status_code != 200:
            raise AssertionError(
                f"listing pages failed: {resp.status_code} {resp.text[:200]}")
        body = resp.json()
        return body if isinstance(body, list) else body.get("list", [])

    def get_response(self, response_id: str) -> requests.Response:
        return self.oc("GET", f"responses/{response_id}")

    def escalation(self, response_id: str) -> requests.Response:
        return self.oc("GET", f"responses/{response_id}/escalation")

    def deliveries(self, response_id: str) -> requests.Response:
        return self.oc("GET", f"responses/{response_id}/deliveries")

    def acknowledge(self, response_id: str) -> requests.Response:
        return self.oc("POST", f"responses/{response_id}/acknowledge", json={})

    def resolve(self, response_id: str) -> requests.Response:
        return self.oc("POST", f"responses/{response_id}/resolve", json={})

    def escalate(self, response_id: str) -> requests.Response:
        return self.oc("POST", f"responses/{response_id}/escalate", json={})

    def note(self, response_id: str, body: str = "api test note") -> requests.Response:
        """`notes` needs a `body`; without one the request never reaches the
        scope check and answers 422 (plan §1.7)."""
        return self.oc("POST", f"responses/{response_id}/notes", json={"body": body})

    def snooze(self, response_id: str, minutes: int = 5) -> requests.Response:
        return self.oc("POST", f"responses/{response_id}/snooze", json={"minutes": minutes})

    def handoff(self, response_id: str, *, to: str | None = None,
                to_team_id: str | None = None) -> requests.Response:
        """A handoff needs a target; without one it answers 400 BEFORE the scope
        check, which is what fooled the manual pass (plan §1.7)."""
        body: dict[str, Any] = {}
        if to is not None:
            body["to"] = to
        if to_team_id is not None:
            body["to_team_id"] = to_team_id
        return self.oc("POST", f"responses/{response_id}/handoff", json=body)

    # ---- alerts, destinations, ingest --------------------------------------

    def seed_destinations(self) -> None:
        """Idempotently seed the template and the two destinations.

        Created then updated, so a stale definition left on a persistent
        environment by an earlier run is corrected rather than reused.
        """
        self.v1("POST", "alerts/templates", json={
            "name": TMPL,
            "body": '{"text":"{alert_name} {alert_level}"}',
            "type": "http",
            "title": "",
        })
        sink = {
            "name": SINK_DEST,
            "url": f"{self.base_url()}/api/{self.org}/{SINK_STREAM}/_json",
            "method": "post", "template": TMPL, "type": "http",
            "headers": self.auth_header(),
        }
        dead = {
            "name": DEAD_DEST, "url": DEAD_URL,
            "method": "post", "template": TMPL, "type": "http", "headers": {},
        }
        for dest in (sink, dead):
            self.v1("POST", "alerts/destinations", json=dest)
            self.v1("PUT", f"alerts/destinations/{dest['name']}", json=dest)

    def create_alert(self, payload: dict[str, Any]) -> requests.Response:
        resp = self.v2("POST", "alerts?folder=default", json=payload)
        if resp.status_code == 200:
            alert_id = (resp.json() or {}).get("id")
            if alert_id:
                self.alerts.append(alert_id)
        return resp

    def get_alert(self, alert_id: str) -> requests.Response:
        return self.v2("GET", f"alerts/{alert_id}")

    def delete_alert(self, alert_id: str) -> requests.Response:
        return self.v2("DELETE", f"alerts/{alert_id}?folder=default")

    def ingest(self, stream: str, rows: list[dict[str, Any]]) -> requests.Response:
        """Ingest needs Basic auth; a session cookie is rejected on this route."""
        return self.v1("POST", f"{stream}/_json", json=rows)

    def seed_rows(self, stream: str, rows: list[dict[str, Any]]) -> requests.Response:
        """Stamp rows with a current `_timestamp` and ingest them.

        Timestamps stay inside the last minute so an alert with a 5-minute
        period sees them without a widened `ZO_INGEST_ALLOWED_UPTO`.
        """
        at = now_micros()
        stamped = [{"_timestamp": at, **row} for row in rows]
        return self.ingest(stream, stamped)

    # ---- waiting ------------------------------------------------------------

    def wait_for_pages(self, alert_id: str, *, count: int = 1,
                       timeout: float = PAGE_TIMEOUT) -> list[dict[str, Any]]:
        """Poll until `count` pages exist for this alert, then return them.

        Filtered server-side on `(subject_type, source_id)`: the org list is
        capped at 200 rows, so a client-side filter would silently miss a page
        on a busy instance.
        """
        def _pages() -> list[dict[str, Any]] | None:
            found = self.list_responses(subject_type="alert", source_id=alert_id,
                                        include_resolved=True)
            return found if len(found) >= count else None

        return wait_until(_pages, timeout=timeout, interval=PAGE_POLL,
                          msg=f"{count} page(s) for alert {alert_id}")

    def open_pages_for(self, team_ids: list[str], *, stream: str | None = None,
                       priority: int = 1) -> list[dict[str, Any]]:
        """Open one page per entry in `team_ids`, aligned by index.

        One alert per page rather than one grouped alert producing several:
        fan-out is the thing plan §5 measures, so a fixture must not assume it.
        Every alert is created before ANY page is waited for, so the whole batch
        costs one scheduler cycle rather than one cycle each.
        """
        stream = stream or uniq(f"{PREFIX}_stream")
        row = {"latency": 900, "service": "checkout", "namespace": "payments"}
        self.seed_rows(stream, [row])
        alert_ids = []
        for team_id in team_ids:
            payload = paging_alert(uniq(f"{PREFIX}_alert"), stream,
                                   oncall_team=team_id, priority=priority)
            resp = self.create_alert(payload)
            if resp.status_code != 200:
                raise AssertionError(
                    f"alert create failed: {resp.status_code} {resp.text}")
            alert_ids.append(resp.json()["id"])

        # Re-seeded after the alerts exist: a rule created after the ingest
        # evaluates a window that may already have slid past those rows.
        self.seed_rows(stream, [row])
        return [self.wait_for_pages(alert_id)[0] for alert_id in alert_ids]

    def open_pages(self, team_id: str, count: int, **kw: Any) -> list[dict[str, Any]]:
        """`count` independent pages on one team, inside a single cycle."""
        return self.open_pages_for([team_id] * count, **kw)

    def wait_for_deliveries(self, response_id: str, *, count: int = 1,
                            timeout: float = LADDER_TIMEOUT) -> dict[str, Any]:
        """Poll until the delivery ledger has `count` rows for this page."""
        def _ledger() -> dict[str, Any] | None:
            resp = self.deliveries(response_id)
            if resp.status_code != 200:
                return None
            body = resp.json() or {}
            return body if len(body.get("deliveries", [])) >= count else None

        return wait_until(_ledger, timeout=timeout, interval=LADDER_POLL,
                          msg=f"{count} delivery row(s) on {response_id}")

    def wait_for_exhausted(self, response_id: str,
                           timeout: float = LADDER_TIMEOUT) -> dict[str, Any]:
        """Poll until the ladder reports itself finished."""
        def _progress() -> dict[str, Any] | None:
            resp = self.escalation(response_id)
            if resp.status_code != 200:
                return None
            body = resp.json() or {}
            return body if body.get("exhausted") else None

        return wait_until(_progress, timeout=timeout, interval=LADDER_POLL,
                          msg=f"ladder on {response_id} to exhaust")

    # ---- teardown -----------------------------------------------------------

    def sweep(self) -> None:
        """Best-effort delete of everything this instance created.

        Ordered alerts-first so nothing can open a new page against a team that
        is on its way out. Never raises: a cleanup failure must not mask the
        result of the test that just ran.
        """
        for alert_id in self.alerts:
            self._quiet(lambda i=alert_id: self.delete_alert(i))
        for rule_id in self.rules:
            self._quiet(lambda i=rule_id: self.delete_ownership(i))
        for team_id in self.teams:
            self._quiet(lambda i=team_id: self.delete_team(i))
        for email in self.users:
            self._quiet(lambda e=email: self._c.users.delete(e, org=self.org))
        self.alerts.clear()
        self.rules.clear()
        self.teams.clear()
        self.users.clear()

    @staticmethod
    def _quiet(call: Any) -> None:
        try:
            call()
        except (requests.RequestException, ValueError) as exc:
            log.debug("oncall sweep step failed: %s", exc)


def make_user(client: OpenObserveClient, org: str, role: str,
              password: str = "Complexpass#123") -> tuple[str, OpenObserveClient]:
    """Create an org user with `role` and return (email, a client acting as them).

    The returned client authenticates as that user, which is the only way to
    assert what the API refuses them — asserting with root's credentials and a
    `user_email` field in the body would test nothing.
    """
    email = f"{PREFIX}_{role}_{uuid.uuid4().hex[:8]}@test.invalid"
    payload = {
        "email": email, "password": password, "first_name": "OnCall",
        "last_name": role.capitalize(), "role": role, "organization": org,
    }
    resp = client.users.create(payload, org=org)
    if resp.status_code != 200:
        raise AssertionError(f"creating {role} user failed: {resp.status_code} {resp.text}")
    return email, OpenObserveClient(email=email, password=password, org=org)


def delivered_recipients(ledger: dict[str, Any], *,
                         rung_micros: int | None = None) -> set[str]:
    """The recipients the ledger says a page actually LANDED on.

    `delivered: false` is a recorded failure, not an absence — it is excluded
    here for the same reason the engine excludes it when deciding whom to retry.
    """
    out = set()
    for row in ledger.get("deliveries", []):
        if row.get("delivered") is not True:
            continue
        if rung_micros is not None and row.get("rung_micros") != rung_micros:
            continue
        recipient = row.get("recipient")
        if recipient:
            out.add(recipient)
    return out


def failed_recipients(ledger: dict[str, Any]) -> list[str]:
    """Recipients with at least one RECORDED delivery failure, newest last."""
    return [row.get("recipient") for row in ledger.get("deliveries", [])
            if row.get("delivered") is False and row.get("recipient")]


def org_env() -> str:
    """The org these tests run against, by identifier where the env supplies one."""
    return os.environ.get("ONCALL_TEST_ORG") or os.environ.get("TEST_ORG_ID", "default")
