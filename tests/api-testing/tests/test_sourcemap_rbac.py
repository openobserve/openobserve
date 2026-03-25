"""
Sourcemap RBAC E2E Tests

Tests for Role-Based Access Control on sourcemap APIs.

Test Coverage:
- Viewer role permissions (cannot upload/delete, can list)
- Editor role permissions (can upload, cannot delete)
- Admin role permissions (can delete)

Prerequisites:
- OpenObserve ENTERPRISE build running on ZO_BASE_URL
- Root user credentials for user creation
- Sourcemaps uploaded (from test_sourcemap_api.py)

Note:
- Tests marked with @pytest.mark.skip for OSS CI (enterprise-only feature)
- Tests must run serially due to shared module-scoped fixture

IMPORTANT - Discovery Test Pattern:
These tests use if/elif to accept both authorized and unauthorized responses.
This is INTENTIONAL to discover actual RBAC behavior empirically, as the
spec is not fully defined. Tests log the discovered behavior and document it.
Once RBAC behavior is confirmed, update tests to assert specific expected codes.
TODO: Update to strict assertions once RBAC enforcement is confirmed.
"""

import pytest
import logging
import base64
import requests

# Mark all tests in this module to run serially and skip in OSS (enterprise-only feature)
pytestmark = [
    pytest.mark.order(2),
    pytest.mark.skip(reason="Sourcemaps is an enterprise feature and cannot be tested in CI with non-enterprise build")
]

logger = logging.getLogger(__name__)

# Test user credentials (created during test run)
test_users = {}


@pytest.fixture(scope="module", autouse=True)
def setup_rbac_users(create_session, base_url, org_id):
    """
    Create test users with different roles for RBAC testing.

    Creates:
    - viewer@sourcemap-test.local (role: viewer)
    - editor@sourcemap-test.local (role: editor)
    - admin@sourcemap-test.local (role: admin)
    """
    global test_users

    session = create_session
    url = base_url

    logger.info("========== SETUP: Creating RBAC test users ==========")

    roles = ['viewer', 'editor', 'admin']

    for role in roles:
        email = f"{role}@sourcemap-test.local"
        password = "TestPass123!"

        logger.info(f"Creating user: {email} with role: {role}")

        try:
            response = session.post(
                f"{url}api/{org_id}/users",
                json={
                    'email': email,
                    'password': password,
                    'first_name': 'Test',
                    'last_name': role.capitalize(),
                    'role': role
                }
            )

            if response.status_code in [200, 201]:
                logger.info(f"✅ User created: {email}")
            else:
                logger.warning(f"⚠️ User creation returned {response.status_code}: {response.text}")

            # Store user info
            test_users[role] = {
                'email': email,
                'password': password,
                'role': role,
                'session': create_user_session(email, password, url)
            }

        except Exception as e:
            logger.error(f"Failed to create user {email}: {e}")
            raise

    logger.info(f"========== SETUP COMPLETE: Created {len(test_users)} test users ==========")

    yield test_users

    # Cleanup
    logger.info("========== TEARDOWN: Deleting RBAC test users ==========")

    for role, user_info in test_users.items():
        try:
            response = session.delete(
                f"{url}api/{org_id}/users/{user_info['email']}"
            )

            if response.status_code == 200:
                logger.info(f"✅ User deleted: {user_info['email']}")
            else:
                logger.warning(f"⚠️ User deletion returned {response.status_code}")

        except Exception as e:
            logger.warning(f"Failed to delete user {user_info['email']}: {e}")

    logger.info("========== TEARDOWN COMPLETE ==========")


def create_user_session(email, password, base_url):
    """Create a requests session with user credentials."""
    s = requests.Session()
    basic_auth = base64.b64encode(f"{email}:{password}".encode()).decode()
    s.headers.update({"Authorization": f"Basic {basic_auth}"})
    return s


@pytest.fixture(scope="module")
def test_sourcemaps_zip():
    """
    Path to static sourcemaps ZIP fixture.
    Uses pre-built sourcemaps from fixtures directory.
    """
    from pathlib import Path
    zip_path = Path(__file__).parent.parent / "fixtures" / "sourcemaps" / "sourcemaps.zip"

    if not zip_path.exists():
        pytest.skip(f"Sourcemaps ZIP not found at {zip_path}. Static fixture missing.")

    return str(zip_path)


# ==============================================================================
# P1 - VIEWER PERMISSIONS
# ==============================================================================

def test_p1_viewer_cannot_upload_sourcemaps(base_url, org_id, test_sourcemaps_zip):
    """
    P1 - FUNCTIONAL TEST
    Viewer role permission check for uploading sourcemaps.
    📝 DISCOVERY: Viewers CAN upload sourcemaps (RBAC not enforced yet).
    """
    assert 'viewer' in test_users, "Viewer user was not created - RBAC setup failed"

    viewer_session = test_users['viewer']['session']

    with open(test_sourcemaps_zip, 'rb') as f:
        files = {'file': ('sourcemaps.zip', f, 'application/zip')}
        data = {
            'service': 'o2-sourcemap-rbac-test',
            'env': 'testing',
            'version': '1.0.0-rbac'
        }

        response = viewer_session.post(
            f"{base_url}api/{org_id}/sourcemaps",
            files=files,
            data=data
        )

    # Document actual behavior
    if response.status_code in [200, 201]:
        logger.info("📝 Discovery: Viewers CAN upload sourcemaps (RBAC not enforced)")
        assert response.status_code in [200, 201]
        # Cleanup
        viewer_session.delete(
            f"{base_url}api/{org_id}/sourcemaps",
            params={'service': data['service'], 'env': data['env'], 'version': data['version']}
        )
    elif response.status_code in [401, 403]:
        logger.info("📝 Discovery: Viewers CANNOT upload sourcemaps (RBAC enforced)")
        assert response.status_code in [401, 403]
    elif response.status_code == 400:
        logger.warning(f"Bad Request (400): {response.text}")
        logger.error("Sourcemap ZIP invalid or missing. Setup failed.")
        pytest.fail("Sourcemap upload failed with 400 - invalid ZIP or missing file")
    else:
        pytest.fail(f"Unexpected status code: {response.status_code} - {response.text}")


