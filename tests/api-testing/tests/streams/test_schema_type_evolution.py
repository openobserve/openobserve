"""Boolean to numeric schema evolution  [regression #10475].

A field first seen as a boolean and later as a number was rejected, because
`is_widening_conversion` did not permit boolean widening. PR #10478 expanded the
allowed conversions so the schema evolves instead of failing the write.

The second ingest is the contract. Asserting only that the first succeeds would
pass on any build, so the test checks the later records are accepted AND that
both generations are queryable afterwards -- a build that accepted the write but
dropped the rows would otherwise look fixed.
"""

import logging
import os
import time
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")


def _window():
    now = int(time.time() * 1_000_000)
    return now - 3_600_000_000, now + 60_000_000


def _search(session, base_url, sql):
    start, end = _window()
    return session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs",
        json={"query": {"sql": sql, "start_time": start, "end_time": end,
                        "from": 0, "size": 100}},
    )


def test_boolean_field_widens_to_numeric(create_session, base_url):
    session = create_session
    stream = f"e2e_evolve_{uuid.uuid4().hex[:8]}"
    now = int(time.time() * 1_000_000)

    bool_rows = [{"_timestamp": now - 5_000_000 + i, "job": "pytest_evolve",
                  "flag": True, "tag": "boolgen"} for i in range(3)]
    r1 = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=bool_rows)
    assert r1.status_code == 200, f"boolean ingest failed: {r1.status_code} {r1.text[:300]}"

    num_rows = [{"_timestamp": now + i, "job": "pytest_evolve",
                 "flag": 7, "tag": "numgen"} for i in range(3)]
    r2 = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=num_rows)
    assert r2.status_code == 200, f"numeric ingest failed: {r2.status_code} {r2.text[:300]}"
    body = r2.json()
    failed = sum(s.get("failed", 0) for s in body.get("status", []))
    logger.info("numeric generation ingest status: %s", body.get("status"))
    assert failed == 0, f"numeric records were rejected after a boolean field: {body}"

    for _ in range(30):
        resp = _search(session, base_url, f'SELECT tag, flag FROM "{stream}"')
        if resp.status_code == 200 and len(resp.json().get("hits", [])) >= 6:
            break
        time.sleep(1)
    assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text[:300]}"

    tags = [h.get("tag") for h in resp.json()["hits"]]
    logger.info("rows visible after evolution: %s", sorted(tags))
    assert tags.count("boolgen") == 3, f"boolean-generation rows lost: {tags}"
    assert tags.count("numgen") == 3, f"numeric-generation rows lost: {tags}"
