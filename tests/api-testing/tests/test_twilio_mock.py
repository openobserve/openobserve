"""The Twilio fake's own contract (M-01 to M-24), so a fake bug never passes for an O2 result."""
from __future__ import annotations

import hashlib
import json
import select
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Generator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlsplit
from xml.sax.saxutils import escape, quoteattr

import pytest
import requests

from helpers.twilio_mock import TwilioMock, TwilioMockError, make_server

CALLBACK = "o2-telephony.test"
ACK_PATH = "/api/v2/org1/oncall/ack/voice/tok1"
ACKED = "<Response><Say>Acknowledged.</Say><Hangup/></Response>"
MOCK_SCRIPT = Path(__file__).parent.parent / "helpers" / "twilio_mock.py"
RECORD_KEYS = {
    "seq", "at", "kind", "method", "path", "sid", "auth_ok", "to", "from", "body", "twiml", "url", "segments",
    "encoding", "twiml_parsed", "twiml_error", "response_status", "rule_id", "client_gone", "accepted",
}
HTTP = requests.Session()
HTTP.trust_env = False


@dataclass
class Account:
    sid: str
    token: str
    number: str

    @property
    def auth(self) -> tuple[str, str]:
        return (self.sid, self.token)


@dataclass
class O2Stub:
    url: str = ""
    seen: list[dict[str, Any]] = field(default_factory=list)
    answers: dict[str, tuple[int, str, str, dict[str, str]]] = field(default_factory=dict)


def serve(server: ThreadingHTTPServer) -> None:
    threading.Thread(target=server.serve_forever, daemon=True).start()


@pytest.fixture(scope="session", autouse=True)
def ingest_data() -> None:
    # Overrides the root autouse seed ingest, since this contract must hold with no O2 server running.
    return None


@pytest.fixture(scope="module")
def o2_stub() -> Generator[O2Stub, None, None]:
    stub = O2Stub()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args: Any) -> None:
            return

        def do_POST(self) -> None:  # noqa: N802
            raw = self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode()
            stub.seen.append({"path": self.path, "headers": dict(self.headers), "form": parse_qs(raw)})
            status, content_type, body, headers = stub.answers.get(
                urlsplit(self.path).path, (200, "text/xml", ACKED, {}),
            )
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body.encode())))
            for key, value in headers.items():
                self.send_header(key, value)
            self.end_headers()
            self.wfile.write(body.encode())

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    stub.url = f"http://127.0.0.1:{server.server_address[1]}"
    serve(server)
    yield stub
    server.shutdown()


@pytest.fixture(scope="module")
def mock_server(o2_stub: O2Stub) -> Generator[ThreadingHTTPServer, None, None]:
    server = make_server(0, o2_stub.url, CALLBACK)
    serve(server)
    yield server
    server.shutdown()


@pytest.fixture(scope="module")
def api(mock_server: ThreadingHTTPServer) -> str:
    return f"http://127.0.0.1:{mock_server.server_address[1]}"


def phone() -> str:
    return f"+999{uuid.uuid4().int % 10**11:011d}"


def new_account(api: str, **fields: Any) -> Account:
    account = Account("AC" + uuid.uuid4().hex, "o2tok-canary-" + uuid.uuid4().hex, phone())
    numbers = fields.pop("numbers", [{"number": account.number, "sms": True, "voice": True}])
    body = {"sid": account.sid, "token": account.token, "numbers": numbers, **fields}
    resp = HTTP.post(f"{api}/_mock/accounts", json=body, timeout=5)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"sid": account.sid}
    return account


def twilio_url(api: str, account: Account, suffix: str) -> str:
    return f"{api}/2010-04-01/Accounts/{account.sid}{suffix}"


def send_sms(api: str, account: Account, to: str, body: str = "hello", *, session: requests.Session = HTTP,
             auth: tuple[str, str] | None = None, timeout: float = 5) -> requests.Response:
    form = {"To": to, "From": account.number, "Body": body}
    return session.post(twilio_url(api, account, "/Messages.json"), data=form, auth=auth or account.auth, timeout=timeout)


def place_call(api: str, account: Account, to: str, twiml: str = "<Response><Say>Hi.</Say><Hangup/></Response>",
               **extra: str) -> requests.Response:
    form = {"To": to, "From": account.number, "Twiml": twiml, **extra}
    return HTTP.post(twilio_url(api, account, "/Calls.json"), data=form, auth=account.auth, timeout=5)


def listen_twiml(action: str = f"https://{CALLBACK}{ACK_PATH}") -> str:
    return (
        f'<Response><Gather numDigits="1" finishOnKey="" action={quoteattr(action)} method="POST">'
        "<Say>Disk &amp; full</Say><Say>Press 4.</Say><Say>Press 4.</Say></Gather>"
        "<Say>No key.</Say><Hangup/></Response>"
    )


def add_rule(api: str, **rule: Any) -> str:
    resp = HTTP.post(f"{api}/_mock/fail", json=rule, timeout=5)
    assert resp.status_code == 200, resp.text
    return resp.json()["rule_id"]


def records(api: str, **query: Any) -> list[dict[str, Any]]:
    resp = HTTP.get(f"{api}/_mock/requests", params=query, timeout=5)
    assert resp.status_code == 200, resp.text
    return resp.json()["requests"]


def press(api: str, **body: Any) -> requests.Response:
    return HTTP.post(f"{api}/_mock/press", json=body, timeout=20)


def assert_twilio_error(resp: requests.Response, status: int, code: int) -> None:
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert body["code"] == code
    assert body["status"] == status
    assert isinstance(body["message"], str)
    assert body["more_info"] == f"https://www.twilio.com/docs/errors/{code}"


def test_m01_unknown_sid_and_wrong_token_get_401_and_auth_ok_false(api: str) -> None:
    good = new_account(api)
    other = new_account(api)
    to = phone()
    unknown = Account("AC" + uuid.uuid4().hex, "x", good.number)
    refused = [
        send_sms(api, unknown, to),
        send_sms(api, good, to, auth=(good.sid, "wrong-token")),
        send_sms(api, good, to, auth=(other.sid, other.token)),
        HTTP.post(twilio_url(api, good, "/Messages.json"), data={"To": to, "From": good.number, "Body": "x"}, timeout=5),
        place_call(api, Account(good.sid, "wrong-token", good.number), to),
        HTTP.get(twilio_url(api, good, ".json"), auth=(good.sid, "wrong-token"), timeout=5),
        HTTP.get(twilio_url(api, good, "/IncomingPhoneNumbers.json"), auth=(good.sid, "wrong-token"), timeout=5),
    ]
    for resp in refused:
        assert_twilio_error(resp, 401, 20003)
        assert resp.headers["WWW-Authenticate"] == 'Basic realm="Twilio API"'
    seen = records(api, sid=good.sid)
    assert len(seen) == 6
    assert all(r["auth_ok"] is False and r["response_status"] == 401 for r in seen)
    assert records(api, sid=unknown.sid)[0]["auth_ok"] is False
    assert send_sms(api, good, to).status_code == 201
    assert records(api, sid=good.sid)[-1]["auth_ok"] is True