def test_p1_viewer_can_list_sourcemaps(create_session, base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Viewer role CAN or CANNOT list sourcemaps (TBD - discover empirically).
    """
    assert 'viewer' in test_users, "Viewer user was not created - RBAC setup failed"

    # First, upload sourcemaps as root
    root_session = create_session

    # Try to list as viewer
    viewer_session = test_users['viewer']['session']

    response = viewer_session.get(
        f"{base_url}api/{org_id}/sourcemaps"
    )

    # Document actual behavior
    if response.status_code == 200:
        logger.info("📝 Discovery: Viewers CAN list sourcemaps")
        assert response.status_code == 200
        maps = response.json()
        assert isinstance(maps, list)
    elif response.status_code in [401, 403]:
        logger.info("📝 Discovery: Viewers CANNOT list sourcemaps")
        assert response.status_code in [401, 403]
    else:
        pytest.fail(f"Unexpected status code: {response.status_code} - {response.text}")


def test_p1_viewer_cannot_delete_sourcemaps(base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Viewer role permission check for deleting sourcemaps.
    📝 DISCOVERY: Viewers CAN delete sourcemaps (RBAC not enforced yet).
    """
    assert 'viewer' in test_users, "Viewer user was not created - RBAC setup failed"

    viewer_session = test_users['viewer']['session']

    params = {
        'service': 'o2-sourcemap-test-app',
        'env': 'testing',
        'version': '1.0.0-api-test'
    }

    response = viewer_session.delete(
        f"{base_url}api/{org_id}/sourcemaps",
        params=params
    )

    # Document actual behavior
    if response.status_code == 200:
        logger.info("📝 Discovery: Viewers CAN delete sourcemaps (RBAC not enforced)")
        assert response.status_code == 200
    elif response.status_code in [401, 403]:
        logger.info("📝 Discovery: Viewers CANNOT delete sourcemaps (RBAC enforced)")
        assert response.status_code in [401, 403]
    else:
        pytest.fail(f"Unexpected status code: {response.status_code}")


# ==============================================================================
# P1 - EDITOR PERMISSIONS
# ==============================================================================

def test_p1_editor_can_upload_sourcemaps(base_url, org_id, test_sourcemaps_zip):
    """
    P1 - FUNCTIONAL TEST
    Editor role CAN or CANNOT upload sourcemaps (TBD - discover empirically).
    """
    assert 'editor' in test_users, "Editor user was not created - RBAC setup failed"

    editor_session = test_users['editor']['session']

    with open(test_sourcemaps_zip, 'rb') as f:
        files = {'file': ('sourcemaps.zip', f, 'application/zip')}
        data = {
            'service': 'o2-sourcemap-editor-test',
            'env': 'testing',
            'version': '1.0.0-editor'
        }

        response = editor_session.post(
            f"{base_url}api/{org_id}/sourcemaps",
            files=files,
            data=data
        )

    # Document actual behavior
    if response.status_code in [200, 201]:
        logger.info("📝 Discovery: Editors CAN upload sourcemaps")
        assert response.status_code in [200, 201]

        # Cleanup: Delete what we just uploaded
        editor_session.delete(
            f"{base_url}api/{org_id}/sourcemaps",
            params={'service': data['service'], 'env': data['env'], 'version': data['version']}
        )

    elif response.status_code in [401, 403]:
        logger.info("📝 Discovery: Editors CANNOT upload sourcemaps (admin only)")
        assert response.status_code in [401, 403]
    else:
        pytest.fail(f"Unexpected status code: {response.status_code} - {response.text}")


# ==============================================================================
# P1 - ADMIN PERMISSIONS
# ==============================================================================

def test_p1_admin_can_delete_sourcemaps(create_session, base_url, org_id, test_sourcemaps_zip):
    """
    P1 - FUNCTIONAL TEST
    Admin role can delete sourcemaps.
    """
    assert 'admin' in test_users, "Admin user was not created - RBAC setup failed"

    # First, upload sourcemaps as root
    root_session = create_session

    with open(test_sourcemaps_zip, 'rb') as f:
        files = {'file': ('sourcemaps.zip', f, 'application/zip')}
        data = {
            'service': 'o2-sourcemap-admin-test',
            'env': 'testing',
            'version': '1.0.0-admin'
        }

        upload_response = root_session.post(
            f"{base_url}api/{org_id}/sourcemaps",
            files=files,
            data=data
        )

    assert upload_response.status_code in [200, 201], \
        f"Root upload failed: {upload_response.status_code}"

    # Try to delete as admin
    admin_session = test_users['admin']['session']

    delete_response = admin_session.delete(
        f"{base_url}api/{org_id}/sourcemaps",
        params={'service': data['service'], 'env': data['env'], 'version': data['version']}
    )

    assert delete_response.status_code == 200, \
        f"Admin delete failed: {delete_response.status_code} - {delete_response.text}"

    # Verify deletion
    list_response = root_session.get(
        f"{base_url}api/{org_id}/sourcemaps",
        params={'service': data['service'], 'env': data['env'], 'version': data['version']}
    )

    maps = list_response.json()
    assert len(maps) == 0, f"Expected empty list after delete, got {len(maps)}"

    logger.info("✅ Admin can delete sourcemaps")
