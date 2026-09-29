"""OTLP log severity must be consistent  [regression #14639].

`severity` was stored as `severityText` when the record set it and as the raw
`severityNumber` otherwise, so the same level landed as `"ERROR"` from one
exporter and `17` from another. The column type then depended on which record
arrived first, and the log viewer read a numeric severity as a syslog level.
PR #14791 derives the text from the number and keeps the number alongside.

Both records carry severityNumber 17, differing only in whether severityText is
set, so any divergence between them is the defect.
"""

import logging
import os
import time
import uuid

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
SEVERITY_NUMBER = 17          # OTLP ERROR


def test_severity_is_derived_when_only_the_number_is_sent(create_session, base_url):
    session = create_session
    tag_with = f"withtext_{uuid.uuid4().hex[:6]}"
    tag_without = f"numonly_{uuid.uuid4().hex[:6]}"
    t_ns = int(time.time() * 1e9) - 180 * 10**9

    def record(offset_ns, tag, with_text):
        rec = {
            "timeUnixNano": str(t_ns + offset_ns),
            "severityNumber": SEVERITY_NUMBER,
            "body": {"stringValue": f"probe {tag}"},
            "attributes": [{"key": "probe_tag", "value": {"stringValue": tag}}],
        }
        if with_text:
            rec["severityText"] = "ERROR"
        return rec

    payload = {"resourceLogs": [{
        "resource": {"attributes": [{"key": "service.name",
                                     "value": {"stringValue": "pytest_severity"}}]},
        "scopeLogs": [{"scope": {"name": "pytest"}, "logRecords": [
            record(0, tag_with, True),
            record(10**6, tag_without, False),
        ]}],
    }]}
    r = session.post(f"{base_url}api/{ORG_ID}/v1/logs", json=payload)
    assert r.status_code == 200, f"OTLP log ingest failed: {r.status_code} {r.text[:300]}"

    now_us = int(time.time() * 1_000_000)
    rows = []
    for _ in range(30):
        q = session.post(
            f"{base_url}api/{ORG_ID}/_search?type=logs",
            json={"query": {
                "sql": 'SELECT probe_tag, severity, severity_number FROM "default" '
                       f"WHERE probe_tag IN ('{tag_with}','{tag_without}')",
                "start_time": now_us - 600_000_000, "end_time": now_us + 60_000_000,
                "from": 0, "size": 10}},
        )
        if q.status_code == 200 and len(q.json().get("hits", [])) >= 2:
            rows = q.json()["hits"]
            break
        time.sleep(2)
    assert len(rows) >= 2, f"both log records never became searchable, got {rows}"

    by_tag = {r_["probe_tag"]: r_ for r_ in rows}
    logger.info("severity by tag: %s",
                {k: (v.get("severity"), v.get("severity_number")) for k, v in by_tag.items()})

    sev_with = by_tag[tag_with].get("severity")
    sev_without = by_tag[tag_without].get("severity")

    # The defect stored the raw number here, giving two representations of one level.
    assert sev_without == sev_with, \
        (f"severity must not depend on whether severityText was sent: "
         f"with-text={sev_with!r} number-only={sev_without!r}")
    assert str(sev_without).upper() == "ERROR", \
        f"severityNumber {SEVERITY_NUMBER} should derive ERROR, got {sev_without!r}"

    # The number must survive alongside the derived text.
    for tag, row in by_tag.items():
        assert row.get("severity_number") == SEVERITY_NUMBER, \
            f"{tag} lost its severity_number: {row.get('severity_number')!r}"
