#!/usr/bin/env python3

import argparse
import base64
import json
import os
from pathlib import Path
import select
import subprocess
import tempfile
import time
import uuid


REQUESTS_PER_PHASE = 20
FIELDS = {
    "text": "custom_logo_text",
    "image": "custom_logo_img",
    "dark_image": "custom_logo_dark_img",
}
ABSENT = {
    "custom_logo_text": "default-brand",
    "custom_logo_img": None,
    "custom_logo_dark_img": None,
}


class Node:
    def __init__(self, binary, environment):
        self.errors = tempfile.TemporaryFile(mode="w+")
        self.process = subprocess.Popen(
            [str(binary), "--node"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.errors,
            text=True,
            bufsize=1,
            env=environment,
        )
        try:
            self.reply()
        except Exception:
            self.close()
            raise

    def reply(self):
        ready, _, _ = select.select([self.process.stdout], [], [], 30)
        if not ready:
            raise AssertionError("branding node did not reply within 30 seconds")
        line = self.process.stdout.readline()
        if not line:
            self.errors.seek(0)
            raise AssertionError(f"branding node exited: {self.errors.read()}")
        return json.loads(line)

    def command(self, action, **arguments):
        self.process.stdin.write(json.dumps({"action": action, **arguments}) + "\n")
        self.process.stdin.flush()
        return self.reply()

    def close(self):
        self.process.stdin.close()
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)
        self.process.stdout.close()
        self.errors.close()


def expected_branding(values):
    expected = dict(ABSENT)
    for field, value in values.items():
        expected[FIELDS[field]] = (
            value if field == "text" else base64.b64encode(value.encode()).decode()
        )
    return expected


def cold_read(node, expected, label):
    result = node.command("read")
    assert result["branding"] == expected, (label, result)
    assert result["metadata_reads"] == 3, (label, result)
    print(f"{label}: cold /config = 3 metadata SELECTs", flush=True)


def cached_reads(node, expected, label):
    for _ in range(REQUESTS_PER_PHASE):
        result = node.command("read")
        assert result["branding"] == expected, (label, result)
        assert result["metadata_reads"] == 0, (label, result)
    print(
        f"{label}: {REQUESTS_PER_PHASE} repeated /config requests = 0 metadata SELECTs",
        flush=True,
    )


def await_invalidation(node, expected, label):
    deadline = time.monotonic() + 5
    stable = 0
    first_match = None
    while time.monotonic() < deadline:
        result = node.command("read")
        if result["branding"] != expected:
            stable = 0
            first_match = None
            continue
        if first_match is None:
            first_match = result
        stable = stable + 1 if result["metadata_reads"] == 0 else 0
        if stable == REQUESTS_PER_PHASE:
            cached_reads(node, expected, label)
            return first_match
    raise AssertionError(f"{label}: coordinator invalidation did not reach the node")


def node_environment():
    environment = dict(os.environ)
    environment["O2_BRANDING_NATS_PREFIX"] = f"o2_branding_check_{uuid.uuid4().hex}_"
    for name in (
        "O2_BRANDING_PRIMARY_DSN",
        "O2_BRANDING_REPLICA_DSN",
        "O2_BRANDING_NATS_ADDR",
    ):
        if name not in environment:
            raise ValueError(f"set {name} to the isolated local test service")
    return environment


def exercise_cluster(binary, environment):
    writer = Node(binary, environment)
    reader = None
    try:
        reader = Node(binary, environment)
        writer.command("seed_replica")
        for name, node in (("writer", writer), ("reader", reader)):
            cold_read(node, ABSENT, f"{name} absent")
            cached_reads(node, ABSENT, f"{name} absent")
        for version in (1, 2):
            values = {
                "text": f"brand-v{version}",
                "image": f"light-v{version}",
                "dark_image": f"dark-v{version}",
            }
            for field, value in values.items():
                writer.command("set", field=field, value=value)
            expected = expected_branding(values)
            for name, node in (("writer", writer), ("reader", reader)):
                await_invalidation(node, expected, f"{name} v{version}")
        for field in FIELDS:
            writer.command("delete", field=field)
        for name, node in (("writer", writer), ("reader", reader)):
            await_invalidation(node, ABSENT, f"{name} deleted")
        for field in FIELDS:
            writer.command("legacy_set", field=field, value=f"legacy-{field}")
    finally:
        writer.close()
        if reader:
            reader.close()


def exercise_legacy_deletion(binary, environment):
    environment = dict(environment)
    environment["O2_BRANDING_NATS_PREFIX"] = f"o2_branding_check_{uuid.uuid4().hex}_"
    values = {field: f"legacy-{field}" for field in FIELDS}
    writer = Node(binary, environment)
    reader = None
    try:
        reader = Node(binary, environment)
        for name, node in (("writer", writer), ("reader", reader)):
            cold_read(node, expected_branding(values), f"{name} legacy")
            cached_reads(node, expected_branding(values), f"{name} legacy")
        for field in FIELDS:
            writer.command("delete", field=field)
            del values[field]
            for name, node in (("writer", writer), ("reader", reader)):
                result = await_invalidation(
                    node, expected_branding(values), f"{name} legacy delete {field}"
                )
                assert result["metadata_reads"] == 1, (field, name, result)
    finally:
        writer.close()
        if reader:
            reader.close()


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Verify /config SQL counts and branding invalidation between two independent "
            "processes. Requires fresh loopback PostgreSQL primary/replica databases and "
            "a local NATS JetStream server via O2_BRANDING_* environment variables."
        )
    )
    parser.add_argument("binary", type=Path, help="built config_branding_cache example")
    arguments = parser.parse_args()
    environment = node_environment()
    exercise_cluster(arguments.binary.resolve(), environment)
    exercise_legacy_deletion(arguments.binary.resolve(), environment)
    print("PASS: real NATS invalidation, cached absence, updates and legacy deletions")


if __name__ == "__main__":
    main()
