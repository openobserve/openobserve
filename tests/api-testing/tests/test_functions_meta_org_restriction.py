"""
API tests for JavaScript function _meta organization restriction.

This module tests that JavaScript functions (transType=1) are only allowed
in the _meta organization, while VRL functions (transType=0) work in all orgs.

Note: The functions API uses camelCase for field names (transType) due to
serde(rename_all = "camelCase") on the Transform struct.
The test endpoint uses snake_case (trans_type) for TestVRLRequest struct.
"""


class TestMetaOrgJavaScriptRestriction:
    """Test JavaScript functions restricted to _meta org only.

    IMPORTANT - API Field Name Format:
    - Create/Update endpoints (POST/PUT /api/{org}/functions): use `transType` (camelCase)
    - Test endpoint (POST /api/{org}/functions/test): use `trans_type` (snake_case)
    This is due to different Rust structs: Transform (camelCase) vs TestVRLRequest (snake_case)
    """

    def test_create_js_function_in_meta_org_success(self, create_session, base_url):
        """JavaScript function creation should succeed in _meta org."""
        session = create_session
        org_id = "_meta"

        payload = {
            "name": "test_js_meta",
            "function": "row.processed = true;",
            "params": "row",
            "transType": 1,  # JavaScript (camelCase for Transform struct)
        }

        resp = session.post(f"{base_url}api/{org_id}/functions", json=payload)

        assert resp.status_code == 200, (
            f"Expected 200 for JS function in _meta org, "
            f"but got {resp.status_code}: {resp.content}"
        )

        # Cleanup
        session.delete(f"{base_url}api/{org_id}/functions/test_js_meta")

    def test_create_js_function_in_default_org_blocked(self, create_session, base_url):
        """JavaScript function creation should fail in default org."""
        session = create_session
        org_id = "default"

        payload = {
            "name": "test_js_default",
            "function": "row.processed = true;",
            "params": "row",
            "transType": 1,  # JavaScript - should be blocked (camelCase for Transform struct)
        }

        resp = session.post(f"{base_url}api/{org_id}/functions", json=payload)

        assert resp.status_code == 400, (
            f"Expected 400 for JS function in default org, "
            f"but got {resp.status_code}: {resp.content}"
        )

        # Verify error message
        response_text = resp.text
        assert "JavaScript functions are only allowed in the '_meta' organization" in response_text, (
            f"Expected restriction error message, but got: {response_text}"
        )

    def test_test_js_function_in_meta_org_success(self, create_session, base_url):
        """Testing JavaScript function should succeed in _meta org."""
        session = create_session
        org_id = "_meta"

        payload = {
            "function": "row.count = (row.count || 0) + 1;",
            "events": [{"name": "test", "count": 5}],
            "trans_type": 1,  # JavaScript
        }

        resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

        assert resp.status_code == 200, (
            f"Expected 200 for JS function test in _meta org, "
            f"but got {resp.status_code}: {resp.content}"
        )

    def test_test_js_function_in_default_org_blocked(self, create_session, base_url):
        """Testing JavaScript function should fail in default org."""
        session = create_session
        org_id = "default"

        payload = {
            "function": "row.count = (row.count || 0) + 1;",
            "events": [{"name": "test", "count": 5}],
            "trans_type": 1,  # JavaScript - should be blocked
        }

        resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

        assert resp.status_code == 400, (
            f"Expected 400 for JS function test in default org, "
            f"but got {resp.status_code}: {resp.content}"
        )

        # Verify error message
        response_text = resp.text
        assert "JavaScript functions are only allowed in the '_meta' organization" in response_text

    def test_update_vrl_to_js_in_default_org_blocked(self, create_session, base_url):
        """
        Test that updating a VRL function to JavaScript in default org is BLOCKED.

        This ensures users cannot bypass the JS restriction by:
        1. Creating a VRL function in default org
        2. Updating it to JavaScript

        The backend enforces JS restriction on both create AND update operations.
        """
        session = create_session
        org_id = "default"

        # Cleanup any leftover from previous runs
        session.delete(f"{base_url}api/{org_id}/functions/test_update_to_js")

        # Create VRL function first
        vrl_payload = {
            "name": "test_update_to_js",
            "function": ".processed = true",
            "params": "row",
            "transType": 0,  # VRL
        }

        create_resp = session.post(f"{base_url}api/{org_id}/functions", json=vrl_payload)
        assert create_resp.status_code == 200, f"Failed to create VRL function: {create_resp.content}"

        # Try to update to JavaScript - should be BLOCKED
        js_payload = {
            "name": "test_update_to_js",
            "function": "row.processed = true;",
            "params": "row",
            "transType": 1,  # JavaScript
        }

        update_resp = session.put(
            f"{base_url}api/{org_id}/functions/test_update_to_js",
            json=js_payload
        )

        # Should return 400 - JS restriction enforced on updates
        assert update_resp.status_code == 400, (
            f"Expected 400 for VRL->JS update in default org, "
            f"but got {update_resp.status_code}: {update_resp.content}"
        )

        # Verify error message
        response_text = update_resp.text
        assert "JavaScript functions are only allowed in the '_meta' organization" in response_text, (
            f"Expected restriction error message, but got: {response_text}"
        )

        # Cleanup
        session.delete(f"{base_url}api/{org_id}/functions/test_update_to_js")


