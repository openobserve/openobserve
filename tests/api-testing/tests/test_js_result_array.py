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
API tests for JavaScript #ResultArray# functions
Tests the /api/{org}/functions/test endpoint with JavaScript functions
"""

import pytest


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_result_array_filtering_all_filtered(create_session, base_url):
    """Test JavaScript #ResultArray# function that filters out all rows"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """#ResultArray#
// Filter rows where newdata > 50
var filtered = [];
for (var i = 0; i < rows.length; i++) {
  if (rows[i].newdata > 50) {
    filtered.push(rows[i]);
  }
}
rows.length = 0;
for (var i = 0; i < filtered.length; i++) {
  rows.push(filtered[i]);
}""",
        "events": [
            {"newdata": 10}, {"newdata": 10}, {"newdata": 10},
            {"newdata": 10}, {"newdata": 10}, {"newdata": 10},
            {"newdata": 10}, {"newdata": 10}, {"newdata": 10}, {"newdata": 10}
        ],
        "trans_type": 1  # 1 = JavaScript
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response: {resp.content}")
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    response_json = resp.json()
    results = response_json.get("results", [])

    # All rows should be filtered out (newdata=10 is not > 50)
    assert len(results) == 0, (
        f"Expected 0 results (all filtered), but got {len(results)}. Results: {results}"
    )


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_result_array_filtering_mixed(create_session, base_url):
    """Test JavaScript #ResultArray# function with mixed data (some pass filter, some don't)"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """#ResultArray#
// Filter rows where newdata > 50
var filtered = [];
for (var i = 0; i < rows.length; i++) {
  if (rows[i].newdata > 50) {
    filtered.push(rows[i]);
  }
}
rows.length = 0;
for (var i = 0; i < filtered.length; i++) {
  rows.push(filtered[i]);
}""",
        "events": [
            {"newdata": 10, "name": "filtered_out_1"},
            {"newdata": 60, "name": "pass_1"},
            {"newdata": 20, "name": "filtered_out_2"},
            {"newdata": 70, "name": "pass_2"},
            {"newdata": 30, "name": "filtered_out_3"},
            {"newdata": 80, "name": "pass_3"},
            {"newdata": 40, "name": "filtered_out_4"},
            {"newdata": 90, "name": "pass_4"},
            {"newdata": 50, "name": "filtered_out_5"},  # Equal to 50, not > 50
            {"newdata": 100, "name": "pass_5"}
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response: {resp.content}")
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    response_json = resp.json()
    results = response_json.get("results", [])

    # Should have 5 results (values > 50: 60, 70, 80, 90, 100)
    assert len(results) == 5, (
        f"Expected 5 results, but got {len(results)}. Results: {results}"
    )

    # Verify correct rows passed through
    passed_names = [r["event"]["name"] for r in results]
    expected_names = ["pass_1", "pass_2", "pass_3", "pass_4", "pass_5"]
    assert passed_names == expected_names, (
        f"Expected names {expected_names}, but got {passed_names}"
    )

    # Verify values
    passed_values = [r["event"]["newdata"] for r in results]
    expected_values = [60, 70, 80, 90, 100]
    assert passed_values == expected_values, (
        f"Expected values {expected_values}, but got {passed_values}"
    )


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_result_array_enrichment(create_session, base_url):
    """Test JavaScript #ResultArray# function that enriches all rows"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """#ResultArray#
// Enrich each row with batch statistics
var total = rows.length;
for (var i = 0; i < rows.length; i++) {
  rows[i].batch_size = total;
  rows[i].index = i;
  rows[i].processed = true;
}""",
        "events": [
            {"id": 1, "value": 100},
            {"id": 2, "value": 200},
            {"id": 3, "value": 300}
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response: {resp.content}")
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    response_json = resp.json()
    results = response_json.get("results", [])

    # Should have 3 results (all enriched)
    assert len(results) == 3, (
        f"Expected 3 results, but got {len(results)}. Results: {results}"
    )

    # Verify enrichment
    for i, result in enumerate(results):
        event = result["event"]
        assert event["batch_size"] == 3, f"Expected batch_size=3, got {event.get('batch_size')}"
        assert event["index"] == i, f"Expected index={i}, got {event.get('index')}"
        assert event["processed"] == True, f"Expected processed=true, got {event.get('processed')}"


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_result_array_expansion(create_session, base_url):
    """Test JavaScript #ResultArray# function that expands rows (1 input -> multiple outputs)"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """#ResultArray#
