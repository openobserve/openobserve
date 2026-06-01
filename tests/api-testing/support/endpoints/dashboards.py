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
