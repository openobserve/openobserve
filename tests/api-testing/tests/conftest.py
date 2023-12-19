import requests
import pytest
import os


BASE_URL = os.environ["ZO_BASE_URL"]


@pytest.fixture
def create_session():
    """Create a session and return it."""

    s = requests.Session()
    username = os.environ["ZO_ROOT_USER_EMAIL"]
    password = os.environ["ZO_ROOT_USER_PASSWORD"]
    s.auth = (username, password)
    s.post(BASE_URL)
    return s


@pytest.fixture
def base_url():
    """Return the base URL."""

    return BASE_URL
