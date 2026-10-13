"""Alert templates render the window bounds in epoch milliseconds (#9031).

`{alert_start_time}` and `{alert_end_time}` are formatted text, so a template could not
build a URL that takes epoch milliseconds. A realtime alert here delivers its
notification back into this instance's own ingest API (a sink stream, as in
multialert_helpers.py), and the test reads the rendered template from that stream.
A realtime alert's window starts at the matching record's `_timestamp`.
"""

import logging
import os
import time

from support.wait import wait_until

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
logger = logging.getLogger(__name__)

TEMPLATE_BODY = (
    '{"start_millis": "{alert_start_time_millis}", '
    '"end_millis": "{alert_end_time_millis}", '
    '"start": "{alert_start_time}"}'
)


def test_template_renders_window_bounds_in_epoch_millis(create_session, base_url):
    session = create_session
    suffix = int(time.time() * 1000)
    source, sink = f"tpl_millis_src_{suffix}", f"tpl_millis_sink_{suffix}"
    template, destination = f"tpl_millis_{suffix}", f"dest_millis_{suffix}"
    alert_name = f"alert_millis_{suffix}"
    alert_id = None
    try:
        resp = session.post(
            f"{base_url}api/{ORG_ID}/alerts/templates",
            json={"name": template, "body": TEMPLATE_BODY, "type": "http", "title": ""},
        )
        assert resp.status_code == 200, f"create template: {resp.status_code} {resp.text}"
        resp = session.post(
            f"{base_url}api/{ORG_ID}/alerts/destinations",
            json={
                "name": destination,
                "url": f"{base_url}api/{ORG_ID}/{sink}/_json",
                "method": "post",
                "template": template,
                "type": "http",
                "headers": {"Authorization": session.headers["Authorization"]},
            },
        )
        assert resp.status_code == 200, f"create destination: {resp.status_code} {resp.text}"

        # the alert's stream has to exist before the alert is created
        resp = session.post(f"{base_url}api/{ORG_ID}/{source}/_json", json=[{"level": "seed"}])
        assert resp.status_code == 200, f"seed source stream: {resp.status_code} {resp.text}"
        resp = session.post(
            f"{base_url}api/v2/{ORG_ID}/alerts?type=logs",
            json={
                "name": alert_name,
                "stream_type": "logs",
                "stream_name": source,
                "is_real_time": True,
                "query_condition": {
                    "type": "custom",
                    "conditions": [{"column": "level", "operator": "=", "value": "error", "type": None, "id": "c1"}],
                },
                "trigger_condition": {
                    "period": 10,
                    "operator": ">=",
                    "threshold": 1,
                    "silence": 10,
                    "frequency": 1,
                    "frequency_type": "minutes",
                },
                "destinations": [destination],
                "enabled": True,
            },
        )
        assert resp.status_code == 200, f"create alert: {resp.status_code} {resp.text}"
        alert_id = resp.json().get("id")

        sent = []

        def ingest_match():
            ts = int(time.time() * 1_000_000)
            resp = session.post(
                f"{base_url}api/{ORG_ID}/{source}/_json",
                json=[{"_timestamp": ts, "level": "error"}],
            )
            assert resp.status_code == 200, f"ingest matching record: {resp.status_code} {resp.text}"
            sent.append(ts)

        ingest_match()

        def delivered():
            now = int(time.time() * 1_000_000)
            resp = session.post(
                f"{base_url}api/{ORG_ID}/_search?type=logs&use_cache=false",
                json={
                    "query": {
                        "sql": f'SELECT * FROM "{sink}"',
                        "start_time": sent[0] - 600_000_000,
                        "end_time": now + 60_000_000,
                        "from": 0,
                        "size": 10,
                    }
                },
            )
            hits = resp.json().get("hits", []) if resp.status_code == 200 else []
            if hits:
                return hits[0]
            # a record ingested before the new alert reached the ingest path cannot fire it
            if now - sent[-1] > 10_000_000:
                ingest_match()
            return None

        hit = wait_until(delivered, timeout=90, interval=2, msg="notification in the sink stream")
        logger.info("rendered notification: %s (matching records sent at %s)", hit, sent)

        # a realtime alert's window starts at the matching record's _timestamp
        assert hit["start_millis"] in {str(ts // 1000) for ts in sent}, hit
        assert hit["end_millis"].isdigit(), hit
        assert int(hit["end_millis"]) >= int(hit["start_millis"]), hit
        # the formatted variant is still text, unchanged by this
        assert not hit["start"].isdigit(), hit
    finally:
        if alert_id:
            session.delete(f"{base_url}api/v2/{ORG_ID}/alerts/{alert_id}?folder=default")
        session.delete(f"{base_url}api/{ORG_ID}/alerts/destinations/{destination}")
        session.delete(f"{base_url}api/{ORG_ID}/alerts/templates/{template}")
        for stream in (source, sink):
            session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs")
