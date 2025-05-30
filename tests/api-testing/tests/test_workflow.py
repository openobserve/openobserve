import os
from create_objects import create_objects

from verify_objects import verify_objects
from edit_objects import edit_objects
from delete_objects import delete_objects
from verifydeleted_objects import verify_deleted_objects       
from verifyedited_objects import verify_edited_objects



# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable
ZO_BASE_URL_SC2 = os.environ.get("ZO_BASE_URL_SC2")  # Use environment variable


total_count = 2
org_id = "default"
stream_name = "stream_pytest_data"

def test_workflow(create_session, base_url):

   create_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # verify_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # edit_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # verify_edited_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # delete_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # verify_deleted_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)