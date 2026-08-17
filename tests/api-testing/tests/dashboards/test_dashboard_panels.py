"""Dashboard panel API tests — AddPanel / UpdatePanel / DeletePanel.

Covers the three panel endpoints (`/dashboards/{id}/panels[/{panel_id}]`), which
had no pytest coverage at all. They are the only dashboard endpoints that take
`hash` as a *query* parameter and mint a fresh one on every write, so their
optimistic-concurrency semantics need tests of their own.

Panel *query execution* — running real SQL through the dashboard search path —
lives in test_dashboard_cte_panels.py. This module deliberately uses one trivial
query throughout, so a failure here means the panel API is broken rather than
the query engine.

Shared fixtures (`panel_streams`, `panel_stream`, `panel_dashboard`) come from
conftest.py in this directory.
"""
from __future__ import annotations

import logging
import time

from support.factories import panel_payload
from support.panel_queries import add_panel, drop_panel, write_with_fresh_hash

logger = logging.getLogger(__name__)

# A query that depends on nothing but the ingested fixture: this module is about
# the panel endpoints, not about what the panel runs.
_BASELINE_SQL = (
    'SELECT facility_zone, COUNT(*) AS cnt FROM "{stream}" '
    "WHERE match_all('warehouse') AND facility_zone IS NOT NULL "
    "GROUP BY facility_zone ORDER BY cnt DESC, facility_zone ASC LIMIT 10"
)

# ── contract ───────────────────────────────────────────────────────────────


class TestDashboardPanelContract:
    """Response schemas for the panel endpoints, per the Utoipa decorators."""

    def test_add_panel_response_schema(self, client, panel_dashboard, panel_stream):
        """POST /dashboards/{id}/panels -> PanelResponseBody {panel, hash, tabId}."""
        panel = panel_payload(
            stream=panel_stream,
            sql=_BASELINE_SQL.format(stream=panel_stream),
            x_alias="facility_zone",
            y_alias="cnt",
        )

        body = add_panel(client, panel_dashboard, panel)
        try:
            for field in ("panel", "hash", "tabId"):
                assert field in body, f"PanelResponseBody missing '{field}': {body}"
            assert body["hash"], "A panel write must return the next hash"
            assert body["tabId"] == "default", f"Expected the panel in tab 'default': {body['tabId']}"

            returned = body["panel"]
            assert returned["id"] == panel["id"], "Panel id should echo back unchanged"
            for field in ("type", "title", "description", "config", "queries", "layout"):
                assert field in returned, f"Panel missing required field '{field}'"
            assert returned["queries"][0]["customQuery"] is True, (
                "customQuery must survive the round trip — if it flips to false, "
                "OO rebuilds the SQL from field config and the panel stops running our query"
            )
        finally:
            drop_panel(client, panel_dashboard, panel["id"])

    def test_panel_sql_round_trips_unmodified(self, client, panel_dashboard, panel_stream):
        """The stored panel SQL must be byte-identical to what was submitted.

        A match_all query that gets normalised, re-quoted or projection-rewritten
        on the way into storage would come back subtly different and run as a
        different query on the next dashboard load.
        """
        sql = _BASELINE_SQL.format(stream=panel_stream)
        panel = panel_payload(
            stream=panel_stream, sql=sql, x_alias="facility_zone", y_alias="cnt"
        )

        add_panel(client, panel_dashboard, panel)
        try:
            stored = [p for p in client.dashboards.panels(panel_dashboard) if p["id"] == panel["id"]]
            assert stored, f"Panel {panel['id']} not found on the dashboard after AddPanel"
            assert stored[0]["queries"][0]["query"] == sql, (
                "Stored panel SQL differs from the submitted SQL"
            )
        finally:
            drop_panel(client, panel_dashboard, panel["id"])


# ── CRUD lifecycle ─────────────────────────────────────────────────────────


