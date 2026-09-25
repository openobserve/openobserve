"""
Sourcemap RBAC E2E Tests

Tests for Role-Based Access Control on sourcemap APIs.

Test Coverage:
- Viewer role permissions (read-only: can list, cannot upload/delete)
- Editor role permissions (write access: can upload, list, delete)
- Admin role permissions (full access: can upload, list, delete)

Expected RBAC Behavior (Role-Based):
- Viewer: Read-only access (list, translate stacktrace)
- Editor: Full write access (upload, list, delete)
- Admin/Root: Full access (upload, list, delete)

Prerequisites:
- OpenObserve ENTERPRISE build running on ZO_BASE_URL
- Root user credentials for user creation
- OpenFGA enabled for RBAC enforcement

Note:
- Tests marked with @pytest.mark.skip for OSS CI (enterprise-only feature)
- Tests must run serially due to shared module-scoped fixture
- Uses session-based authentication (matches enterprise RBAC test pattern)
"""

import pytest
import logging
import requests

pytestmark = [
    pytest.mark.order(2),
]

logger = logging.getLogger(__name__)

# Test user credentials (created during test run)
test_users = {}


@pytest.fixture(scope="module", autouse=True)
def _require_custom_roles(create_session, base_url):
    """Skip on builds without custom roles, rather than skipping everywhere.

    These cases need viewer/editor/admin accounts. An OSS build has no custom
    roles, so the users cannot exist and every case errors at login.

    This replaces an unconditional `pytest.mark.skip`, which skipped the module
    on EVERY build -- enterprise included -- so these cases had never run
    anywhere. The capability is probed rather than assumed from the edition, in
    the same way `test_anomaly_conditions.py` probes its endpoint.

    The probe is deliberately READ-ONLY. Creating and deleting a probe user
    would mutate the shared `default` org from an autouse fixture, in parallel
    (xdist) with the RBAC suite that tests user permissions -- `GET /roles`
    answers 403 "Not Supported" on OSS and lists roles on enterprise, which is
    the same signal without touching anything.
    """
    probe = create_session.get(f"{base_url}api/default/roles")
    if probe.status_code != 200:
        pytest.skip(
            f"custom roles are not available on this build "
            f"(GET /roles -> {probe.status_code})"
        )


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
        # The enterprise password policy requires at least 15 characters; the
        # previous 12-character value was rejected with HTTP 400, so every case
        # then failed at login.
        password = "TestPass123!Secure"

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

            # Create authenticated session via login endpoint
            user_session = create_user_session(email, password, url)
            if not user_session:
                # Fail loudly rather than skip. The module gate already
                # established that this build supports custom roles, so failing
                # to provision one here is a real defect -- skipping would hide
                # it, which is how the 15-character password policy went
                # unnoticed. The create response is included so the cause is
                # visible without re-running.
                logger.error(f"Failed to create session for {email}")
                raise AssertionError(
                    f"could not provision the {role} user ({email}) on a build that "
                    f"reports custom-role support; create returned "
                    f"{response.status_code}: {response.text[:200]}"
                )

            # Store user info
            test_users[role] = {
                'email': email,
                'password': password,
                'role': role,
                'session': user_session
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
    """
    Create authenticated session via /auth/login endpoint.

    This matches the enterprise RBAC test pattern, ensuring proper
    OpenFGA permission setup through the login flow.
    """
    user_session = requests.Session()
    login_url = f"{base_url}auth/login"
    login_data = {"name": email, "password": password}

    try:
        login_resp = user_session.post(login_url, json=login_data, timeout=30)

        if login_resp.status_code != 200:
            logger.error(f"Login failed for {email}: {login_resp.status_code} - {login_resp.text}")
            return None

        logger.info(f"Successfully logged in as {email}")
        return user_session  # Returns session with cookies from login

    except requests.RequestException as e:
        logger.error(f"Network error during login for {email}: {str(e)}")
        return None


@pytest.fixture(scope="module")
def test_sourcemaps_zip():
    """
    Path to static sourcemaps ZIP fixture.
    Uses pre-built sourcemaps from fixtures directory.
    """
    from pathlib import Path
    # 3 parents from tests/api-testing/tests/rum/test_sourcemap_rbac.py -> tests/api-testing/ where fixtures/ lives
    zip_path = Path(__file__).parent.parent.parent / "fixtures" / "sourcemaps" / "sourcemaps.zip"

    if not zip_path.exists():
        pytest.skip(f"Sourcemaps ZIP not found at {zip_path}. Static fixture missing.")

    return str(zip_path)


# ==============================================================================
# P1 - VIEWER PERMISSIONS
# ==============================================================================

def test_p1_viewer_cannot_upload_sourcemaps(base_url, org_id, test_sourcemaps_zip):
    """
    P1 - FUNCTIONAL TEST
    Viewer role CANNOT upload sourcemaps (read-only access).

    Expected: 401 or 403 (Unauthorized/Forbidden)
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

    assert response.status_code in [401, 403], \
        f"Viewer should NOT be able to upload sourcemaps. Got {response.status_code}: {response.text}"
    logger.info("✅ Viewer correctly denied upload access")


def test_p1_viewer_can_list_sourcemaps(base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Viewer role CAN list sourcemaps (read-only access).

    Expected: 200 OK with list of sourcemaps
    """
    assert 'viewer' in test_users, "Viewer user was not created - RBAC setup failed"

    viewer_session = test_users['viewer']['session']

    response = viewer_session.get(
        f"{base_url}api/{org_id}/sourcemaps"
    )

    assert response.status_code == 200, \
        f"Viewer should be able to list sourcemaps. Got {response.status_code}: {response.text}"

    maps = response.json()
    assert isinstance(maps, list), "Response should be a list"
    logger.info(f"✅ Viewer correctly allowed list access ({len(maps)} sourcemaps)")


def test_p1_viewer_cannot_delete_sourcemaps(base_url, org_id):
    """
    P1 - FUNCTIONAL TEST
    Viewer role CANNOT delete sourcemaps (read-only access).

    Expected: 401 or 403 (Unauthorized/Forbidden)
    """
    assert 'viewer' in test_users, "Viewer user was not created - RBAC setup failed"

    viewer_session = test_users['viewer']['session']

    # Use isolated service/version to avoid affecting shared test data
    params = {
        'service': 'o2-sourcemap-rbac-viewer-delete-test',
        'env': 'testing',
        'version': '1.0.0-rbac-delete'
    }

    response = viewer_session.delete(
        f"{base_url}api/{org_id}/sourcemaps",
        params=params
    )

    assert response.status_code in [401, 403], \
        f"Viewer should NOT be able to delete sourcemaps. Got {response.status_code}: {response.text}"
    logger.info("✅ Viewer correctly denied delete access")


# ==============================================================================
# P1 - EDITOR PERMISSIONS
# ==============================================================================

def test_p1_editor_can_upload_sourcemaps(base_url, org_id, test_sourcemaps_zip):
    """
    P1 - FUNCTIONAL TEST
    Editor role CAN upload sourcemaps (write access).

    Expected: 200 or 201 (Success/Created)
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

    assert response.status_code in [200, 201], \
        f"Editor should be able to upload sourcemaps. Got {response.status_code}: {response.text}"
    logger.info("✅ Editor correctly allowed upload access")

    # Cleanup: Delete what we just uploaded (editors have full write access)
    delete_response = editor_session.delete(
        f"{base_url}api/{org_id}/sourcemaps",
        params={'service': data['service'], 'env': data['env'], 'version': data['version']}
    )

    if delete_response.status_code == 200:
        logger.info("✅ Editor cleanup successful")
    else:
        logger.warning(f"⚠️ Editor cleanup returned {delete_response.status_code}: {delete_response.text}")


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
