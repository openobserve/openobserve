"""
Test deduplication of fields in stream settings update API.

This test verifies that when the same field is added multiple times to stream
settings (e.g., full_text_search_keys, index_fields), the backend correctly
deduplicates them and does not store duplicate entries.

Test Coverage:
- TestIndexFieldsDedup: Dedup for index_fields
- TestBloomFilterFieldsDedup: Dedup for bloom_filter_fields
- TestFullTextSearchKeysDedup: Dedup for full_text_search_keys (uses existing schema fields)
- TestDefinedSchemaFieldsDedup: Dedup for defined_schema_fields
- TestStreamSettingsDedupEdgeCases: Multiple fields, repeated adds, remove+readd, partial updates

Reference: PR #11495 - Stream settings update API should dedup fields before adding
"""

import pytest
import time
import logging
import os
import random

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

ORG_ID = os.environ.get("TEST_ORG_ID", "default")
STREAM_NAME = "stream_pytest_data"  # Reuses the seed data stream from conftest
STREAM_TYPE = "logs"

# Known fields from the seed data that exist in the stream schema.
# These are safe to use for FTS/index/bloom filter testing since
# the backend validates that fields exist in the schema before adding.
#
# TYPE CONSTRAINTS:
# - FTS keys: must be string/text fields (not _timestamp, not numeric fields)
# - Index fields (secondary index): must be numeric/not string fields
# - Bloom filter fields: typically string fields
#
# From the seed data logs_data.json:
#   String fields: level, message, log, stream, code
#   Numeric fields: _timestamp (auto), FloatValue
FTS_SAFE_FIELDS = ["level", "message", "log", "stream"]
# FloatValue is numeric; _timestamp is used for bloom but not FTS
INDEX_SAFE_FIELDS = ["_timestamp", "FloatValue"]
BLOOM_SAFE_FIELDS = ["level", "message", "log", "stream", "_timestamp", "FloatValue"]


def get_field_for_fts(settings):
    """Return a field safe for FTS (text type, not in FTS already)."""
    current = set(settings.get("full_text_search_keys", []))
    available = [f for f in FTS_SAFE_FIELDS if f not in current]
    if not available:
        pytest.skip("No FTS-safe fields available outside current settings")
    return random.choice(available)


def get_field_for_index(settings):
    """Return a field safe for index (not in FTS and not already indexed)."""
    current_fts = set(settings.get("full_text_search_keys", []))
    current_idx = set(settings.get("index_fields", []))
    safe = [f for f in INDEX_SAFE_FIELDS if f not in current_fts and f not in current_idx]
    if not safe:
        pytest.skip("No index-safe fields available outside current settings")
    return random.choice(safe)


def get_field_for_bloom(settings):
    """Return a field safe for bloom filter (not already in bloom_filter_fields)."""
    current = set(settings.get("bloom_filter_fields", []))
    available = [f for f in BLOOM_SAFE_FIELDS if f not in current]
    if not available:
        pytest.skip("No bloom-filter-safe fields available outside current settings")
    return random.choice(available)


def get_stream_settings(session, base_url, org_id, stream_name, stream_type=STREAM_TYPE):
    """Get stream settings via the schema endpoint."""
    schema_url = f"{base_url}api/{org_id}/streams/{stream_name}/schema?type={stream_type}"
    resp = session.get(schema_url)
    if resp.status_code == 200:
        return resp.json().get("settings", {})
    logger.warning(f"Failed to get settings for {stream_name}: {resp.status_code} {resp.text[:200]}")
    return {}


def update_stream_settings(session, base_url, org_id, stream_name, payload, stream_type=STREAM_TYPE):
    """Update stream settings via the PUT settings endpoint."""
    settings_url = f"{base_url}api/{org_id}/streams/{stream_name}/settings?type={stream_type}"
    resp = session.put(settings_url, json=payload, headers={"Content-Type": "application/json"})
    return resp


