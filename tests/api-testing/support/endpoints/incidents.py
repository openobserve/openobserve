"""Incident endpoint wrappers, including the external alert ingest webhook."""
from __future__ import annotations

from typing import Any

import requests


class IncidentsAPI:
    """Wraps /api/v2/{org}/alerts/incidents."""

    def __init__(self, client):
        self.c = client

    # ----- external alert ingest -----

    def ingest(self, payload: dict[str, Any], *, org: str | None = None) -> requests.Response:
        """POST an externally-sourced alert into incident correlation.

        Returns the raw response so tests can assert on 400s as well as the
        success body.
        """
        return self.c.post(
            "alerts/incidents/ingest", prefix="api/v2/", json=payload, org=org
        )

    def ingest_ok(self, payload: dict[str, Any], *, org: str | None = None) -> dict[str, Any]:
        """Ingest and return the parsed body, failing loudly on a non-200."""
        r = self.ingest(payload, org=org)
        assert r.status_code == 200, f"ingest failed: {r.status_code} {r.text}"
        return r.json()

    # ----- read -----

    def list(self, *, status: str | None = None, org: str | None = None) -> list[dict[str, Any]]:
        params = {"status": status} if status else None
        r = self.c.get(
            "alerts/incidents", prefix="api/v2/", params=params, org=org, raise_for_status=True
        )
        return r.json().get("incidents", [])

    def get(self, incident_id: str, *, org: str | None = None) -> requests.Response:
        return self.c.get(f"alerts/incidents/{incident_id}", prefix="api/v2/", org=org)

    def get_ok(self, incident_id: str, *, org: str | None = None) -> dict[str, Any]:
        r = self.get(incident_id, org=org)
        assert r.status_code == 200, f"get incident failed: {r.status_code} {r.text}"
        return r.json()

    def triggers(self, incident_id: str, *, org: str | None = None) -> list[dict[str, Any]]:
        """The incident's alert links.

        Externally-ingested alerts are rendered from here rather than from
        `alerts`, because they have no row in the alerts table.
        """
        return self.get_ok(incident_id, org=org).get("triggers", [])
