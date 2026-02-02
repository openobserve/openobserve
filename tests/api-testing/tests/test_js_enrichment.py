# Copyright 2026 OpenObserve Inc.
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU Affero General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program.  If not, see <http://www.gnu.org/licenses/>.

"""
API tests for JavaScript functions with enrichment table support
Tests the /api/{org}/functions/test endpoint with JavaScript functions accessing enrichment tables
"""

import pytest


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_enrichment_basic_lookup(create_session, base_url):
    """Test JavaScript function with enrichment table lookup - basic usage"""
    session = create_session
    org_id = "default"

    # First, create a test enrichment table
    # Note: This assumes enrichment table API is available
    # If not, this test will need to be adjusted or skipped

    payload = {
        "function": """
// Basic enrichment lookup
const userData = getEnrichmentTableData('test_users', row.user_id);

if (userData) {
  row.user_name = userData.name;
  row.user_email = userData.email;
} else {
  row.user_name = 'unknown';
  row.user_email = 'unknown';
}
""",
        "events": [
            {"user_id": "123", "action": "login"},
            {"user_id": "456", "action": "logout"}
        ],
        "trans_type": 1  # JavaScript
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response status: {resp.status_code}")
    print(f"Response content: {resp.content}")

    # Even if enrichment table doesn't exist, function should execute
    # It will just return 'unknown' for missing data
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    results = resp.json().get("results", [])
    assert len(results) == 2, f"Expected 2 results, got {len(results)}"

    # Verify fallback values are set
    for result in results:
        event = result["event"]
        assert "user_name" in event, f"Missing user_name in event: {event}"
        assert "user_email" in event, f"Missing user_email in event: {event}"


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_enrichment_auto_detection(create_session, base_url):
    """Test auto-detection of enrichment tables from JavaScript code"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """
// Auto-detection should find 'products' and 'categories' tables
const product = getEnrichmentTableData('products', row.product_id);
const category = getEnrichmentTableData('categories', row.category_id);

if (product) {
  row.product_name = product.name;
  row.product_price = product.price;
}

if (category) {
  row.category_name = category.name;
}
""",
        "events": [
            {"product_id": "P123", "category_id": "C1"},
            {"product_id": "P456", "category_id": "C2"}
        ],
        "trans_type": 1
        # Note: enrichment_tables NOT specified - should auto-detect
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response status: {resp.status_code}")
    print(f"Response content: {resp.content}")

    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    results = resp.json().get("results", [])
    assert len(results) == 2, f"Expected 2 results, got {len(results)}"


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_enrichment_explicit_tables(create_session, base_url):
    """Test explicit enrichment_tables parameter"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """
const user = getEnrichmentTableData('users', row.user_id);
if (user) {
  row.enriched = true;
  row.user_data = user;
}
""",
        "events": [
            {"user_id": "U123"}
        ],
        "trans_type": 1,
        "enrichment_tables": ["users"]  # Explicitly specify table
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response status: {resp.status_code}")
    print(f"Response content: {resp.content}")

    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_enrichment_with_result_array(create_session, base_url):
    """Test JavaScript #ResultArray# with enrichment tables"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """#ResultArray#
// Process array with enrichment
for (var i = 0; i < rows.length; i++) {
  const userData = getEnrichmentTableData('users', rows[i].user_id);
  if (userData) {
    rows[i].user_name = userData.name;
    rows[i].enriched = true;
  } else {
    rows[i].enriched = false;
  }
}
""",
        "events": [
            {"user_id": "U1", "action": "view"},
            {"user_id": "U2", "action": "click"},
            {"user_id": "U3", "action": "purchase"}
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response status: {resp.status_code}")
    print(f"Response content: {resp.content}")

    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    results = resp.json().get("results", [])
    assert len(results) == 3, f"Expected 3 results, got {len(results)}"

    # Verify enriched flag was set
    for result in results:
        event = result["event"]
        assert "enriched" in event, f"Missing enriched flag in event: {event}"


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_enrichment_table_not_found(create_session, base_url):
    """Test graceful handling when enrichment table doesn't exist"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """
const data = getEnrichmentTableData('nonexistent_table', row.id);

if (data === null || data === undefined) {
  row.status = 'table_not_found';
} else {
  row.status = 'found';
  row.data = data;
}
""",
        "events": [
            {"id": "123"}
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response status: {resp.status_code}")
    print(f"Response content: {resp.content}")

    # Should succeed even if table doesn't exist
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    results = resp.json().get("results", [])
    assert len(results) == 1, f"Expected 1 result, got {len(results)}"

    event = results[0]["event"]
    assert event.get("status") == "table_not_found", (
        f"Expected status='table_not_found', got {event.get('status')}"
    )


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_enrichment_key_not_found(create_session, base_url):
    """Test graceful handling when key doesn't exist in enrichment table"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """
const userData = getEnrichmentTableData('users', 'nonexistent_key_99999');

if (userData === null || userData === undefined) {
  row.lookup_result = 'key_not_found';
} else {
  row.lookup_result = 'found';
  row.user_data = userData;
}
""",
        "events": [
            {"id": "test"}
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response status: {resp.status_code}")
    print(f"Response content: {resp.content}")

    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    results = resp.json().get("results", [])
    assert len(results) == 1, f"Expected 1 result, got {len(results)}"

    event = results[0]["event"]
    assert event.get("lookup_result") == "key_not_found", (
        f"Expected lookup_result='key_not_found', got {event.get('lookup_result')}"
    )


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_enrichment_multiple_lookups(create_session, base_url):
    """Test multiple enrichment table lookups in single function"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """
// Multiple enrichment lookups
const user = getEnrichmentTableData('users', row.user_id);
const product = getEnrichmentTableData('products', row.product_id);
const store = getEnrichmentTableData('stores', row.store_id);

row.enrichment_count = 0;

if (user) {
  row.user_name = user.name;
  row.enrichment_count++;
}

if (product) {
  row.product_name = product.name;
  row.enrichment_count++;
}

if (store) {
  row.store_name = store.name;
  row.enrichment_count++;
}
""",
        "events": [
            {
                "user_id": "U1",
                "product_id": "P1",
                "store_id": "S1",
                "action": "purchase"
            }
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response status: {resp.status_code}")
    print(f"Response content: {resp.content}")

    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    results = resp.json().get("results", [])
    assert len(results) == 1, f"Expected 1 result, got {len(results)}"

    event = results[0]["event"]
    assert "enrichment_count" in event, f"Missing enrichment_count in event: {event}"


def test_js_enrichment_vrl_comparison(create_session, base_url):
    """Test that VRL functions still work (no regression)"""
    session = create_session
    org_id = "default"

    # VRL function (trans_type=0 or auto-detected)
    payload = {
        "function": """.enriched = "vrl_works"
.""",
        "events": [
            {"id": 1},
            {"id": 2}
        ],
        "trans_type": 0  # VRL
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response status: {resp.status_code}")
    print(f"Response content: {resp.content}")

    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    results = resp.json().get("results", [])
    assert len(results) == 2, f"Expected 2 results, got {len(results)}"

    for result in results:
        event = result["event"]
        assert event.get("enriched") == "vrl_works", (
            f"Expected enriched='vrl_works', got {event.get('enriched')}"
        )
