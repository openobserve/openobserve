import os
import pytest
import random
import uuid
import json
from pathlib import Path
import base64
import requests
import io
import time
import tink
from tink import daead
from tink import secret_key_access
from datetime import datetime, timezone, timedelta
from pages.cipher_page import CipherPage
from pages.template_page import TemplatePage
from pages.destination_page import DestinationPage
from pages.alert_page import AlertPage
from pages.savedview_page import SavedViewPage
from pages.folder_page import FolderPage
from pages.dashboard_page import DashboardPage
from pages.function_page import FunctionPage
from pages.enrichment_page import EnrichmentPage
from pages.pipeline_page import PipelinePage
from pages.report_page import ReportPage
from pages.user_page import UserPage
from pages.serviceaccount_page import ServiceAccountPage
from pages.role_page import RolePage
from pages.uds_mqr_page import UdsMqrPage   

# Constants for WebSocket URL and user credentials
ZO_BASE_URL = os.environ.get("ZO_BASE_URL")  # Use environment variable
ZO_BASE_URL_SC = os.environ.get("ZO_BASE_URL_SC")  # Use environment variable
ZO_ROOT_USER_EMAIL = os.environ.get("ZO_ROOT_USER_EMAIL")  # Use environment variable
ZO_ROOT_USER_PASSWORD = os.environ.get("ZO_ROOT_USER_PASSWORD")  # Use environment variable
ZO_BASE_URL_SC2 = os.environ.get("ZO_BASE_URL_SC2")  # Use environment variable
root_dir = Path(__file__).parent.parent.parent


# Variables to be used in the tests
now = datetime.now(timezone.utc)
end_time = int(now.timestamp() * 1000000)
one_min_ago = int((now - timedelta(minutes=1)).timestamp() * 1000000)
simpleKeys = os.environ["SIMPLE_KEYS"]
simpleKeysUp = os.environ["SIMPLE_KEYS_UP"]

# Retrieve the primary key ID 
primary_key_id_tink = os.environ.get("PRIMARY_KEY_ID", 0)  # Default to 0 if not set
primary_key_id_tink_val = os.environ["PRIMARY_KEY_ID_VAL"]   
primary_key_id_tink_up = os.environ.get("PRIMARY_KEY_ID_UP", 0)  # Default to 0 if not set
primary_key_id_tink_val_up = os.environ["PRIMARY_KEY_ID_VAL_UP"]   

Unique_value = f"u_{random.randint(100000, 999999)}"
Total_count = 2
org_id = "default"
stream_name = "stream_pytest_data"

