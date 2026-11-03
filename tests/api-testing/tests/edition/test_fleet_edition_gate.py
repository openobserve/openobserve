"""Fleet management is served by the enterprise build only; the edition comes from `/config`, so both branches run."""

from __future__ import annotations

from support.client import OpenObserveClient

ENTERPRISE_BUILDS = ("enterprise", "cloud")


def test_fl_gate_02_04_fleet_routes_follow_the_edition(client: OpenObserveClient):
    config = client.get("config")
    assert config.status_code == 200, config.text
    build_type = config.json()["build_type"]
    fleets = client.get("fleet/fleets")

    if build_type in ENTERPRISE_BUILDS:
        assert config.json()["fleet_enabled"] is True, config.json()
        assert fleets.status_code == 200, fleets.text
        assert "default" in {f["id"] for f in fleets.json()["items"]}, fleets.text
    else:
        assert build_type == "opensource", build_type
        assert config.json()["fleet_enabled"] is False, config.json()
        # The OSS router never registers the fleet routes (enterprise-only `fleet_routes`), so there is no 403 stub.
        assert fleets.status_code == 404, fleets.text
