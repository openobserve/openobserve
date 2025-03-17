
from requests.auth import HTTPBasicAuth
from datetime import datetime, timezone, timedelta
from pages.cipher_page import CipherPage
from pages.template_page import TemplatePage
from pages.folder_page import FolderPage
from pages.dashboard_page import DashboardPage
from pages.destination_page import DestinationPage
from pages.alert_page import AlertPage
from pages.user_page import UserPage
from pages.enrichment_page import EnrichmentPage
from pages.function_page import FunctionPage
from pages.pipeline_page import PipelinePage
from pages.report_page import ReportPage
from pages.savedview_page import SavedViewPage
from pages.serviceaccount_page import ServiceAccountPage
from pages.search_page import SearchPage
from pages.alertV2_page import AlertV2Page


def create_objects(session, base_url, user_email, user_password, org_id, num_objects):
    """Create objects in the OpenObserve running instance."""
    
    template_page = TemplatePage(session, base_url, org_id)
    cipher_page = CipherPage(session, base_url, org_id)
   
    for i in range(num_objects):

        # Create templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.create_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.create_template_email(session, base_url, user_email, user_password, org_id, template_name_email)

        





