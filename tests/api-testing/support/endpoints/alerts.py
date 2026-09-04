"""Alerts (v2) endpoint wrappers."""
from __future__ import annotations

from typing import Any

import requests


class AlertsAPI:
    """Wraps the /api/v2/{org}/alerts surface plus templates/destinations under /api/{org}/alerts/."""

    def __init__(self, client): self.c = client

    # ----- alerts (v2) -----

    def list(self, *, org: str | None = None) -> list[dict[str, Any]]:
        r = self.c.get("alerts", prefix="api/v2/", org=org, raise_for_status=True)
        return r.json().get("list", [])

    def create(self, payload: dict[str, Any], *, org: str | None = None) -> dict[str, Any]:
        r = self.c.post("alerts", prefix="api/v2/", json=payload, org=org, raise_for_status=True)
        return r.json()

    def get(self, alert_id: str, *, org: str | None = None) -> requests.Response:
        return self.c.get(f"alerts/{alert_id}", prefix="api/v2/", org=org)

    def delete(self, alert_id: str, *, org: str | None = None) -> requests.Response:
        return self.c.delete(f"alerts/{alert_id}", prefix="api/v2/", org=org)

    # ----- templates -----

    def create_template(self, payload: dict[str, Any], *, org: str | None = None) -> requests.Response:
        return self.c.post("alerts/templates", json=payload, org=org, raise_for_status=True)

    def delete_template(self, name: str, *, org: str | None = None) -> requests.Response:
        return self.c.delete(f"alerts/templates/{name}", org=org)

    # ----- destinations -----

    def create_destination(self, payload: dict[str, Any], *, org: str | None = None) -> requests.Response:
        return self.c.post("alerts/destinations", json=payload, org=org, raise_for_status=True)

    def get_destination(self, name: str, *, org: str | None = None) -> requests.Response:
        return self.c.get(f"alerts/destinations/{name}", org=org)

    def delete_destination(self, name: str, *, org: str | None = None) -> requests.Response:
        return self.c.delete(f"alerts/destinations/{name}", org=org)
