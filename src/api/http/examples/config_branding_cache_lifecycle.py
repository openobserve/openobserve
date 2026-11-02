#!/usr/bin/env python3

import argparse
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import json
from pathlib import Path
import socket
import threading
from urllib.parse import urlparse
import uuid

from config_branding_cache_cluster import (
    ABSENT,
    Node,
    await_invalidation,
    cached_reads,
    node_environment,
)


class NatsProxy:
    def __init__(self, address, observed_stream):
        target = urlparse(address)
        self.target = (target.hostname, target.port or 4222)
        self.server = socket.socket()
        self.server.bind(("127.0.0.1", 0))
        self.server.listen()
        self.server.settimeout(0.2)
        self.address = f"nats://127.0.0.1:{self.server.getsockname()[1]}"
        self.running = threading.Event()
        self.running.set()
        self.accepting = threading.Event()
        self.accepting.set()
        self.consumer_gate = threading.Event()
        self.consumer_gate.set()
        self.registration = threading.Condition()
        self.registrations = 0
        self.observed_stream = observed_stream.encode()
        self.connections = set()
        self.connection_lock = threading.Lock()
        self.thread = threading.Thread(target=self.serve, daemon=True)
        self.thread.start()

    def serve(self):
        while self.running.is_set():
            try:
                client, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            if not self.accepting.is_set():
                client.close()
                continue
            upstream = socket.create_connection(self.target, timeout=5)
            upstream.settimeout(None)
            with self.connection_lock:
                self.connections.update((client, upstream))
            threading.Thread(
                target=self.forward_client, args=(client, upstream), daemon=True
            ).start()
            threading.Thread(
                target=self.forward_server, args=(upstream, client), daemon=True
            ).start()

    def forward_client(self, source, target):
        try:
            with source.makefile("rb") as stream:
                while self.running.is_set():
                    header = stream.readline()
                    if not header:
                        return
                    fields = header.split()
                    frame = header
                    if fields[0] in (b"PUB", b"HPUB"):
                        frame += stream.read(int(fields[-1]) + 2)
                        subject = fields[1]
                        if (
                            b".CONSUMER." in subject
                            and b".CREATE." in subject
                            and self.observed_stream in subject
                        ):
                            with self.registration:
                                self.registrations += 1
                                self.registration.notify_all()
                            self.consumer_gate.wait()
                    target.sendall(frame)
        except OSError:
            return
        finally:
            self.close_connection(source, target)

    def forward_server(self, source, target):
        try:
            while self.running.is_set():
                data = source.recv(65536)
                if not data:
                    return
                target.sendall(data)
        except OSError:
            return
        finally:
            self.close_connection(source, target)

    def close_connection(self, *connections):
        for connection in connections:
            try:
                connection.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            connection.close()
            with self.connection_lock:
                self.connections.discard(connection)

    def wait_for_registration(self, count):
        with self.registration:
            assert self.registration.wait_for(
                lambda: self.registrations >= count, timeout=10
            ), "reader never requested actual broker consumer creation"

    def disconnect(self):
        self.accepting.clear()
        with self.connection_lock:
            connections = list(self.connections)
        self.close_connection(*connections)

    def close(self):
        self.running.clear()
        self.consumer_gate.set()
        self.disconnect()
        self.server.close()
        self.thread.join(timeout=2)


def nats_request(address, subject):
    target = urlparse(address)
    inbox = f"_INBOX.branding.{uuid.uuid4().hex}"
    with socket.create_connection((target.hostname, target.port or 4222), timeout=5) as client:
        with client.makefile("rb") as stream:
            assert stream.readline().startswith(b"INFO ")
            client.sendall(
                (
                    'CONNECT {"verbose":false}\r\n'
                    f"SUB {inbox} 1\r\n"
                    f"PUB {subject} {inbox} 2\r\n{{}}\r\n"
                ).encode()
            )
            while True:
                line = stream.readline()
                assert line, "NATS API connection closed without response"
                if line.startswith(b"PING"):
                    client.sendall(b"PONG\r\n")
                elif line.startswith(b"MSG "):
                    body = stream.read(int(line.split()[-1]) + 2)
                    result = json.loads(body)
                    assert "error" not in result, result
                    return result
                elif line.startswith(b"-ERR"):
                    raise AssertionError(line)


