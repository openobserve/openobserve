"""
delete_fields must reject reserved columns — openobserve#14331.

PUT /api/{org}/streams/{stream}/delete_fields used to accept `_timestamp` and
answer 200 "fields deleted". With the column gone, every existing row became
unqueryable while search still returned 0 hits as a SUCCESS, so the data looked
like it had silently vanished.

This lives at the API level on purpose. The bug is unreachable from the product
— the Streams UI disables the `_timestamp` checkbox — and the Rust unit tests
around `stream::delete_fields` cover the service function, not the handler's
status code, which is the half that returned 200.

Reserved set comes from `StreamSettings::uds_internal_columns()`: `_timestamp`
and `_all` are always reserved regardless of stream settings.
"""

import logging
import os
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
ALWAYS_RESERVED = ["_timestamp", "_all"]


def _ingest(session, base_url, stream, rows):
    resp = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=rows)
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"
    return resp


def _delete_stream(session, base_url, stream):
    """Streams are not swept anywhere, so each test removes what it created."""
    session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs")


def _delete_fields(session, base_url, stream, fields):
    return session.put(
        f"{base_url}api/{ORG_ID}/streams/{stream}/delete_fields?type=logs",
        json={"fields": fields},
    )


def _search_hits(session, base_url, stream):
    now = int(time.time() * 1_000_000)
    resp = session.post(
        f"{base_url}api/{ORG_ID}/_search?type=logs",
        json={
            "query": {
                "sql": f'SELECT * FROM "{stream}"',
                "start_time": now - 3_600_000_000,
                "end_time": now,
                "from": 0,
                "size": 100,
            }
        },
    )
    assert resp.status_code == 200, f"search failed: {resp.status_code} {resp.text}"
    return resp.json().get("hits", [])


class TestDeleteFieldsReservedColumns:
    def test_reserved_columns_are_rejected(self, create_session, base_url, random_string):
        session = create_session
        stream = f"pytest_14331_{random_string(6).lower()}"
        _ingest(session, base_url, stream, [
            {"level": "info", "job": "pytest_14331", "message": f"seed {i}"} for i in range(5)
        ])
        time.sleep(3)

        try:
            assert len(_search_hits(session, base_url, stream)) > 0, \
                "Precondition: the seeded rows must be queryable before we try to break the stream"

            for field in ALWAYS_RESERVED:
                resp = _delete_fields(session, base_url, stream, [field])
                logger.info("delete_fields(%s) -> %s %s", field, resp.status_code, resp.text[:160])

                assert resp.status_code == 400, (
                    f"#14331: deleting reserved column {field} must be rejected with 400, "
                    f"got {resp.status_code} {resp.text}"
                )
                assert f"field [{field}] is reserved and cannot be deleted" in resp.text, (
                    f"#14331: the rejection for {field} must name it as reserved, got {resp.text}"
                )

            # The real damage was data going unqueryable, so prove it did not.
            assert len(_search_hits(session, base_url, stream)) > 0, \
                "#14331: the stream's data must remain queryable after a rejected delete_fields"
        finally:
            _delete_stream(session, base_url, stream)

    def test_reserved_column_is_rejected_even_alongside_a_deletable_field(
        self, create_session, base_url, random_string
    ):
        """A mixed payload must fail as a whole rather than partially applying."""
        session = create_session
        stream = f"pytest_14331_mix_{random_string(6).lower()}"
        _ingest(session, base_url, stream, [
            {"level": "warn", "job": "pytest_14331", "droppable": "x", "message": f"seed {i}"}
            for i in range(5)
        ])
        time.sleep(3)

        try:
            resp = _delete_fields(session, base_url, stream, ["droppable", "_timestamp"])
            logger.info("mixed delete_fields -> %s %s", resp.status_code, resp.text[:160])
            assert resp.status_code == 400, (
                f"#14331: a payload containing a reserved column must be rejected outright, "
                f"got {resp.status_code} {resp.text}"
            )

            assert len(_search_hits(session, base_url, stream)) > 0, \
                "#14331: a rejected mixed payload must leave the stream queryable"
        finally:
            _delete_stream(session, base_url, stream)

    def test_a_normal_field_can_still_be_deleted(self, create_session, base_url, random_string):
        """Guards against the fix over-reaching into a blanket rejection."""
        session = create_session
        stream = f"pytest_14331_ok_{random_string(6).lower()}"
        _ingest(session, base_url, stream, [
            {"level": "info", "job": "pytest_14331", "droppable": "x", "message": f"seed {i}"}
            for i in range(5)
        ])
        time.sleep(3)

        try:
            resp = _delete_fields(session, base_url, stream, ["droppable"])
            logger.info("delete_fields(droppable) -> %s %s", resp.status_code, resp.text[:160])
            assert resp.status_code == 200, (
                f"#14331: a non-reserved field must still be deletable, "
                f"got {resp.status_code} {resp.text}"
            )
        finally:
            _delete_stream(session, base_url, stream)
