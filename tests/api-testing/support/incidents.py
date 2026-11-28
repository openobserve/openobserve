"""Read the whole incident list: the route serves at most 200 rows a page."""
from __future__ import annotations

from collections.abc import Callable
from typing import Any

import requests

PAGE = 200


def list_all_incidents(v2: Callable[..., requests.Response], status: str | None = None) -> list[dict[str, Any]]:
    """Every incident of the org, walking `next_cursor`; `v2(method, path)` sends an api/v2 request."""
    params: dict[str, Any] = {"limit": PAGE, "sort": "first_alert_at:asc"}
    if status:
        params["status"] = status
    incidents: list[dict[str, Any]] = []
    while True:
        resp = v2("GET", "alerts/incidents", params=params)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        incidents.extend(body["incidents"])
        if not body.get("next_cursor"):
            return incidents
        params["cursor"] = body["next_cursor"]
