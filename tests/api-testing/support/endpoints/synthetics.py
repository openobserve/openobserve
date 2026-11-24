"""Synthetics endpoint wrappers: checks, runs, probe locations, shared variables and environments."""
from __future__ import annotations

from typing import Any

import requests

from ..wait import retry_on_db_lock


class SyntheticsAPI:
    """Wraps /api/{org}/synthetics. Every method returns the raw Response so tests assert status and body."""

    def __init__(self, client): self.c = client

    def create(self, payload: dict[str, Any], *, folder: str = "default") -> requests.Response:
        return retry_on_db_lock(lambda: self.c.post(f"synthetics?folder={folder}", json=payload))

    def get(self, check_id: str) -> requests.Response:
        return self.c.get(f"synthetics/{check_id}")

    def update(self, check_id: str, payload: dict[str, Any], *, folder: str = "default") -> requests.Response:
        return retry_on_db_lock(lambda: self.c.put(f"synthetics/{check_id}?folder={folder}", json=payload))

    def delete(self, check_id: str) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.delete(f"synthetics/{check_id}"))

    def bulk_delete(self, ids: list[str]) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.delete("synthetics", json={"ids": ids}))

    def list(self, **params: Any) -> requests.Response:
        return self.c.get("synthetics", params=params)

    def set_enabled(self, check_id: str, body: dict[str, Any]) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.put(f"synthetics/{check_id}/enable", json=body))

    def run_now(self, check_id: str) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.post(f"synthetics/{check_id}/run"))

    def runs(self, check_id: str, **params: Any) -> requests.Response:
        return self.c.get(f"synthetics/{check_id}/runs", params=params)

    def run(self, check_id: str, run_id: str) -> requests.Response:
        return self.c.get(f"synthetics/{check_id}/runs/{run_id}")

    def list_locations(self) -> requests.Response:
        return self.c.get("synthetics/locations")

    def create_location(self, payload: dict[str, Any]) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.post("synthetics/locations", json=payload))

    def get_location(self, location_id: str) -> requests.Response:
        return self.c.get(f"synthetics/locations/{location_id}")

    def update_location(self, location_id: str, payload: dict[str, Any]) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.put(f"synthetics/locations/{location_id}", json=payload))

    def delete_location(self, location_id: str) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.delete(f"synthetics/locations/{location_id}"))

    def list_variables(self) -> requests.Response:
        return self.c.get("synthetics/variables")

    def create_variable(self, payload: dict[str, Any]) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.post("synthetics/variables", json=payload))

    def update_variable(self, variable_id: str, payload: dict[str, Any]) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.put(f"synthetics/variables/{variable_id}", json=payload))

    def delete_variable(self, variable_id: str) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.delete(f"synthetics/variables/{variable_id}"))

    def list_environments(self) -> requests.Response:
        return self.c.get("synthetics/environments")

    def create_environment(self, payload: dict[str, Any]) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.post("synthetics/environments", json=payload))

    def delete_environment(self, name: str) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.delete(f"synthetics/environments/{name}"))

    def list_environment_variables(self, env: str) -> requests.Response:
        return self.c.get(f"synthetics/environments/{env}/variables")

    def create_environment_variable(self, env: str, payload: dict[str, Any]) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.post(f"synthetics/environments/{env}/variables", json=payload))

    def update_environment_variable(self, env: str, variable_id: str, payload: dict[str, Any]) -> requests.Response:
        return retry_on_db_lock(
            lambda: self.c.put(f"synthetics/environments/{env}/variables/{variable_id}", json=payload)
        )

    def delete_environment_variable(self, env: str, variable_id: str) -> requests.Response:
        return retry_on_db_lock(lambda: self.c.delete(f"synthetics/environments/{env}/variables/{variable_id}"))
