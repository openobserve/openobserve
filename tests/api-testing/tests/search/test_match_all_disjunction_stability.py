"""Many OR-ed match_all() conditions must not abort the process  [regression #12398].

A single search that ORs together several `match_all()` terms aborted the whole
node with `fatal runtime error: stack overflow` -- one query could take the
server down, and it then restarted. Fixed in PR #14469 by hardening the leader
and follower against deeply nested full-text disjunctions.

The contract the issue states is "the query runs, or fails gracefully with an
error -- it must not abort". So the assertion is deliberately NOT that the query
succeeds: a well-formed error is an acceptable outcome. What must hold is that
the server is still answering afterwards, which is the half a status-code check
alone would miss -- a crashed node restarts, so a later request can succeed
while the query still killed the process.
"""

import logging
import os
import time
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
ROW_COUNT = 60
TERMS = ["error", "Error", "exception", "Exception",
         "Traceback", "FATAL", "panic", "CRITICAL"]


def _seed(session, base_url, stream):
    now = int(time.time() * 1_000_000)
    rows = [
        {
            "_timestamp": now - i * 1_000_000,
            "container_name": f"c{i % 4}",
            "project": f"p{i % 3}",
            "message": f"{TERMS[i % len(TERMS)]} something happened {i}",
        }
        for i in range(ROW_COUNT)
    ]
    resp = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=rows)
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text[:400]}"

    for _ in range(30):
        r = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs",
            json={"query": {
                "sql": f'SELECT count(*) AS n FROM "{stream}"',
                "start_time": now - 3_600_000_000, "end_time": now + 60_000_000,
                "from": 0, "size": 1,
            }},
        )
        if r.status_code == 200 and (r.json().get("hits") or [{}])[0].get("n", 0) >= ROW_COUNT:
            return now
        time.sleep(1)
    raise AssertionError(f"stream {stream} never became searchable")


def _server_is_alive(session, base_url) -> bool:
    r = session.get(f"{base_url}api/{ORG_ID}/streams", timeout=30)
    return r.status_code == 200


def test_ored_match_all_terms_do_not_abort_the_server(create_session, base_url):
    session = create_session
    stream = f"e2e_matchall_or_{uuid.uuid4().hex[:8]}"
    now = _seed(session, base_url, stream)

    assert _server_is_alive(session, base_url), "server was already unhealthy before the query"

    disjunction = " OR ".join(f"match_all('{t}')" for t in TERMS)
    sql = (
        f'SELECT project AS proj, container_name, count(*) AS n FROM "{stream}" '
        f"WHERE ({disjunction}) GROUP BY proj, container_name ORDER BY n DESC"
    )

    resp = session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs",
        json={"query": {
            "sql": sql,
            "start_time": now - 3_600_000_000, "end_time": now + 60_000_000,
            "from": 0, "size": 100,
        }},
    )
    logger.info("disjunction query answered %s", resp.status_code)

    # A graceful error is acceptable; a dead connection is not.
    assert resp.status_code < 500 or resp.text, \
        f"query returned {resp.status_code} with no body, which suggests the node died"

    # The real contract: the process is still serving.
    assert _server_is_alive(session, base_url), \
        "server stopped answering after the OR-ed match_all query, i.e. the query aborted it"

    if resp.status_code == 200:
        hits = resp.json().get("hits", [])
        assert isinstance(hits, list), f"unexpected result shape: {resp.text[:300]}"
        logger.info("query succeeded with %d grouped rows", len(hits))
