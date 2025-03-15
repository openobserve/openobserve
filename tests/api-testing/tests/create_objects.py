import pytest

@pytest.fixture
def create_objects(base_url ,user_email, user_password,num_objects):
    """Create objects in the OpenObserve running instance."""
    session = requests.Session()
    session.auth = HTTPBasicAuth(ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD)

    for i in range(num_objects):
        {
          template_page.create_template(session, base_url, user_email, user_password, f"test_template_{i}")

        }




