"""Loopback fake of the Twilio REST API for the on-call telephony tests; no reset, every read names a To or SID."""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import itertools
import json
import logging
import os
import re
import select
import socket
import sys
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from collections import defaultdict
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

log = logging.getLogger("twilio-mock")

LOOPBACK = "127.0.0.1"
DEFAULT_PORT = 5097
DEFAULT_O2_URL = "http://127.0.0.1:5080"
API_VERSION = "2010-04-01"
API_PREFIX = f"/{API_VERSION}/"
MAX_BODY_CHARS = 1600
MAX_TWIML_CHARS = 4000
SERVER_TIMEOUT_MS = 5000
O2_TIMEOUT_SECS = 15
DOCS_ERRORS = "https://www.twilio.com/docs/errors/"

KINDS = ("sms", "call", "account", "numbers")
ACCOUNT_STATUSES = ("active", "suspended", "closed")
ACCOUNT_TYPES = ("Full", "Trial")
RECIPIENT_NOT_ALLOWED_CODES = (21215, 21219, 21408, 21608)
TWIML_CONTENT_TYPES = ("text/xml", "application/xml", "text/html")

SID_RE = re.compile(r"AC[0-9a-fA-F]{32}")
E164_RE = re.compile(r"\+[1-9][0-9]{1,14}")
PATH_SID_RE = re.compile(rf"{API_PREFIX}Accounts/([^/.]+)(.*)")
CODE_SENTENCE_RE = re.compile(r"Your OpenObserve verification code is ([0-9]{6})\. It expires in 10 minutes\.")
DIGITS_RE = re.compile(r"[0-9*#]+")
ROUTES = {
    ("POST", "/Messages.json"): "sms",
    ("POST", "/Calls.json"): "call",
    ("GET", ".json"): "account",
    ("GET", "/IncomingPhoneNumbers.json"): "numbers",
}

GSM_ONE = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 \n\r!\"#$%&'()*+,-./:;<=>?@_")
GSM_TWO = set("{}[]~^|\\")