def test_m02_sms_answers_201_with_twilio_shape_and_records_by_to_and_sid(api: str) -> None:
    account = new_account(api)
    to = phone()
    resp = send_sms(api, account, to, "Disk & full")
    assert resp.status_code == 201
    assert resp.headers["Content-Type"].startswith("application/json")
    body = resp.json()
    assert body["sid"].startswith("SM")
    assert len(body["sid"]) == 34
    assert body["status"] == "queued"
    assert (body["to"], body["from"], body["body"]) == (to, account.number, "Disk & full")
    assert body["account_sid"] == account.sid
    assert body["direction"] == "outbound-api"
    assert body["num_segments"] == "1"
    assert body["uri"] == f"/2010-04-01/Accounts/{account.sid}/Messages/{body['sid']}.json"
    by_to = records(api, to=to)
    assert by_to == records(api, sid=account.sid)
    assert len(by_to) == 1
    record = by_to[0]
    assert RECORD_KEYS <= record.keys()
    assert (record["kind"], record["method"], record["sid"]) == ("sms", "POST", account.sid)
    assert (record["to"], record["from"], record["body"]) == (to, account.number, "Disk & full")
    assert (record["response_status"], record["auth_ok"], record["resource_sid"]) == (201, True, body["sid"])
    assert record["accepted"] is True
    call = place_call(api, account, to)
    assert call.status_code == 201
    assert call.json()["sid"].startswith("CA")
    assert len(call.json()["sid"]) == 34
    assert call.json()["status"] == "queued"
    assert (call.json()["to"], call.json()["from"]) == (to, account.number)


def test_m03_missing_or_conflicting_params_are_refused(api: str) -> None:
    account = new_account(api)
    to = phone()
    sms_url = twilio_url(api, account, "/Messages.json")
    call_url = twilio_url(api, account, "/Calls.json")
    ok_twiml = "<Response><Hangup/></Response>"
    sms_cases = [
        ({"From": account.number, "Body": "x"}, 21604),
        ({"To": to, "Body": "x"}, 21603),
        ({"To": to, "From": account.number}, 21602),
        ({"To": "not-a-number", "From": account.number, "Body": "x"}, 21211),
        ({"To": to, "From": account.number, "Body": "x" * 1601}, 21617),
    ]
    for form, code in sms_cases:
        assert_twilio_error(HTTP.post(sms_url, data=form, auth=account.auth, timeout=5), 400, code)
    call_cases = [
        ({"From": account.number, "Twiml": ok_twiml}, 21201),
        ({"To": to, "Twiml": ok_twiml}, 21213),
        ({"To": "14155550100", "From": account.number, "Twiml": ok_twiml}, 21211),
        ({"To": to, "From": account.number}, 21205),
        ({"To": to, "From": account.number, "Twiml": ok_twiml, "Url": "https://o2.test/x"}, 21205),
        ({"To": to, "From": account.number, "Twiml": ok_twiml + " " * 4001}, 32018),
    ]
    for form, code in call_cases:
        assert_twilio_error(HTTP.post(call_url, data=form, auth=account.auth, timeout=5), 400, code)
    as_json = HTTP.post(sms_url, json={"To": to, "From": account.number, "Body": "x"}, auth=account.auth, timeout=5)
    assert_twilio_error(as_json, 400, 21604)
    assert send_sms(api, account, to, "x" * 1600).status_code == 201
    exactly_4000 = ok_twiml + " " * (4000 - len(ok_twiml))
    assert place_call(api, account, to, exactly_4000).status_code == 201


def test_m04_a_from_not_usable_on_the_account_is_refused(api: str) -> None:
    account = new_account(api)
    stranger = new_account(api)
    to = phone()
    for sender in (phone(), stranger.number):
        hijack = Account(account.sid, account.token, sender)
        assert_twilio_error(send_sms(api, hijack, to), 400, 21606)
        assert_twilio_error(place_call(api, hijack, to), 400, 21210)
    voice_only = phone()
    sms_only = phone()
    limited = new_account(api, numbers=[
        {"number": voice_only, "sms": False, "voice": True},
        {"number": sms_only, "sms": True, "voice": False},
    ])
    assert_twilio_error(send_sms(api, Account(limited.sid, limited.token, voice_only), to), 400, 21606)
    assert_twilio_error(place_call(api, Account(limited.sid, limited.token, sms_only), to), 400, 21210)
    assert send_sms(api, Account(limited.sid, limited.token, sms_only), to).status_code == 201
    assert place_call(api, Account(limited.sid, limited.token, voice_only), to).status_code == 201
    closed = new_account(api, status="closed")
    assert_twilio_error(send_sms(api, closed, to), 401, 20003)
    assert_twilio_error(place_call(api, closed, to), 401, 20003)


