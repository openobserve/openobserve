import pytest
"""
API tests for JavaScript function organization behaviour.

Backend contract (validated on OSS + ENT builds, current main):
The functions *backend* imposes NO org restriction on JavaScript functions —
JS (transType=1) is accepted in every org, including `default`, on BOTH OSS
and Enterprise builds. The `_meta`-only rule that used to exist now lives ONLY
in the frontend (AddFunction.vue gates the JS radio on
`isEnterprise || isCloud || org === "_meta"`, baked at build time). Since API
tests hit the backend directly, there is no edition difference to assert here.

Historical note (PR #13156): earlier the backend returned 400 with
"JavaScript functions are only allowed in the '_meta' organization" for JS in
non-_meta orgs. That restriction was removed. These tests assert the current
"JS allowed everywhere" contract; the class name is kept for git continuity.

Note: The functions API uses camelCase for field names (transType) due to
serde(rename_all = "camelCase") on the Transform struct.
The test endpoint uses snake_case (trans_type) for TestVRLRequest struct.
"""


class TestMetaOrgJavaScriptRestriction:
    """JavaScript functions are accepted in all orgs at the backend/API layer.

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

    def test_create_js_function_in_default_org_allowed(self, create_session, base_url):
        """JavaScript function creation succeeds in default org (JS no longer _meta-only).

        Previously this returned 400 with a restriction message. The backend
        restriction was removed (PR #13156), so JS create in a non-_meta org
        now returns 200 on every edition. (Positive side of "JS allowed
        everywhere" — the negative case no longer exists at the API layer.)
        """
        session = create_session
        org_id = "default"

        payload = {
            "name": "test_js_default_allowed",
            "function": "row.processed = true;",
            "params": "row",
            "transType": 1,  # JavaScript (camelCase for Transform struct)
        }

        # Cleanup any leftover from previous runs
        session.delete(f"{base_url}api/{org_id}/functions/test_js_default_allowed")

        resp = session.post(f"{base_url}api/{org_id}/functions", json=payload)

        assert resp.status_code == 200, (
            f"Expected 200 for JS function in default org (JS is no longer "
            f"_meta-only), but got {resp.status_code}: {resp.content}"
        )

        # Cleanup
        session.delete(f"{base_url}api/{org_id}/functions/test_js_default_allowed")

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

    def test_test_js_function_in_default_org_allowed(self, create_session, base_url):
        """Testing a JavaScript function succeeds in default org (JS no longer _meta-only).

        /functions/test with a valid JS transform in a non-_meta org now
        returns 200 and the transformed event, on every edition (PR #13156).
        """
        session = create_session
        org_id = "default"

        payload = {
            "function": "row.count = (row.count || 0) + 1;",
            "events": [{"name": "test", "count": 5}],
            "trans_type": 1,  # JavaScript
        }

        resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

        assert resp.status_code == 200, (
            f"Expected 200 for JS function test in default org (JS is no longer "
            f"_meta-only), but got {resp.status_code}: {resp.content}"
        )

        # The transform runs: count 5 -> 6
        body = resp.json()
        assert body["results"][0]["event"].get("count") == 6, (
            f"expected JS transform to run (count 5 -> 6), got: {body['results']}"
        )

    def test_update_vrl_to_js_in_default_org_allowed(self, create_session, base_url):
        """
        Updating a VRL function to JavaScript in default org succeeds (JS no longer _meta-only).

        Previously the backend rejected VRL->JS updates outside _meta with a
        400 restriction message. That restriction was removed (PR #13156), so:
        1. Create a VRL function in default org
        2. Update it to JavaScript
        both now return 200 on every edition.
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

        # Update to JavaScript - now allowed
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

        assert update_resp.status_code == 200, (
            f"Expected 200 for VRL->JS update in default org (JS is no longer "
            f"_meta-only), but got {update_resp.status_code}: {update_resp.content}"
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
    """Runtime-error surfacing on /functions/test (PR #13156 behaviour change).

    The old "JS is only allowed in _meta" 400 restriction is gone (see
    TestMetaOrgJavaScriptRestriction). What matters now for error messaging is
    the per-event surfacing of RUNTIME errors: code that compiles cleanly but
    throws when run against an event returns 200, with the error attached to
    that event in results[].message (for both VRL and JS). These tests pin that
    contract. (Absorbs the former restriction-message tests, which asserted
    behaviour that no longer exists.)
    """

    def test_js_runtime_error_message_content(self, create_session, base_url):
        """A JS runtime error is surfaced per-event with a clear ReferenceError."""
        session = create_session
        org_id = "default"

        payload = {
            "function": "row.field = undefinedVar;",  # valid syntax, throws at runtime
            "events": [{"name": "test"}],
            "trans_type": 1,
        }
        resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

        assert resp.status_code == 200, (
            f"JS runtime error should be 200 (per-event surfacing), "
            f"but got {resp.status_code}: {resp.content}"
        )
        results = resp.json()["results"]
        assert results, f"expected per-event results, got: {results}"
        msg = results[0].get("message", "")
        assert "ReferenceError" in msg, f"expected ReferenceError in message, got: {msg!r}"
        assert "undefinedVar" in msg, f"expected the offending name in message, got: {msg!r}"

    def test_runtime_error_surfaced_for_both_vrl_and_js(self, create_session, base_url):
        """Runtime errors surface per-event for BOTH languages (200 + results[].message).

        Consistency check: whether the transform is VRL or JS, a runtime
        failure that compiles cleanly returns 200 and carries the error in
        results[].message rather than a top-level 400.
        """
        session = create_session
        org_id = "default"

        # JS runtime error
        js_resp = session.post(
            f"{base_url}api/{org_id}/functions/test",
            json={
                "function": "row.field = undefinedVar;",
                "events": [{"name": "test"}],
                "trans_type": 1,
            },
        )
        assert js_resp.status_code == 200, f"JS: {js_resp.status_code} {js_resp.content}"
        js_msg = js_resp.json()["results"][0].get("message", "")
        assert js_msg, f"JS runtime error should carry a per-event message, got: {js_msg!r}"

        # VRL runtime error (to_int! aborts when the value can't be coerced)
        vrl_resp = session.post(
            f"{base_url}api/{org_id}/functions/test",
            json={
                "function": ".x = to_int!(.s)",
                "events": [{"s": "notanumber"}],
                "trans_type": 0,
            },
        )
        assert vrl_resp.status_code == 200, f"VRL: {vrl_resp.status_code} {vrl_resp.content}"
        vrl_msg = vrl_resp.json()["results"][0].get("message", "")
        assert "vrl runtime error" in vrl_msg, (
            f"VRL runtime error should carry a per-event message, got: {vrl_msg!r}"
        )

    def test_partial_failure_flags_only_failing_events(self, create_session, base_url):
        """Per-event semantics: in a mixed batch, only the failing event carries a message.

        The JS function throws only when row.bad is truthy, so event 1 fails
        (ReferenceError) and event 2 transforms cleanly. Response is 200 with
        one message-bearing result and one clean result.
        """
        session = create_session
        org_id = "default"

        payload = {
            "function": "if (row.bad) { row.x = undefinedVar; } else { row.x = 1; }",
            "events": [{"bad": True}, {"bad": False}],
            "trans_type": 1,
        }
        resp = session.post(f"{base_url}api/{org_id}/functions/test", json=payload)

        assert resp.status_code == 200, f"{resp.status_code}: {resp.content}"
        results = resp.json()["results"]
        assert len(results) == 2, f"expected one result per event, got: {results}"
        assert "ReferenceError" in results[0].get("message", ""), (
            f"failing event should carry a runtime error, got: {results[0]}"
        )
        assert not results[1].get("message"), (
            f"clean event should have no error message, got: {results[1]}"
        )
        assert results[1]["event"].get("x") == 1, (
            f"clean event should be transformed (x=1), got: {results[1]}"
        )

    def test_syntax_error_still_returns_400(self, create_session, base_url):
        """Regression guard: a genuine SYNTAX error still 400s (not the 200 runtime path).

        Pins the line between "syntax error -> 400" and "runtime error -> 200"
        so a future change can't blur it. Covers both languages.
        """
        session = create_session
        org_id = "default"

        # JS syntax error
        js_resp = session.post(
            f"{base_url}api/{org_id}/functions/test",
            json={"function": "function broken {", "events": [{"a": 1}], "trans_type": 1},
        )
        assert js_resp.status_code == 400, (
            f"JS syntax error should be 400, got {js_resp.status_code}: {js_resp.content}"
        )

        # VRL syntax error
        vrl_resp = session.post(
            f"{base_url}api/{org_id}/functions/test",
            json={"function": "=====", "events": [{"a": 1}], "trans_type": 0},
        )
        assert vrl_resp.status_code == 400, (
            f"VRL syntax error should be 400, got {vrl_resp.status_code}: {vrl_resp.content}"
        )


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
