"""Search endpoint wrappers."""
from __future__ import annotations

from typing import Any

import requests

from ..factories import search_payload, time_window


class SearchAPI:
    def __init__(self, client): self.c = client

    def sql(
        self,
        sql: str,
        *,
        minutes: int = 15,
        size: int = 100,
        org: str | None = None,
        type_: str = "logs",
        raise_for_status: bool = True,
    ) -> requests.Response:
        """Run an SQL search. By default raises on non-2xx so callers can `.json()` safely."""
        start, end = time_window(minutes=minutes)
        body = search_payload(sql, start_time=start, end_time=end, size=size)
        return self.c.post(
            f"_search?type={type_}",
            json=body,
            org=org,
            raise_for_status=raise_for_status,
        )

    def dashboard_panel(
        self,
        sql: str,
        *,
        dashboard_id: str,
        start_time: int,
        end_time: int,
        size: int = 500,
        use_cache: bool = False,
        org: str | None = None,
        raise_for_status: bool = False,
    ) -> requests.Response:
        """Run a panel query the way the dashboard UI does.

        Hits `_search?type=logs&search_type=dashboards&dashboard_id=…`, which is
        a distinct code path from the Logs page (`search_type=ui`): it carries the
        dashboard context and defaults `use_cache` on. A query that works in Logs
        can still regress here, so panel tests must exercise this variant.

        `use_cache` defaults to False so repeated assertions read the engine, not
        a cached result set.
        """
        body = search_payload(sql, start_time=start_time, end_time=end_time, size=size)
        return self.c.post(
            "_search",
            params={
                "type": "logs",
                "search_type": "dashboards",
                "use_cache": str(use_cache).lower(),
                "dashboard_id": dashboard_id,
            },
            json=body,
            org=org,
            raise_for_status=raise_for_status,
        )

    def hits(self, sql: str, **kw) -> list[dict[str, Any]]:
        """Convenience: run SQL and return just the hits list."""
        return self.sql(sql, **kw).json().get("hits", [])

    def count(self, sql: str, **kw) -> int:
        """Convenience: run SQL and return the row count from a single hit's `count` field.

        Use with `SELECT COUNT(*) AS count FROM ...`.
        """
        h = self.hits(sql, **kw)
        if not h:
            return 0
        return int(h[0].get("count", 0))
