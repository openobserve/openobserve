"""RUM must record the real client IP, not the proxy's  [regression #11377].

Behind a proxy every RUM record was attributed to the proxy (or loopback), so
per-user geo and IP were meaningless. PR #11378 resolves the address through
`RealIp`, which honours the forwarded header, and stores it as `ip`.

The test sends the beacon with an explicit `X-Forwarded-For` and asserts the
stored value is that address rather than a loopback one -- asserting merely that
`ip` is non-empty would pass on the unfixed build, which happily stored the
proxy address.
"""

import logging
import os
import time
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
FORWARDED_IP = "203.0.113.7"          # TEST-NET-3, never a real client
LOOPBACK = {"127.0.0.1", "::1"}


def _rum_token(session, base_url):
    r = session.get(f"{base_url}api/{ORG_ID}/rumtoken")
    assert r.status_code == 200, f"rum token fetch failed: {r.status_code} {r.text[:200]}"
    body = r.json()
    token = (body.get("data") or {}).get("rum_token") or body.get("rum_token")
    assert token, f"no rum token in response: {body}"
    return token


def test_forwarded_client_ip_is_recorded(create_session, base_url):
    session = create_session
    token = _rum_token(session, base_url)
    service = f"pytest_realip_{uuid.uuid4().hex[:8]}"

    beacon = {
        "type": "view",
        "date": int(time.time() * 1000),
        "service": service,
        "application": {"id": "pytest_realip"},
        "session": {"id": uuid.uuid4().hex},
        "view": {"id": uuid.uuid4().hex, "url": "http://example.test/"},
    }
    resp = session.post(
        f"{base_url}rum/v1/{ORG_ID}/rum",
        params={"oo-api-key": token},
        headers={"X-Forwarded-For": FORWARDED_IP},
        json=beacon,
    )
    assert resp.status_code in (200, 202), \
        f"rum ingest failed: {resp.status_code} {resp.text[:300]}"

    # RUM records carry their own `date`, so query a wide window rather than
    # assuming the row lands near "now".
    now_us = int(time.time() * 1_000_000)
    row = None
    for _ in range(30):
        q = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs",
            json={"query": {
                "sql": f"SELECT ip, service FROM \"_rumdata\" WHERE service = '{service}'",
                "start_time": now_us - 86_400_000_000, "end_time": now_us + 60_000_000,
                "from": 0, "size": 5}},
        )
        if q.status_code == 200 and q.json().get("hits"):
            row = q.json()["hits"][0]
            break
        time.sleep(2)

    assert row, f"the RUM beacon for {service} never became searchable"
    logger.info("stored RUM ip: %s", row.get("ip"))

    assert row.get("ip") not in LOOPBACK, \
        f"the proxy/loopback address was recorded instead of the client: {row.get('ip')}"
    assert row.get("ip") == FORWARDED_IP, \
        f"expected the forwarded client IP {FORWARDED_IP}, got {row.get('ip')!r}"
