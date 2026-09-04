"""KV store endpoint wrappers."""
from __future__ import annotations

from typing import Any

import requests


class KVStoreAPI:
    def __init__(self, client): self.c = client

    def list(self, *, prefix: str | None = None, org: str | None = None) -> requests.Response:
        path = "kv"
        if prefix is not None:
            path = f"kv?prefix={prefix}"
        return self.c.get(path, org=org)

    def get(self, key: str, *, org: str | None = None) -> requests.Response:
        return self.c.get(f"kv/{key}", org=org)

    def set(self, key: str, value: Any, *, org: str | None = None) -> requests.Response:
        return self.c.post(f"kv/{key}", json=value, org=org)

    def delete(self, key: str, *, org: str | None = None) -> requests.Response:
        return self.c.delete(f"kv/{key}", org=org)