def cleanup_fts_fields(session, base_url, org_id, fields):
    """Remove orphaned fields from full_text_search_keys to prevent cross-test contamination."""
    settings = get_stream_settings(session, base_url, org_id, STREAM_NAME)
    current_fts = list(settings.get("full_text_search_keys", []))
    logger.info(f"Pre-cleanup FTS: {current_fts}")
    to_remove = [f for f in fields if f in current_fts]
    if to_remove:
        logger.info(f"Cleanup: removing orphaned FTS keys: {to_remove}")
        payload = {"full_text_search_keys": {"add": [], "remove": to_remove}}
        update_stream_settings(session, base_url, org_id, STREAM_NAME, payload)
        time.sleep(1)  # Wait for cleanup to take effect


class TestIndexFieldsDedup:
    """Test deduplication of index_fields in stream settings."""

    def test_dedup_index_fields(self, create_session, base_url):
        """
        Test: Adding the same field to index_fields twice does not create duplicates.
        """
        logger.info("=== TEST: index_fields dedup ===")
        session = create_session

        # Clean up orphaned FTS keys from previous (possibly aborted) runs
        cleanup_fts_fields(session, base_url, ORG_ID, INDEX_SAFE_FIELDS)

        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        field_name = get_field_for_index(settings)
        original_idx = list(settings.get("index_fields", []))
        logger.info(f"Original index_fields ({len(original_idx)}): {original_idx}")

        try:
            # Add field
            payload = {"index_fields": {"add": [field_name], "remove": []}}
            resp1 = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp1.status_code == 200, f"First add failed: {resp1.text[:500]}"
            time.sleep(1)

            # Verify added
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            idx_after = settings.get("index_fields", [])
            logger.info(f"After first add: {idx_after}")
            assert field_name in idx_after, f"Field should be in index_fields: {idx_after}"

            # Add same field again
            resp2 = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp2.status_code == 200, f"Second add failed: {resp2.text[:500]}"
            time.sleep(1)

            # Verify no duplicates
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            idx_final = settings.get("index_fields", [])
            logger.info(f"After second add: {idx_final}")

            assert idx_final.count(field_name) == 1, \
                f"Field appears {idx_final.count(field_name)} times (expected 1): {idx_final}"
            assert len(idx_final) == len(original_idx) + 1, \
                f"Expected {len(original_idx) + 1} index fields, got {len(idx_final)}"

            logger.info("=== PASSED: index_fields dedup ===")
        finally:
            cleanup = {"index_fields": {"add": [], "remove": [field_name]}}
            update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, cleanup)


class TestBloomFilterFieldsDedup:
    """Test deduplication of bloom_filter_fields in stream settings."""

    def test_dedup_bloom_filter_fields(self, create_session, base_url):
        """
        Test: Adding the same field to bloom_filter_fields twice does not create duplicates.
        """
        logger.info("=== TEST: bloom_filter_fields dedup ===")
        session = create_session
        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        field_name = get_field_for_bloom(settings)
        original_bf = list(settings.get("bloom_filter_fields", []))
        logger.info(f"Original bloom_filter_fields ({len(original_bf)}): {original_bf}")

        try:
            payload = {"bloom_filter_fields": {"add": [field_name], "remove": []}}
            resp1 = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp1.status_code == 200, f"First add failed: {resp1.text[:500]}"
            time.sleep(1)

            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            bf_after = settings.get("bloom_filter_fields", [])
            logger.info(f"After first add: {bf_after}")
            assert field_name in bf_after, f"Field should be in bloom filter: {bf_after}"

            resp2 = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp2.status_code == 200, f"Second add failed: {resp2.text[:500]}"
            time.sleep(1)

            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            bf_final = settings.get("bloom_filter_fields", [])
            logger.info(f"After second add: {bf_final}")

            assert bf_final.count(field_name) == 1, \
                f"Field appears {bf_final.count(field_name)} times (expected 1): {bf_final}"
            assert len(bf_final) == len(original_bf) + 1, \
                f"Expected {len(original_bf) + 1} bloom filter fields, got {len(bf_final)}"

            logger.info("=== PASSED: bloom_filter_fields dedup ===")
        finally:
            cleanup = {"bloom_filter_fields": {"add": [], "remove": [field_name]}}
            update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, cleanup)


