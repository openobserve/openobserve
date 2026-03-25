"""
Sourcemap API E2E Tests

Tests for RUM sourcemap upload, list, delete, and stacktrace resolution APIs.

Test Coverage:
- Upload sourcemaps (ZIP with multiple .map files)
- List uploaded sourcemaps with filters
- Resolve stacktraces for various error types
- Edge cases (wrong version, wrong service, deleted maps, partial maps)
- Delete sourcemaps

Prerequisites:
- OpenObserve ENTERPRISE build running on ZO_BASE_URL
- RUM enabled (ZO_RUM_ENABLED=true)
- Static sourcemap fixtures at tests/api-testing/fixtures/sourcemaps/

Note:
- Tests use pre-built sourcemaps (no build step required)
- Tests marked with @pytest.mark.skip for OSS CI (enterprise-only feature)
- Tests must run serially due to shared module-scoped fixture
- Use: pytest test_sourcemap_api.py -v (no -n flag for parallel)
"""

import pytest
import logging

# Mark all tests in this module to run serially and skip in OSS (enterprise-only feature)
pytestmark = [
    pytest.mark.order(1),
    pytest.mark.skip(reason="Sourcemaps is an enterprise feature and cannot be tested in CI with non-enterprise build")
]
from sourcemap_helpers import (
    load_static_sourcemaps,
    upload_sourcemaps,
    list_sourcemaps,
    delete_sourcemaps,
    resolve_stacktrace,
    get_expected_stacktrace,
    EXPECTED_RESOLUTIONS
)

logger = logging.getLogger(__name__)

# Shared test state
test_app_build = {}
test_app_server = {}


@pytest.fixture(scope="module", autouse=True)
def setup_test_app(create_session, base_url, org_id):
    """
    Load static sourcemaps and upload once for all tests in this module.

    This fixture:
    1. Loads pre-built sourcemaps from fixtures
    2. Uploads sourcemaps to API
    3. Cleans up after all tests

    Note: Uses static fixtures instead of building test app dynamically.
    This allows tests to run in CI without Node.js/webpack dependencies.
    """
    global test_app_build, test_app_server

    session = create_session
    url = base_url

    logger.info("========== SETUP: Loading static sourcemaps ==========")

    try:
        # 1. Load static sourcemaps from fixtures
        test_app_build = load_static_sourcemaps(
            config={
                'service': 'o2-sourcemap-test-app',
                'env': 'testing',
                'version': '1.0.0-api-test',
                'org': org_id
            }
        )

        # 2. No test app server needed (using static fixtures)
        test_app_server = None

        # 3. Upload sourcemaps
        upload_sourcemaps(
            session,
            url,
            org_id,
            test_app_build['sourcemaps_zip'],
            test_app_build['config']['service'],
            test_app_build['config']['env'],
            test_app_build['config']['version']
        )

        logger.info("========== SETUP COMPLETE ==========")

        # Yield to pause - cleanup runs after all module tests complete
        # Note: Tests access data via module globals, not this yielded value
        yield

    finally:
        logger.info("========== TEARDOWN: Cleaning up ==========")

        # Delete sourcemaps
        try:
            delete_sourcemaps(
                session,
                url,
                org_id,
                test_app_build['config']['service'],
                test_app_build['config']['env'],
                test_app_build['config']['version']
            )
        except Exception as e:
            logger.warning(f"Cleanup: Failed to delete sourcemaps: {e}")

        # Note: No HTTP server to stop (using static fixtures)

        logger.info("========== TEARDOWN COMPLETE ==========")


# ==============================================================================
# P0 - CRITICAL PATH TESTS
# ==============================================================================

def test_p0_upload_sourcemaps_successfully(create_session, base_url, org_id):
    """
    P0 - SMOKE TEST
    Upload sourcemaps ZIP and verify success.
    """
    session = create_session
    url = base_url

    # Verify upload was successful (done in setup_test_app fixture)
    # List to confirm
    maps = list_sourcemaps(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version']
    )

    assert len(maps) >= 4, f"Expected at least 4 sourcemap files, got {len(maps)}"
    logger.info(f"✅ Upload successful: {len(maps)} sourcemaps found")


