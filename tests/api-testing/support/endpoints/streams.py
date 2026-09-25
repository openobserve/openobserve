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

    def update_settings(
        self,
        name: str,
        *,
        type_: str = "logs",
        org: str | None = None,
        **overrides: Any,
    ) -> requests.Response:
        """PATCH stream settings: only the keys you pass are applied.

        `UpdateStreamSettings` is entirely Option/serde-default and the server
        applies each field only when it is `Some`, so sending a "complete"
        document would quietly overwrite every setting the caller did not mean
        to touch. List-valued fields take the add/remove form —
        `update_settings(s, full_text_search_keys={"add": ["msg"]})`.
        """
        return self.c.put(f"streams/{name}/settings?type={type_}", json=overrides, org=org)

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
