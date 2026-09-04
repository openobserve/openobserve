"""OpenObserveClient — central HTTP entry point for API tests.

Replaces the per-test boilerplate triple
    session = create_session; url = base_url; org_id = "default"
that appears 307 times in the legacy suite.

Usage:
    client = OpenObserveClient()
    streams = client.streams.list()
    body = client.search.sql('SELECT * FROM "stream" LIMIT 1', minutes=15)

All endpoint-group properties (`client.streams`, `client.search`, …) are
lightweight — they construct a small wrapper on each access. Cheap; no
hidden state.
"""
from __future__ import annotations

import base64
import logging
import os
from typing import Any
from urllib.parse import urljoin

import requests

log = logging.getLogger("o2-api")


class OpenObserveClient:
    def __init__(
        self,
        *,
        base_url: str | None = None,
        email: str | None = None,
        password: str | None = None,
        org: str = "default",
        timeout: float = 30.0,
    ):
        self.base_url = (base_url or os.environ["ZO_BASE_URL"]).rstrip("/") + "/"
        self.email = email or os.environ["ZO_ROOT_USER_EMAIL"]
        self.password = password or os.environ["ZO_ROOT_USER_PASSWORD"]
        self.org = org
        self.timeout = timeout
        self.session = requests.Session()
        auth_b64 = base64.b64encode(f"{self.email}:{self.password}".encode()).decode()
        self.session.headers["Authorization"] = f"Basic {auth_b64}"

    # ----- URL + request plumbing -----

    def url(self, path: str, *, org: str | None = None, prefix: str = "api/") -> str:
        """Build a full URL.

        Default prefix is `api/` + org. For org-less endpoints (like `/healthz`,
        `/node/flush`, `/api/v2/{org}/…`), pass `prefix=""` and use a full path.
        """
        if prefix:
            return urljoin(self.base_url, f"{prefix}{org or self.org}/{path.lstrip('/')}")
        return urljoin(self.base_url, path.lstrip('/'))

    def request(self, method: str, path: str, **kwargs: Any) -> requests.Response:
        """Issue an HTTP request. `path` is appended to `api/{org}/`.

        Supports the same kwargs as `requests.Session.request`, plus:
            org=...   — override the default org for this call
            prefix="" — bypass the api/{org}/ prefix entirely
            raise_for_status=True  — raise on 4xx/5xx
        """
        org = kwargs.pop("org", None)
        prefix = kwargs.pop("prefix", "api/")
        raise_for_status = kwargs.pop("raise_for_status", False)
        kwargs.setdefault("timeout", self.timeout)
        url = self.url(path, org=org, prefix=prefix)
        resp = self.session.request(method, url, **kwargs)
        log.debug("%s %s -> %s", method, url, resp.status_code)
        if raise_for_status:
            resp.raise_for_status()
        return resp

    def get(self, path: str, **kw: Any) -> requests.Response:    return self.request("GET", path, **kw)
    def post(self, path: str, **kw: Any) -> requests.Response:   return self.request("POST", path, **kw)
    def put(self, path: str, **kw: Any) -> requests.Response:    return self.request("PUT", path, **kw)
    def patch(self, path: str, **kw: Any) -> requests.Response:  return self.request("PATCH", path, **kw)
    def delete(self, path: str, **kw: Any) -> requests.Response: return self.request("DELETE", path, **kw)

    # ----- endpoint groups (lazy import + construction) -----

    @property
    def search(self):
        from .endpoints.search import SearchAPI
        return SearchAPI(self)

    @property
    def streams(self):
        from .endpoints.streams import StreamsAPI
        return StreamsAPI(self)

    @property
    def users(self):
        from .endpoints.users import UsersAPI
        return UsersAPI(self)

    @property
    def dashboards(self):
        from .endpoints.dashboards import DashboardsAPI
        return DashboardsAPI(self)

    @property
    def alerts(self):
        from .endpoints.alerts import AlertsAPI
        return AlertsAPI(self)

    @property
    def folders(self):
        from .endpoints.folders import FoldersAPI
        return FoldersAPI(self)

    @property
    def kvstore(self):
        from .endpoints.kvstore import KVStoreAPI
        return KVStoreAPI(self)