class TwilioError(Exception):
    def __init__(self, status: int, code: int | None, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


class ControlError(Exception):
    """A refusal of a ``/_mock`` call; never confused with a Twilio answer."""

    def __init__(self, status: int, error: str, message: str = ""):
        super().__init__(error)
        self.status = status
        self.error = error
        self.message = message


class TwilioMockError(Exception):
    """A control call that did not do what the test asked; raised so nothing can pass by doing nothing."""

    def __init__(self, message: str, status: int | None = None, body: Any = None):
        super().__init__(message)
        self.status = status
        self.body = body


def error_body(status: int, code: int | None, message: str) -> dict[str, Any]:
    body: dict[str, Any] = {"message": message, "status": status}
    if code is not None:
        body = {"code": code, "message": message, "more_info": f"{DOCS_ERRORS}{code}", "status": status}
    return body


def rfc2822_now() -> str:
    return time.strftime("%a, %d %b %Y %H:%M:%S +0000", time.gmtime())


def sms_parts(text: str) -> tuple[int, str]:
    """Parts and encoding per spec M6: GSM-7 at 160/153, anything outside it switches to UCS-2 at 70/67."""
    if all(c in GSM_ONE or c in GSM_TWO for c in text):
        count, single, part, encoding = sum(2 if c in GSM_TWO else 1 for c in text), 160, 153, "GSM-7"
    else:
        count, single, part, encoding = len(text.encode("utf-16-le")) // 2, 70, 67, "UCS-2"
    return (1 if count <= single else -(-count // part)), encoding


def parse_twiml(text: str) -> tuple[dict[str, Any] | None, str | None]:
    """Parses with a strict XML parser, so a bad escape reaches ``twiml_error`` instead of a lenient match."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as e:
        return None, f"not well-formed XML: {e}"
    if root.tag != "Response":
        return None, f"root element is <{root.tag}>, not <Response>"
    parsed: dict[str, Any] = {"says": [], "gather": None, "after_gather_says": [], "hangup": False}
    for verb in root:
        if verb.tag == "Say":
            parsed["after_gather_says" if parsed["gather"] else "says"].append(verb.text or "")
        elif verb.tag == "Gather" and parsed["gather"] is None:
            parsed["gather"] = {
                "numDigits": verb.get("numDigits"),
                "finishOnKey": verb.get("finishOnKey"),
                "action": verb.get("action"),
                "method": verb.get("method"),
                "says": [s.text or "" for s in verb.findall("Say")],
            }
        elif verb.tag == "Hangup":
            parsed["hangup"] = True
        else:
            return None, f"unexpected verb <{verb.tag}>"
    return parsed, None


def gathered_digits(digits: str | None, gather: dict[str, Any]) -> str:
    """What a caller's keys become: the finish key ends input, and ``numDigits`` caps it; an unset key means ``#``."""
    keys = digits or ""
    finish = "#" if gather.get("finishOnKey") is None else gather["finishOnKey"]
    if finish and finish in keys:
        keys = keys[:keys.index(finish)]
    return keys[:int(gather["numDigits"])] if gather.get("numDigits") else keys


def resource_uri(account_sid: str, collection: str, sid: str) -> str:
    return f"/{API_VERSION}/Accounts/{account_sid}/{collection}/{sid}.json"


def message_resource(account_sid: str, sid: str, form: dict[str, str], segments: int) -> dict[str, Any]:
    now = rfc2822_now()
    return {
        "account_sid": account_sid,
        "api_version": API_VERSION,
        "body": form["Body"],
        "date_created": now,
        "date_sent": None,
        "date_updated": now,
        "direction": "outbound-api",
        "error_code": None,
        "error_message": None,
        "from": form["From"],
        "messaging_service_sid": None,
        "num_media": "0",
        "num_segments": str(segments),
        "price": None,
        "price_unit": None,
        "sid": sid,
        "status": "queued",
        "subresource_uris": {"media": resource_uri(account_sid, "Messages", sid).replace(".json", "/Media.json")},
        "to": form["To"],
        "uri": resource_uri(account_sid, "Messages", sid),
    }


def call_resource(account_sid: str, sid: str, form: dict[str, str]) -> dict[str, Any]:
    now = rfc2822_now()
    nulls = ("answered_by", "caller_name", "duration", "end_time", "forwarded_from", "group_sid", "parent_call_sid",
             "phone_number_sid", "price", "price_unit", "queue_time", "start_time", "trunk_sid")
    return {
        **dict.fromkeys(nulls),
        "account_sid": account_sid,
        "api_version": API_VERSION,
        "date_created": now,
        "date_updated": now,
        "direction": "outbound-api",
        "from": form["From"],
        "from_formatted": form["From"],
        "sid": sid,
        "status": "queued",
        "subresource_uris": {"recordings": resource_uri(account_sid, "Calls", sid).replace(".json", "/Recordings.json")},
        "to": form["To"],
        "to_formatted": form["To"],
        "uri": resource_uri(account_sid, "Calls", sid),
    }


def account_resource(sid: str, account: dict[str, Any]) -> dict[str, Any]:
    now = rfc2822_now()
    base = f"/{API_VERSION}/Accounts/{sid}"
    return {
        "date_created": now,
        "date_updated": now,
        "friendly_name": sid,
        "owner_account_sid": sid,
        "sid": sid,
        "status": account["status"],
        "subresource_uris": {
            "calls": f"{base}/Calls.json",
            "incoming_phone_numbers": f"{base}/IncomingPhoneNumbers.json",
            "messages": f"{base}/Messages.json",
        },
        "type": account["type"],
        "uri": f"{base}.json",
    }


def number_resource(account_sid: str, number: dict[str, Any]) -> dict[str, Any]:
    sid = "PN" + hashlib.sha256(number["number"].encode()).hexdigest()[:32]
    now = rfc2822_now()
    return {
        "account_sid": account_sid,
        "api_version": API_VERSION,
        "capabilities": {"voice": number["voice"], "sms": number["sms"], "mms": False, "fax": False},
        "date_created": now,
        "date_updated": now,
        "friendly_name": number["number"],
        "origin": "twilio",
        "phone_number": number["number"],
        "sid": sid,
        "status": "in-use",
        "uri": resource_uri(account_sid, "IncomingPhoneNumbers", sid),
    }


def numbers_page(account_sid: str, account: dict[str, Any], query: dict[str, str]) -> dict[str, Any]:
    wanted = query.get("PhoneNumber")
    # Twilio's filter also matches partial numbers and '*', so an exact-only fake would hide a server with no exact check.
    pattern = re.compile("".join("[0-9]" if c == "*" else re.escape(c) for c in wanted)) if wanted else None
    found = [n for n in account["numbers"] if pattern is None or pattern.search(n["number"])]
    uri = f"/{API_VERSION}/Accounts/{account_sid}/IncomingPhoneNumbers.json?{urlencode(query)}"
    return {
        "end": max(len(found) - 1, 0),
        "first_page_uri": uri,
        "incoming_phone_numbers": [number_resource(account_sid, n) for n in found],
        "next_page_uri": None,
        "page": 0,
        "page_size": 50,
        "previous_page_uri": None,
        "start": 0,
        "uri": uri,
    }


def rule_payload(rule: dict[str, Any]) -> bytes | None:
    if "raw_body" in rule:
        return rule["raw_body"].encode()
    if "body" in rule:
        return json.dumps(rule["body"]).encode()
    status = rule.get("status")
    if status is None or (200 <= status < 300 and "code" not in rule):
        return None
    return json.dumps(error_body(status, rule.get("code"), rule.get("message", "Mock failure"))).encode()


def counts_on_breaker(rule: dict[str, Any]) -> bool:
    if rule.get("delay_ms", 0) >= SERVER_TIMEOUT_MS:
        return True
    status = rule.get("status")
    if status is None:
        return False
    try:
        parsed = json.loads(rule_payload(rule) or b"{}")
    except ValueError:
        parsed = None
    fields = parsed if isinstance(parsed, dict) else {}
    if 200 <= status < 300:
        return fields.get("status") in ("suspended", "closed")
    if 400 <= status < 500:
        return fields.get("code") not in RECIPIENT_NOT_ALLOWED_CODES and status in (401, 403, 429)
    return True


def check_rule(rule: Any) -> None:
    if not isinstance(rule, dict) or not (rule.get("to") or rule.get("sid")):
        raise ControlError(400, "target_required", "a rule must name to or sid")
    if rule.get("kind") is not None and rule["kind"] not in KINDS:
        raise ControlError(400, "invalid_rule", f"kind must be one of {KINDS}")
    if rule.get("to") and rule.get("kind") in ("account", "numbers"):
        raise ControlError(400, "to_never_matches_kind", "account and numbers requests carry no To")
    if rule.get("status") is None and rule.get("delay_ms") is None:
        raise ControlError(400, "invalid_rule", "a rule needs status or delay_ms")
    if rule.get("status") is None and any(k in rule for k in ("code", "message", "body", "raw_body")):
        raise ControlError(400, "invalid_rule", "code, message, body and raw_body need a status")
    for field, low, high in (("status", 100, 699), ("times", 1, None), ("delay_ms", 0, None)):
        value = rule.get(field)
        bad = value is not None and (not isinstance(value, int) or value < low or (high is not None and value > high))
        if bad:
            raise ControlError(400, "invalid_rule", f"{field} is out of range")
    if "raw_body" in rule and not isinstance(rule["raw_body"], str):
        raise ControlError(400, "invalid_rule", "raw_body must be a string")
    if "location" in rule and not (isinstance(rule["location"], str) and rule["location"]
                                   and isinstance(rule.get("status"), int) and 300 <= rule["status"] < 400):
        raise ControlError(400, "invalid_rule", "location must be a non-empty string on a 3xx status")


def clean_numbers(numbers: Any) -> list[dict[str, Any]]:
    if not isinstance(numbers, list) or not all(isinstance(n, dict) and n.get("number") for n in numbers):
        raise ControlError(400, "invalid_account", "numbers must be a list of {number, sms?, voice?}")
    return [{"number": n["number"], "sms": bool(n.get("sms", True)), "voice": bool(n.get("voice", True))} for n in numbers]


class MockState:
    def __init__(self, o2_url: str, callback_host: str | None):
        self.o2_url = o2_url.rstrip("/")
        self.callback_host = callback_host
        self.lock = threading.Lock()
        self.seq = itertools.count(1)
        self.rule_ids = itertools.count(1)
        self.accounts: dict[str, dict[str, Any]] = {}
        self.protected: set[str] = set()
        self.rules: dict[str, dict[str, Any]] = {}
        self.by_to: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.by_sid: dict[str, list[dict[str, Any]]] = defaultdict(list)
        self.by_seq: dict[int, dict[str, Any]] = {}
        self.token_hashes: dict[int, str | None] = {}
        self.reply_gathers: dict[str, dict[str, Any]] = {}

    def add_account(self, body: Any) -> str:
        if not isinstance(body, dict) or not SID_RE.fullmatch(str(body.get("sid", ""))):
            raise ControlError(400, "invalid_sid", "sid must be AC followed by 32 hex characters")
        if not body.get("token") or not isinstance(body["token"], str):
            raise ControlError(400, "invalid_account", "token is required")
        status, kind = body.get("status", "active"), body.get("type", "Full")
        if status not in ACCOUNT_STATUSES or kind not in ACCOUNT_TYPES:
            raise ControlError(400, "invalid_account", "unknown status or type")
        account = {
            "token_sha256": hashlib.sha256(body["token"].encode()).hexdigest(),
            "status": status,
            "type": kind,
            "numbers": clean_numbers(body.get("numbers", [])),
        }
        if body["sid"] in self.protected and account != self.accounts[body["sid"]]:
            raise ControlError(409, "protected_sid", "the shared deployment account cannot be changed")
        self.accounts[body["sid"]] = account
        return body["sid"]

    def add_rule(self, rule: Any) -> str:
        check_rule(rule)
        sid_hits_protected = rule.get("sid") in self.protected if rule.get("sid") else bool(self.protected)
        # Without a To the rule also hits other tests' recipients on the shared account, so it clashes even if harmless.
        if sid_hits_protected and (counts_on_breaker(rule) or not rule.get("to")):
            raise ControlError(409, "would_poison_shared_breaker", "use a To-scoped recipient-class rule or an org sid")
        rule_id = f"r{next(self.rule_ids)}"
        self.rules[rule_id] = dict(rule)
        return rule_id

    def remove_rule(self, rule_id: str) -> None:
        if self.rules.pop(rule_id, None) is None:
            raise ControlError(404, "no_such_rule")

    def take_rule(self, kind: str, sid: str | None, to: str | None) -> tuple[str | None, dict[str, Any] | None]:
        for rule_id in reversed(list(self.rules)):
            rule = self.rules[rule_id]
            hit = (not rule.get("to") or rule["to"] == to) and (not rule.get("sid") or rule["sid"] == sid)
            if hit and (not rule.get("kind") or rule["kind"] == kind):
                if rule.get("times") is not None:
                    rule["times"] -= 1
                    if rule["times"] <= 0:
                        del self.rules[rule_id]
                return rule_id, rule
        return None, None

    def record(self, record: dict[str, Any], token_hash: str | None) -> None:
        record["seq"] = next(self.seq)
        self.by_seq[record["seq"]] = record
        self.token_hashes[record["seq"]] = token_hash
        if record["sid"]:
            self.by_sid[record["sid"]].append(record)
        if record["to"]:
            self.by_to[record["to"]].append(record)

    def find(self, to: str | None, sid: str | None, kind: str | None, since_seq: int,
             wanted: bool | None = None) -> list[dict[str, Any]]:
        if not to and not sid:
            raise ControlError(400, "target_required", "name to or sid")
        pool = self.by_to.get(to, []) if to else self.by_sid.get(sid, [])
        return [dict(r) for r in pool
                if (not sid or r["sid"] == sid) and (not kind or r["kind"] == kind) and r["seq"] > since_seq
                and (wanted is None or r["accepted"] is wanted)]

    def last_code(self, to: str | None) -> dict[str, Any]:
        if not to:
            raise ControlError(400, "target_required", "name to")
        for record in reversed(self.by_to.get(to, [])):
            found = record["kind"] == "sms" and record["accepted"] and CODE_SENTENCE_RE.fullmatch(record["body"] or "")
            if found:
                return {"code": found.group(1), "seq": record["seq"], "sid": record["sid"], "message_sid": record["resource_sid"]}
        raise ControlError(404, "no_code", "no accepted SMS to this number holds the exact verification sentence")

    def call_to_press(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or not (body.get("call_sid") or body.get("to")):
            raise ControlError(400, "target_required", "name call_sid or to")
        pool = self.by_to.get(body.get("to"), []) if body.get("to") else list(self.by_seq.values())
        calls = [r for r in pool if r["kind"] == "call" and r["accepted"]]
        if body.get("call_sid"):
            calls = [r for r in calls if r["resource_sid"] == body["call_sid"]]
        if not calls:
            raise ControlError(404, "no_such_call", "only a call Twilio accepted can ring")
        return dict(calls[-1])


def accepted_filter(value: str | None) -> bool | None:
    if value not in (None, "true", "false"):
        raise ControlError(400, "invalid_filter", "accepted must be true or false")
    return None if value is None else value == "true"


def check_sms(account: dict[str, Any], form: dict[str, str]) -> None:
    if not form.get("To"):
        raise TwilioError(400, 21604, "A 'To' phone number is required.")
    if not form.get("From"):
        raise TwilioError(400, 21603, "A 'From' or 'MessagingServiceSid' parameter is required to send a message.")
    if not form.get("Body"):
        raise TwilioError(400, 21602, "Message body is required.")
    if not E164_RE.fullmatch(form["To"]):
        raise TwilioError(400, 21211, f"Invalid 'To' Phone Number: {form['To']}")
    if not any(n["number"] == form["From"] and n["sms"] for n in account["numbers"]):
        raise TwilioError(400, 21606, "The 'From' number is not a valid message-capable Twilio number for this account.")
    if len(form["Body"]) > MAX_BODY_CHARS:
        raise TwilioError(400, 21617, "The concatenated message body exceeds the 1600 character limit.")


def check_call(account: dict[str, Any], form: dict[str, str], twiml_error: str | None) -> None:
    if not form.get("To"):
        raise TwilioError(400, 21201, "No 'To' number is specified.")
    if not form.get("From"):
        raise TwilioError(400, 21213, "No 'From' number is specified.")
    if not E164_RE.fullmatch(form["To"]):
        raise TwilioError(400, 21211, f"Invalid 'To' Phone Number: {form['To']}")
    # Twilio ignores Twiml when both come, but the server must never send Url, so this stays stricter than Twilio.
    if bool(form.get("Twiml")) == bool(form.get("Url")):
        raise TwilioError(400, 21205, "Exactly one of Twiml or Url is required.")
    if len(form.get("Twiml", "")) > MAX_TWIML_CHARS:
        raise TwilioError(400, 32018, "Twiml size exceeded maximum allowed value.")
    if not any(n["number"] == form["From"] and n["voice"] for n in account["numbers"]):
        raise TwilioError(400, 21210, "The source phone number provided is not yet verified for your account.")
    if twiml_error:
        raise TwilioError(400, 12100, "Document parse failure.")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *_args: Any, **_kwargs: Any) -> None:
        # Following a 3xx from O2 would turn a refusal into whatever the target answers.
        return None


UPSTREAM = build_opener(ProxyHandler({}), NoRedirect)


def post_form(url: str, form: dict[str, str]) -> tuple[int, str, str]:
    data = urlencode(form).encode()
    headers = {"Content-Type": "application/x-www-form-urlencoded", "User-Agent": "TwilioProxy/1.1"}
    try:
        with UPSTREAM.open(Request(url, data=data, headers=headers, method="POST"), timeout=O2_TIMEOUT_SECS) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read().decode(errors="replace")
    except HTTPError as e:
        return e.code, e.headers.get("Content-Type", ""), e.read().decode(errors="replace")
    except (URLError, OSError) as e:
        raise ControlError(502, "o2_unreachable", f"{url}: {e}") from e


def press_key(st: MockState, body: dict[str, Any]) -> dict[str, Any]:
    with st.lock:
        call = st.call_to_press(body)
        # A real caller answers the Gather they just heard, so a broken action in a reprompt must not pass.
        gather = st.reply_gathers.get(call["resource_sid"]) or (call["twiml_parsed"] or {}).get("gather")
    digits = body.get("digits")
    if digits is not None and not (isinstance(digits, str) and DIGITS_RE.fullmatch(digits)):
        raise ControlError(400, "invalid_digits", "digits must be keys of a phone pad")
    if gather is None or not gather.get("action"):
        raise ControlError(409, "no_gather", "this call has no <Gather> to press a key into")
    if (gather.get("method") or "POST") != "POST":
        raise ControlError(409, "gather_method_not_post", "the server always asks for POST")
    action = urlsplit(gather["action"])
    if not st.callback_host or action.hostname != st.callback_host:
        raise ControlError(409, "action_host_mismatch", f"action host is {action.hostname!r}, not {st.callback_host!r}")
    path = action.path + (f"?{action.query}" if action.query else "")
    form = {
        "CallSid": call["resource_sid"],
        "AccountSid": call["sid"],
        "From": call["from"],
        "To": call["to"],
        "CallStatus": "in-progress",
        "ApiVersion": API_VERSION,
        "Direction": "outbound-api",
    }
    keys = gathered_digits(digits, gather)
    if keys:
        form["Digits"] = keys
    status, content_type, raw = post_form(st.o2_url + path, form)
    answer = press_answer(status, content_type, raw, path, call["resource_sid"], form.get("Digits"))
    if status == 200 and answer["gather"]:
        with st.lock:
            st.reply_gathers[call["resource_sid"]] = answer["gather"]
    return answer


def press_answer(status: int, content_type: str, raw: str, path: str, call_sid: str, digits: str | None) -> dict[str, Any]:
    parsed, error = parse_twiml(raw)
    if error is None and content_type.split(";")[0].strip().lower() not in TWIML_CONTENT_TYPES:
        parsed, error = None, f"Content-Type {content_type!r} is not TwiML"
    parsed = parsed or {}
    return {
        "status": status,
        "content_type": content_type,
        "says": parsed.get("says", []),
        "hangup": parsed.get("hangup", False),
        "gather": parsed.get("gather"),
        "after_gather_says": parsed.get("after_gather_says", []),
        "action_path": path,
        "raw": raw,
        "twiml_error": error,
        "call_sid": call_sid,
        "digits_sent": digits,
    }


class TwilioMockHandler(BaseHTTPRequestHandler):
    server_version = "TwilioMock/1"
    state: MockState

    def log_message(self, fmt: str, *args: Any) -> None:
        log.debug(fmt, *args)

    def do_GET(self) -> None:  # noqa: N802
        self.dispatch(b"")

    def do_POST(self) -> None:  # noqa: N802
        self.dispatch(self.rfile.read(int(self.headers.get("Content-Length") or 0)))

    def do_DELETE(self) -> None:  # noqa: N802
        self.dispatch(self.rfile.read(int(self.headers.get("Content-Length") or 0)))

    def dispatch(self, raw: bytes) -> None:
        url = urlsplit(self.path)
        if url.path.startswith("/_mock/"):
            return self.control(url.path, url.query, raw)
        if url.path.startswith(API_PREFIX):
            return self.twilio(url.path, url.query, raw)
        return self.send_json(404, error_body(404, 20404, f"The requested resource {url.path} was not found"))

    def twilio(self, path: str, query_text: str, raw: bytes) -> None:
        st = self.state
        form = self.parse_form(raw)
        query = {k: v[-1] for k, v in parse_qs(query_text, keep_blank_values=True).items()}
        with st.lock:
            record = self.arrive(path, query, form)
            status, payload, rule = self.answer(record, form, query)
        delay = (rule or {}).get("delay_ms", 0)
        if delay and not self.wait_for_client(delay):
            return self.client_gone(record)
        self.finish_twilio(record, status, payload, rule)

    def arrive(self, path: str, query: dict[str, str], form: dict[str, str]) -> dict[str, Any]:
        """Records before anything can fail, so a client timeout still counts as an attempt."""
        match = PATH_SID_RE.fullmatch(path)
        sid, suffix = match.groups() if match else (None, "")
        user, token_hash = self.basic_auth()
        account = self.state.accounts.get(sid or "")
        auth_ok = bool(account and user == sid and token_hash and hmac.compare_digest(token_hash, account["token_sha256"]))
        twiml = form.get("Twiml")
        parsed, twiml_error = parse_twiml(twiml) if twiml else (None, None)
        body = form.get("Body")
        segments, encoding = sms_parts(body) if body is not None else (None, None)
        record = {
            "at": time.time(),
            "kind": ROUTES.get((self.command, suffix), "unsupported"),
            "method": self.command,
            "path": path,
            "query": query,
            "sid": sid,
            "auth_ok": auth_ok,
            "auth_user": user,
            "to": form.get("To"),
            "from": form.get("From"),
            "body": body,
            "twiml": twiml,
            "url": form.get("Url"),
            "segments": segments,
            "encoding": encoding,
            "twiml_parsed": parsed,
            "twiml_error": twiml_error,
            "resource_sid": None,
            "response_status": None,
            "rule_id": None,
            "client_gone": False,
            "accepted": None,
        }
        self.state.record(record, token_hash)
        return record

    def answer(self, record: dict[str, Any], form: dict[str, str], query: dict[str, str]) -> tuple[int, bytes, dict[str, Any] | None]:
        st = self.state
        try:
            if not record["auth_ok"]:
                raise TwilioError(401, 20003, "Authenticate")
            status, resource = self.route(record, st.accounts[record["sid"]], form, query)
        except TwilioError as e:
            return e.status, json.dumps(error_body(e.status, e.code, e.message)).encode(), None
        rule_id, rule = st.take_rule(record["kind"], record["sid"], record["to"])
        record["rule_id"] = rule_id
        if rule is None:
            return status, json.dumps(resource).encode(), None
        payload = rule_payload(rule)
        if payload is not None:
            record["resource_sid"] = None
        return rule.get("status", status), json.dumps(resource).encode() if payload is None else payload, rule

    def route(self, record: dict[str, Any], account: dict[str, Any], form: dict[str, str], query: dict[str, str]) -> tuple[int, dict[str, Any]]:
        kind, sid = record["kind"], record["sid"]
        # The 20003 page lists a suspended or closed account as a cause, so sending is refused like bad credentials.
        if kind in ("sms", "call") and account["status"] != "active":
            raise TwilioError(401, 20003, "Authenticate")
        if kind == "sms":
            check_sms(account, form)
            record["resource_sid"] = "SM" + uuid.uuid4().hex
            return 201, message_resource(sid, record["resource_sid"], form, record["segments"])
        if kind == "call":
            check_call(account, form, record["twiml_error"])
            record["resource_sid"] = "CA" + uuid.uuid4().hex
            return 201, call_resource(sid, record["resource_sid"], form)
        if kind == "account":
            return 200, account_resource(sid, account)
        if kind == "numbers":
            return 200, numbers_page(sid, account, query)
        if any(suffix == path_suffix(record["path"]) for _method, suffix in ROUTES):
            raise TwilioError(405, None, "Method not allowed")
        raise TwilioError(404, 20404, f"The requested resource {record['path']} was not found")

    def wait_for_client(self, delay_ms: int) -> bool:
        deadline = time.monotonic() + delay_ms / 1000
        while (left := deadline - time.monotonic()) > 0:
            ready, _, _ = select.select([self.connection], [], [], left)
            if ready:
                if not self.client_is_there():
                    return False
                time.sleep(min(left, 0.05))
        return self.client_is_there()

    def client_is_there(self) -> bool:
        self.connection.setblocking(False)
        try:
            return self.connection.recv(1, socket.MSG_PEEK) != b""
        except BlockingIOError:
            return True
        except OSError:
            return False
        finally:
            self.connection.setblocking(True)

    def client_gone(self, record: dict[str, Any]) -> None:
        with self.state.lock:
            record["client_gone"] = True
            record["accepted"] = False
            record["response_status"] = None
            record["resource_sid"] = None
        self.close_connection = True

    def finish_twilio(self, record: dict[str, Any], status: int, payload: bytes, rule: dict[str, Any] | None) -> None:
        ok = 200 <= status < 300
        with self.state.lock:
            record["response_status"] = status
            # A rule's own bytes are a scripted answer, so nothing was really sent even on a 2xx.
            record["accepted"] = ok and record["auth_ok"] and (rule is None or rule_payload(rule) is None)
            if not ok:
                record["resource_sid"] = None
        log.info("%s %s -> %s", record["method"], record["path"], status)
        headers = {"WWW-Authenticate": 'Basic realm="Twilio API"'} if status == 401 else {}
        if rule and rule.get("location"):
            headers["Location"] = rule["location"]
        try:
            self.send_bytes(status, "application/json", payload, headers)
        except (BrokenPipeError, ConnectionResetError):
            self.client_gone(record)

    def control(self, path: str, query_text: str, raw: bytes) -> None:
        query = {k: v[-1] for k, v in parse_qs(query_text).items()}
        try:
            body = json.loads(raw or b"{}")
            self.send_json(*self.control_route(path, query, body))
        except ValueError:
            self.send_json(400, {"error": "invalid_json"})
        except ControlError as e:
            self.send_json(e.status, {"error": e.error, "message": e.message})

    def control_route(self, path: str, query: dict[str, str], body: Any) -> tuple[int, dict[str, Any]]:
        route = (self.command, path)
        st = self.state
        if route == ("POST", "/_mock/press"):
            return 200, press_key(st, body)
        with st.lock:
            if route == ("GET", "/_mock/health"):
                return 200, {"ok": True, "protected_sids": sorted(st.protected), "callback_host": st.callback_host, "o2_url": st.o2_url}
            if route == ("POST", "/_mock/accounts"):
                return 200, {"sid": st.add_account(body)}
            if route == ("POST", "/_mock/fail"):
                return 200, {"rule_id": st.add_rule(body)}
            if route == ("GET", "/_mock/requests"):
                since = int(query.get("since_seq", 0))
                wanted = accepted_filter(query.get("accepted"))
                return 200, {"requests": st.find(query.get("to"), query.get("sid"), query.get("kind"), since, wanted)}
            if route == ("GET", "/_mock/last_code"):
                return 200, st.last_code(query.get("to"))
            if self.command == "DELETE" and path.startswith("/_mock/fail/"):
                st.remove_rule(path[len("/_mock/fail/"):])
                return 200, {"removed": True}
            seq = re.fullmatch(r"/_mock/requests/([0-9]+)/token_hash", path)
            if self.command == "GET" and seq and int(seq.group(1)) in st.token_hashes:
                return 200, {"sha256": st.token_hashes[int(seq.group(1))]}
        raise ControlError(404, "unknown_path", f"{self.command} {path}")

    def parse_form(self, raw: bytes) -> dict[str, str]:
        # Twilio takes form bodies, so a JSON body reads as no parameters and is refused, not parsed.
        if not self.headers.get("Content-Type", "").startswith("application/x-www-form-urlencoded"):
            return {}
        return {k: v[-1] for k, v in parse_qs(raw.decode(errors="replace"), keep_blank_values=True).items()}

    def basic_auth(self) -> tuple[str | None, str | None]:
        """The username and a hash of the password; the raw password is never kept."""
        header = self.headers.get("Authorization", "")
        if not header.startswith("Basic "):
            return None, None
        try:
            user, sep, token = base64.b64decode(header[len("Basic "):], validate=True).decode().partition(":")
        except ValueError:
            return None, None
        return user, hashlib.sha256(token.encode()).hexdigest() if sep else None

    def send_json(self, status: int, body: dict[str, Any]) -> None:
        self.send_bytes(status, "application/json", json.dumps(body).encode(), {})

    def send_bytes(self, status: int, content_type: str, data: bytes, headers: dict[str, str]) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        for k, v in headers.items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(data)


def path_suffix(path: str) -> str:
    match = PATH_SID_RE.fullmatch(path)
    return match.group(2) if match else ""


class TwilioMockServer(ThreadingHTTPServer):
    # The default backlog of 5 drops connections when a whole shard's sends arrive together.
    request_queue_size = 128


def make_server(port: int = 0, o2_url: str = DEFAULT_O2_URL, callback_host: str | None = None,
                deployment_account: tuple[str, str, str] | None = None) -> TwilioMockServer:
    server = TwilioMockServer((LOOPBACK, port), TwilioMockHandler)
    state = MockState(o2_url, callback_host)
    if deployment_account:
        sid, token, number = deployment_account
        state.add_account({"sid": sid, "token": token, "numbers": [{"number": number}]})
        state.protected.add(sid)
    server.state = state
    server.RequestHandlerClass = type("BoundTwilioMockHandler", (TwilioMockHandler,), {"state": state})
    return server


class TwilioMock:
    """Client of the control API; every refusal raises, so a helper cannot turn nothing happening into a pass."""

    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or os.environ.get("TWILIO_MOCK_URL") or f"http://{LOOPBACK}:{DEFAULT_PORT}").rstrip("/")

    def call(self, method: str, path: str, body: Any = None, query: dict[str, Any] | None = None) -> Any:
        clean = {k: v for k, v in (query or {}).items() if v is not None}
        url = f"{self.base_url}{path}" + (f"?{urlencode(clean)}" if clean else "")
        data = None if body is None else json.dumps(body).encode()
        request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
        try:
            with UPSTREAM.open(request, timeout=O2_TIMEOUT_SECS + 5) as resp:
                return json.loads(resp.read())
        except HTTPError as e:
            raw = e.read().decode(errors="replace")
            raise TwilioMockError(f"{method} {path}: HTTP {e.code}: {raw}", e.code, raw) from e

    def reachable(self) -> bool:
        try:
            return self.call("GET", "/_mock/health")["ok"] is True
        except (OSError, TwilioMockError, ValueError):
            return False

    def add_account(self, sid: str, token: str, *, status: str = "active", type: str = "Full",
                    numbers: list[dict[str, Any]] | None = None) -> None:
        body = {"sid": sid, "token": token, "status": status, "type": type, "numbers": numbers or []}
        self.call("POST", "/_mock/accounts", body)

    def fail(self, **rule: Any) -> str:
        return self.call("POST", "/_mock/fail", rule)["rule_id"]

    def clear_fail(self, rule_id: str) -> None:
        self.call("DELETE", f"/_mock/fail/{rule_id}")

    def requests(self, to: str | None = None, sid: str | None = None, kind: str | None = None,
                 since_seq: int | None = None, accepted: bool | None = None) -> list[dict[str, Any]]:
        query = {"to": to, "sid": sid, "kind": kind, "since_seq": since_seq,
                 "accepted": None if accepted is None else str(accepted).lower()}
        return self.call("GET", "/_mock/requests", query=query)["requests"]

    def wait_for(self, to: str, kind: str, count: int = 1, timeout: float = 45, *, sid: str | None = None,
                 since_seq: int | None = None, accepted: bool | None = True) -> list[dict[str, Any]]:
        """Accepted requests only by default, because a request the fake refused never reached a phone."""
        deadline = time.monotonic() + timeout
        while True:
            found = self.requests(to=to, sid=sid, kind=kind, since_seq=since_seq, accepted=accepted)
            if len(found) >= count:
                return found
            if time.monotonic() >= deadline:
                answers = [r["response_status"] for r in self.requests(to=to, sid=sid, kind=kind, since_seq=since_seq)]
                raise TwilioMockError(f"{kind} to {to}: saw {len(found)} of {count} with accepted={accepted} after "
                                      f"{timeout}s; every answer so far: {answers}", body=found)
            time.sleep(0.2)

    def last_code(self, to: str) -> str:
        return self.call("GET", "/_mock/last_code", query={"to": to})["code"]

    def token_hash(self, seq: int) -> str | None:
        return self.call("GET", f"/_mock/requests/{seq}/token_hash")["sha256"]

    def press(self, *, to: str | None = None, call_sid: str | None = None, digits: str | None = None,
              expect_status: int | None = 200) -> dict[str, Any]:
        """Raises when O2 refuses the press; pass ``expect_status`` to assert a refusal, or ``None`` to read any answer."""
        body = {k: v for k, v in {"to": to, "call_sid": call_sid, "digits": digits}.items() if v is not None}
        answer = self.call("POST", "/_mock/press", body)
        if expect_status is not None and answer["status"] != expect_status:
            raise TwilioMockError(f"press: O2 answered {answer['status']}, wanted {expect_status}", answer["status"], answer)
        if expect_status == 200 and answer["twiml_error"]:
            raise TwilioMockError(f"press: O2's 200 is not TwiML: {answer['twiml_error']}", 200, answer)
        return answer


def parse_deployment_account(value: str) -> tuple[str, str, str] | None:
    sid, _, rest = value.partition(":")
    token, _, number = rest.rpartition(":")
    return (sid, token, number) if sid and token and number else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--o2-url", default=DEFAULT_O2_URL)
    parser.add_argument("--callback-host", default=None)
    parser.add_argument("--deployment-account", default=None, metavar="SID:TOKEN:+FROM")
    args = parser.parse_args(argv)
    deployment = None
    if args.deployment_account is not None:
        deployment = parse_deployment_account(args.deployment_account)
        if deployment is None:
            # argparse's own errors echo the value, which holds the token.
            parser.error("--deployment-account must be SID:TOKEN:+FROM")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s twilio-mock %(message)s")
    try:
        server = make_server(args.port, args.o2_url, args.callback_host, deployment)
    except ControlError as e:
        parser.error(f"--deployment-account: {e.error}")
    sys.stderr.write(f"twilio mock listening on http://{LOOPBACK}:{server.server_address[1]}\n")
    sys.stderr.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
