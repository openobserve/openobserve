import sys
from pathlib import Path

# Add the current directory to sys.path
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

from pages.template_page import TemplatePage
from pages.folder_page import FolderPage
from pages.dashboard_page import DashboardPage
from pages.destination_page import DestinationPage
from pages.user_page import UserPage
from pages.enrichment_page import EnrichmentPage
from pages.function_page import FunctionPage
from pages.pipeline_page import PipelinePage
from pages.report_page import ReportPage
from pages.savedview_page import SavedViewPage
from pages.serviceaccount_page import ServiceAccountPage
# Use environment variable
def create_objects(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Create objects in the OpenObserve running instance."""


    template_page = TemplatePage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)
    folder_page = FolderPage(session, base_url, org_id)
    dashboard_page = DashboardPage(session, base_url, org_id)
    user_page = UserPage(session, base_url, org_id)
    enrichment_page = EnrichmentPage(session, base_url, org_id)
    function_page = FunctionPage(session, base_url, org_id)
    pipeline_page = PipelinePage(session, base_url, org_id)
    report_page = ReportPage(session, base_url, org_id)
    savedview_page = SavedViewPage(session, base_url, org_id)
    serviceaccount_page = ServiceAccountPage(session, base_url, org_id)
    for i in range(num_objects):

        # Create templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.create_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.create_template_email(session, base_url, user_email, user_password, org_id, template_name_email)

        # Create destinations

        
        destination_name_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}"
        destination_page.create_destination_webhook(session, base_url, org_id, user_email, user_password, template_name_webhook, destination_name_webhook)

        email_address_admin = f"admin{user_page.Unique_value_user}{i}@gmail.com"
        user_page.create_user_admin(session, base_url, user_email, user_password, org_id, email_address_admin)

        destination_name_email = f"destination_email_{destination_page.Unique_value_destination}_{i}"
        destination_page.create_destination_email(session, base_url, org_id, user_email, user_password, email_address_admin, template_name_email, destination_name_email)  

        destination_name_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}"
        destination_page.create_destination_pipeline(session, base_url, org_id, user_email, user_password, destination_name_pipeline)


        folder_name = f"folder_{folder_page.Unique_value_folder}_{i}"
        folder_id = folder_page.create_folder(session, base_url, user_email, user_password, org_id, folder_name)

        dashboard_name = f"dashboard_{dashboard_page.Unique_value_dashboard}_{i}"
        dashboard_id = dashboard_page.create_dashboard(session, base_url, user_email, user_password, org_id, stream_name, folder_id, dashboard_name)

        enrichment_name = f"enrichment_{enrichment_page.Unique_value_enrichment}_{i}"
        enrichment_page.create_enrichment(session, base_url, user_email, user_password, org_id, enrichment_name)

        function_name = f"function_{function_page.Unique_value_function}_{i}"
        function_page.create_function(session, base_url, user_email, user_password, org_id, function_name)

        realTime_pipeline_name = f"realTime_pipeline_{pipeline_page.Unique_value_pipeline}_{i}"
        pipeline_page.create_realTime_pipeline(session, base_url, user_email, user_password, org_id, stream_name, realTime_pipeline_name)

        scheduled_pipeline_name = f"scheduled_pipeline_{pipeline_page.Unique_value_pipeline}_{i}"
        pipeline_page.create_scheduled_pipeline(session, base_url, user_email, user_password, org_id, stream_name, scheduled_pipeline_name)

        scheduled_report_name = f"scheduled_report_{report_page.Unique_value_report}_{i}"
        report_page.create_scheduled_report(session, base_url, user_email, user_password, org_id, dashboard_id, folder_id, scheduled_report_name)

        cached_report_name = f"cached_report_{report_page.Unique_value_report}_{i}"
        report_page.create_cached_report(session, base_url, user_email, user_password, org_id, dashboard_id, folder_id, cached_report_name)

        savedview_name = f"savedview_{savedview_page.Unique_value_savedview}_{i}"
        savedview_page.create_savedView(session, base_url, user_email, user_password, org_id, stream_name, savedview_name)

        email_address_serviceaccount = f"serviceaccount{user_page.Unique_value_user}{i}@gmail.com"
        serviceaccount_page.create_service_account(session, base_url, user_email, user_password, org_id, email_address_serviceaccount)




        