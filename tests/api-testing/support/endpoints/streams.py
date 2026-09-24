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
        """PUT stream settings. The endpoint replaces the whole document, so the
        add/remove lists have to be sent even when only one scalar is changing."""
        payload: dict[str, Any] = {
            "partition_keys": {"add": [], "remove": []},
            "index_fields": {"add": [], "remove": []},
            "full_text_search_keys": {"add": [], "remove": []},
            "bloom_filter_fields": {"add": [], "remove": []},
            "defined_schema_fields": {"add": [], "remove": []},
            "extended_retention_days": {"add": [], "remove": []},
            "data_retention": 3650,
            "store_original_data": False,
            "approx_partition": False,
        }
        payload.update(overrides)
        return self.c.put(f"streams/{name}/settings?type={type_}", json=payload, org=org)

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
