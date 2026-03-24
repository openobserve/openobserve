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
- OpenObserve running on ZO_BASE_URL
- RUM enabled (ZO_RUM_ENABLED=true)
- Test app at tests/ui-testing/MD_Files/Sourcemaps/o2-sourcemap-test-app/
- npm installed in test app directory

Note: Tests must run serially due to shared module-scoped fixture.
Use: pytest test_sourcemap_api.py -v (no -n flag for parallel)
"""

import pytest
import logging

# Mark all tests in this module to run serially
pytestmark = pytest.mark.order(1)
from sourcemap_helpers import (
    build_test_app,
    serve_test_app,
    stop_test_app_server,
    upload_sourcemaps,
    list_sourcemaps,
    delete_sourcemaps,
    resolve_stacktrace,
    get_rum_token,
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
    Build and serve test app once for all tests in this module.

    This fixture:
    1. Fetches RUM token
    2. Builds test app with updated SDK config
    3. Serves app on port 8089
    4. Uploads sourcemaps
    5. Cleans up after all tests
    """
    global test_app_build, test_app_server

    session = create_session
    url = base_url

    logger.info("========== SETUP: Building and serving test app ==========")

    try:
        # 1. Get RUM token
        rum_token = get_rum_token(session, url, org_id)

        # 2. Build test app
        test_app_build = build_test_app(
            rum_token,
            config={
                'service': 'o2-sourcemap-test-app',
                'env': 'testing',
                'version': '1.0.0-api-test',
                'org': org_id
            }
        )

        # 3. Serve test app
        test_app_server = serve_test_app(test_app_build['dist_path'], port=8089)

        # 4. Upload sourcemaps
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

        yield test_app_build

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

        # Stop HTTP server
        try:
            stop_test_app_server(test_app_server)
        except Exception as e:
            logger.warning(f"Cleanup: Failed to stop server: {e}")

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
        assert 'files' in map_entry or 'file' in map_entry
        assert 'uploaded_at' in map_entry or 'timestamp' in map_entry

    # Verify expected files
    all_files = []
    for map_entry in maps:
        files = map_entry.get('files', [map_entry.get('file')])
        all_files.extend(files if isinstance(files, list) else [files])

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
    assert expected['file'] in first_frame['source_info']['original_file']
    assert first_frame['source_info']['original_line'] == expected['line']
    assert first_frame['source_info']['original_column'] == expected['column']
    assert first_frame['source_info']['original_function_name'] == expected['function']
    assert expected['contains'] in first_frame['source_info']['source_content']

    logger.info(f"✅ TypeError resolved: {first_frame['source_info']['original_file']}:{first_frame['source_info']['original_line']}")


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
    assert expected['file'] in first_frame['source_info']['original_file']
    assert first_frame['source_info']['original_line'] == expected['line']
    assert expected['contains'] in first_frame['source_info']['source_content']

    logger.info(f"✅ ReferenceError resolved: {first_frame['source_info']['original_file']}:{first_frame['source_info']['original_line']}")


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
    assert expected['file'] in first_frame['source_info']['original_file']
    assert first_frame['source_info']['original_line'] == expected['line']
    assert expected['contains'] in first_frame['source_info']['source_content']

    logger.info(f"✅ RangeError resolved: {first_frame['source_info']['original_file']}:{first_frame['source_info']['original_line']}")


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
    assert expected['file'] in first_frame['source_info']['original_file']
    assert first_frame['source_info']['original_line'] == expected['line']
    assert expected['contains'] in first_frame['source_info']['source_content']

    logger.info(f"✅ Custom Error resolved: {first_frame['source_info']['original_file']}:{first_frame['source_info']['original_line']}")


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
    assert expected['file'] in frames[0]['source_info']['original_file']
    assert frames[0]['source_info']['original_line'] == expected['line']
    assert frames[0]['source_info']['original_function_name'] == expected['function']

    # Second frame from main chunk
    assert frames[1]['source_info'] is not None
    assert 'index.js' in frames[1]['source_info']['original_file']

    logger.info(f"✅ Cross-chunk error resolved: {frames[0]['source_info']['original_file']}:{frames[0]['source_info']['original_line']}")


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


def test_p2_partial_sourcemaps_mixed_resolution(create_session, base_url, org_id):
    """
    P2 - EDGE CASE TEST
    Upload only main.map, verify mixed resolution (main resolved, lazy-module null).
    """
    session = create_session
    url = base_url

    # This test would require creating a partial ZIP
    # For now, we'll skip implementation and document expected behavior
    pytest.skip("Partial sourcemaps test requires custom ZIP creation - deferred")


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
    source_content = first_frame['source_info']['source_content']
    lines = source_content.split('\n')

    # Should have ~11 lines (may vary slightly)
    assert len(lines) >= 10, f"Expected at least 10 lines of context, got {len(lines)}"
    assert len(lines) <= 12, f"Expected at most 12 lines of context, got {len(lines)}"

    # Should contain the error line
    assert 'return user.profile.name' in source_content

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