def test_create_workflow(create_session, base_url):
    session = create_session
    template_page = TemplatePage(create_session, base_url, org_id)
    cipher_page = CipherPage(create_session, base_url, org_id)
    destination_page = DestinationPage(create_session, base_url, org_id)
    alert_page = AlertPage(create_session, base_url, org_id)
    savedview_page = SavedViewPage(create_session, base_url, org_id)
    folder_page = FolderPage(create_session, base_url, org_id)
    dashboard_page = DashboardPage(create_session, base_url, org_id)
    function_page = FunctionPage(create_session, base_url, org_id)
    enrichment_page = EnrichmentPage(create_session, base_url, org_id)
    pipeline_page =PipelinePage(create_session, base_url, org_id)
    report_page = ReportPage(create_session, base_url, org_id)
    user_page = UserPage(create_session, base_url, org_id)
    service_account_page = ServiceAccountPage(create_session, base_url, org_id)
    role_page = RolePage(create_session, base_url, org_id)
    uds_mqr_page = UdsMqrPage(create_session, base_url, org_id)
    # Loop to create 500 templates, destinations, and alerts
    for i in range(Total_count):

        # Cipher keys creation simple at OpenObserve
        cipher_name_simpleOO = f"sim_{cipher_page.Unique_value_cipher}_{i + 1}_{random.randint(100000, 999999)}"  
        try:
            cipher_page.create_cipher_simpleOO(session, base_url, org_id, cipher_name_simpleOO)
        except Exception as e:
            print(f"Failed to cipher simple at OpenObserve: {e}")

        # Cipher keys creation Tink at OpenObserve
        cipher_name_tinkOO = f"tink_{cipher_page.Unique_value_cipher}_{i + 1}_{random.randint(100000, 999999)}"
        try:
            cipher_page.create_cipher_tinkOO(session, base_url, org_id, cipher_name_tinkOO)
        except Exception as e:
            print(f"Failed to cipher Tink at OpenObserve: {e}")   

        # Create unique template names
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i + 1}_{random.randint(100000, 999999)}"
        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i + 1}_{random.randint(100000, 999999)}"

        # Create templates
        try:
            template_page.create_template_webhook(session, base_url, org_id, template_name_webhook)
        except Exception as e:
            print(f"Failed to create webhook template: {e}")

        try:
            template_page.create_template_email(session, base_url, org_id, template_name_email)
        except Exception as e:
            print(f"Failed to create email template: {e}")

        # # Create unique destination names
        # destination_name_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i + 1}_{random.randint(100000, 999999)}"
        # destination_name_email = f"destination_email_{destination_page.Unique_value_destination}_{i + 1}_{random.randint(100000, 999999)}"
        # destination_name_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i + 1}_{random.randint(100000, 999999)}"

        # # Create destinations
        # try:
        #     destination_page.create_destination_webhook(session, base_url, org_id, template_name_webhook, destination_name_webhook)
        # except Exception as e:
        #     print(f"Failed to create webhook destination: {e}")

        # try:
        #     destination_page.create_destination_email(session, base_url, org_id, template_name_email, destination_name_email, ZO_ROOT_USER_EMAIL)
        # except Exception as e:
        #     print(f"Failed to create email destination: {e}")

        # try:
        #     destination_page.create_destination_pipeline(session, base_url, org_id, destination_name_pipeline)
        # except Exception as e:
        #     print(f"Failed to create pipeline destination: {e}")


        # # Create alerts with unique names
        # alert_webhook = f"alert_webhook_{alert_page.Unique_value_alert}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_page.create_standard_alert(session, base_url, org_id, alert_webhook, template_name_webhook, stream_name, destination_name_webhook)
        # except Exception as e:
        #     print(f"Failed to create webhook alert: {e}")

        # alert_email = f"alert_email_{alert_page.Unique_value_alert}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_page.create_standard_alert(session, base_url, org_id, alert_email, template_name_email, stream_name, destination_name_email)
        # except Exception as e:
        #     print(f"Failed to create email alert: {e}")

        # alert_cron = f"alert_cron_{alert_page.Unique_value_alert}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_page.create_standard_alert_cron(session, base_url, org_id, alert_cron, template_name_email, stream_name, destination_name_email)
        # except Exception as e:
        #     pytest.fail(f"Failed to create cron alert: {e}")

        # alert_real_time = f"alert_real_time_{alert_page.Unique_value_alert}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_page.create_real_time_alert(session, base_url, org_id, alert_real_time, template_name_email, stream_name, destination_name_email)
        # except Exception as e:
        #     print(f"Failed to create real-time alert: {e}")

        # alert_sql = f"alert_sql_{alert_page.Unique_value_alert}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     alert_page.create_standard_alert_sql(session, base_url, org_id, alert_sql, template_name_email, stream_name, destination_name_email)
        # except Exception as e:
        #     print(f"Failed to create SQL alert: {e}")

        # savedview_name = f"savedview_{savedview_page.Unique_value_savedview}_{i + 1}_{random.randint(100000, 999999)}"      
        # try:
        #     savedview_page.create_savedView(session, base_url, org_id, savedview_name, stream_name)
        # except Exception as e:
        #     print(f"Failed to create saved view: {e}")

        # folder_name = f"folder_{folder_page.Unique_value_folder}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     folder_id = folder_page.create_folder(session, base_url, org_id, folder_name)
        # except Exception as e:
        #     print(f"Failed to create folder: {e}")

        # dashboard_name = f"dashboard_{dashboard_page.Unique_value_dashboard}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     dashboard_id = dashboard_page.create_dashboard(session, base_url, org_id, dashboard_name, folder_id)
        # except Exception as e:
        #     print(f"Failed to create dashboard: {e}")

        # function_name = f"function_{function_page.Unique_value_function}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     function_page.create_function(session, base_url, org_id, function_name)   
        # except Exception as e:
        #     print(f"Failed to create function: {e}")

        # enrichment_table_name = f"enrichment_{enrichment_page.Unique_value_enrichment}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     enrichment_page.create_enrichment_table(session, base_url, org_id, enrichment_table_name)
        # except Exception as e:
        #     print(f"Failed to create enrichment table: {e}")

        # realTime_pipeline_name = f"realTime_pipeline_{pipeline_page.Unique_value_pipeline}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     pipeline_page.create_realTime_pipeline(session, base_url, org_id, realTime_pipeline_name, stream_name)  
        # except Exception as e:
        #     print(f"Failed to create real-time pipeline: {e}")

        # scheduled_pipeline_name = f"scheduled_pipeline_{pipeline_page.Unique_value_pipeline}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     pipeline_page.create_scheduled_pipeline(session, base_url, org_id, scheduled_pipeline_name, stream_name)    
        # except Exception as e:
        #     print(f"Failed to create scheduled pipeline: {e}")

        # scheduled_report_name = f"scheduled_report_{report_page.Unique_value_report}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     report_page.create_scheduled_report(session, base_url, org_id, scheduled_report_name, dashboard_id, folder_id)  
        # except Exception as e:
        #     print(f"Failed to create scheduled report: {e}")

        # cached_report_name = f"cached_report_{report_page.Unique_value_report}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     report_page.create_cached_report(session, base_url, org_id, cached_report_name, dashboard_id, folder_id)  
        # except Exception as e:
        #     print(f"Failed to create cached report: {e}")

        # email_address_admin = f"user_email_admin_{user_page.Unique_value_user}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     user_page.create_user_admin(session, base_url, org_id, email_address_admin)
        # except Exception as e:
        #     print(f"Failed to create admin user: {e}")

        # email_address_viewer = f"user_email_viewer_{user_page.Unique_value_user}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     user_page.create_user_viewer(session, base_url, org_id, email_address_viewer) 
        # except Exception as e:
        #     print(f"Failed to create viewer user: {e}")

        # email_address_editor = f"user_email_editor_{user_page.Unique_value_user}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     user_page.create_user_editor(session, base_url, org_id, email_address_editor) 
        # except Exception as e:
        #     print(f"Failed to create editor user: {e}")

        # email_address_user = f"user_email_user_{user_page.Unique_value_user}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     user_page.create_user_user(session, base_url, org_id, email_address_user)
        # except Exception as e:
        #     print(f"Failed to create regular user: {e}")

        # service_account_email = f"service_account_{service_account_page.Unique_value_serviceaccount}_{i + 1}_{random.randint(100000, 999999)}@gmail.com"
        # try:
        #     service_account_page.create_service_account(session, base_url, org_id, service_account_email) 
        # except Exception as e:
        #     print(f"Failed to create service account: {e}")

        # role_name = f"role_{role_page.Unique_value_role}_{i + 1}_{random.randint(100000, 999999)}"
        # try:
        #     role_page.create_role(role_name)
        # except Exception as e:
        #     print(f"Failed to create role: {e}")

        # # Example usage within the test
        # max_query_range_hours =  i + 1
        # print(f"Iteration {i + 1}: max_query_range_hours = {max_query_range_hours}")
        # try:
        #     uds_mqr_page.create_uds_mqr(session, base_url, org_id, stream_name, max_query_range_hours)
        # except Exception as e:
        #     print(f"Error occurred while creating UDS max query range: {e}")


        