def test_m05_account_and_number_lookups_answer_like_twilio(api: str) -> None:
    for status, kind in (("active", "Full"), ("active", "Trial"), ("suspended", "Full"), ("closed", "Full")):
        account = new_account(api, status=status, type=kind)
        resp = HTTP.get(twilio_url(api, account, ".json"), auth=account.auth, timeout=5)
        assert resp.status_code == 200
        body = resp.json()
        assert (body["sid"], body["status"], body["type"]) == (account.sid, status, kind)
        assert body["uri"] == f"/2010-04-01/Accounts/{account.sid}.json"
        assert records(api, sid=account.sid, kind="account")[0]["auth_ok"] is True
    exact = phone()
    longer = exact + "9"
    no_sms = phone()
    account = new_account(api, numbers=[
        {"number": exact, "sms": True, "voice": True},
        {"number": longer, "sms": True, "voice": True},
        {"number": no_sms, "sms": False, "voice": True},
    ])
    numbers_url = twilio_url(api, account, "/IncomingPhoneNumbers.json")

    def lookup(raw_query: str) -> list[dict[str, Any]]:
        resp = HTTP.get(f"{numbers_url}?{raw_query}", auth=account.auth, timeout=5)
        assert resp.status_code == 200
        return resp.json()["incoming_phone_numbers"]

    encoded = "PhoneNumber=%2B" + exact[1:]
    assert [n["phone_number"] for n in lookup(encoded)] == [exact, longer]
    assert lookup("PhoneNumber=%2B" + no_sms[1:])[0]["capabilities"] == {"voice": True, "sms": False, "mms": False, "fax": False}
    assert lookup("PhoneNumber=%2B" + phone()[1:]) == []
    assert lookup("PhoneNumber=" + exact) == []
    assert len(lookup("PhoneNumber=" + exact[4:])) == 2
    assert [n["phone_number"] for n in lookup("PhoneNumber=%2B" + exact[1:-1] + "*")] == [exact, longer]
    envelope = HTTP.get(f"{numbers_url}?{encoded}", auth=account.auth, timeout=5).json()
    assert {"page", "page_size", "start", "end", "uri", "first_page_uri", "next_page_uri", "previous_page_uri"} <= envelope.keys()
    assert records(api, sid=account.sid, kind="numbers")[0]["query"] == {"PhoneNumber": exact}


def test_m06_a_rule_on_one_to_leaves_another_to_alone_under_two_threads(api: str) -> None:
    account = new_account(api)
    bystander = new_account(api)
    failing, healthy = phone(), phone()
    add_rule(api, to=failing, status=500)
    barrier = threading.Barrier(2)

    def burst(to: str) -> list[int]:
        session = requests.Session()
        session.trust_env = False
        barrier.wait(timeout=5)
        return [send_sms(api, account, to, session=session).status_code for _ in range(20)]

    with ThreadPoolExecutor(2) as pool:
        failed, sent = pool.submit(burst, failing), pool.submit(burst, healthy)
        assert failed.result() == [500] * 20
        assert sent.result() == [201] * 20
    assert len(records(api, to=failing)) == 20
    assert len(records(api, to=healthy)) == 20
    add_rule(api, sid=account.sid, status=503)
    assert send_sms(api, account, phone()).status_code == 503
    assert send_sms(api, bystander, phone()).status_code == 201
    assert HTTP.get(twilio_url(api, bystander, ".json"), auth=bystander.auth, timeout=5).status_code == 200


def test_m07_times_runs_out_and_delete_removes_the_rule(api: str) -> None:
    account = new_account(api)
    to = phone()
    spent = add_rule(api, to=to, status=500, times=2)
    assert [send_sms(api, account, to).status_code for _ in range(3)] == [500, 500, 201]
    assert HTTP.delete(f"{api}/_mock/fail/{spent}", timeout=5).status_code == 404
    rule = add_rule(api, to=to, status=500)
    assert send_sms(api, account, to).status_code == 500
    removed = HTTP.delete(f"{api}/_mock/fail/{rule}", timeout=5)
    assert removed.status_code == 200
    assert removed.json() == {"removed": True}
    assert send_sms(api, account, to).status_code == 201
    assert HTTP.delete(f"{api}/_mock/fail/{rule}", timeout=5).status_code == 404
    older = add_rule(api, to=to, status=500)
    newer = add_rule(api, to=to, status=503, times=1)
    assert [send_sms(api, account, to).status_code for _ in range(2)] == [503, 500]
    assert records(api, to=to)[-2]["rule_id"] == newer
    assert records(api, to=to)[-1]["rule_id"] == older


def test_m08_no_reset_route_and_shared_account_rules_are_guarded(api: str, o2_stub: O2Stub) -> None:
    for method in ("GET", "POST", "DELETE"):
        assert HTTP.request(method, f"{api}/_mock/reset", timeout=5).status_code == 404
    refused = HTTP.post(f"{api}/_mock/fail", json={"status": 500}, timeout=5)
    assert refused.status_code == 400
    assert refused.json()["error"] == "target_required"
    org = "AC" + uuid.uuid4().hex
    shared = "AC" + uuid.uuid4().hex
    server = make_server(0, o2_stub.url, deployment_account=(shared, "ci-deployment-fixture", phone()))
    serve(server)
    guarded = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        to = phone()
        poison = [
            {"sid": shared, "status": 500},
            {"sid": shared, "to": to, "status": 500},
            {"to": to, "status": 500},
            {"to": to, "status": 401},
            {"to": to, "status": 403},
            {"to": to, "status": 429},
            {"to": to, "status": 302},
            {"to": to, "status": 200, "body": {"status": "suspended"}},
            {"to": to, "status": 201, "raw_body": '{"status":"closed"}'},
            {"to": to, "delay_ms": 6000},
            {"sid": shared, "status": 400, "code": 21610},
        ]
        for rule in poison:
            resp = HTTP.post(f"{guarded}/_mock/fail", json=rule, timeout=5)
            assert resp.status_code == 409, rule
            assert resp.json()["error"] == "would_poison_shared_breaker"
        allowed = [
            {"to": to, "status": 400, "code": 21610},
            {"to": to, "status": 403, "code": 21215},
            {"sid": shared, "to": to, "status": 400, "code": 21608},
            {"to": to, "delay_ms": 100},
            {"sid": org, "status": 500},
        ]
        for rule in allowed:
            assert HTTP.post(f"{guarded}/_mock/fail", json=rule, timeout=5).status_code == 200, rule
    finally:
        server.shutdown()


