import pytest
import time
import requests
from create_objectsEP import create_objectsEP
# from verify_objectsEP import verify_objectsEP
# from edit_objectsEP import edit_objectsEP
# from delete_objectsEP import delete_objectsEP
# from verifydeleted_objectsEP import verifydeleted_objectsEP
import os
# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable
ZO_BASE_URL_SC2 = os.environ.get("ZO_BASE_URL_SC2")  # Use environment variable


total_count = 1
org_id = "default"
stream_name = "stream_pytest_data"

def test_workFlowEP(create_session, base_url):

   create_objectsEP(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count) # create objects
   # verify_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # edit_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # verify_edited_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # delete_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)
   # verify_deleted_objects(create_session, base_url, ZO_ROOT_USER_EMAIL, ZO_ROOT_USER_PASSWORD, org_id, stream_name, total_count)