def test_validate_SC(create_session, supercluster_base_urls):
    session = create_session

    for sc_url in supercluster_base_urls:
        cipher_page = CipherPage(session, sc_url, org_id)
        template_page = TemplatePage(session, sc_url, org_id)

        # Validate simpleOO keys
        result = cipher_page.retrieve_cipherKeys_simpleOO(session, sc_url, org_id)
        assert result['count'] == Total_count
        first_key_name_simpleOO = result['first_key_name']
        cipher_page.retrieve_cipher_simpleOO(session, sc_url, org_id, first_key_name_simpleOO, "GNf6Mc")

        # Validate tinkOO keys
        result = cipher_page.retrieve_cipherKeys_tinkOO(session, sc_url, org_id)
        assert result['count'] == Total_count
        first_key_name_tinkOO = result['first_key_name']
        cipher_page.retrieve_cipher_tinkOO(session, sc_url, org_id, first_key_name_tinkOO, primary_key_id_tink)

        # Validate templates
        templates = template_page.retrieve_templates_email(session, sc_url, org_id)
        assert templates['count'] == Total_count
        first_template_name_email = templates['first_template_email']
        template_page.retrieve_template_email(session, sc_url, org_id, first_template_name_email)

        templates = template_page.retrieve_templates_webhook(session, sc_url, org_id)
        assert templates['count'] == Total_count
        first_template_name_webhook = templates['first_template_webhook']
        template_page.retrieve_template_webhook(session, sc_url, org_id, first_template_name_webhook)










