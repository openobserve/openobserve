<<<<<<< HEAD
=======


>>>>>>> bd6aa04c8 (Have updated for dev3 / dev4)

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

<<<<<<< HEAD
        
=======
        # Create destinations
        destination_name_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}"
        destination_page.create_destination_webhook(session, base_url, org_id, user_email, user_password, template_name_webhook, destination_name_webhook)

        email_address_admin = f"admin{user_page.Unique_value_user}{i}@gmail.com"
        user_page.create_user_admin(session, base_url, user_email, user_password, org_id, email_address_admin)

        destination_name_email = f"destination_email_{destination_page.Unique_value_destination}_{i}"
        destination_page.create_destination_email(session, base_url, org_id, user_email, user_password, email_address_admin, template_name_email, destination_name_email)  
        
        # destination_name_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}"
        # destination_page.create_destination_pipeline(session, base_url, org_id, user_email, user_password, destination_name_pipeline)

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


        # savedview_name = f"savedview_{savedview_page.Unique_value_savedview}_{i}"
        # savedview_page.create_savedView(session, base_url, user_email, user_password, org_id, stream_name, savedview_name)

        folder_name = f"folder_{folder_page.Unique_value_folder}_{i}"
        folder_id = folder_page.create_folder(session, base_url, user_email, user_password, org_id, folder_name)

        # dashboard_name = f"dashboard_{dashboard_page.Unique_value_dashboard}_{i}"
        # dashboard_id = dashboard_page.create_dashboard(session, base_url, user_email, user_password, org_id, folder_id, dashboard_name)

        panel_name = f"panel_{dashboard_page.Unique_value_panel}_{i}"
        panel_id = dashboard_page.create_panel(session, base_url, user_email, user_password, org_id, stream_name, folder_id, panel_name)

        scheduled_report_name = f"scheduled_report_{report_page.Unique_value_report}_{i}"
        scheduled_report_id = report_page.create_scheduled_report(session, base_url, user_email, user_password, org_id, panel_id, folder_id, scheduled_report_name)

        cached_report_name = f"cached_report_{report_page.Unique_value_report}_{i}"
        cached_report_id = report_page.create_cached_report(session, base_url, user_email, user_password, org_id, panel_id, folder_id, cached_report_name)

        # function_name = f"function_{function_page.Unique_value_function}_{i}"
        # function_id = function_page.create_function(session, base_url, user_email, user_password, org_id, function_name)

        # enrichment_name = f"enrichment_{enrichment_page.Unique_value_enrichment}_{i}"
        # enrichment_id = enrichment_page.create_enrichment(session, base_url, user_email, user_password, org_id, enrichment_name)

        # pipeline_name = f"realTime_pipeline_{pipeline_page.Unique_value_pipeline}_{i}"
        # pipeline_id = pipeline_page.create_realTime_pipeline(session, base_url, user_email, user_password, org_id, stream_name, pipeline_name)

        # pipeline_name = f"scheduled_pipeline_{pipeline_page.Unique_value_pipeline}_{i}"
        # pipeline_id = pipeline_page.create_scheduled_pipeline(session, base_url, user_email, user_password, org_id, stream_name, pipeline_name)

        # email_address_admin = f"admin{user_page.Unique_value_user}{i}@gmail.com"
        # user_page.create_user_admin(session, base_url, user_email, user_password, org_id, email_address_admin)

        # email_address_viewer = f"viewer{user_page.Unique_value_user}{i}@gmail.com"
        # user_page.create_user_viewer(session, base_url, user_email, user_password, org_id, email_address_viewer)

        # email_address_editor = f"editor{user_page.Unique_value_user}{i}@gmail.com"
        # user_page.create_user_editor(session, base_url, user_email, user_password, org_id, email_address_editor)

        # email_address_user = f"user{user_page.Unique_value_user}{i}@gmail.com"
        # user_page.create_user_user(session, base_url, user_email, user_password, org_id, email_address_user)

        # serviceaccount_name = f"serviceaccount{serviceaccount_page.Unique_value_serviceaccount}{i}@gmail.com"
        # serviceaccount_page.create_service_account(session, base_url, user_email, user_password, org_id, serviceaccount_name)

        # role_name = f"role{role_page.Unique_value_role}{i}"
        # role_page.create_role(session, base_url, user_email, user_password, org_id, role_name)

        # uds_mqr_hours = i + 1
        # uds_mqr_page.create_uds_mqr(session, base_url, user_email, user_password, org_id, stream_name, uds_mqr_hours)
>>>>>>> bd6aa04c8 (Have updated for dev3 / dev4)





