"""JavaScript function + enrichment table API tests.

Rewritten in Phase 4 of the api-tests revamp:
- Discovered the real reason the original 7 tests were skipped with
  "Temporarily disabled - failing test":
    1. JavaScript functions are ONLY allowed in the `_meta` organization
       (OO returns 400 in any other org with a clear error message).
       The original tests POSTed to `default` and were rejected at the
       org-restriction check.
    2. Even when POSTed to `_meta`, the `getEnrichmentTableData()` helper
       isn't injected into the runtime when called via the
       `/functions/test` endpoint — returns "ReferenceError:
       getEnrichmentTableData is not defined" even with explicit
       `enrichment_tables: [...]` in the payload.

  So the original "failing" framing was misleading. The tests test a
  combination of (a) org-restricted JS + (b) a runtime helper that
  doesn't exist in this endpoint. They remain skipped here BUT WITH
  THE REAL REASON DOCUMENTED, so a future engineer can either:
  - Fix the backend to expose getEnrichmentTableData in functions/test
  - Or move these tests to an integration suite that creates real
    enrichment tables + runs a real (non-test) pipeline.

- Keeps the VRL regression test (the one not-skipped in the original)
  — relocated under its proper name. This test verifies that VRL
  continues to work in `default` org (no regression in the
  more-common case).
- Each remaining skipped test still uses `org='_meta'` so when the
  backend bug is fixed, the test will actually execute and reveal
  whether the helper now works.
"""
from __future__ import annotations

import logging

import pytest

from support.client import OpenObserveClient

logger = logging.getLogger(__name__)

JS_META_ORG = "_meta"
DEFAULT_ORG = "default"

SAMPLE_EVENTS_TWO = [
    {"user_id": "123", "action": "login"},
    {"user_id": "456", "action": "logout"},
]

# Reason string reused across all skipped JS-enrichment tests so future bulk
# unskip is a single sed.
JS_HELPER_UNAVAILABLE = (
    "JS getEnrichmentTableData() helper is not exposed via /functions/test endpoint "
    "(returns ReferenceError even in _meta org with explicit enrichment_tables). "
    "Enable when backend wires the helper into the test endpoint."
)


# ----- VRL regression (always runs, no JS) -----


def test_vrl_function_via_test_endpoint(client: OpenObserveClient):
    """VRL via /functions/test still works in `default` org (no regression).

    Acts as a baseline: if THIS fails, the test endpoint itself is broken
    (independent of JS).
    """
    payload = {
        "function": '.enriched = "vrl_works"\n.',
        "events": [{"id": 1}, {"id": 2}],
        "trans_type": 0,  # VRL
    }
    resp = client.post("functions/test", json=payload, org=DEFAULT_ORG)
    assert resp.status_code == 200, f"VRL via test endpoint failed: {resp.text}"

    body = resp.json()
    results = body.get("results", [])
    assert len(results) == 2, f"expected 2 results, got {len(results)}: {body}"

    for i, result in enumerate(results):
        assert result["event"].get("enriched") == "vrl_works", \
            f"result {i}: VRL transform didn't add enriched='vrl_works': {result}"


# ----- JS enrichment tests — skipped pending backend support -----


@pytest.mark.skip(reason=JS_HELPER_UNAVAILABLE)
def test_js_enrichment_basic_lookup(client: OpenObserveClient):
    """JS function with basic enrichment lookup against `test_users` table."""
    payload = {
        "function": (
            "const userData = getEnrichmentTableData('test_users', row.user_id);\n"
            "if (userData) { row.user_name = userData.name; row.user_email = userData.email; }\n"
            "else { row.user_name = 'unknown'; row.user_email = 'unknown'; }"
        ),
        "events": SAMPLE_EVENTS_TWO,
        "trans_type": 1,  # JS
    }
    resp = client.post("functions/test", json=payload, org=JS_META_ORG)
    assert resp.status_code == 200, resp.text

    results = resp.json().get("results", [])
    assert len(results) == 2, f"expected 2 results, got {len(results)}"
    for r in results:
        assert "user_name" in r["event"]
        assert "user_email" in r["event"]


@pytest.mark.skip(reason=JS_HELPER_UNAVAILABLE)
def test_js_enrichment_auto_detection(client: OpenObserveClient):
    """JS function: enrichment table names should be auto-detected from the function body."""
    payload = {
        "function": (
            "const product = getEnrichmentTableData('products', row.product_id);\n"
            "const category = getEnrichmentTableData('categories', row.category_id);\n"
            "if (product) { row.product_name = product.name; row.product_price = product.price; }\n"
            "if (category) { row.category_name = category.name; }"
        ),
        "events": [
            {"product_id": "P123", "category_id": "C1"},
            {"product_id": "P456", "category_id": "C2"},
        ],
        "trans_type": 1,
        # NOTE: enrichment_tables NOT specified — should auto-detect
    }
    resp = client.post("functions/test", json=payload, org=JS_META_ORG)
    assert resp.status_code == 200, resp.text
    assert len(resp.json().get("results", [])) == 2