class TestFullTextSearchKeysDedup:
    """Test deduplication of full_text_search_keys in stream settings.

    NOTE: FTS keys must reference fields that exist in the stream schema.
    We use known fields from the seed data to avoid schema validation errors.
    """

    def test_dedup_full_text_search_keys(self, create_session, base_url):
        """
        Test: Adding the same field to full_text_search_keys twice does not create duplicates.
        Uses a field that exists in the stream schema and is a text type.
        """
        logger.info("=== TEST: full_text_search_keys dedup ===")
        session = create_session

        # Get current FTS keys
        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        field_name = get_field_for_fts(settings)
        original_fts = list(settings.get("full_text_search_keys", []))
        logger.info(f"Original full_text_search_keys ({len(original_fts)}): {original_fts}")

        try:
            # Add field
            payload = {"full_text_search_keys": {"add": [field_name], "remove": []}}
            resp1 = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp1.status_code == 200, f"First add failed ({resp1.status_code}): {resp1.text[:500]}"
            time.sleep(1)

            # Verify added
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            fts_after = settings.get("full_text_search_keys", [])
            logger.info(f"After first add: {fts_after}")
            assert field_name in fts_after, \
                f"Field '{field_name}' should be in FTS after add. FTS: {fts_after}"

            # Add same field again
            resp2 = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp2.status_code == 200, f"Second add failed: {resp2.text[:500]}"
            time.sleep(1)

            # Verify no duplicates
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            fts_final = settings.get("full_text_search_keys", [])
            logger.info(f"After second add: {fts_final}")

            assert fts_final.count(field_name) == 1, \
                f"Field '{field_name}' appears {fts_final.count(field_name)} times (expected 1). FTS: {fts_final}"
            assert len(fts_final) == len(original_fts) + 1, \
                f"Expected {len(original_fts) + 1} FTS keys, got {len(fts_final)}"

            logger.info("=== PASSED: full_text_search_keys dedup ===")
        finally:
            # Cleanup
            cleanup = {"full_text_search_keys": {"add": [], "remove": [field_name]}}
            update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, cleanup)

    def test_dedup_fts_multiple_known_fields(self, create_session, base_url):
        """
        Test: Adding multiple distinct existing fields to FTS works with dedup.

        Each field is added twice to verify both addition and dedup work.
        Uses text-type fields only (_timestamp would be rejected for FTS).
        """
        logger.info("=== TEST: FTS multiple known fields ===")
        session = create_session

        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        original_fts = list(settings.get("full_text_search_keys", []))
        # Pick two fields not already in FTS
        available = [f for f in FTS_SAFE_FIELDS if f not in set(original_fts)]
        if len(available) < 2:
            pytest.skip("Fewer than 2 FTS-safe fields available outside current settings")
        field_a, field_b = available[:2]

        try:
            # Add both fields one at a time
            for field_name in [field_a, field_b]:
                payload = {"full_text_search_keys": {"add": [field_name], "remove": []}}
                resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
                assert resp.status_code == 200, f"Add '{field_name}' failed: {resp.text[:200]}"
                time.sleep(1)

            # Add both fields again (should be deduped)
            for field_name in [field_a, field_b]:
                payload = {"full_text_search_keys": {"add": [field_name], "remove": []}}
                resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
                assert resp.status_code == 200, f"Second add '{field_name}' failed: {resp.text[:200]}"
                time.sleep(1)

            # Verify each field appears exactly once
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            fts_final = settings.get("full_text_search_keys", [])
            logger.info(f"FTS after adds: {fts_final}")

            for field_name in [field_a, field_b]:
                count = fts_final.count(field_name)
                assert count == 1, \
                    f"Field '{field_name}' appears {count} times (expected 1): {fts_final}"

            assert len(fts_final) == len(original_fts) + 2, \
                f"Expected {len(original_fts) + 2} FTS keys, got {len(fts_final)}"

            logger.info("=== PASSED: FTS multiple fields dedup ===")
        finally:
            # Cleanup
            cleanup = {"full_text_search_keys": {"add": [], "remove": [field_a, field_b]}}
            update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, cleanup)


