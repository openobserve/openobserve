import os


from requests.auth import HTTPBasicAuth
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


 # Use environment variable
def create_objects(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Create objects in the OpenObserve running instance."""

    cipher_page = CipherPage(session, base_url, org_id)
    template_page = TemplatePage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)
    alert_page = AlertPage(session, base_url, org_id)
    savedview_page = SavedViewPage(session, base_url, org_id)

    for i in range(num_objects):
        
        # Create cipher keys
        cipher_name_simpleOO = f"sim_{cipher_page.Unique_value_cipher}_{i}"
        cipher_page.create_cipher_simpleOO(session, base_url, user_email, user_password, org_id, cipher_name_simpleOO)

        cipher_name_tinkOO = f"tink_{cipher_page.Unique_value_cipher}_{i}"
        cipher_page.create_cipher_tinkOO(session, base_url, user_email, user_password, org_id, cipher_name_tinkOO)

        # Create templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.create_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)
        
        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.create_template_email(session, base_url, user_email, user_password, org_id, template_name_email)

        # Create destinations
        destination_name_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}"
        destination_page.create_destination_webhook(session, base_url, org_id, user_email, user_password, template_name_webhook, destination_name_webhook)

        destination_name_email = f"destination_email_{destination_page.Unique_value_destination}_{i}"
        destination_page.create_destination_email(session, base_url, org_id, user_email, user_password, user_email, template_name_email, destination_name_email)  
        
        destination_name_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}"
        destination_page.create_destination_pipeline(session, base_url, org_id, user_email, user_password, destination_name_pipeline)

        # Create alerts
        alert_webhook = f"alert_webhook_{alert_page.Unique_value_alert}_{i}"
        alert_page.create_standard_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_webhook) 

        alert_email = f"alert_email_{alert_page.Unique_value_alert}_{i}"  
        alert_page.create_standard_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_email, destination_name_email, alert_email)

        alert_cron = f"alert_cron_{alert_page.Unique_value_alert}_{i}"
        alert_page.create_standard_alert_cron(session, base_url, user_email, user_password, org_id, stream_name, template_name_email, destination_name_email, alert_cron)

        alert_real_time = f"alert_real_time_{alert_page.Unique_value_alert}_{i}"
        alert_page.create_real_time_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_real_time)

        alert_sql = f"alert_sql_{alert_page.Unique_value_alert}_{i}"
        alert_page.create_standard_alert_sql(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_sql)

        savedview_name = f"savedview_{savedview_page.Unique_value_savedview}_{i}"
        savedview_page.create_savedView(session, base_url, user_email, user_password, org_id, stream_name, savedview_name)