def test_m09_rules_answer_with_status_code_body_and_raw_body(api: str) -> None:
    account = new_account(api)
    to = phone()
    add_rule(api, to=to, status=400, code=21610, message="Unsubscribed", times=1)
    resp = send_sms(api, account, to)
    assert_twilio_error(resp, 400, 21610)
    assert resp.json()["message"] == "Unsubscribed"
    add_rule(api, to=to, status=500, times=1)
    bare = send_sms(api, account, to)
    assert bare.status_code == 500
    assert "code" not in bare.json()
    add_rule(api, to=to, status=201, body={"sid": "SMx", "status": "suspended"}, times=1)
    closed = send_sms(api, account, to)
    assert (closed.status_code, closed.json()) == (201, {"sid": "SMx", "status": "suspended"})
    add_rule(api, to=to, status=201, raw_body="not json", times=1)
    raw = send_sms(api, account, to)
    assert (raw.status_code, raw.text) == (201, "not json")
    add_rule(api, to=to, status=302, raw_body="", times=1)
    moved = HTTP.post(twilio_url(api, account, "/Messages.json"), allow_redirects=False, auth=account.auth, timeout=5,
                      data={"To": to, "From": account.number, "Body": "x"})
    assert (moved.status_code, moved.text) == (302, "")
    add_rule(api, to=to, kind="call", status=503, times=1)
    assert send_sms(api, account, to).status_code == 201
    assert place_call(api, account, to).status_code == 503
    add_rule(api, sid=account.sid, kind="account", status=403, code=20003, times=1)
    denied = HTTP.get(twilio_url(api, account, ".json"), auth=account.auth, timeout=5)
    assert_twilio_error(denied, 403, 20003)
    add_rule(api, sid=account.sid, kind="numbers", status=200, raw_body="garbage", times=1)
    garbled = HTTP.get(twilio_url(api, account, "/IncomingPhoneNumbers.json"), auth=account.auth, timeout=5)
    assert (garbled.status_code, garbled.text) == (200, "garbage")
    assert HTTP.post(f"{api}/_mock/fail", json={"to": to, "kind": "account", "status": 500}, timeout=5).status_code == 400
    assert HTTP.post(f"{api}/_mock/fail", json={"to": to, "code": 21610}, timeout=5).status_code == 400
    assert records(api, to=to)[0]["rule_id"] is not None


def test_m10_a_client_timeout_is_recorded_as_client_gone(api: str) -> None:
    account = new_account(api)
    to = phone()
    add_rule(api, to=to, delay_ms=4000, status=500)
    with pytest.raises(requests.exceptions.Timeout):
        send_sms(api, account, to, timeout=0.3)
    deadline = time.monotonic() + 3
    while not records(api, to=to)[0]["client_gone"] and time.monotonic() < deadline:
        time.sleep(0.05)
    record = records(api, to=to)[0]
    assert record["client_gone"] is True
    assert record["response_status"] is None
    patient = phone()
    add_rule(api, to=patient, delay_ms=200, status=500)
    assert send_sms(api, account, patient).status_code == 500
    stayed = records(api, to=patient)[0]
    assert (stayed["client_gone"], stayed["response_status"]) == (False, 500)
    slow_ok = phone()
    add_rule(api, to=slow_ok, delay_ms=100)
    assert send_sms(api, account, slow_ok).status_code == 201


def test_m11_reads_need_a_target_and_filters_and_since_seq_work(api: str) -> None:
    resp = HTTP.get(f"{api}/_mock/requests", timeout=5)
    assert resp.status_code == 400
    assert resp.json()["error"] == "target_required"
    assert HTTP.get(f"{api}/_mock/requests", params={"kind": "sms"}, timeout=5).status_code == 400
    one, two = new_account(api), new_account(api)
    to_a, to_b = phone(), phone()
    send_sms(api, one, to_a)
    place_call(api, one, to_a)
    send_sms(api, one, to_b)
    send_sms(api, two, to_a)
    assert [r["kind"] for r in records(api, to=to_a)] == ["sms", "call", "sms"]
    assert [r["kind"] for r in records(api, to=to_a, kind="call")] == ["call"]
    assert [r["to"] for r in records(api, sid=one.sid)] == [to_a, to_a, to_b]
    assert [r["sid"] for r in records(api, to=to_a, sid=two.sid)] == [two.sid]
    seqs = [r["seq"] for r in records(api, to=to_a)]
    assert seqs == sorted(set(seqs))
    assert [r["seq"] for r in records(api, to=to_a, since_seq=seqs[0])] == seqs[1:]
    assert records(api, to=to_a, since_seq=seqs[-1]) == []
    assert records(api, to=phone()) == []
    assert records(api, sid="AC" + uuid.uuid4().hex) == []


def test_m12_last_code_needs_the_exact_sentence_and_is_newest_per_to(api: str) -> None:
    account = new_account(api)
    to, other = phone(), phone()
    sentence = "Your OpenObserve verification code is {}. It expires in 10 minutes."

    def code_status(number: str) -> int:
        return HTTP.get(f"{api}/_mock/last_code", params={"to": number}, timeout=5).status_code

    assert code_status(to) == 404
    drifted = [
        "Your OpenObserve code is 123456. It expires in 10 minutes.",
        sentence.format("12345"),
        sentence.format("1234567"),
        sentence.format("123456") + " ",
        "Hi. " + sentence.format("123456"),
        "your openobserve verification code is 123456. it expires in 10 minutes.",
    ]
    for body in drifted:
        assert send_sms(api, account, to, body).status_code == 201
        assert code_status(to) == 404, body
    send_sms(api, account, to, sentence.format("111111"))
    send_sms(api, account, to, sentence.format("222222"))
    send_sms(api, account, other, sentence.format("333333"))
    answer = HTTP.get(f"{api}/_mock/last_code", params={"to": to}, timeout=5).json()
    assert answer["code"] == "222222"
    assert answer["sid"] == account.sid
    assert answer["seq"] == records(api, to=to)[-1]["seq"]
    assert HTTP.get(f"{api}/_mock/last_code", params={"to": other}, timeout=5).json()["code"] == "333333"
    assert HTTP.get(f"{api}/_mock/last_code", timeout=5).status_code == 400
    refused = phone()
    add_rule(api, to=refused, status=500, times=1)
    send_sms(api, account, refused, sentence.format("444444"))
    assert code_status(refused) == 404
    replaced = phone()
    add_rule(api, to=replaced, status=201, raw_body="{}", times=1)
    send_sms(api, account, replaced, sentence.format("555555"))
    assert code_status(replaced) == 404


