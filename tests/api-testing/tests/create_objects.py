import sys
from pathlib import Path

# Add the current directory to sys.path
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

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


# Use environment variable
def create_objects(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Create objects in the OpenObserve running instance."""


    template_page = TemplatePage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)
    alert_page = AlertPage(session, base_url, org_id)
    folder_page = FolderPage(session, base_url, org_id)
    dashboard_page = DashboardPage(session, base_url, org_id)
    user_page = UserPage(session, base_url, org_id)
    enrichment_page = EnrichmentPage(session, base_url, org_id)
    function_page = FunctionPage(session, base_url, org_id)
    pipeline_page = PipelinePage(session, base_url, org_id)
    report_page = ReportPage(session, base_url, org_id)
    savedview_page = SavedViewPage(session, base_url, org_id)
    serviceaccount_page = ServiceAccountPage(session, base_url, org_id)
    search_page = SearchPage(session, base_url, org_id) 
    alertV2_page = AlertV2Page(session, base_url, org_id)

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
        folder_id = folder_page.create_folder_dashboard_v2(session, base_url, user_email, user_password, org_id, folder_name)

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

        # Create alerts
        alert_webhook = f"standard_{alert_page.Unique_value_alert}_{i}"
        alert_page.create_standard_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_webhook) 

        alert_email = f"alert_email_{alert_page.Unique_value_alert}_{i}"  
        alert_page.create_standard_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_email, destination_name_email, alert_email)

        alert_cron = f"alert_cron_{alert_page.Unique_value_alert}_{i}"
        alert_page.create_standard_alert_cron(session, base_url, user_email, user_password, org_id, stream_name, template_name_email, destination_name_email, alert_cron)

        alert_real_time = f"alert_real_time_{alert_page.Unique_value_alert}_{i}"
        alert_page.create_real_time_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_real_time)

        alert_sql = f"alert_sql_{alert_page.Unique_value_alert}_{i}"
        alert_page.create_standard_alert_sql(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_sql)

        # Create search
        search_page.search_partition_logs_query_2_hours_stream(session, base_url, user_email, user_password, org_id, stream_name)   
        search_page.search_cache_logs_query_2_hours_stream(session, base_url, user_email, user_password, org_id, stream_name)
        search_page.search_histogram_logs_query_2_hours_stream(session, base_url, user_email, user_password, org_id, stream_name)

         # Test cases for Version 2 API
        # Create templates
        template_v2_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}v2"
        template_page.create_template_webhook(session, base_url, user_email, user_password, org_id, template_v2_webhook)
        # Create destinations
        destination_v2_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}v2"
        destination_page.create_destination_webhook(session, base_url, org_id, user_email, user_password, template_v2_webhook, destination_v2_webhook)
        # Create folder
        folder_v2_name = f"folder_{folder_page.Unique_value_folder}_{i}v2"
        folder_id = folder_page.create_folder_alert_v2(session, base_url, user_email, user_password, org_id, folder_v2_name)
        # Create alert
        alert_v2_name = f"alert_{alertV2_page.Unique_value_alert}_{i}v2"
        alertV2_page.create_scheduled_sql_alert(session, base_url, user_email, user_password, org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_name)
        alert_v2_name_no_trigger = f"alert_{alertV2_page.Unique_value_alert}_{i}v2_no_trigger"
        alertV2_page.create_scheduled_sql_alert_vrl_no_trigger(session, base_url, user_email, user_password, org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_name_no_trigger)
        alert_v2_name_trigger = f"alert_{alertV2_page.Unique_value_alert}_{i}v2_trigger"
        alertV2_page.create_scheduled_sql_alert_vrl_trigger(session, base_url, user_email, user_password, org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_name_trigger)


        # Created all objects successfully by admin user

        # Create templates

        template_admin_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}admin"
        template_page.create_template_webhook(session, base_url, email_address_admin, "12345678", org_id, template_admin_webhook)

        template_admin_email = f"template_email_{template_page.Unique_value_temp}_{i}admin"
        template_page.create_template_email(session, base_url, email_address_admin, "12345678", org_id, template_admin_email)

        # Create destinations
        
        destination_admin_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}admin"
        destination_page.create_destination_webhook(session, base_url, org_id, email_address_admin, "12345678", template_admin_webhook, destination_admin_webhook)

        email_admin = f"aduser{user_page.Unique_value_user}{i}@gmail.com"
        user_page.create_user_admin(session, base_url, email_address_admin, "12345678", org_id, email_admin)

        destination_admin_email = f"destination_email_{destination_page.Unique_value_destination}_{i}admin"
        destination_page.create_destination_email(session, base_url, org_id, email_address_admin, "12345678", email_admin, template_admin_email, destination_admin_email)  

        destination_admin_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}admin"
        destination_page.create_destination_pipeline(session, base_url, org_id, email_address_admin, "12345678", destination_admin_pipeline)

        folder_admin = f"folder_{folder_page.Unique_value_folder}_{i}admin"
        folder_id = folder_page.create_folder_dashboard_v2(session, base_url, email_address_admin, "12345678", org_id, folder_admin)

        dashboard_admin = f"dashboard_{dashboard_page.Unique_value_dashboard}_{i}admin"
        dashboard_id = dashboard_page.create_dashboard(session, base_url, email_address_admin, "12345678", org_id, stream_name, folder_id, dashboard_admin)

        enrichment_admin = f"enrichment_{enrichment_page.Unique_value_enrichment}_{i}admin"
        enrichment_page.create_enrichment(session, base_url, email_address_admin, "12345678", org_id, enrichment_admin)

        function_admin = f"function_{function_page.Unique_value_function}_{i}admin"
        function_page.create_function(session, base_url, email_address_admin, "12345678", org_id, function_admin)

        realTime_pipeline_admin = f"realTime_pipeline_{pipeline_page.Unique_value_pipeline}_{i}admin"
        pipeline_page.create_realTime_pipeline(session, base_url, email_address_admin, "12345678", org_id, stream_name, realTime_pipeline_admin)

        scheduled_pipeline_admin = f"scheduled_pipeline_{pipeline_page.Unique_value_pipeline}_{i}admin"
        pipeline_page.create_scheduled_pipeline(session, base_url, email_address_admin, "12345678", org_id, stream_name, scheduled_pipeline_admin)

        scheduled_report_admin = f"scheduled_report_{report_page.Unique_value_report}_{i}admin"
        report_page.create_scheduled_report(session, base_url, email_address_admin, "12345678", org_id, dashboard_id, folder_id, scheduled_report_admin)

        cached_report_admin = f"cached_report_{report_page.Unique_value_report}_{i}admin"
        report_page.create_cached_report(session, base_url, email_address_admin, "12345678", org_id, dashboard_id, folder_id, cached_report_admin)

        savedview_admin = f"savedview_{savedview_page.Unique_value_savedview}_{i}admin"
        savedview_page.create_savedView(session, base_url, email_address_admin, "12345678", org_id, stream_name, savedview_admin)

        email_address_serviceaccount_admin = f"serviceaccount_admin{user_page.Unique_value_user}{i}@gmail.com"
        serviceaccount_page.create_service_account(session, base_url, email_address_admin, "12345678", org_id, email_address_serviceaccount_admin)

        # Create alerts
        alert_webhook_admin = f"alert_webhook_{alert_page.Unique_value_alert}_{i}admin"
        alert_page.create_standard_alert(session, base_url, email_address_admin, "12345678", org_id, stream_name, template_name_webhook, destination_name_webhook, alert_webhook_admin) 

        alert_email_admin = f"alert_email_{alert_page.Unique_value_alert}_{i}admin"  
        alert_page.create_standard_alert(session, base_url, email_address_admin, "12345678", org_id, stream_name, template_name_email, destination_name_email, alert_email_admin)

        alert_cron_admin = f"alert_cron_{alert_page.Unique_value_alert}_{i}admin"
        alert_page.create_standard_alert_cron(session, base_url, email_address_admin, "12345678", org_id, stream_name, template_name_email, destination_name_email, alert_cron_admin)

        alert_real_time_admin = f"alert_real_time_{alert_page.Unique_value_alert}_{i}admin"
        alert_page.create_real_time_alert(session, base_url, email_address_admin, "12345678", org_id, stream_name, template_name_webhook, destination_name_webhook, alert_real_time_admin)

        alert_sql_admin = f"alert_sql_{alert_page.Unique_value_alert}_{i}admin"
        alert_page.create_standard_alert_sql(session, base_url, email_address_admin, "12345678", org_id, stream_name, template_name_webhook, destination_name_webhook, alert_sql_admin)

        # Create search
        search_page.search_partition_logs_query_2_hours_stream(session, base_url, email_address_admin, "12345678", org_id, stream_name)   
        search_page.search_cache_logs_query_2_hours_stream(session, base_url, email_address_admin, "12345678", org_id, stream_name)
        search_page.search_histogram_logs_query_2_hours_stream(session, base_url, email_address_admin, "12345678", org_id, stream_name)


        # Test cases for Version 2 API
        # Create templates
        template_v2_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}adminv2"
        template_page.create_template_webhook(session, base_url, email_address_admin, "12345678", org_id, template_v2_webhook)
        # Create destinations
        destination_v2_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}adminv2"
        destination_page.create_destination_webhook(session, base_url, org_id, email_address_admin, "12345678", template_v2_webhook, destination_v2_webhook)
        # Create folder
        folder_v2_name = f"folder_{folder_page.Unique_value_folder}_{i}adminv2"
        folder_id = folder_page.create_folder_alert_v2(session, base_url, email_address_admin, "12345678", org_id, folder_v2_name)
        # Create alert
        alert_v2_name = f"alert_{alertV2_page.Unique_value_alert}_{i}adminv2"
        alertV2_page.create_scheduled_sql_alert(session, base_url, email_address_admin, "12345678", org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_name)
        alert_v2_name_no_trigger = f"alert_{alertV2_page.Unique_value_alert}_{i}adminv2_no_trigger"
        alertV2_page.create_scheduled_sql_alert_vrl_no_trigger(session, base_url, email_address_admin, "12345678", org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_name_no_trigger)
        alert_v2_name_trigger = f"alert_{alertV2_page.Unique_value_alert}_{i}adminv2_trigger"
        alertV2_page.create_scheduled_sql_alert_vrl_trigger(session, base_url, email_address_admin, "12345678", org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_name_trigger)
        