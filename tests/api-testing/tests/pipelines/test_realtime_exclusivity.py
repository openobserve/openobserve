"""
Only one realtime pipeline per source stream — openobserve#6443.

The UI allowed one realtime pipeline per stream; the API had no such validation.
`save_pipeline` now rejects a second one with 400 "A realtime pipeline with same
source stream already exists" (src/core/src/pipeline/mod.rs).

Verified against a local debug build before these assertions were written:
status 400 and that exact message.

The `source` object MUST carry `org_id`. The guard compares the incoming source
against `list_streams_with_pipeline`, whose entries are fully qualified, so a
payload omitting `org_id` compares unequal and slips past the check — see
`test_source_without_org_id_documents_the_bypass` at the end, which records that
gap rather than asserting the desired behaviour.
"""

import logging
import os
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
DUPLICATE_MSG = "A realtime pipeline with same source stream already exists"


def _ingest(session, base_url, stream):
    resp = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=[{"a": 1}])
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"


def _realtime_pipeline(name, stream, include_org_id=True):
    source = {"source_type": "realtime", "stream_name": stream, "stream_type": "logs"}
    if include_org_id:
        source["org_id"] = ORG_ID
    return {
        "name": name,
        "description": "",
        "source": source,
        "nodes": [
            {
                "id": "n1",
                "data": {"node_type": "stream", "stream_name": stream,
                         "stream_type": "logs", "org_id": ORG_ID},
                "position": {"x": 0, "y": 0},
                "io_type": "input",
            },
            {
                "id": "n2",
                "data": {"node_type": "stream", "stream_name": f"{stream}_out",
                         "stream_type": "logs", "org_id": ORG_ID},
                "position": {"x": 200, "y": 0},
                "io_type": "output",
            },
        ],
        "edges": [{"id": "e1", "source": "n1", "target": "n2"}],
        "org": ORG_ID,
    }


def _create(session, base_url, payload):
    return session.post(f"{base_url}api/{ORG_ID}/pipelines", json=payload)


def _delete_by_name(session, base_url, name):
    resp = session.get(f"{base_url}api/{ORG_ID}/pipelines")
    if resp.status_code != 200:
        return
    for p in resp.json().get("list", []):
        if p.get("name") == name:
            session.delete(f"{base_url}api/{ORG_ID}/pipelines/{p['pipeline_id']}")


class TestRealtimePipelineExclusivity:
    def test_second_realtime_pipeline_on_same_stream_is_rejected(
        self, create_session, base_url, random_string
    ):
        session = create_session
        suffix = random_string(6).lower()
        stream = f"pytest_6443_{suffix}"
        first, second = f"pytest6443a{suffix}", f"pytest6443b{suffix}"

        _ingest(session, base_url, stream)
        time.sleep(3)
        try:
            resp = _create(session, base_url, _realtime_pipeline(first, stream))
            assert resp.status_code == 200, \
                f"Precondition: the first realtime pipeline must be accepted, got {resp.status_code} {resp.text}"
            time.sleep(3)

            resp = _create(session, base_url, _realtime_pipeline(second, stream))
            logger.info("second realtime pipeline -> %s %s", resp.status_code, resp.text[:200])

            assert resp.status_code == 400, (
                f"#6443: a second realtime pipeline on {stream} must be rejected with 400, "
                f"got {resp.status_code} {resp.text}"
            )
            assert DUPLICATE_MSG in resp.text, (
                f"#6443: the rejection must name the duplicate source stream, got {resp.text}"
            )

            # The rejection must not have created anything.
            listing = session.get(f"{base_url}api/{ORG_ID}/pipelines").json().get("list", [])
            names = [p.get("name") for p in listing]
            assert second not in names, \
                f"#6443: the rejected pipeline must not be persisted, found it in {names}"
        finally:
            _delete_by_name(session, base_url, first)
            _delete_by_name(session, base_url, second)

    def test_realtime_pipelines_on_different_streams_are_both_allowed(
        self, create_session, base_url, random_string
    ):
        """Guards against the exclusivity check over-reaching across streams."""
        session = create_session
        suffix = random_string(6).lower()
        stream_a, stream_b = f"pytest_6443_a_{suffix}", f"pytest_6443_b_{suffix}"
        name_a, name_b = f"pytest6443sa{suffix}", f"pytest6443sb{suffix}"

        _ingest(session, base_url, stream_a)
        _ingest(session, base_url, stream_b)
        time.sleep(3)
        try:
            for name, stream in ((name_a, stream_a), (name_b, stream_b)):
                resp = _create(session, base_url, _realtime_pipeline(name, stream))
                assert resp.status_code == 200, (
                    f"#6443: exclusivity is per stream, so {name} on {stream} must be accepted, "
                    f"got {resp.status_code} {resp.text}"
                )
                time.sleep(2)
        finally:
            _delete_by_name(session, base_url, name_a)
            _delete_by_name(session, base_url, name_b)

    def test_source_without_org_id_documents_the_bypass(
        self, create_session, base_url, random_string
    ):
        """
        Records a real gap rather than the desired behaviour: with `org_id`
        omitted from `source`, the incoming stream compares unequal to the
        fully-qualified entries in `list_streams_with_pipeline`, so the
        exclusivity check is skipped and a second realtime pipeline is accepted.

        Flip this to expect 400 when the comparison is made org-agnostic, or
        when `org_id` becomes required on the source.
        """
        session = create_session
        suffix = random_string(6).lower()
        stream = f"pytest_6443_noorg_{suffix}"
        first, second = f"pytest6443na{suffix}", f"pytest6443nb{suffix}"

        _ingest(session, base_url, stream)
        time.sleep(3)
        try:
            resp = _create(session, base_url, _realtime_pipeline(first, stream, include_org_id=False))
            assert resp.status_code == 200, f"first: {resp.status_code} {resp.text}"
            time.sleep(3)

            resp = _create(session, base_url, _realtime_pipeline(second, stream, include_org_id=False))
            logger.info("second (no org_id in source) -> %s %s", resp.status_code, resp.text[:200])
            assert resp.status_code == 200, (
                "#6443: this test records the org_id bypass — a 400 here means the gap is "
                f"closed and the assertion should be inverted. Got {resp.status_code} {resp.text}"
            )
        finally:
            _delete_by_name(session, base_url, first)
            _delete_by_name(session, base_url, second)