def test_m13_twiml_is_parsed_strictly_and_kept_raw(api: str) -> None:
    account = new_account(api)
    to = phone()
    action = f"https://{CALLBACK}{ACK_PATH}?x=1&y=\"2\""
    twiml = listen_twiml(action)
    assert place_call(api, account, to, twiml).status_code == 201
    record = records(api, to=to, kind="call")[0]
    assert record["twiml"] == twiml
    assert record["twiml_error"] is None
    assert record["twiml_parsed"] == {
        "says": [],
        "gather": {
            "numDigits": "1",
            "finishOnKey": "",
            "action": action,
            "method": "POST",
            "says": ["Disk & full", "Press 4.", "Press 4."],
        },
        "after_gather_says": ["No key."],
        "hangup": True,
    }
    say_only = phone()
    place_call(api, account, say_only, f"<Response><Say>{escape('One & two')}</Say><Say>Three</Say><Hangup/></Response>")
    assert records(api, to=say_only)[0]["twiml_parsed"] == {
        "says": ["One & two", "Three"], "gather": None, "after_gather_says": [], "hangup": True,
    }
    for bad in ("<Response><Say>a & b</Say></Response>", "<Response><Say>open", "<Other/>", "<Response><Dial>1</Dial></Response>"):
        number = phone()
        assert_twilio_error(place_call(api, account, number, bad), 400, 12100)
        flagged = records(api, to=number)[0]
        assert flagged["twiml"] == bad
        assert flagged["twiml_parsed"] is None
        assert flagged["twiml_error"]


def test_m14_press_posts_to_o2_without_auth_and_never_masks_a_refusal(api: str, o2_stub: O2Stub) -> None:
    account = new_account(api)
    to = phone()
    call_sid = place_call(api, account, to, listen_twiml(f"https://{CALLBACK}{ACK_PATH}?x=1&y=2")).json()["sid"]
    resp = press(api, to=to, digits="4")
    assert resp.status_code == 200
    answer = resp.json()
    assert (answer["status"], answer["content_type"], answer["raw"]) == (200, "text/xml", ACKED)
    assert (answer["says"], answer["hangup"], answer["gather"]) == (["Acknowledged."], True, None)
    assert answer["action_path"] == f"{ACK_PATH}?x=1&y=2"
    assert answer["twiml_error"] is None
    seen = o2_stub.seen[-1]
    assert seen["path"] == f"{ACK_PATH}?x=1&y=2"
    assert seen["form"]["Digits"] == ["4"]
    assert seen["form"]["CallSid"] == [call_sid]
    assert seen["form"]["AccountSid"] == [account.sid]
    assert seen["form"]["To"] == [to]
    assert seen["headers"]["Content-Type"] == "application/x-www-form-urlencoded"
    assert "Authorization" not in seen["headers"]
    assert "X-Twilio-Signature" not in seen["headers"]
    assert press(api, call_sid=call_sid, digits="6").status_code == 200
    assert o2_stub.seen[-1]["form"]["Digits"] == ["6"]
    press(api, to=to)
    assert "Digits" not in o2_stub.seen[-1]["form"]
    press(api, to=to, digits="88")
    assert o2_stub.seen[-1]["form"]["Digits"] == ["8"]
    press(api, to=to, digits="#")
    assert o2_stub.seen[-1]["form"]["Digits"] == ["#"]
    default_finish = phone()
    place_call(api, account, default_finish, f'<Response><Gather action="https://{CALLBACK}{ACK_PATH}"/></Response>')
    press(api, to=default_finish, digits="#")
    assert "Digits" not in o2_stub.seen[-1]["form"]

    no_gather = phone()
    place_call(api, account, no_gather)
    refused = press(api, to=no_gather, digits="4")
    assert (refused.status_code, refused.json()["error"]) == (409, "no_gather")
    wrong_host = phone()
    place_call(api, account, wrong_host, listen_twiml("https://evil.example/x"))
    refused = press(api, to=wrong_host, digits="4")
    assert (refused.status_code, refused.json()["error"]) == (409, "action_host_mismatch")
    assert press(api, to=phone(), digits="4").status_code == 404
    assert press(api, call_sid="CA" + uuid.uuid4().hex, digits="4").status_code == 404
    never_rang = phone()
    add_rule(api, to=never_rang, status=500, times=1)
    place_call(api, account, never_rang, listen_twiml())
    assert press(api, to=never_rang, digits="4").status_code == 404

    refusing = "/api/v2/org1/oncall/ack/voice/refused"
    o2_stub.answers[refusing] = (403, "application/json", '{"message":"Forbidden"}', {})
    target = phone()
    place_call(api, account, target, listen_twiml(f"https://{CALLBACK}{refusing}"))
    answer = press(api, to=target, digits="4").json()
    assert (answer["status"], answer["raw"]) == (403, '{"message":"Forbidden"}')
    assert (answer["says"], answer["hangup"]) == ([], False)
    assert answer["twiml_error"]
    moving = "/api/v2/org1/oncall/ack/voice/moved"
    o2_stub.answers[moving] = (302, "text/xml", ACKED, {"Location": ACK_PATH})
    target = phone()
    place_call(api, account, target, listen_twiml(f"https://{CALLBACK}{moving}"))
    before = len(o2_stub.seen)
    assert press(api, to=target, digits="4").json()["status"] == 302
    assert len(o2_stub.seen) == before + 1
    garbled = "/api/v2/org1/oncall/ack/voice/garbled"
    o2_stub.answers[garbled] = (200, "text/xml", "not xml", {})
    target = phone()
    place_call(api, account, target, listen_twiml(f"https://{CALLBACK}{garbled}"))
    assert press(api, to=target, digits="4").json()["twiml_error"]
    wrong_type = "/api/v2/org1/oncall/ack/voice/wrong-type"
    o2_stub.answers[wrong_type] = (200, "application/json", ACKED, {})
    target = phone()
    place_call(api, account, target, listen_twiml(f"https://{CALLBACK}{wrong_type}"))
    assert "Content-Type" in press(api, to=target, digits="4").json()["twiml_error"]

    dead = make_server(0, "http://127.0.0.1:1", CALLBACK)
    serve(dead)
    dead_api = f"http://127.0.0.1:{dead.server_address[1]}"
    try:
        target = phone()
        place_call(dead_api, new_account(dead_api), target, listen_twiml())
        unreachable = press(dead_api, to=target, digits="4")
        assert (unreachable.status_code, unreachable.json()["error"]) == (502, "o2_unreachable")
    finally:
        dead.shutdown()


