"""Service versions are served by the enterprise build only; the edition comes from `/config`, so both branches run."""

from __future__ import annotations

from support.client import OpenObserveClient

ENTERPRISE_BUILDS = ("enterprise", "cloud")
OSS_DENIAL = "Service versions require the enterprise build"


def test_service_versions_routes_follow_the_edition(client: OpenObserveClient):
    config = client.get("config", prefix="")
    assert config.status_code == 200, config.text
    build_type = config.json()["build_type"]
    responses = {
        "envs": client.get("service_identity/envs"),
        "aliases": client.get("service_identity/aliases"),
        "versions": client.get("service_versions", params={"service": "svcver-edition-probe"}),
    }

    if build_type in ENTERPRISE_BUILDS:
        for name, resp in responses.items():
            assert resp.status_code == 200, f"{name}: {resp.status_code} {resp.text}"
        assert responses["versions"].json()["versions"] == []
    else:
        assert build_type == "opensource", build_type
        for name, resp in responses.items():
            assert resp.status_code == 403, f"{name}: {resp.status_code} {resp.text}"
            assert OSS_DENIAL in resp.text, f"{name}: {resp.text}"