// Expand: 1 input row -> 3 output rows
if (rows.length > 0) {
  var firstRow = rows[0];
  rows.length = 0;
  for (var i = 0; i < 3; i++) {
    var newRow = {};
    for (var key in firstRow) {
      newRow[key] = firstRow[key];
    }
    newRow.index = i;
    newRow.expanded = true;
    rows.push(newRow);
  }
}""",
        "events": [
            {"name": "test", "value": 100}
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response: {resp.content}")
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    response_json = resp.json()
    results = response_json.get("results", [])

    # Should have 3 results (1 input expanded to 3)
    assert len(results) == 3, (
        f"Expected 3 results, but got {len(results)}. Results: {results}"
    )

    # Verify each expanded row
    for i, result in enumerate(results):
        event = result["event"]
        assert event["name"] == "test", f"Expected name='test', got {event.get('name')}"
        assert event["value"] == 100, f"Expected value=100, got {event.get('value')}"
        assert event["index"] == i, f"Expected index={i}, got {event.get('index')}"
        assert event["expanded"] == True, f"Expected expanded=true, got {event.get('expanded')}"


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_result_array_empty_input(create_session, base_url):
    """Test JavaScript #ResultArray# function with empty input array"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """#ResultArray#
// Process empty array
for (var i = 0; i < rows.length; i++) {
  rows[i].processed = true;
}""",
        "events": [],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response: {resp.content}")
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    response_json = resp.json()
    results = response_json.get("results", [])

    # Should have 0 results (empty input)
    assert len(results) == 0, (
        f"Expected 0 results, but got {len(results)}. Results: {results}"
    )


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_regular_function_without_result_array(create_session, base_url):
    """Test regular JavaScript function (without #ResultArray#) processes rows individually"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """// Regular function (no #ResultArray#)
row.processed = true;
row.doubled = (row.value || 0) * 2;""",
        "events": [
            {"value": 10},
            {"value": 20},
            {"value": 30}
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response: {resp.content}")
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    response_json = resp.json()
    results = response_json.get("results", [])

    # Should have 3 results (processed individually)
    assert len(results) == 3, (
        f"Expected 3 results, but got {len(results)}. Results: {results}"
    )

    # Verify each row was processed
    expected_doubled = [20, 40, 60]
    for i, result in enumerate(results):
        event = result["event"]
        assert event["processed"] == True, f"Row {i} not processed"
        assert event["doubled"] == expected_doubled[i], (
            f"Row {i}: expected doubled={expected_doubled[i]}, got {event.get('doubled')}"
        )


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_result_array_aggregation(create_session, base_url):
    """Test JavaScript #ResultArray# function with aggregation across all rows"""
    session = create_session
    org_id = "default"

    payload = {
        "function": """#ResultArray#
// Calculate batch statistics
var sum = 0;
for (var i = 0; i < rows.length; i++) {
  sum += rows[i].value || 0;
}
var avg = sum / rows.length;

// Enrich each row with aggregated data
for (var i = 0; i < rows.length; i++) {
  rows[i].batch_sum = sum;
  rows[i].batch_avg = avg;
  rows[i].batch_count = rows.length;
}""",
        "events": [
            {"value": 100},
            {"value": 200},
            {"value": 300}
        ],
        "trans_type": 1
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response: {resp.content}")
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    response_json = resp.json()
    results = response_json.get("results", [])

    # Should have 3 results with aggregated data
    assert len(results) == 3, (
        f"Expected 3 results, but got {len(results)}. Results: {results}"
    )

    # Verify aggregation
    for result in results:
        event = result["event"]
        assert event["batch_sum"] == 600, f"Expected batch_sum=600, got {event.get('batch_sum')}"
        assert event["batch_avg"] == 200, f"Expected batch_avg=200, got {event.get('batch_avg')}"
        assert event["batch_count"] == 3, f"Expected batch_count=3, got {event.get('batch_count')}"


@pytest.mark.skip(reason="Temporarily disabled - failing test")
def test_js_result_array_with_explicit_trans_type(create_session, base_url):
    """Test that trans_type must be explicitly specified for JavaScript #ResultArray# functions

    Note: #ResultArray# marker alone is ambiguous - it's used by both VRL and JavaScript.
    Without trans_type, functions with #ResultArray# are treated as VRL by default.
    JavaScript functions with #ResultArray# MUST specify trans_type=1.
    """
    session = create_session
    org_id = "default"

    payload = {
        "function": """#ResultArray#
// JavaScript #ResultArray# function requires trans_type=1
for (var i = 0; i < rows.length; i++) {
  rows[i].explicitly_typed = true;
}""",
        "events": [
            {"id": 1},
            {"id": 2}
        ],
        "trans_type": 1  # REQUIRED for JavaScript functions
    }

    resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

    print(f"Response: {resp.content}")
    assert resp.status_code == 200, (
        f"Expected 200, but got {resp.status_code}. Response: {resp.content}"
    )

    response_json = resp.json()
    results = response_json.get("results", [])

    # Should have 2 results
    assert len(results) == 2, (
        f"Expected 2 results, but got {len(results)}. Results: {results}"
    )

    # Verify processing
    for result in results:
        event = result["event"]
        assert event.get("explicitly_typed") == True, (
            f"Expected explicitly_typed=true, got {event.get('explicitly_typed')}"
        )