def startup(binary, environment):
    writer = Node(binary, environment)
    proxy = NatsProxy(environment["O2_BRANDING_NATS_ADDR"], notification_stream(environment))
    reader = None
    proxy.consumer_gate.clear()
    reader_environment = dict(environment, O2_BRANDING_NATS_ADDR=proxy.address)
    with ThreadPoolExecutor(max_workers=1) as executor:
        pending = None
        try:
            writer.command("seed_replica")
            writer.command("set", field="text", value="before-startup")
            pending = executor.submit(Node, binary, reader_environment)
            proxy.wait_for_registration(1)
            try:
                reader = pending.result(timeout=0.5)
            except TimeoutError:
                reader = None
            if reader:
                print("premature reader cached:", reader.command("read"), flush=True)
            writer.command("set", field="text", value="during-startup")
            assert reader is None, "reader enabled cache while broker consumer CREATE was held"
            proxy.consumer_gate.set()
            reader = pending.result(timeout=10)
            expected = dict(ABSENT, custom_logo_text="during-startup")
            await_invalidation(reader, expected, "delayed broker registration")
            print("PASS: remote update during delayed broker registration is not missed", flush=True)
        finally:
            proxy.consumer_gate.set()
            if reader is None and pending is not None:
                reader = pending.result(timeout=10)
            if reader:
                reader.close()
            writer.close()
            proxy.close()


def recovery(binary, environment):
    writer = Node(binary, environment)
    proxy = NatsProxy(environment["O2_BRANDING_NATS_ADDR"], notification_stream(environment))
    reader = None
    try:
        writer.command("seed_replica")
        writer.command("set", field="text", value="before-disconnect")
        reader = Node(binary, dict(environment, O2_BRANDING_NATS_ADDR=proxy.address))
        proxy.wait_for_registration(1)
        expected = dict(ABSENT, custom_logo_text="before-disconnect")
        await_invalidation(reader, expected, "reader before disconnect")
        proxy.disconnect()
        cached_reads(reader, expected, "reader disconnected")
        writer.command("set", field="text", value="notification-will-be-lost")
        stream = notification_stream(environment)
        assert stream in (
            environment["O2_BRANDING_NATS_PREFIX"] + "coordinator_events",
            "KV_" + environment["O2_BRANDING_NATS_PREFIX"] + "custom_logo_cache",
        )
        purged = nats_request(environment["O2_BRANDING_NATS_ADDR"], f"$JS.API.STREAM.PURGE.{stream}")
        assert purged["success"] and purged["purged"] > 0, purged
        print("reader notification purged while its real TCP connection is blocked:", stream, purged["purged"], flush=True)
        proxy.accepting.set()
        expected = dict(ABSENT, custom_logo_text="notification-will-be-lost")
        await_invalidation(reader, expected, "reader after lost-notification recovery")
        writer.command("set", field="text", value="after-recovery")
        expected = dict(ABSENT, custom_logo_text="after-recovery")
        await_invalidation(reader, expected, "reader first post-recovery mutation")
        print("PASS: actual connection recovery resets cache and keeps subsequent invalidations", flush=True)
    finally:
        if reader:
            reader.close()
        writer.close()
        proxy.close()


def notification_stream(environment):
    modules = environment.get("ZO_NATS_KV_WATCH_MODULES", "").split(",")
    if any("/custom_logo_cache/".startswith(prefix) for prefix in modules if prefix):
        return "KV_" + environment["O2_BRANDING_NATS_PREFIX"] + "custom_logo_cache"
    return environment["O2_BRANDING_NATS_PREFIX"] + "coordinator_events"


def main():
    parser = argparse.ArgumentParser(description="Verify actual NATS readiness and lost-notification recovery")
    parser.add_argument("binary", type=Path)
    parser.add_argument("--case", required=True, choices=("startup", "recovery"))
    arguments = parser.parse_args()
    environment = node_environment()
    if arguments.case == "startup":
        startup(arguments.binary.resolve(), environment)
    else:
        recovery(arguments.binary.resolve(), environment)


if __name__ == "__main__":
    main()