def test_update_workflow(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL
    
    # Initialize page objects
    cipher_page = CipherPage(create_session, base_url, org_id)
    template_page = TemplatePage(create_session, base_url, org_id)

    # Update simple cipher
    result = cipher_page.retrieve_cipherKeys_simpleOO(session, base_url, org_id)
    first_key_name_simpleOO = result['first_key_name']
    cipher_page.update_cipher_simpleOO(session, base_url, org_id, first_key_name_simpleOO)
    cipher_page.retrieve_cipher_simpleOO(session, base_url, org_id, first_key_name_simpleOO, "6h/Q/O")

    # Update tink cipher
    result = cipher_page.retrieve_cipherKeys_tinkOO(session, base_url, org_id)
    first_key_name_tinkOO = result['first_key_name']
    cipher_page.update_cipher_tinkOO(session, base_url, org_id, first_key_name_tinkOO)
    cipher_page.retrieve_cipher_tinkOO(session, base_url, org_id, first_key_name_tinkOO, primary_key_id_tink_up)

    # Update email templates
    templates = template_page.retrieve_templates_email(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_email_{Unique_value}' templates found - {templates['count']}")
    first_template_name_email = templates['first_template_email']
    template_page.update_template_email(session, base_url, org_id, first_template_name_email)

    # Update webhook templates
    templates = template_page.retrieve_templates_webhook(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_webhook_{Unique_value}' templates found - {templates['count']}")
    first_template_name_webhook = templates['first_template_webhook']
    template_page.update_template_webhook(session, base_url, org_id, first_template_name_webhook)



     
 
    


def test_validate_updated_SC(create_session, supercluster_base_urls):
    session = create_session
    

    for sc_url in supercluster_base_urls:
        cipher_page = CipherPage(session, sc_url, org_id)
        template_page = TemplatePage(session, sc_url, org_id)

        result = cipher_page.retrieve_cipherKeys_simpleOO(session, sc_url, org_id)
        first_key_name_simpleOO = result['first_key_name']
        cipher_page.retrieve_cipher_simpleOO(session, sc_url, org_id, first_key_name_simpleOO, "6h/Q/O")

        result = cipher_page.retrieve_cipherKeys_tinkOO(session, sc_url, org_id)
        first_key_name_tinkOO = result['first_key_name']
        cipher_page.retrieve_cipher_tinkOO(session, sc_url, org_id, first_key_name_tinkOO, primary_key_id_tink_up)

        templates = template_page.retrieve_templates_email(session, sc_url, org_id)
        assert templates['count'] == Total_count
        first_template_name_email = templates['first_template_email']
        template_page.retrieve_template_email(session, sc_url, org_id, first_template_name_email)

        templates = template_page.retrieve_templates_webhook(session, sc_url, org_id)
        assert templates['count'] == Total_count
        first_template_name_webhook = templates['first_template_webhook']
        template_page.retrieve_template_webhook(session, sc_url, org_id, first_template_name_webhook)



    


def test_delete_workflow(create_session, base_url):
    session = create_session
    base_url = ZO_BASE_URL


    cipher_page = CipherPage(session, base_url, org_id)
    template_page = TemplatePage(session, base_url, org_id)
    
    # Delete and validate simple cipher
    result = cipher_page.retrieve_cipherKeys_simpleOO(session, base_url, org_id)
    first_key_name_simpleOO = result['first_key_name']
    cipher_page.delete_cipher(session, base_url, org_id, "sim")
    cipher_page.validate_deleted_cipher(session, base_url, org_id, first_key_name_simpleOO)

    # Delete and validate tink cipher
    result = cipher_page.retrieve_cipherKeys_tinkOO(session, base_url, org_id)
    first_key_name_tinkOO = result['first_key_name']
    cipher_page.delete_cipher(session, base_url, org_id, "tink")
    cipher_page.validate_deleted_cipher(session, base_url, org_id, first_key_name_tinkOO)


    # Delete and validate email templates
    templates = template_page.retrieve_templates_email(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_email_{template_page.Unique_value_temp}' templates found - {templates['count']}")
    first_template_name_email = templates['first_template_email']
    template_page.delete_template(session, base_url, org_id, "template_email")
    template_page.validate_deleted_template(session, base_url, org_id, first_template_name_email)

    # Delete and validate webhook templates
    templates = template_page.retrieve_templates_webhook(session, base_url, org_id)
    assert templates['count'] == Total_count, (f"No 'template_webhook_{template_page.Unique_value_temp}' templates found - {templates['count']}")
    first_template_name_webhook = templates['first_template_webhook']
    template_page.delete_template(session, base_url, org_id, "template_webhook")
    template_page.validate_deleted_template(session, base_url, org_id, first_template_name_webhook)   

    
def test_deleted_SC(create_session, supercluster_base_urls):
    session = create_session
    
    for sc_url in supercluster_base_urls:
        template_page = TemplatePage(session, sc_url, org_id)
        cipher_page = CipherPage(session, sc_url, org_id)

        cipher_page.validate_deleted_cipher_SC(session, sc_url, org_id, "sim")
        cipher_page.validate_deleted_cipher_SC(session, sc_url, org_id, "tink")
        template_page.validate_deleted_template_SC(session, sc_url, org_id, "template_email")
        template_page.validate_deleted_template_SC(session, sc_url, org_id, "template_webhook")


    




    




       