def test_m15_segments_follow_spec_m6(api: str) -> None:
    account = new_account(api)
    cases = [
        ("a" * 160, 1, "GSM-7"),
        ("a" * 161, 2, "GSM-7"),
        ("a" * 306, 2, "GSM-7"),
        ("a" * 307, 3, "GSM-7"),
        ("a" * 459, 3, "GSM-7"),
        ("a" * 460, 4, "GSM-7"),
        ("{" * 80, 1, "GSM-7"),
        ("{" * 81, 2, "GSM-7"),
        ("}[]~^|\\" + "a" * 146, 1, "GSM-7"),
        ("}[]~^|\\" + "a" * 147, 2, "GSM-7"),
        ("line one\nline two", 1, "GSM-7"),
        ("é" * 70, 1, "UCS-2"),
        ("é" * 71, 2, "UCS-2"),
        ("é" * 134, 2, "UCS-2"),
        ("é" * 135, 3, "UCS-2"),
        ("a" * 69 + "é", 1, "UCS-2"),
        ("a" * 70 + "é", 2, "UCS-2"),
        ("`" * 71, 2, "UCS-2"),
        ("\U0001F600" * 35, 1, "UCS-2"),
        ("\U0001F600" * 36, 2, "UCS-2"),
    ]
    for body, parts, encoding in cases:
        to = phone()
        answer = send_sms(api, account, to, body)
        assert answer.status_code == 201
        record = records(api, to=to)[0]
        assert (record["segments"], record["encoding"]) == (parts, encoding), body
        assert answer.json()["num_segments"] == str(parts)


def test_m16_the_token_is_never_kept_returned_or_logged(
    api: str, mock_server: ThreadingHTTPServer, caplog: pytest.LogCaptureFixture,
) -> None:
    account = new_account(api)
    wrong = "o2tok-canary-" + uuid.uuid4().hex
    to = phone()
    with caplog.at_level("DEBUG", logger="twilio-mock"):
        answers = [
            send_sms(api, account, to),
            place_call(api, account, to, listen_twiml()),
            HTTP.get(twilio_url(api, account, ".json"), auth=account.auth, timeout=5),
            HTTP.get(twilio_url(api, account, "/IncomingPhoneNumbers.json"), auth=account.auth, timeout=5),
            send_sms(api, account, to, auth=(account.sid, wrong)),
            press(api, to=to, digits="4"),
            HTTP.get(f"{api}/_mock/requests", params={"sid": account.sid}, timeout=5),
            HTTP.get(f"{api}/_mock/health", timeout=5),
        ]
    assert "Messages.json" in caplog.text
    remembered = repr(vars(mock_server.state))
    for token in (account.token, wrong):
        assert token not in caplog.text
        assert token not in remembered
        for answer in answers:
            assert token not in answer.text
            assert token not in str(answer.headers)
    assert "auth_token" not in answers[2].json()
    seen = records(api, sid=account.sid)
    good_seq, wrong_seq = seen[0]["seq"], seen[-1]["seq"]
    hashes = [HTTP.get(f"{api}/_mock/requests/{seq}/token_hash", timeout=5).json()["sha256"] for seq in (good_seq, wrong_seq)]
    assert hashes == [hashlib.sha256(t.encode()).hexdigest() for t in (account.token, wrong)]
    assert HTTP.get(f"{api}/_mock/requests/999999999/token_hash", timeout=5).status_code == 404
    bare = HTTP.get(twilio_url(api, account, ".json"), timeout=5)
    assert bare.status_code == 401
    assert HTTP.get(f"{api}/_mock/requests/{records(api, sid=account.sid)[-1]['seq']}/token_hash", timeout=5).json() == {"sha256": None}


def test_m17_answers_stay_uncompressed_when_gzip_is_offered(api: str) -> None:
    account = new_account(api)
    gzip = {"Accept-Encoding": "gzip, br, deflate"}
    resp = HTTP.post(twilio_url(api, account, "/Messages.json"), auth=account.auth, headers=gzip, stream=True, timeout=5,
                     data={"To": phone(), "From": account.number, "Body": "x"})
    assert resp.status_code == 201
    assert "Content-Encoding" not in resp.headers
    assert json.loads(resp.raw.read(decode_content=False))["status"] == "queued"
    resp = HTTP.get(twilio_url(api, account, ".json"), auth=account.auth, headers=gzip, stream=True, timeout=5)
    assert "Content-Encoding" not in resp.headers
    assert json.loads(resp.raw.read(decode_content=False))["status"] == "active"


def test_m18_fifty_parallel_sends_over_five_numbers_count_exactly(api: str) -> None:
    account = new_account(api)
    numbers = [phone() for _ in range(5)]

    def send(index: int) -> str:
        session = requests.Session()
        session.trust_env = False
        resp = send_sms(api, account, numbers[index % 5], f"message {index}", session=session, timeout=10)
        assert resp.status_code == 201
        return resp.json()["sid"]

    with ThreadPoolExecutor(20) as pool:
        sids = list(pool.map(send, range(50)))
    assert len(set(sids)) == 50
    for offset, number in enumerate(numbers):
        seen = records(api, to=number)
        assert len(seen) == 10
        assert {r["body"] for r in seen} == {f"message {i}" for i in range(offset, 50, 5)}
    all_seen = records(api, sid=account.sid)
    assert len(all_seen) == 50
    assert len({r["seq"] for r in all_seen}) == 50


def test_m19_cli_registers_the_deployment_account_and_marks_it_protected() -> None:
    sid = "AC" + "0" * 32
    token = "ci-deployment-fixture"
    number = phone()
    # -I -S drop site-packages, so this also proves the mock starts on a bare python3 with no installed deps.
    command = [sys.executable, "-I", "-S", str(MOCK_SCRIPT), "--port", "0", "--callback-host", CALLBACK,
               "--deployment-account", f"{sid}:{token}:{number}"]
    process = subprocess.Popen(command, stderr=subprocess.PIPE, text=True)
    try:
        ready, _, _ = select.select([process.stderr], [], [], 10)
        assert ready, "the mock did not start within 10 s"
        banner = process.stderr.readline()
        assert banner.startswith("twilio mock listening on http://127.0.0.1:"), banner
        cli_api = banner.split()[-1]
        health = HTTP.get(f"{cli_api}/_mock/health", timeout=5).json()
        assert health["ok"] is True
        assert health["protected_sids"] == [sid]
        assert health["callback_host"] == CALLBACK
        account = Account(sid, token, number)
        assert HTTP.get(twilio_url(cli_api, account, ".json"), auth=account.auth, timeout=5).status_code == 200
        assert send_sms(cli_api, account, phone()).status_code == 201
        wrong = HTTP.get(twilio_url(cli_api, account, ".json"), auth=(sid, "wrong"), timeout=5)
        assert_twilio_error(wrong, 401, 20003)
        same = {"sid": sid, "token": token, "numbers": [{"number": number}]}
        assert HTTP.post(f"{cli_api}/_mock/accounts", json=same, timeout=5).status_code == 200
        changed = HTTP.post(f"{cli_api}/_mock/accounts", json={**same, "token": "other"}, timeout=5)
        assert (changed.status_code, changed.json()["error"]) == (409, "protected_sid")
        assert HTTP.get(twilio_url(cli_api, account, ".json"), auth=account.auth, timeout=5).status_code == 200
        bad_sid = HTTP.post(f"{cli_api}/_mock/accounts", json={"sid": "XX1", "token": "t"}, timeout=5)
        assert (bad_sid.status_code, bad_sid.json()["error"]) == (400, "invalid_sid")
    finally:
        process.terminate()
        _, stderr = process.communicate(timeout=10)
    assert token not in banner
    assert token not in stderr
    bad_flag = subprocess.run(
        [sys.executable, "-I", "-S", str(MOCK_SCRIPT), "--port", "0", "--deployment-account", "secret-no-colons"],
        capture_output=True, text=True, timeout=10, check=False,
    )
    assert bad_flag.returncode == 2
    assert "secret-no-colons" not in bad_flag.stderr
    in_process = make_server()
    assert in_process.server_address[0] == "127.0.0.1"
    in_process.server_close()


