"""Dashboard endpoint wrappers."""
from __future__ import annotations

from typing import Any

import requests


class DashboardsAPI:
    def __init__(self, client): self.c = client

    def list(self, *, org: str | None = None) -> list[dict[str, Any]]:
        r = self.c.get("dashboards", org=org, raise_for_status=True)
        return r.json().get("dashboards", [])

    def create(self, payload: dict[str, Any], *, org: str | None = None) -> dict[str, Any]:
        """Create a dashboard and return the response body."""
        r = self.c.post("dashboards", json=payload, org=org, raise_for_status=True)
        return r.json()

    def get(self, dashboard_id: str, *, org: str | None = None) -> requests.Response:
        return self.c.get(f"dashboards/{dashboard_id}", org=org)

    def delete(self, dashboard_id: str, *, org: str | None = None) -> requests.Response:
        return self.c.delete(f"dashboards/{dashboard_id}", org=org)

    def hash(self, dashboard_id: str, *, org: str | None = None) -> str:
        """Current optimistic-concurrency hash, read from the GET response.

        Every panel mutation consumes a hash and mints a new one, so callers
        must re-read (or chain the `hash` from the previous response) before
        the next write — a stale hash is a 409, not a retryable error.
        """
        r = self.get(dashboard_id, org=org)
        r.raise_for_status()
        return r.json()["hash"]

    # ----- panel operations (v8 dashboards only) -----

    def add_panel(
        self,
        dashboard_id: str,
        panel: dict[str, Any],
        *,
        hash: str,
        tab_id: str | None = None,
        folder: str | None = None,
        org: str | None = None,
    ) -> requests.Response:
        """POST /api/{org}/dashboards/{id}/panels — `hash` is a query param, not body."""
        params: dict[str, str] = {"hash": hash}
        if folder is not None:
            params["folder"] = folder
        body: dict[str, Any] = {"panel": panel}
        if tab_id is not None:
            body["tabId"] = tab_id
        return self.c.post(f"dashboards/{dashboard_id}/panels", params=params, json=body, org=org)

    def update_panel(
        self,
        dashboard_id: str,
        panel_id: str,
        panel: dict[str, Any],
        *,
        hash: str,
        tab_id: str | None = None,
        folder: str | None = None,
        org: str | None = None,
    ) -> requests.Response:
        """PUT /api/{org}/dashboards/{id}/panels/{panel_id}."""
        params: dict[str, str] = {"hash": hash}
        if folder is not None:
            params["folder"] = folder
        body: dict[str, Any] = {"panel": panel}
        if tab_id is not None:
            body["tabId"] = tab_id
        return self.c.put(
            f"dashboards/{dashboard_id}/panels/{panel_id}", params=params, json=body, org=org
        )

    def delete_panel(
        self,
        dashboard_id: str,
        panel_id: str,
        *,
        hash: str,
        tab_id: str | None = None,
        folder: str | None = None,
        org: str | None = None,
    ) -> requests.Response:
        """DELETE /api/{org}/dashboards/{id}/panels/{panel_id}."""
        params: dict[str, str] = {"hash": hash}
        if folder is not None:
            params["folder"] = folder
        if tab_id is not None:
            params["tabId"] = tab_id
        return self.c.delete(f"dashboards/{dashboard_id}/panels/{panel_id}", params=params, org=org)

    def panels(self, dashboard_id: str, *, org: str | None = None) -> list[dict[str, Any]]:
        """Flatten every panel across every tab of a v8 dashboard."""
        r = self.get(dashboard_id, org=org)
        r.raise_for_status()
        return [p for tab in r.json()["v8"].get("tabs", []) for p in tab.get("panels", [])]