class TestVRLFunctionsAllOrganizations:
    """Test that VRL functions work in all organizations (control tests)."""

    def test_create_vrl_function_in_meta_org(self, create_session, base_url):
        """VRL function creation should succeed in _meta org."""
        session = create_session
        org_id = "_meta"

        payload = {
            "name": "test_vrl_meta",
            "function": ".processed = true",
            "params": "row",
            "transType": 0,  # VRL (camelCase for Transform struct)
        }

        resp = session.post(f"{base_url}api/{org_id}/functions", json=payload)

        assert resp.status_code == 200, (
            f"Expected 200 for VRL function in _meta org, "
            f"but got {resp.status_code}: {resp.content}"
        )

        # Cleanup
        session.delete(f"{base_url}api/{org_id}/functions/test_vrl_meta")

    def test_create_vrl_function_in_default_org(self, create_session, base_url):
        """VRL function creation should succeed in default org."""
        session = create_session
        org_id = "default"

        payload = {
            "name": "test_vrl_default",
            "function": ".processed = true",
            "params": "row",
            "transType": 0,  # VRL (camelCase for Transform struct)
        }

        resp = session.post(f"{base_url}api/{org_id}/functions", json=payload)

        assert resp.status_code == 200, (
            f"Expected 200 for VRL function in default org, "
            f"but got {resp.status_code}: {resp.content}"
        )

        # Cleanup
        session.delete(f"{base_url}api/{org_id}/functions/test_vrl_default")

    def test_test_vrl_function_in_all_orgs(self, create_session, base_url):
        """Testing VRL function should work in all organizations."""
        session = create_session

        payload = {
            "function": ".count = to_int!(.count) + 1",
            "events": [{"name": "test", "count": 5}],
            "trans_type": 0,  # VRL (snake_case for TestVRLRequest struct)
        }

        # Test in both _meta and default
        for org_id in ["_meta", "default"]:
            resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

            assert resp.status_code == 200, (
                f"Expected 200 for VRL function test in {org_id} org, "
                f"but got {resp.status_code}: {resp.content}"
            )

    def test_update_vrl_function_in_default_org(self, create_session, base_url):
        """Updating VRL function should work in default org."""
        session = create_session
        org_id = "default"

        # Create VRL function
        create_payload = {
            "name": "test_vrl_update",
            "function": ".version = 1",
            "params": "row",
            "transType": 0,  # VRL (camelCase for Transform struct)
        }

        create_resp = session.post(f"{base_url}api/{org_id}/functions", json=create_payload)
        assert create_resp.status_code == 200

        # Update VRL function
        update_payload = {
            "name": "test_vrl_update",
            "function": ".version = 2",
            "params": "row",
            "transType": 0,  # VRL (camelCase for Transform struct)
        }

        update_resp = session.put(
            f"{base_url}api/{org_id}/functions/test_vrl_update",
            json=update_payload
        )

        assert update_resp.status_code == 200, (
            f"Expected 200 for VRL update in default org, "
            f"but got {update_resp.status_code}: {update_resp.content}"
        )

        # Cleanup
        session.delete(f"{base_url}api/{org_id}/functions/test_vrl_update")