def test_m20_helpers_raise_instead_of_passing_on_nothing(api: str, o2_stub: O2Stub) -> None:
    client = TwilioMock(api)
    assert client.reachable() is True
    assert TwilioMock("http://127.0.0.1:1").reachable() is False
    account = new_account(api)
    silent = phone()
    with pytest.raises(TwilioMockError, match="saw 0 of 1"):
        client.wait_for(silent, "sms", timeout=0.3)
    send_sms(api, account, silent)
    assert [r["to"] for r in client.wait_for(silent, "sms", timeout=1)] == [silent]
    with pytest.raises(TwilioMockError, match="saw 1 of 2"):
        client.wait_for(silent, "sms", count=2, timeout=0.3)
    with pytest.raises(TwilioMockError) as refused:
        client.requests()
    assert refused.value.status == 400
    with pytest.raises(TwilioMockError) as refused:
        client.last_code(silent)
    assert refused.value.status == 404
    with pytest.raises(TwilioMockError) as refused:
        client.fail(status=500)
    assert refused.value.status == 400
    place_call(api, account, silent)
    with pytest.raises(TwilioMockError) as refused:
        client.press(to=silent, digits="4")
    assert refused.value.status == 409
    assert "no_gather" in refused.value.body

    target = phone()
    refusing = "/api/v2/org1/oncall/ack/voice/helper-refused"
    o2_stub.answers[refusing] = (500, "text/xml", ACKED, {})
    place_call(api, account, target, listen_twiml(f"https://{CALLBACK}{refusing}"))
    with pytest.raises(TwilioMockError, match="O2 answered 500") as server_refused:
        client.press(to=target, digits="4")
    assert server_refused.value.body["raw"] == ACKED
    assert client.press(to=target, digits="4", expect_status=500)["status"] == 500
    assert client.press(to=target, digits="4", expect_status=None)["status"] == 500
    garbled = "/api/v2/org1/oncall/ack/voice/helper-garbled"
    o2_stub.answers[garbled] = (200, "text/xml", "not xml", {})
    target = phone()
    place_call(api, account, target, listen_twiml(f"https://{CALLBACK}{garbled}"))
    with pytest.raises(TwilioMockError, match="not TwiML"):
        client.press(to=target, digits="4")

    good = phone()
    place_call(api, account, good, listen_twiml())
    assert client.press(to=good, digits="4")["says"] == ["Acknowledged."]
    assert client.token_hash(records(api, to=good)[0]["seq"]) == hashlib.sha256(account.token.encode()).hexdigest()
    rule_id = client.fail(to=good, status=500)
    client.clear_fail(rule_id)
    with pytest.raises(TwilioMockError) as refused:
        client.clear_fail(rule_id)
    assert refused.value.status == 404
    second = "AC" + uuid.uuid4().hex
    client.add_account(second, "t", numbers=[{"number": good}], type="Trial")
    answer = HTTP.get(f"{api}/2010-04-01/Accounts/{second}.json", auth=(second, "t"), timeout=5).json()
    assert (answer["status"], answer["type"]) == ("active", "Trial")


def test_m21_a_wait_counts_only_accepted_requests_unless_told_otherwise(api: str) -> None:
    client = TwilioMock(api)
    account = new_account(api)

    def wrong_token(to: str) -> None:
        send_sms(api, account, to, auth=(account.sid, "wrong-token"))

    def from_not_on_the_account(to: str) -> None:
        send_sms(api, Account(account.sid, account.token, phone()), to)

    def bad_twiml(to: str) -> None:
        place_call(api, account, to, "<Response><Say>a & b</Say></Response>")

    def rule_refuses(to: str) -> None:
        add_rule(api, to=to, status=500)
        send_sms(api, account, to)

    def rule_replaces_a_2xx(to: str) -> None:
        add_rule(api, to=to, status=201, raw_body="{}")
        send_sms(api, account, to)

    def client_timed_out(to: str) -> None:
        add_rule(api, to=to, delay_ms=4000)
        with pytest.raises(requests.exceptions.Timeout):
            send_sms(api, account, to, timeout=0.3)

    cases = [
        (wrong_token, "sms", 401),
        (from_not_on_the_account, "sms", 400),
        (bad_twiml, "call", 400),
        (rule_refuses, "sms", 500),
        (rule_replaces_a_2xx, "sms", 201),
        (client_timed_out, "sms", None),
    ]
    for refuse, kind, status in cases:
        to = phone()
        refuse(to)
        with pytest.raises(TwilioMockError, match="saw 0 of 1"):
            client.wait_for(to, kind, timeout=0.3)
        [seen] = client.wait_for(to, kind, timeout=3, accepted=False)
        assert (seen["accepted"], seen["response_status"]) == (False, status), refuse.__name__
        assert [r["seq"] for r in client.requests(to=to, kind=kind)] == [seen["seq"]], refuse.__name__

    mixed = phone()
    wrong_token(mixed)
    assert send_sms(api, account, mixed).status_code == 201
    assert [r["response_status"] for r in client.wait_for(mixed, "sms", timeout=1)] == [201]
    assert [r["response_status"] for r in client.wait_for(mixed, "sms", timeout=1, accepted=False)] == [401]
    assert [r["response_status"] for r in client.wait_for(mixed, "sms", 2, timeout=1, accepted=None)] == [401, 201]
    with pytest.raises(TwilioMockError, match=r"saw 1 of 2.*\[401, 201\]"):
        client.wait_for(mixed, "sms", 2, timeout=0.3)

    held = phone()
    add_rule(api, to=held, delay_ms=1000)
    with ThreadPoolExecutor(1) as pool:
        answer = pool.submit(send_sms, api, account, held, session=requests.Session())
        deadline = time.monotonic() + 3
        while not client.requests(to=held) and time.monotonic() < deadline:
            time.sleep(0.02)
        assert [r["accepted"] for r in client.requests(to=held)] == [None], "an unanswered request is neither"
        assert client.requests(to=held, accepted=True) == []
        assert client.requests(to=held, accepted=False) == []
        assert answer.result().status_code == 201
    assert [r["accepted"] for r in client.wait_for(held, "sms", timeout=1)] == [True]

    assert HTTP.get(twilio_url(api, account, ".json"), auth=account.auth, timeout=5).status_code == 200
    assert len(client.requests(sid=account.sid, kind="account", accepted=True)) == 1
    add_rule(api, sid=account.sid, kind="account", status=200, body={"status": "closed"}, times=1)
    assert HTTP.get(twilio_url(api, account, ".json"), auth=account.auth, timeout=5).status_code == 200
    assert len(client.requests(sid=account.sid, kind="account", accepted=False)) == 1

    bad_filter = HTTP.get(f"{api}/_mock/requests", params={"to": mixed, "accepted": "maybe"}, timeout=5)
    assert (bad_filter.status_code, bad_filter.json()["error"]) == (400, "invalid_filter")


