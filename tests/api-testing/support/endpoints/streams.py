"""Streams endpoint wrappers."""
from __future__ import annotations

from typing import Any

import requests


class StreamsAPI:
    def __init__(self, client): self.c = client

    def list(self, *, org: str | None = None) -> list[dict[str, Any]]:
        r = self.c.get("streams", org=org, raise_for_status=True)
        return r.json().get("list", [])

    def exists(self, name: str, *, org: str | None = None) -> bool:
        return any(s.get("name") == name for s in self.list(org=org))

    def schema(self, name: str, *, org: str | None = None) -> dict[str, Any]:
        return self.c.get(f"streams/{name}/schema", org=org, raise_for_status=True).json()

    def delete(self, name: str, *, type_: str = "logs", org: str | None = None) -> requests.Response:
        return self.c.delete(f"streams/{name}?type={type_}", org=org)

    def ingest_json(
        self,
        stream: str,
        records: list[dict[str, Any]],
        *,
        org: str | None = None,
    ) -> requests.Response:
        """POST records to /api/{org}/{stream}/_json."""
        return self.c.post(
            f"{stream}/_json",
            json=records,
            org=org,
            raise_for_status=True,
        )