@pytest.mark.skip(reason=JS_HELPER_UNAVAILABLE)
def test_js_enrichment_explicit_tables(client: OpenObserveClient):
    """JS function with explicit `enrichment_tables` parameter."""
    payload = {
        "function": (
            "const user = getEnrichmentTableData('users', row.user_id);\n"
            "if (user) { row.enriched = true; row.user_data = user; }"
        ),
        "events": [{"user_id": "U123"}],
        "trans_type": 1,
        "enrichment_tables": ["users"],
    }
    resp = client.post("functions/test", json=payload, org=JS_META_ORG)
    assert resp.status_code == 200, resp.text


@pytest.mark.skip(reason=JS_HELPER_UNAVAILABLE)
def test_js_enrichment_with_result_array(client: OpenObserveClient):
    """JS #ResultArray# directive plus enrichment lookup."""
    payload = {
        "function": (
            "#ResultArray#\n"
            "for (var i = 0; i < rows.length; i++) {\n"
            "  const userData = getEnrichmentTableData('users', rows[i].user_id);\n"
            "  if (userData) { rows[i].user_name = userData.name; rows[i].enriched = true; }\n"
            "  else { rows[i].enriched = false; }\n"
            "}"
        ),
        "events": [
            {"user_id": "U1", "action": "view"},
            {"user_id": "U2", "action": "click"},
            {"user_id": "U3", "action": "purchase"},
        ],
        "trans_type": 1,
    }
    resp = client.post("functions/test", json=payload, org=JS_META_ORG)
    assert resp.status_code == 200, resp.text

    results = resp.json().get("results", [])
    assert len(results) == 3
    for r in results:
        assert "enriched" in r["event"]


@pytest.mark.skip(reason=JS_HELPER_UNAVAILABLE)
def test_js_enrichment_table_not_found(client: OpenObserveClient):
    """Graceful handling when the enrichment table doesn't exist (should return null)."""
    payload = {
        "function": (
            "const data = getEnrichmentTableData('nonexistent_table', row.id);\n"
            "if (data === null || data === undefined) { row.status = 'table_not_found'; }\n"
            "else { row.status = 'found'; row.data = data; }"
        ),
        "events": [{"id": "123"}],
        "trans_type": 1,
    }
    resp = client.post("functions/test", json=payload, org=JS_META_ORG)
    assert resp.status_code == 200, resp.text

    results = resp.json().get("results", [])
    assert len(results) == 1
    assert results[0]["event"].get("status") == "table_not_found"


@pytest.mark.skip(reason=JS_HELPER_UNAVAILABLE)
def test_js_enrichment_key_not_found(client: OpenObserveClient):
    """Graceful handling when the lookup key doesn't exist in the enrichment table."""
    payload = {
        "function": (
            "const userData = getEnrichmentTableData('users', 'nonexistent_key_99999');\n"
            "if (userData === null || userData === undefined) { row.lookup_result = 'key_not_found'; }\n"
            "else { row.lookup_result = 'found'; row.user_data = userData; }"
        ),
        "events": [{"id": "test"}],
        "trans_type": 1,
    }
    resp = client.post("functions/test", json=payload, org=JS_META_ORG)
    assert resp.status_code == 200, resp.text
    assert resp.json()["results"][0]["event"].get("lookup_result") == "key_not_found"


@pytest.mark.skip(reason=JS_HELPER_UNAVAILABLE)
def test_js_enrichment_multiple_lookups(client: OpenObserveClient):
    """Multiple enrichment table lookups in a single JS function increment a counter."""
    payload = {
        "function": (
            "const user = getEnrichmentTableData('users', row.user_id);\n"
            "const product = getEnrichmentTableData('products', row.product_id);\n"
            "const store = getEnrichmentTableData('stores', row.store_id);\n"
            "row.enrichment_count = 0;\n"
            "if (user) { row.user_name = user.name; row.enrichment_count++; }\n"
            "if (product) { row.product_name = product.name; row.enrichment_count++; }\n"
            "if (store) { row.store_name = store.name; row.enrichment_count++; }"
        ),
        "events": [{"user_id": "U1", "product_id": "P1", "store_id": "S1", "action": "purchase"}],
        "trans_type": 1,
    }
    resp = client.post("functions/test", json=payload, org=JS_META_ORG)
    assert resp.status_code == 200, resp.text
    assert "enrichment_count" in resp.json()["results"][0]["event"]


# ----- documented org-restriction (always runs) -----


def test_js_function_in_default_org_returns_400(client: OpenObserveClient):
    """OO restricts JS functions to the `_meta` org. Documents this constraint.

    The original suite missed this — it POSTed JS to `default` and silently
    failed. This test makes the constraint a first-class contract: if/when
    the backend opens JS to other orgs, this test starts failing and you
    know to update.
    """
    payload = {
        "function": "row.x = 'js works here';",
        "events": [{"id": 1}],
        "trans_type": 1,
    }
    resp = client.post("functions/test", json=payload, org=DEFAULT_ORG)
    assert resp.status_code == 400, \
        f"JS in non-_meta org should be 400, got {resp.status_code}: {resp.text}"

    body = resp.json()
    assert "JavaScript" in body.get("message", "") or "_meta" in body.get("message", ""), \
        f"error message should mention JS restriction, got: {body}"
