"""A meta row with non-UTF-8 key2 must not stop a SQLite single node from starting (#14917); spawns its own server."""
from __future__ import annotations

import os
import shutil
import socket
import sqlite3
import subprocess
import time
from pathlib import Path

import pytest
import requests

REPO_ROOT = Path(__file__).resolve().parents[4]
BINARY = Path(os.environ.get("O2_BINARY", REPO_ROOT / "target" / "debug" / "openobserve"))
# "metadata/" followed by a lone 0x80 byte: invalid UTF-8 at index 9, as in the report.
INVALID_KEY2 = bytes.fromhex("6d657461646174612f80")
STARTUP_TIMEOUT = 120

pytestmark = pytest.mark.skipif(not BINARY.exists(), reason=f"openobserve binary not found at {BINARY}")


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _Server:
    def __init__(self, data_dir: Path, log_path: Path):
        self.http_port, self.grpc_port = _free_port(), _free_port()
        self.base = f"http://127.0.0.1:{self.http_port}"
        self.auth = (os.environ["ZO_ROOT_USER_EMAIL"], os.environ["ZO_ROOT_USER_PASSWORD"])
        self.data_dir, self.log_path = data_dir, log_path
        self.proc: subprocess.Popen | None = None

    def start(self) -> None:
        env = {k: v for k, v in os.environ.items() if not k.startswith("ZO_")}
        env.update({
            "ZO_ROOT_USER_EMAIL": self.auth[0],
            "ZO_ROOT_USER_PASSWORD": self.auth[1],
            "ZO_EXT_AUTH_SALT": "test-only-ext-auth-salt-0123456789",
            "ZO_HTTP_PORT": str(self.http_port),
            "ZO_GRPC_PORT": str(self.grpc_port),
            "ZO_DATA_DIR": str(self.data_dir),
            "ZO_TELEMETRY": "false",
        })
        log = open(self.log_path, "ab")
        # cwd is the data dir so a repo-root .env is never picked up.
        self.proc = subprocess.Popen([str(BINARY)], cwd=self.data_dir, env=env, stdout=log, stderr=subprocess.STDOUT)

    def wait_healthy(self) -> bool:
        deadline = time.time() + STARTUP_TIMEOUT
        while time.time() < deadline:
            if self.proc.poll() is not None:
                return False
            try:
                if requests.get(f"{self.base}/healthz", timeout=2).status_code == 200:
                    return True
            except requests.RequestException:
                pass
            time.sleep(1)
        return False

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()

    def log_text(self) -> str:
        return self.log_path.read_text(errors="replace")


@pytest.fixture
def server(tmp_path):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    srv = _Server(data_dir, tmp_path / "openobserve.log")
    yield srv
    srv.stop()
    shutil.rmtree(data_dir, ignore_errors=True)


def _plant_invalid_schema_row(db_path: Path) -> int:
    con = sqlite3.connect(db_path)
    try:
        cur = con.execute(
            "INSERT INTO meta (module, key1, key2, start_dt, value) "
            "SELECT 'schema', key1, CAST(? AS TEXT), 1, value FROM meta WHERE module = 'schema' LIMIT 1",
            (INVALID_KEY2,),
        )
        con.commit()
        assert cur.rowcount == 1, "precondition: a schema row must exist to copy"
        return cur.lastrowid
    finally:
        con.close()


def test_server_starts_and_skips_the_undecodable_row(server):
    server.start()
    assert server.wait_healthy(), f"precondition: clean start failed\n{server.log_text()[-3000:]}"
    resp = requests.post(f"{server.base}/api/default/utf8_guard/_json", json=[{"msg": "healthy"}], auth=server.auth, timeout=30)
    assert resp.status_code == 200, resp.text
    server.stop()

    bad_id = _plant_invalid_schema_row(server.data_dir / "db" / "metadata.sqlite")

    server.start()
    healthy = server.wait_healthy()
    log = server.log_text()
    assert "stream cache failed" not in log, "Bug #14917: startup panicked on an undecodable meta row"
    assert healthy, f"server did not come back up\n{log[-3000:]}"
    assert "invalid UTF-8" in log, "the skipped row must be logged"
    assert f"id: {bad_id}" in log, "the skipped row's id must be logged so an operator can delete it"

    streams = requests.get(f"{server.base}/api/default/streams?type=logs", auth=server.auth, timeout=30).json()
    assert "utf8_guard" in [s["name"] for s in streams.get("list", [])], streams
