"""Custom model prices can be created, edited and deleted in every edition, the open source build included."""

from __future__ import annotations

import uuid

from support.client import OpenObserveClient


def test_a_custom_price_round_trips(client: OpenObserveClient):
    name = f"api_price_{uuid.uuid4().hex[:8]}"
    price = {
        "name": name,
        "match_pattern": f"(?i)^{name}$",
        "enabled": True,
        "tiers": [{"name": "Default", "prices": {"input": 1e-6, "output": 2e-6}}],
    }
    created = client.post("llm/models", json=price)
    assert created.status_code == 201, f"{created.status_code} {created.text[:300]}"
    model_id = created.json()["id"]
    try:
        price["tiers"][0]["prices"]["output"] = 3e-6
        updated = client.put(f"llm/models/{model_id}", json=price)
        assert updated.status_code == 200, f"{updated.status_code} {updated.text[:300]}"
        fetched = client.get(f"llm/models/{model_id}")
        assert fetched.status_code == 200, f"{fetched.status_code} {fetched.text[:300]}"
        assert fetched.json()["tiers"][0]["prices"]["output"] == 3e-6, fetched.text[:300]
    finally:
        deleted = client.delete(f"llm/models/{model_id}")
        assert deleted.status_code == 200, f"{deleted.status_code} {deleted.text[:300]}"
