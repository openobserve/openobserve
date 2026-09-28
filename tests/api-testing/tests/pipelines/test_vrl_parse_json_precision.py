"""VRL parse_json must not leak serde_json's private number wrapper  [#10919].

With `serde_json` built with `arbitrary_precision`, a high-precision number
deserialises into an object keyed `$serde_json::private::Number` rather than a
scalar. `parse_json` in VRL passed that object straight through, so flattening
produced a field literally named `__serde_json__private__number` instead of the
value. PR #10920 detects the wrapper and converts it to a float.

The assertion is therefore twofold: the parsed value must be numeric, AND no
field carrying the private wrapper's name may appear anywhere in the event --
checking only the value would miss the wrapper leaking alongside it.
"""

import logging
import os

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")

# Enough digits that serde_json cannot hold it as a plain f64/i64.
HIGH_PRECISION = "12345678901234567890.123456789"


def _run_vrl(session, base_url, function, events):
    resp = session.post(
        f"{base_url}api/{ORG_ID}/functions/test",
        json={"function": function, "events": events},
    )
    assert resp.status_code == 200, \
        f"function test failed: {resp.status_code} {resp.text[:300]}"
    results = resp.json().get("results", [])
    assert results, f"no results returned: {resp.text[:300]}"
    return results[0].get("event", {})


def test_parse_json_yields_a_number_for_high_precision_input(create_session, base_url):
    event = _run_vrl(
        create_session, base_url,
        ".parsed = parse_json!(.payload)\n.",
        [{"payload": '{"big": ' + HIGH_PRECISION + '}'}],
    )
    logger.info("parsed event keys: %s", sorted(event.keys()))

    assert "parsed_big" in event, f"the parsed number is missing: {event}"
    assert isinstance(event["parsed_big"], (int, float)), \
        f"parse_json must yield a number, got {type(event['parsed_big']).__name__}: {event['parsed_big']!r}"


def test_no_serde_json_private_wrapper_leaks_into_fields(create_session, base_url):
    """The wrapper object must not survive as a field name."""
    event = _run_vrl(
        create_session, base_url,
        ".parsed = parse_json!(.payload)\n.",
        [{"payload": '{"big": ' + HIGH_PRECISION + ', "nested": {"inner": ' + HIGH_PRECISION + '}}'}],
    )
    leaked = [k for k in event if "serde_json" in k.lower() or "private" in k.lower()]
    logger.info("event keys: %s", sorted(event.keys()))
    assert not leaked, f"serde_json's private number wrapper leaked as field(s): {leaked}"

    assert isinstance(event.get("parsed_nested_inner"), (int, float)), \
        f"a nested high-precision number must also parse as a number: {event.get('parsed_nested_inner')!r}"
