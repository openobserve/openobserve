"""
update_fields must refuse a type change it does not apply — openobserve#14995.

PUT /api/{org}/streams/{stream}/update_fields answered 200 "fields updated" for a
change to an existing field that is not a widening (Utf8 -> Int64), which the
schema merge never applies. The field kept its old type, and in a request that
also carried a widening change, only that one was applied.

This lives at the API level because the half that misreported is the handler's
status code; the Rust unit tests around `stream::update_fields_type` cover the
service function.
"""

import logging
import os
import time

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")


def _ingest(session, base_url, stream, rows):
    resp = session.post(f"{base_url}api/{ORG_ID}/{stream}/_json", json=rows)
    assert resp.status_code == 200, f"ingest failed: {resp.status_code} {resp.text}"


def _delete_stream(session, base_url, stream):
    """Streams are not swept anywhere, so each test removes what it created."""
    session.delete(f"{base_url}api/{ORG_ID}/streams/{stream}?type=logs")


def _update_fields(session, base_url, stream, fields):
    return session.put(
        f"{base_url}api/{ORG_ID}/streams/{stream}/update_fields?type=logs",
        json={"fields": [{"name": name, "data_type": data_type, "nullable": True}
                         for name, data_type in fields]},
    )


def _schema(session, base_url, stream):
    resp = session.get(f"{base_url}api/{ORG_ID}/streams/{stream}/schema?type=logs")
    assert resp.status_code == 200, f"schema read failed: {resp.status_code} {resp.text}"
    return resp.json()


def _field_types(session, base_url, stream):
    return {f["name"]: f["type"] for f in _schema(session, base_url, stream).get("schema", [])}


def _wait_for_types(session, base_url, stream, expected, timeout=30):
    types = {}
    for _ in range(timeout * 2):
        types = _field_types(session, base_url, stream)
        if all(types.get(name) == data_type for name, data_type in expected.items()):
            return types
        time.sleep(0.5)
    raise AssertionError(f"expected field types {expected}, the schema has {types}")


class TestUpdateFieldsTypeChange:
    def test_a_change_that_is_not_a_widening_is_rejected(self, create_session, base_url, random_string):
        session = create_session
        stream = f"pytest_14995_{random_string(6).lower()}"
        _ingest(session, base_url, stream, [{"status_code": "200", "count": 5}])

        try:
            _wait_for_types(session, base_url, stream, {"status_code": "Utf8", "count": "Int64"})

            for data_type in ["Int64", "UInt64", "Float64", "Boolean"]:
                resp = _update_fields(session, base_url, stream, [("status_code", data_type)])
                logger.info("update_fields(status_code -> %s) -> %s %s", data_type, resp.status_code, resp.text[:160])

                assert resp.status_code == 400, (
                    f"#14995: status_code Utf8 -> {data_type} is not applied, so it must be rejected with 400, "
                    f"got {resp.status_code} {resp.text}"
                )
                assert f"field [status_code] is Utf8 and cannot be changed to {data_type}" in resp.text, (
                    f"#14995: the rejection must name the field and both types, got {resp.text}"
                )
        finally:
            _delete_stream(session, base_url, stream)

    def test_a_mixed_request_is_rejected_as_a_whole(self, create_session, base_url, random_string):
        """The applicable change must not go through while the response reports an error."""
        session = create_session
        stream = f"pytest_14995_mix_{random_string(6).lower()}"
        _ingest(session, base_url, stream, [{"status_code": "200", "count": 5}])

        try:
            _wait_for_types(session, base_url, stream, {"status_code": "Utf8", "count": "Int64"})

            resp = _update_fields(session, base_url, stream, [("count", "Float64"), ("status_code", "Int64")])
            logger.info("mixed update_fields -> %s %s", resp.status_code, resp.text[:160])
            assert resp.status_code == 400, (
                f"#14995: a request with a change that is not applied must be rejected outright, "
                f"got {resp.status_code} {resp.text}"
            )

            count_type = _field_types(session, base_url, stream)["count"]
            assert count_type == "Int64", \
                f"#14995: a rejected request must not apply its other changes, count is {count_type}"
        finally:
            _delete_stream(session, base_url, stream)

    def test_widening_and_new_fields_are_still_applied(self, create_session, base_url, random_string):
        """Guards against the fix over-reaching into a blanket rejection."""
        session = create_session
        stream = f"pytest_14995_ok_{random_string(6).lower()}"
        _ingest(session, base_url, stream, [{"status_code": "200", "count": 5}])

        try:
            _wait_for_types(session, base_url, stream, {"status_code": "Utf8", "count": "Int64"})

            resp = _update_fields(session, base_url, stream, [
                ("count", "Float64"), ("status_code", "LargeUtf8"), ("new_field", "Int64"),
            ])
            logger.info("update_fields(widening + new field) -> %s %s", resp.status_code, resp.text[:160])
            assert resp.status_code == 200, (
                f"#14995: widening changes and a new field must still be accepted, "
                f"got {resp.status_code} {resp.text}"
            )
            _wait_for_types(session, base_url, stream,
                            {"count": "Float64", "status_code": "LargeUtf8", "new_field": "Int64"})
        finally:
            _delete_stream(session, base_url, stream)