def reprompt_to(action: str) -> tuple[int, str, str, dict[str, str]]:
    return 200, "text/xml", listen_twiml(action), {}


def test_m22_a_press_follows_the_gather_in_the_last_reply(api: str, o2_stub: O2Stub) -> None:
    account = new_account(api)
    first = "/api/v2/org1/oncall/ack/voice/m22-first"
    second = "/api/v2/org1/oncall/ack/voice/m22-second"
    third = "/api/v2/org1/oncall/ack/voice/m22-third"
    o2_stub.answers[first] = reprompt_to(f"https://{CALLBACK}{second}")
    o2_stub.answers[second] = reprompt_to(f"https://{CALLBACK}{third}")
    to = phone()
    other = phone()
    place_call(api, account, to, listen_twiml(f"https://{CALLBACK}{first}"))
    place_call(api, account, other, listen_twiml(f"https://{CALLBACK}{first}"))

    assert press(api, to=to, digits="1").json()["action_path"] == first
    assert press(api, to=to, digits="1").json()["action_path"] == second
    assert o2_stub.seen[-1]["path"] == second
    assert press(api, to=to, digits="4").json()["action_path"] == third
    assert o2_stub.seen[-1]["path"] == third
    assert press(api, to=to, digits="4").json()["action_path"] == third, "a reply with no Gather leaves the last one"
    assert press(api, to=other, digits="1").json()["action_path"] == first, "each call keeps its own Gather"

    broken = "/api/v2/org1/oncall/ack/voice/m22-broken"
    o2_stub.answers[broken] = reprompt_to("https://evil.example/x")
    target = phone()
    place_call(api, account, target, listen_twiml(f"https://{CALLBACK}{broken}"))
    assert press(api, to=target, digits="1").json()["status"] == 200
    refused = press(api, to=target, digits="4")
    assert (refused.status_code, refused.json()["error"]) == (409, "action_host_mismatch")

    refusing = "/api/v2/org1/oncall/ack/voice/m22-refusing"
    o2_stub.answers[refusing] = (500, "text/xml", listen_twiml("https://evil.example/x"), {})
    target = phone()
    place_call(api, account, target, listen_twiml(f"https://{CALLBACK}{refusing}"))
    assert press(api, to=target, digits="1").json()["status"] == 500
    assert press(api, to=target, digits="4").json()["action_path"] == refusing, "only a 200 reply is a reply Twilio plays"


def test_m23_a_rule_can_answer_a_redirect_with_a_location(api: str) -> None:
    account = new_account(api)
    to = phone()
    target = f"/2010-04-01/Accounts/{account.sid}.json"
    add_rule(api, to=to, kind="sms", status=302, location=target)
    resp = HTTP.post(
        twilio_url(api, account, "/Messages.json"),
        data={"To": to, "From": account.number, "Body": "hello"},
        auth=account.auth,
        timeout=5,
        allow_redirects=False,
    )
    assert resp.status_code == 302
    assert resp.headers["Location"] == target
    [record] = records(api, to=to, kind="sms")
    assert (record["response_status"], record["accepted"], record["resource_sid"]) == (302, False, None)
    assert HTTP.get(f"{api}{target}", auth=account.auth, timeout=5).status_code == 200, "a client that follows must land on a 200"

    followed = send_sms(api, account, to)
    assert followed.status_code == 200, "requests follows the redirect by default, as the client under test may"
    assert followed.history[0].status_code == 302
    assert followed.json()["sid"] == account.sid

    plain = phone()
    add_rule(api, to=plain, kind="sms", status=302)
    resp = HTTP.post(twilio_url(api, account, "/Messages.json"), data={"To": plain, "From": account.number, "Body": "x"},
                     auth=account.auth, timeout=5, allow_redirects=False)
    assert (resp.status_code, resp.headers.get("Location")) == (302, None), "no location means no header"

    for rule in ({"status": 500, "location": target}, {"status": 200, "location": target},
                 {"status": 302, "location": ""}, {"status": 302, "location": 1}, {"delay_ms": 1, "location": target}):
        refused = HTTP.post(f"{api}/_mock/fail", json={"to": phone(), **rule}, timeout=5)
        assert (refused.status_code, refused.json()["error"]) == (400, "invalid_rule"), rule


def test_m24_a_redirect_rule_still_counts_on_a_protected_account() -> None:
    sid, token, number = "AC" + "0" * 32, "ci-deployment-fixture", phone()
    server = make_server(0, "http://127.0.0.1:1", CALLBACK, (sid, token, number))
    serve(server)
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}/_mock/fail"
        refused = HTTP.post(url, json={"to": phone(), "status": 302, "location": "/x"}, timeout=5)
        assert (refused.status_code, refused.json()["error"]) == (409, "would_poison_shared_breaker")
    finally:
        server.shutdown()
