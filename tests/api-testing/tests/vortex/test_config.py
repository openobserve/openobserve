"""Vortex server configuration tests (Section 8, scenarios 66–67).

Scenarios 68–70 require direct filesystem and startup-flag inspection
which is not possible via the HTTP API — those scenarios live in the
enterprise repo as integration tests.

Enterprise CI only — do not add to OSS api-testing.yml.

Test plan coverage: scenarios 66–67 (Section 8 — Server Configuration).
"""
from __future__ import annotations

import os
import time
import logging
import subprocess
from datetime import datetime, timezone, timedelta

import pytest

from support.factories import search_payload
from .conftest import SESSION_ID, count_records, flush_and_wait, ingest

_BASE = f"vcfg_{SESSION_ID}"


def _stream(suffix: str) -> str:
    return f"{_BASE}_{suffix}"


def _ts(offset_us: int = 0) -> int:
    return int(time.time() * 1_000_000) + offset_us


# ─── Scenario 66: Search endpoint reachable ───────────────────────────────────

class TestServerConfig:
    """Scenario 66: search endpoint responds correctly with vortex format active."""

    STREAM = _stream("probe")

    def test_66_search_endpoint_reachable(self, client):
        """Ingest one record and verify it's immediately searchable via memtable."""
        record = {"_timestamp": _ts(), "host": "probe-host", "probe": "vortex_config_66"}
        ingest(client, self.STREAM, [record])

        # Poll the memtable — no flush needed; data should appear within seconds
        now = datetime.now(timezone.utc)
        payload = search_payload(
            f'SELECT COUNT(*) AS c FROM "{self.STREAM}" WHERE probe=\'vortex_config_66\'',
            start_time=int((now - timedelta(hours=1)).timestamp() * 1_000_000),
            end_time=int((now + timedelta(hours=1)).timestamp() * 1_000_000),
            size=1,
        )

        def _visible():
            r = client.post("_search?type=logs", json=payload)
            if r.status_code != 200:
                return False
            hits = r.json().get("hits", [])
            return bool(hits and int(hits[0].get("c", 0)) >= 1)

        from support.wait import wait_until
        wait_until(_visible, timeout=30, interval=1.0,
                   msg="probe record not visible in memtable")

        logging.info("scenario-66: search endpoint reachable and vortex memtable visible")


# ─── Scenario 67: Invalid format flag ────────────────────────────────────────

class TestInvalidFormatFlag:
    """Scenario 67: server launched with ZO_FILE_FORMAT=invalid exits with error.

    This test requires direct binary access — set ZO_BINARY_PATH env var to
    the path of the openobserve binary. Without it, the test is skipped.

    Enterprise CI should set ZO_BINARY_PATH to the freshly-built binary.
    """

    def test_67_invalid_format_exits_with_error(self):
        binary = os.environ.get("ZO_BINARY_PATH")
        if not binary:
            pytest.skip(
                "ZO_BINARY_PATH not set — cannot test binary startup flags. "
                "Set this in enterprise CI to the path of the openobserve binary."
            )

        if not os.path.isfile(binary):
            pytest.skip(f"ZO_BINARY_PATH={binary!r} does not exist")

        import tempfile
        with tempfile.TemporaryDirectory() as tmpdir:
            env = {
                **os.environ,
                "ZO_FILE_FORMAT": "invalid_format_xyz",
                # Provide required env vars so the binary fails on format
                # validation, not on missing configuration.
                "ZO_DATA_DIR": tmpdir,
                "ZO_ROOT_USER_EMAIL": os.environ.get("ZO_ROOT_USER_EMAIL", "root@example.com"),
                "ZO_ROOT_USER_PASSWORD": os.environ.get("ZO_ROOT_USER_PASSWORD", "Complexpass#123"),
            }
            result = subprocess.run(
                [binary, "--check-config"],
                env=env,
                capture_output=True,
                text=True,
                timeout=15,
            )
        assert result.returncode != 0, (
            "server should exit non-zero with invalid ZO_FILE_FORMAT, "
            f"but got returncode={result.returncode}"
        )
        output = result.stdout + result.stderr
        assert any(kw in output.lower() for kw in ("invalid", "error", "unknown", "format")), (
            f"expected error message about invalid format, got: {output[:300]}"
        )
        logging.info("scenario-67: invalid format flag correctly rejected")