class TestDashboardPanelCRUD:
    """Add -> read -> update -> delete -> verify, against one dashboard."""

    _panel_id: str | None = None
    _panel: dict | None = None

    def test_01_add_panel(self, client, panel_dashboard, panel_stream):
        """AddPanel returns the panel and the next hash."""
        panel = panel_payload(
            stream=panel_stream,
            sql=_BASELINE_SQL.format(stream=panel_stream),
            x_alias="facility_zone",
            y_alias="cnt",
            title="CRUD panel",
        )
        body = add_panel(client, panel_dashboard, panel)

        TestDashboardPanelCRUD._panel = panel
        TestDashboardPanelCRUD._panel_id = body["panel"]["id"]
        assert TestDashboardPanelCRUD._panel_id, "AddPanel must return a panel id"

    def test_02_read_panel(self, client, panel_dashboard):
        """The added panel is present on the dashboard with its title intact."""
        assert TestDashboardPanelCRUD._panel_id, "Prerequisite: panel must be added first"

        panels = client.dashboards.panels(panel_dashboard)
        match = [p for p in panels if p["id"] == TestDashboardPanelCRUD._panel_id]
        assert match, f"Panel {TestDashboardPanelCRUD._panel_id} missing from dashboard"
        assert match[0]["title"] == "CRUD panel", "Panel title should match what was submitted"

    def test_03_update_panel(self, client, panel_dashboard, panel_stream):
        """UpdatePanel swaps the SQL and title, and returns a fresh hash."""
        assert TestDashboardPanelCRUD._panel_id, "Prerequisite: panel must be added first"

        new_sql = (
            "SELECT histogram(_timestamp, '5 minute') AS bucket, COUNT(*) AS hits "
            f'FROM "{panel_stream}" '
            "WHERE match_all('warehouse') GROUP BY bucket ORDER BY bucket ASC LIMIT 20"
        )
        updated = panel_payload(
            stream=panel_stream,
            sql=new_sql,
            x_alias="bucket",
            y_alias="hits",
            panel_id=TestDashboardPanelCRUD._panel_id,
            title="CRUD panel (updated)",
            panel_type="line",
        )

        resp = client.dashboards.update_panel(
            panel_dashboard,
            TestDashboardPanelCRUD._panel_id,
            updated,
            hash=client.dashboards.hash(panel_dashboard),
        )
        assert resp.status_code == 200, f"UpdatePanel failed: {resp.status_code} {resp.text}"

        stored = [
            p
            for p in client.dashboards.panels(panel_dashboard)
            if p["id"] == TestDashboardPanelCRUD._panel_id
        ]
        assert stored, "Panel disappeared after update"
        assert stored[0]["title"] == "CRUD panel (updated)", "Updated title not persisted"
        assert stored[0]["queries"][0]["query"] == new_sql, "Updated SQL not persisted"
        assert stored[0]["type"] == "line", "Updated panel type not persisted"

    def test_04_delete_panel(self, client, panel_dashboard):
        """DeletePanel returns the deleted id and the next hash."""
        assert TestDashboardPanelCRUD._panel_id, "Prerequisite: panel must be added first"

        resp = client.dashboards.delete_panel(
            panel_dashboard,
            TestDashboardPanelCRUD._panel_id,
            hash=client.dashboards.hash(panel_dashboard),
        )
        assert resp.status_code == 200, f"DeletePanel failed: {resp.status_code} {resp.text}"

        body = resp.json()
        assert body["panelId"] == TestDashboardPanelCRUD._panel_id, (
            f"DeletePanel echoed the wrong id: {body}"
        )
        assert body["hash"], "DeletePanel must return the next hash"

    def test_05_verify_panel_deleted(self, client, panel_dashboard):
        """The panel is gone from the dashboard, and deleting it again 404s."""
        assert TestDashboardPanelCRUD._panel_id, "Prerequisite: panel must be added first"

        panel_ids = [p["id"] for p in client.dashboards.panels(panel_dashboard)]
        assert TestDashboardPanelCRUD._panel_id not in panel_ids, (
            "Deleted panel still present on the dashboard"
        )

        resp = client.dashboards.delete_panel(
            panel_dashboard,
            TestDashboardPanelCRUD._panel_id,
            hash=client.dashboards.hash(panel_dashboard),
        )
        assert resp.status_code == 404, (
            f"Expected 404 deleting an already-deleted panel, got {resp.status_code}: {resp.text}"
        )


# ── error paths ────────────────────────────────────────────────────────────


