import os
from create_objects import create_objects



# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable
ZO_BASE_URL_SC2 = os.environ.get("ZO_BASE_URL_SC2")  # Use environment variable


total_count = 2
org_id = "default"
stream_name = "default"

def test_workflow(create_session, base_url):

   create_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)