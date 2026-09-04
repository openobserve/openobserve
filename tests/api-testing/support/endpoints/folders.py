"""Folder endpoint wrappers (for alerts and dashboards)."""
from __future__ import annotations

from typing import Any, Literal

import requests

FolderKind = Literal["alerts", "dashboards"]


class FoldersAPI:
    def __init__(self, client): self.c = client

    def create(
        self,
        payload: dict[str, Any],
        *,
        kind: FolderKind = "alerts",
        org: str | None = None,
    ) -> dict[str, Any]:
        r = self.c.post(f"folders/{kind}", prefix="api/v2/", json=payload, org=org, raise_for_status=True)
        return r.json()

    def delete(
        self,
        folder_id: str,
        *,
        kind: FolderKind = "alerts",
        org: str | None = None,
    ) -> requests.Response:
        return self.c.delete(f"folders/{kind}/{folder_id}", prefix="api/v2/", org=org)
