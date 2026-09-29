"""OTLP log severity must not depend on which fields the exporter happened to set.

Regression test for o2-enterprise#2661: ``severity`` was written straight from
whatever arrived, so ``severityNumber: 17`` with ``severityText: "ERROR"``
stored ``"ERROR"`` while ``severityNumber: 17`` alone stored ``"17"``. Both are
ERROR in OTel, so ``WHERE severity = 'ERROR'`` silently returned only the
records whose exporter set the text field — two SDKs writing to one stream split
the same level across two values, and the column's *type* varied by stream
(integer where only numbers ever arrived).

Both records go into ONE stream in ONE request, which is the case that broke:
the split is only visible when the two forms share a column.
"""
from __future__ import annotations

import logging
import uuid

from support.otlp_json import SEVERITY_NUMBER_ERROR, log_record, logs_request, now_unix_nano
from support.wait import wait_until

logger = logging.getLogger(__name__)

SEARCH_MINUTES = 30


def test_severity_text_is_derived_from_severity_number(client):
    stream = f"otlp_sev_{uuid.uuid4().hex[:8]}"
    ts = now_unix_nano()
    payload = logs_request(
        [
            log_record(
                "exporter set both",
                time_unix_nano=ts,
                severity_number=SEVERITY_NUMBER_ERROR,
                severity_text="ERROR",
            ),
            log_record(
                "exporter set the number only",
                time_unix_nano=ts,
                severity_number=SEVERITY_NUMBER_ERROR,
            ),
        ]
    )

    resp = client.post("v1/logs", json=payload, headers={"stream-name": stream})
    assert resp.status_code == 200, resp.text

    def both_rows():
        rows = client.search.sql(
            f'SELECT severity FROM "{stream}"',
            minutes=SEARCH_MINUTES,
            raise_for_status=False,
        )
        if rows.status_code != 200:
            return None
        hits = rows.json().get("hits", [])
        return hits if len(hits) == 2 else None

    hits = wait_until(both_rows, timeout=60, interval=2, msg=f"2 rows in {stream}")

    severities = {str(h.get("severity")) for h in hits}
    assert severities == {"ERROR"}, (
        "a record carrying only severityNumber=17 must still store ERROR, so that "
        f"severity = 'ERROR' finds both records; got {sorted(severities)}"
    )