def test_p0_list_uploaded_sourcemaps(create_session, base_url, org_id):
    """
    P0 - SMOKE TEST
    List uploaded sourcemaps and verify metadata.
    """
    session = create_session
    url = base_url

    maps = list_sourcemaps(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version']
    )

    assert len(maps) == 4, f"Expected exactly 4 sourcemaps, got {len(maps)}"

    # Verify metadata
    for map_entry in maps:
        assert map_entry['service'] == test_app_build['config']['service']
        assert map_entry['env'] == test_app_build['config']['env']
        assert map_entry['version'] == test_app_build['config']['version']
        # API returns individual entries per file, not a files array
        assert 'source_map_file_name' in map_entry
        assert 'created_at' in map_entry

    # Verify expected files
    all_files = []
    for map_entry in maps:
        # Each entry has source_map_file_name field
        all_files.append(map_entry['source_map_file_name'])

    hashes = test_app_build['hashes']
    expected_files = [
        f"main.{hashes['main']}.js.map",
        f"lazy-module.{hashes['lazy_module']}.js.map",
        f"profiler.{hashes['profiler']}.js.map",
        f"recorder.{hashes['recorder']}.js.map"
    ]

    for expected_file in expected_files:
        assert any(expected_file in str(f) for f in all_files), f"Expected file {expected_file} not found in {all_files}"

    logger.info(f"✅ List successful: Found all expected sourcemaps")


# ==============================================================================
# P1 - CORE FUNCTIONALITY: STACKTRACE RESOLUTION
# ==============================================================================