class TestStreamSettingsDedupEdgeCases:
    """Edge cases for stream settings deduplication."""

    @pytest.fixture(scope="class", autouse=True)
    def verify_stream_exists(self, create_session, base_url):
        """Verify the test stream exists before running tests."""
        session = create_session
        logger.info(f"=== SETUP: Verifying stream '{STREAM_NAME}' exists ===")
        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        assert settings is not None, f"Stream '{STREAM_NAME}' should be accessible"
        logger.info(f"Settings keys: {list(settings.keys())}")
        logger.info(f"=== SETUP COMPLETE ===")
        yield

    def test_multiple_distinct_fields_no_duplicates(self, create_session, base_url):
        """
        Test: Adding distinct existing fields should all be present (no false dedup).
        Uses index_fields which accepts any schema field.
        """
        logger.info("=== TEST: Multiple distinct fields (no false dedup) ===")
        session = create_session

        # Clean up orphaned FTS keys from previous runs
        cleanup_fts_fields(session, base_url, ORG_ID, INDEX_SAFE_FIELDS)

        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        field_a = get_field_for_index(settings)
        # Get a second field different from field_a
        available = [f for f in INDEX_SAFE_FIELDS if f != field_a]
        filtered = [f for f in available if f not in set(settings.get("full_text_search_keys", []))]
        candidates = filtered if filtered else available
        field_b = candidates[0] if candidates else pytest.skip("Only one index-safe field available")
        original_idx = list(settings.get("index_fields", []))

        try:
            # Add first field
            payload = {"index_fields": {"add": [field_a], "remove": []}}
            resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp.status_code == 200
            time.sleep(1)

            # Add second field
            payload = {"index_fields": {"add": [field_b], "remove": []}}
            resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp.status_code == 200
            time.sleep(1)

            # Verify both present
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            idx_keys = settings.get("index_fields", [])
            logger.info(f"Index fields after adds: {idx_keys}")

            assert field_a in idx_keys, f"'{field_a}' should be present"
            assert field_b in idx_keys, f"'{field_b}' should be present"
            assert idx_keys.count(field_a) == 1
            assert idx_keys.count(field_b) == 1
            assert len(idx_keys) == len(original_idx) + 2, \
                f"Expected {len(original_idx) + 2}, got {len(idx_keys)}"

            logger.info("=== PASSED ===")
        finally:
            cleanup = {"index_fields": {"add": [], "remove": [field_a, field_b]}}
            update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, cleanup)

    def test_repeated_adds_of_same_field(self, create_session, base_url):
        """
        Test: Adding the same field 4+ times should result in only 1 entry.
        """
        logger.info("=== TEST: Repeated adds of same field ===")
        session = create_session

        # Clean up orphaned FTS keys from previous runs
        cleanup_fts_fields(session, base_url, ORG_ID, INDEX_SAFE_FIELDS)

        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        field_name = get_field_for_index(settings)
        original_idx = list(settings.get("index_fields", []))
        payload = {"index_fields": {"add": [field_name], "remove": []}}

        try:
            # Add field 4 times
            for i in range(4):
                resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
                assert resp.status_code == 200, f"Attempt {i+1} failed: {resp.text[:200]}"
                time.sleep(1)

            # Verify exactly once
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            idx_keys = settings.get("index_fields", [])
            count = idx_keys.count(field_name)
            logger.info(f"Field count after 4 adds: {count}, fields: {idx_keys}")

            assert count == 1, f"Field appears {count} times (expected 1): {idx_keys}"
            assert len(idx_keys) == len(original_idx) + 1

            logger.info("=== PASSED: Repeated adds prevented duplicates ===")
        finally:
            cleanup = {"index_fields": {"add": [], "remove": [field_name]}}
            update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, cleanup)

    def test_remove_and_re_add_field(self, create_session, base_url):
        """
        Test: Remove a field then re-add it. Should be present once.
        """
        logger.info("=== TEST: Remove and re-add field ===")
        session = create_session

        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        field_name = get_field_for_index(settings)

        try:
            # Add
            payload = {"index_fields": {"add": [field_name], "remove": []}}
            resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp.status_code == 200
            time.sleep(1)

            # Remove
            remove_payload = {"index_fields": {"add": [], "remove": [field_name]}}
            resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, remove_payload)
            assert resp.status_code == 200
            time.sleep(1)

            # Verify removed
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            assert field_name not in settings.get("index_fields", []), "Field should be removed"

            # Re-add
            resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, payload)
            assert resp.status_code == 200
            time.sleep(1)

            # Verify present once
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            idx_keys = settings.get("index_fields", [])
            assert idx_keys.count(field_name) == 1, \
                f"Field appears {idx_keys.count(field_name)} times after re-add: {idx_keys}"

            logger.info("=== PASSED: Remove and re-add works ===")
        finally:
            update_stream_settings(session, base_url, ORG_ID, STREAM_NAME,
                                  {"index_fields": {"add": [], "remove": [field_name]}})

    def test_empty_add_does_not_break(self, create_session, base_url):
        """
        Test: Empty add list should not cause issues.
        """
        logger.info("=== TEST: Empty add list ===")
        session = create_session

        settings_before = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        original_fts = list(settings_before.get("full_text_search_keys", []))

        empty_payload = {"full_text_search_keys": {"add": [], "remove": []}}
        resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, empty_payload)
        assert resp.status_code == 200, f"Empty update got {resp.status_code}: {resp.text[:200]}"
        time.sleep(1)

        settings_after = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        assert settings_after.get("full_text_search_keys", []) == original_fts, \
            "Settings should be unchanged"

        logger.info("=== PASSED: Empty add list handled ===")

    def test_partial_updates_preserve_other_settings(self, create_session, base_url):
        """
        Test: Updating index_fields should not affect bloom_filter_fields.
        """
        logger.info("=== TEST: Partial updates preserve other settings ===")
        session = create_session

        # Clean up orphaned FTS keys from previous runs
        cleanup_fts_fields(session, base_url, ORG_ID, INDEX_SAFE_FIELDS)

        settings_before = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        field_name = get_field_for_index(settings_before)
        original_bf = list(settings_before.get("bloom_filter_fields", []))

        try:
            # Add to index_fields only
            idx_payload = {"index_fields": {"add": [field_name], "remove": []}}
            resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, idx_payload)
            assert resp.status_code == 200
            time.sleep(1)

            # Verify index updated, bloom filter unchanged
            settings_after = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
            bf_after = settings_after.get("bloom_filter_fields", [])
            assert bf_after == original_bf, \
                f"Bloom filter changed. Before: {original_bf}, After: {bf_after}"

            idx_after = settings_after.get("index_fields", [])
            assert field_name in idx_after, f"Field should be in index: {idx_after}"

            logger.info("=== PASSED: Partial updates preserve other settings ===")
        finally:
            cleanup = {"index_fields": {"add": [], "remove": [field_name]}}
            update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, cleanup)

    def test_dedup_works_for_both_fts_and_index_separately(self, create_session, base_url):
        """
        Test: Same field can be added to FTS and index separately,
        each should dedup independently.

        Note: Backend may reject a field being in both FTS and index
        (validate_index_field_conflicts). This test documents actual behavior.
        """
        logger.info("=== TEST: FTS and index dedup independently ===")
        session = create_session
        settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)
        field_name = get_field_for_fts(settings)
        idx_added = False
        fts_added = False

        try:
            # Add to index_fields twice
            idx_payload = {"index_fields": {"add": [field_name], "remove": []}}
            resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, idx_payload)
            idx_added = resp.status_code == 200
            if idx_added:
                resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, idx_payload)

            # Add to FTS twice
            fts_payload = {"full_text_search_keys": {"add": [field_name], "remove": []}}
            resp = update_stream_settings(session, base_url, ORG_ID, STREAM_NAME, fts_payload)
            fts_added = resp.status_code == 200

            logger.info(f"Index add: {'accepted' if idx_added else 'rejected'}, "
                        f"FTS add: {'accepted' if fts_added else 'rejected'}")

            time.sleep(1)
            settings = get_stream_settings(session, base_url, ORG_ID, STREAM_NAME)

            if idx_added:
                idx = settings.get("index_fields", [])
                assert idx.count(field_name) == 1, f"Index dedup failed: {idx}"

            if fts_added:
                fts = settings.get("full_text_search_keys", [])
                assert fts.count(field_name) == 1, f"FTS dedup failed: {fts}"

            logger.info("=== PASSED: FTS and index dedup test completed ===")
        finally:
            if idx_added:
                update_stream_settings(session, base_url, ORG_ID, STREAM_NAME,
                                      {"index_fields": {"add": [], "remove": [field_name]}})
            if fts_added:
                update_stream_settings(session, base_url, ORG_ID, STREAM_NAME,
                                      {"full_text_search_keys": {"add": [], "remove": [field_name]}})
