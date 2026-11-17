"""Source-map uploads take the higher default limits #16477 made configurable.

Before, an upload was capped at 5 MB per map, 100 MB uncompressed in all and 1000 maps. The defaults are now
`ZO_SOURCEMAP_FILE_MAX_SIZE=50` (MB), `ZO_SOURCEMAP_ZIP_MAX_SIZE=500` (MB) and `ZO_SOURCEMAP_ZIP_MAX_ENTRIES=5000`.
Map bodies are one repeated byte, so even the 51 MB map zips to a few hundred KB.
"""

from __future__ import annotations

import io
import json
import zipfile
from collections.abc import Generator

import pytest

from support.client import OpenObserveClient
from support.factories import unique_name

MB = 1024 * 1024
ENV = "pytest"
VERSION = "1.0.0"


@pytest.fixture
def service(client: OpenObserveClient) -> Generator[str, None, None]:
    """A service of its own, so listing and deleting touch only this test's maps."""
    name = unique_name("pytest_sourcemap_limits")
    yield name
    resp = client.delete("sourcemaps", params={"service": name, "env": ENV, "version": VERSION})
    assert resp.status_code == 200, f"cleanup {name}: {resp.status_code} {resp.text[:300]}"
    assert _listed(client, name) == [], f"cleanup left maps of {name}"


def _map(name: str, size: int) -> bytes:
    """A valid source map padded to `size` bytes through its `sourcesContent`."""
    head = json.dumps({"version": 3, "file": name, "sources": [f"{name}.ts"], "names": [], "mappings": "AAAA"})
    prefix = head[:-1] + ', "sourcesContent": ["'
    suffix = '"]}'
    return (prefix + "a" * (size - len(prefix) - len(suffix)) + suffix).encode()


def _zip(entries: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, body in entries.items():
            zf.writestr(name, body)
    return buf.getvalue()


def _upload(client: OpenObserveClient, service: str, data: bytes):
    return client.post(
        "sourcemaps",
        files={"file": ("maps.zip", data, "application/zip")},
        data={"service": service, "env": ENV, "version": VERSION},
        timeout=120,
    )


def _listed(client: OpenObserveClient, service: str) -> list[dict]:
    resp = client.get("sourcemaps", params={"service": service, "env": ENV, "version": VERSION})
    assert resp.status_code == 200, f"list {service}: {resp.status_code} {resp.text[:300]}"
    return resp.json()


def _assert_stored(resp, client: OpenObserveClient, service: str, names: list[str]) -> None:
    assert resp.status_code == 201, f"#16477: {resp.status_code} {resp.text[:300]}"
    assert resp.json()["message"] == "successfully stored sourcemaps", resp.text[:300]
    assert sorted(m["source_map_file_name"] for m in _listed(client, service)) == sorted(names), "#16477"


def _assert_refused(resp, client: OpenObserveClient, service: str, message: str) -> None:
    assert resp.status_code == 400, f"#16477: {resp.status_code} {resp.text[:300]}"
    assert resp.json()["message"] == message, f"#16477: {resp.text[:300]}"
    assert _listed(client, service) == [], "#16477 a refused upload left maps behind"


def test_maps_past_the_old_size_limits_are_stored(client: OpenObserveClient, service: str):
    # 4 x 30 MB: each map is over the old 5 MB cap and together they are over the old 100 MB cap.
    names = [f"big{i}.js.map" for i in range(4)]
    resp = _upload(client, service, _zip({name: _map(name, 30 * MB) for name in names}))
    _assert_stored(resp, client, service, names)


def test_maps_past_the_old_count_limit_are_stored(client: OpenObserveClient, service: str):
    names = [f"f{i}.js.map" for i in range(1001)]
    resp = _upload(client, service, _zip({name: _map(name, 200) for name in names}))
    _assert_stored(resp, client, service, names)


def test_a_map_over_the_new_size_limit_is_refused(client: OpenObserveClient, service: str):
    resp = _upload(client, service, _zip({"huge.js.map": _map("huge.js.map", 51 * MB)}))
    message = "file huge.js.map in zip exceeds the maximum file size of 50 MB (ZO_SOURCEMAP_FILE_MAX_SIZE)"
    _assert_refused(resp, client, service, message)


def test_maps_over_the_new_count_limit_are_refused(client: OpenObserveClient, service: str):
    names = [f"f{i}.js.map" for i in range(5001)]
    resp = _upload(client, service, _zip({name: _map(name, 200) for name in names}))
    message = "zip contains 5001 sourcemap files, exceeding the maximum of 5000 (ZO_SOURCEMAP_ZIP_MAX_ENTRIES)"
    _assert_refused(resp, client, service, message)