def test_p1_resolve_type_error(create_session, base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Resolve TypeError stacktrace to original source.
    """
    session = create_session
    url = base_url

    stacktrace = get_expected_stacktrace('type_error', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version'],
        stacktrace
    )

    # Verify resolution
    assert 'stacktrace' in result
    assert 'stack' in result['stacktrace']

    first_frame = result['stacktrace']['stack'][0]
    expected = EXPECTED_RESOLUTIONS['type_error']

    assert first_frame['source_info'] is not None, "Expected source_info to be populated"

    # Verify the resolved line contains the original file path
    assert expected['file'] in first_frame['line'], f"Expected {expected['file']} in resolved line: {first_frame['line']}"

    # Verify source code content is present
    assert first_frame['source_info']['source'], "Expected source code to be populated"
    assert expected['contains'] in first_frame['source_info']['source'], f"Expected '{expected['contains']}' in source"

    # Verify line and column are present
    assert first_frame['source_info']['stack_line'] > 0
    assert first_frame['source_info']['stack_col'] >= 0

    logger.info(f"✅ TypeError resolved: {first_frame['line']}")


def test_p1_resolve_reference_error(create_session, base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Resolve ReferenceError stacktrace.
    """
    session = create_session
    url = base_url

    stacktrace = get_expected_stacktrace('reference_error', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version'],
        stacktrace
    )

    first_frame = result['stacktrace']['stack'][0]
    expected = EXPECTED_RESOLUTIONS['reference_error']

    assert first_frame['source_info'] is not None
    assert expected['file'] in first_frame['line']
    assert first_frame['source_info']['source']
    assert expected['contains'] in first_frame['source_info']['source']

    logger.info(f"✅ ReferenceError resolved: {first_frame['line']}")


def test_p1_resolve_range_error(create_session, base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Resolve RangeError stacktrace.
    """
    session = create_session
    url = base_url

    stacktrace = get_expected_stacktrace('range_error', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version'],
        stacktrace
    )

    first_frame = result['stacktrace']['stack'][0]
    expected = EXPECTED_RESOLUTIONS['range_error']

    assert first_frame['source_info'] is not None
    assert expected['file'] in first_frame['line']
    assert first_frame['source_info']['source']
    assert expected['contains'] in first_frame['source_info']['source']

    logger.info(f"✅ RangeError resolved: {first_frame['line']}")


def test_p1_resolve_custom_error(create_session, base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Resolve Custom Error (PaymentError) stacktrace.
    """
    session = create_session
    url = base_url

    stacktrace = get_expected_stacktrace('custom_error', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version'],
        stacktrace
    )

    first_frame = result['stacktrace']['stack'][0]
    expected = EXPECTED_RESOLUTIONS['custom_error']

    assert first_frame['source_info'] is not None
    assert expected['file'] in first_frame['line']
    assert first_frame['source_info']['source']
    assert expected['contains'] in first_frame['source_info']['source']

    logger.info(f"✅ Custom Error resolved: {first_frame['line']}")


def test_p1_resolve_cross_chunk_error(create_session, base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Resolve cross-chunk error (lazy-module) stacktrace.
    Tests multi-file sourcemap resolution.
    """
    session = create_session
    url = base_url

    stacktrace = get_expected_stacktrace('cross_chunk', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version'],
        stacktrace
    )

    frames = result['stacktrace']['stack']
    expected = EXPECTED_RESOLUTIONS['cross_chunk']

    # First frame from lazy-module chunk
    assert frames[0]['source_info'] is not None
    assert expected['file'] in frames[0]['line']
    assert frames[0]['source_info']['source']

    # Check if there are multiple frames (cross-chunk)
    if len(frames) > 1:
        logger.info(f"Cross-chunk: {len(frames)} frames found")
        # Second frame might be from a different chunk
        if frames[1]['source_info'] is not None:
            logger.info(f"Second frame resolved: {frames[1]['line']}")
        else:
            logger.info("Second frame not resolved (may be outside sourcemap coverage)")

    logger.info(f"✅ Cross-chunk error resolved: {frames[0]['line']}")


# ==============================================================================
# P2 - EDGE CASES
# ==============================================================================

def test_p2_wrong_version_returns_graceful_null(create_session, base_url, org_id):
    """
    P2 - EDGE CASE TEST
    Resolve with non-existent version returns graceful null.
    """
    session = create_session
    url = base_url

    stacktrace = get_expected_stacktrace('type_error', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        '999.0.0',  # Non-existent version
        stacktrace
    )

    # Should return 200 with source_info: null (graceful degradation)
    frames = result['stacktrace']['stack']
    for frame in frames:
        assert frame['source_info'] is None, "Expected source_info to be null for wrong version"

    logger.info("✅ Wrong version: Graceful null returned")


def test_p2_wrong_service_returns_graceful_null(create_session, base_url, org_id):
    """
    P2 - EDGE CASE TEST
    Resolve with non-existent service returns graceful null.
    """
    session = create_session
    url = base_url

    stacktrace = get_expected_stacktrace('type_error', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        'nonexistent-service',  # Non-existent service
        test_app_build['config']['env'],
        test_app_build['config']['version'],
        stacktrace
    )

    frames = result['stacktrace']['stack']
    for frame in frames:
        assert frame['source_info'] is None, "Expected source_info to be null for wrong service"

    logger.info("✅ Wrong service: Graceful null returned")


def test_p2_deleted_sourcemaps_return_graceful_null(create_session, base_url, org_id):
    """
    P2 - EDGE CASE TEST
    Resolve after deleting sourcemaps returns graceful null.
    """
    session = create_session
    url = base_url

    # Delete sourcemaps
    delete_response = delete_sourcemaps(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version']
    )

    assert delete_response.status_code == 200, f"Delete failed: {delete_response.status_code}"

    # Try to resolve
    stacktrace = get_expected_stacktrace('type_error', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version'],
        stacktrace
    )

    frames = result['stacktrace']['stack']
    for frame in frames:
        assert frame['source_info'] is None, "Expected source_info to be null for deleted maps"

    # Re-upload for subsequent tests
    upload_sourcemaps(
        session,
        url,
        org_id,
        test_app_build['sourcemaps_zip'],
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version']
    )

    logger.info("✅ Deleted sourcemaps: Graceful null returned, re-uploaded for other tests")


def test_p2_source_context_validation(create_session, base_url, org_id):
    """
    P2 - FUNCTIONAL TEST
    Verify source context includes ~11 lines (5 before + error + 5 after).
    """
    session = create_session
    url = base_url

    stacktrace = get_expected_stacktrace('type_error', test_app_build['hashes'])

    result = resolve_stacktrace(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version'],
        stacktrace
    )

    first_frame = result['stacktrace']['stack'][0]
    source_code = first_frame['source_info']['source']
    lines = source_code.split('\n')

    # Should have ~11 lines (may vary slightly)
    assert len(lines) >= 10, f"Expected at least 10 lines of context, got {len(lines)}"
    assert len(lines) <= 12, f"Expected at most 12 lines of context, got {len(lines)}"

    # Should contain the error line
    assert 'return user.profile.name' in source_code

    logger.info(f"✅ Source context validated: {len(lines)} lines")


# ==============================================================================
# P0 - CLEANUP TESTS
# ==============================================================================

def test_p0_delete_sourcemaps_successfully(create_session, base_url, org_id):
    """
    P0 - FUNCTIONAL TEST
    Delete sourcemaps and verify success.
    """
    session = create_session
    url = base_url

    response = delete_sourcemaps(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version']
    )

    assert response.status_code == 200, f"Delete failed: {response.status_code} - {response.text}"

    logger.info("✅ Delete successful")


def test_p0_list_after_delete_returns_empty(create_session, base_url, org_id):
    """
    P0 - FUNCTIONAL TEST
    List after delete returns empty array.
    """
    session = create_session
    url = base_url

    maps = list_sourcemaps(
        session,
        url,
        org_id,
        test_app_build['config']['service'],
        test_app_build['config']['env'],
        test_app_build['config']['version']
    )

    assert len(maps) == 0, f"Expected empty list after delete, got {len(maps)} sourcemaps"

    logger.info("✅ List after delete: Empty as expected")
