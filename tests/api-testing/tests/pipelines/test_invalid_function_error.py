"""A malformed function must error, not panic  [regression #7708].

Adding an incorrect function surfaced a panic rather than a usable error, so the
caller saw a failure with no indication of what was wrong -- and a panicking
request path is a liveness risk.

Asserting only the status would be weak: the contract is a *usable* error (a
message naming the problem) AND a server still answering afterwards, since a
panic can take the request down while the process restarts behind it.
"""

import logging
import os

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
BAD_VRL = ".x = this is not valid vrl ((("


def _alive(session, base_url):
    return session.get(f"{base_url}api/{ORG_ID}/streams", timeout=30).status_code == 200


def test_malformed_function_returns_a_usable_error(create_session, base_url):
    session = create_session
    assert _alive(session, base_url), "server was already unhealthy before the request"

    resp = session.post(
        f"{base_url}api/{ORG_ID}/functions/test",
        json={"function": BAD_VRL, "events": [{"a": 1}]},
    )
    logger.info("malformed function answered %s", resp.status_code)

    assert 400 <= resp.status_code < 500, \
        f"a malformed function should be a client error, got {resp.status_code}: {resp.text[:300]}"

    body = resp.text.lower()
    assert "error" in body or "syntax" in body, \
        f"the response should explain what is wrong, got {resp.text[:300]}"
    assert "panic" not in body, f"a panic leaked into the response: {resp.text[:300]}"

    # A panicking path can answer and still have taken the worker down.
    assert _alive(session, base_url), "server stopped answering after the malformed function"


def test_valid_function_still_works(create_session, base_url):
    """Control: the rejection is about the function, not all requests."""
    session = create_session
    resp = session.post(
        f"{base_url}api/{ORG_ID}/functions/test",
        json={"function": '.added = "ok"\n.', "events": [{"a": 1}]},
    )
    assert resp.status_code == 200, f"a valid function must succeed: {resp.status_code} {resp.text[:300]}"
    results = resp.json().get("results", [])
    assert results and results[0].get("event", {}).get("added") == "ok", \
        f"the valid function did not apply: {resp.text[:300]}"