class TestDashboardPanelErrors:
    """Error paths derived from `DashboardError` in src/core/src/dashboards/mod.rs."""

    def test_add_panel_missing_hash(self, client, panel_dashboard, panel_stream):
        """No `hash` query param -> 400 (handler rejects before reaching the store)."""
        panel = panel_payload(
            stream=panel_stream,
            sql=_BASELINE_SQL.format(stream=panel_stream),
            x_alias="facility_zone",
            y_alias="cnt",
        )
        resp = client.post(f"dashboards/{panel_dashboard}/panels", json={"panel": panel})
        assert resp.status_code == 400, (
            f"Expected 400 for a missing hash param, got {resp.status_code}: {resp.text}"
        )

    def test_add_panel_stale_hash(self, client, panel_dashboard, panel_stream):
        """DashboardError::UpdateConflictingHash -> 409.

        Reuse a hash that a prior write already consumed; the second write must
        be rejected rather than silently overwriting the first.
        """
        first = panel_payload(
            stream=panel_stream,
            sql=_BASELINE_SQL.format(stream=panel_stream),
            x_alias="facility_zone",
            y_alias="cnt",
        )
        # Take the stale hash from the write that actually consumed it, rather
        # than from a separate read: this module shares one dashboard across many
        # writes, so a hash read moments earlier can already be a version behind
        # and the setup write would 409 for the wrong reason.
        resp, stale_hash = write_with_fresh_hash(
            client,
            panel_dashboard,
            lambda h: client.dashboards.add_panel(panel_dashboard, first, hash=h),
        )
        assert resp.status_code == 200, f"Setup write failed: {resp.status_code} {resp.text}"

        try:
            second = panel_payload(
                stream=panel_stream,
                sql=_BASELINE_SQL.format(stream=panel_stream),
                x_alias="facility_zone",
                y_alias="cnt",
            )
            conflict = client.dashboards.add_panel(panel_dashboard, second, hash=stale_hash)
            assert conflict.status_code == 409, (
                f"Expected 409 for a stale hash, got {conflict.status_code}: {conflict.text}"
            )
        finally:
            drop_panel(client, panel_dashboard, first["id"])

    def test_add_duplicate_panel_id(self, client, panel_dashboard, panel_stream):
        """DashboardError::PanelAlreadyExists -> 409."""
        panel = panel_payload(
            stream=panel_stream,
            sql=_BASELINE_SQL.format(stream=panel_stream),
            x_alias="facility_zone",
            y_alias="cnt",
        )
        add_panel(client, panel_dashboard, panel)

        try:
            resp = client.dashboards.add_panel(
                panel_dashboard, panel, hash=client.dashboards.hash(panel_dashboard)
            )
            assert resp.status_code == 409, (
                f"Expected 409 for a duplicate panel id, got {resp.status_code}: {resp.text}"
            )
        finally:
            drop_panel(client, panel_dashboard, panel["id"])

    def test_add_panel_unknown_tab(self, client, panel_dashboard, panel_stream):
        """DashboardError::TabNotFound -> 404."""
        panel = panel_payload(
            stream=panel_stream,
            sql=_BASELINE_SQL.format(stream=panel_stream),
            x_alias="facility_zone",
            y_alias="cnt",
        )
        resp = client.dashboards.add_panel(
            panel_dashboard,
            panel,
            hash=client.dashboards.hash(panel_dashboard),
            tab_id=f"no_such_tab_{int(time.time() * 1000)}",
        )
        assert resp.status_code == 404, (
            f"Expected 404 for an unknown tab, got {resp.status_code}: {resp.text}"
        )

    def test_add_panel_unknown_dashboard(self, client, panel_stream):
        """DashboardError::DashboardNotFound -> 404."""
        panel = panel_payload(
            stream=panel_stream,
            sql=_BASELINE_SQL.format(stream=panel_stream),
            x_alias="facility_zone",
            y_alias="cnt",
        )
        resp = client.dashboards.add_panel(
            f"nonexistent_{int(time.time() * 1000)}", panel, hash="0"
        )
        assert resp.status_code == 404, (
            f"Expected 404 for an unknown dashboard, got {resp.status_code}: {resp.text}"
        )

    def test_update_unknown_panel(self, client, panel_dashboard, panel_stream):
        """DashboardError::PanelNotFound -> 404."""
        missing_id = f"nonexistent_{int(time.time() * 1000)}"
        panel = panel_payload(
            stream=panel_stream,
            sql=_BASELINE_SQL.format(stream=panel_stream),
            x_alias="facility_zone",
            y_alias="cnt",
            panel_id=missing_id,
        )
        resp = client.dashboards.update_panel(
            panel_dashboard, missing_id, panel, hash=client.dashboards.hash(panel_dashboard)
        )
        assert resp.status_code == 404, (
            f"Expected 404 updating an unknown panel, got {resp.status_code}: {resp.text}"
        )

    def test_delete_panel_missing_hash(self, client, panel_dashboard):
        """DeletePanel without a `hash` query param -> 400."""
        resp = client.delete(f"dashboards/{panel_dashboard}/panels/some_panel_id")
        assert resp.status_code == 400, (
            f"Expected 400 for a missing hash param, got {resp.status_code}: {resp.text}"
        )