class TestTransTypeAutoDetection:
    """Test trans_type auto-detection behavior."""

    def test_auto_detect_vrl_in_default_org(self, create_session, base_url):
        """Auto-detection should default to VRL in default org."""
        session = create_session
        org_id = "default"

        payload = {
            "function": ".test = true",
            "events": [{"name": "test"}],
            # trans_type omitted - should auto-detect as VRL
        }

        resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

        assert resp.status_code == 200, (
            f"Expected 200 for auto-detected VRL in default org, "
            f"but got {resp.status_code}: {resp.content}"
        )

    def test_auto_detect_vrl_in_meta_org(self, create_session, base_url):
        """Auto-detection should work for VRL in _meta org."""
        session = create_session
        org_id = "_meta"

        payload = {
            "function": ".test = true",
            "events": [{"name": "test"}],
            # trans_type omitted - should auto-detect as VRL
        }

        resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

        assert resp.status_code == 200, (
            f"Expected 200 for auto-detected VRL in _meta org, "
            f"but got {resp.status_code}: {resp.content}"
        )


class TestErrorMessages:
    """Test error message quality and consistency."""

    def test_error_message_content(self, create_session, base_url):
        """Error message should be clear and actionable."""
        session = create_session
        org_id = "default"

        payload = {
            "name": "test_error_msg",
            "function": "row.test = true;",
            "params": "row",
            "transType": 1,  # JavaScript - blocked (camelCase for Transform struct)
        }

        resp = session.post(f"{base_url}api/{org_id}/functions", json=payload)

        assert resp.status_code == 400
        response_text = resp.text

        # Check error message contains key information
        assert "JavaScript" in response_text, "Error should mention JavaScript"
        assert "_meta" in response_text, "Error should mention _meta org"
        assert "organization" in response_text, "Error should mention organization"
        assert "VRL" in response_text, "Error should suggest VRL alternative"

    def test_error_message_consistency(self, create_session, base_url):
        """Error message should be consistent across save and test endpoints."""
        session = create_session
        org_id = "default"

        # Test save endpoint (camelCase for Transform struct)
        save_payload = {
            "name": "test_consistency",
            "function": "row.test = true;",
            "params": "row",
            "transType": 1,
        }
        save_resp = session.post(f"{base_url}api/{org_id}/functions", json=save_payload)
        save_error = save_resp.text

        # Test test endpoint (snake_case for TestVRLRequest struct)
        test_payload = {
            "function": "row.test = true;",
            "events": [{"name": "test"}],
            "trans_type": 1,
        }
        test_resp = session.post(f"{base_url}api/{org_id}/functions/test", json=test_payload)
        test_error = test_resp.text

        # Both should have same core error message
        expected_message = "JavaScript functions are only allowed in the '_meta' organization"
        assert expected_message in save_error, "Save endpoint should have restriction message"
        assert expected_message in test_error, "Test endpoint should have restriction message"


class TestEdgeCases:
    """Test edge cases and boundary conditions."""

    def test_empty_function_code(self, create_session, base_url):
        """Empty JavaScript function should still be blocked in default org."""
        session = create_session
        org_id = "default"

        payload = {
            "name": "test_empty",
            "function": "",
            "params": "row",
            "transType": 1,  # JavaScript - blocked even if empty (camelCase for Transform struct)
        }

        resp = session.post(f"{base_url}api/{org_id}/functions", json=payload)

        # Should still return 400 for org restriction (before validation)
        assert resp.status_code in [400, 422], (
            f"Expected 400 or 422 for empty JS function in default org, "
            f"but got {resp.status_code}"
        )

    def test_invalid_trans_type_value(self, create_session, base_url):
        """Invalid trans_type should be handled gracefully."""
        session = create_session
        org_id = "default"

        payload = {
            "function": ".test = true",
            "events": [{"name": "test"}],
            "trans_type": 999,  # Invalid value
        }

        resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

        # Should handle gracefully (400 or default to VRL)
        assert resp.status_code in [200, 400, 422], (
            f"Expected 200 or 400 for invalid trans_type, "
            f"but got {resp.status_code}"
        )

    def test_case_sensitivity_org_name(self, create_session, base_url):
        """Org name matching should be case-sensitive (_meta vs _META)."""
        session = create_session

        # Try with uppercase _META (should be blocked)
        org_id = "_META"  # Wrong case

        payload = {
            "name": "test_case",
            "function": "row.test = true;",
            "params": "row",
            "transType": 1,  # camelCase for Transform struct
        }

        resp = session.post(f"{base_url}api/{org_id}/functions", json=payload)

        # Should fail (either 400 for JS restriction or 404 for org not found)
        assert resp.status_code in [400, 404], (
            f"Expected 400 or 404 for uppercase _META, "
            f"but got {resp.status_code}"
        )
