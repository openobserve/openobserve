"""User endpoint wrappers."""
from __future__ import annotations

from typing import Any

import requests


class UsersAPI:
    def __init__(self, client): self.c = client

    def list(self, *, org: str | None = None) -> list[dict[str, Any]]:
        r = self.c.get("users", org=org, raise_for_status=True)
        return r.json().get("data", r.json().get("list", []))

    def create(self, payload: dict[str, Any], *, org: str | None = None) -> requests.Response:
        return self.c.post("users", json=payload, org=org)

    def update(self, email: str, payload: dict[str, Any], *, org: str | None = None) -> requests.Response:
        return self.c.put(f"users/{email}", json=payload, org=org)

    def delete(self, email: str, *, org: str | None = None) -> requests.Response:
        return self.c.delete(f"users/{email}", org=org)
