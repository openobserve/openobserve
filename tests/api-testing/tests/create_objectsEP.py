import time

# Create Objects from pages
from pages.Cipher_Page import CipherPage
from pages.Role_Page import RolePage
from pages.template_page import TemplatePage
from pages.serviceaccount_page import ServiceAccountPage
from pages.search_page import SearchPage
from pages.destination_page import DestinationPage
from pages.user_page import UserPage
from pages.folder_page import FolderPage
from pages.dashboard_page import DashboardPage
from pages.enrichment_page import EnrichmentPage
from pages.function_page import FunctionPage
from pages.pipeline_page import PipelinePage
from pages.alert_page import AlertPage
from pages.alertV2_page import AlertV2Page
from pages.savedview_page import SavedViewPage
from pages.report_page import ReportPage

def create_objectsEP(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Create objects in the OpenObserve Enterprise running instance."""

    cipher_page = CipherPage(session, base_url, org_id)
    role_page = RolePage(session, base_url, org_id)
    template_page = TemplatePage(session, base_url, org_id)
    serviceaccount_page = ServiceAccountPage(session, base_url, org_id)
    search_page = SearchPage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)
    user_page = UserPage(session, base_url, org_id)
    folder_page = FolderPage(session, base_url, org_id)
    dashboard_page = DashboardPage(session, base_url, org_id)
    enrichment_page = EnrichmentPage(session, base_url, org_id)
    function_page = FunctionPage(session, base_url, org_id)
    pipeline_page = PipelinePage(session, base_url, org_id)
    alert_page = AlertPage(session, base_url, org_id)
    alert_v2_page = AlertV2Page(session, base_url, org_id)
    savedview_page = SavedViewPage(session, base_url, org_id)
    report_page = ReportPage(session, base_url, org_id)

    for i in range(num_objects):
        # Create cipher keys with root user
        cipher_name_simpleOO = f"sim_{cipher_page.Unique_value_cipher}_{i}EP"
        cipher_page.create_cipher_simpleOO(session, base_url, user_email, user_password, org_id, cipher_name_simpleOO)

        cipher_name_tinkOO = f"tink_{cipher_page.Unique_value_cipher}_{i}EP"
        cipher_page.create_cipher_tinkOO(session, base_url, user_email, user_password, org_id, cipher_name_tinkOO)

        # Create templates with root user
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}EP"
        template_page.create_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}EP"
        template_page.create_template_email(session, base_url, user_email, user_password, org_id, template_name_email)

        # Create search with root user
        search_page.search_partition_logs_query_2_hours_stream(session, base_url, user_email, user_password, org_id, stream_name)   
        search_page.search_cache_logs_query_2_hours_stream(session, base_url, user_email, user_password, org_id, stream_name)
        search_page.search_histogram_logs_query_2_hours_stream(session, base_url, user_email, user_password, org_id, stream_name)

        # Create service account and role
        serviceaccount_name = f"saep{serviceaccount_page.Unique_value_serviceaccount}{i}@gmail.com"
        token = serviceaccount_page.create_service_account(session, base_url, user_email, user_password, org_id, serviceaccount_name)

        role_name = f"au_{role_page.unique_value_role}{i}ep"
        role_page.create_role(session, base_url, user_email, user_password, org_id, role_name)

        # Add all necessary permissions to the role
        role_page.add_permissions(session, base_url, user_email, user_password, org_id, role_name)

        # Add service account to the role
        role_page.add_service_account_permission(session, base_url, user_email, user_password, org_id, serviceaccount_name, role_name)

        # Wait a moment for permissions to propagate
        time.sleep(2)

        # Create templates with service account
        template_serviceaccount_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}SA"
        template_page.create_template_webhook(session, base_url, serviceaccount_name, token, org_id, template_serviceaccount_webhook)

        template_serviceaccount_email = f"template_email_{template_page.Unique_value_temp}_{i}SA"
        template_page.create_template_email(session, base_url, serviceaccount_name, token, org_id, template_serviceaccount_email)

        # Create search with service account
        search_page.search_partition_logs_query_2_hours_stream(session, base_url, serviceaccount_name, token, org_id, stream_name)   
        search_page.search_cache_logs_query_2_hours_stream(session, base_url, serviceaccount_name, token, org_id, stream_name)
        search_page.search_histogram_logs_query_2_hours_stream(session, base_url, serviceaccount_name, token, org_id, stream_name)

        # Create cipher keys with service account
        cipher_serviceaccount_simpleOO = f"sim_{cipher_page.Unique_value_cipher}_{i}SA"
        cipher_page.create_cipher_simpleOO(session, base_url, serviceaccount_name, token, org_id, cipher_serviceaccount_simpleOO)

        cipher_serviceaccount_tinkOO = f"tink_{cipher_page.Unique_value_cipher}_{i}SA"
        cipher_page.create_cipher_tinkOO(session, base_url, serviceaccount_name, token, org_id, cipher_serviceaccount_tinkOO)


        # Create destinations
        
        destination_serviceaccount_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}sa"
        destination_page.create_destination_webhook(session, base_url, org_id, serviceaccount_name, token, template_serviceaccount_webhook, destination_serviceaccount_webhook)

        email_serviceaccount= f"aduser{user_page.Unique_value_user}{i}@gmail.com"
        user_page.create_user_admin(session, base_url, serviceaccount_name, token, org_id, email_serviceaccount)

        destination_serviceaccount_email = f"destination_email_{destination_page.Unique_value_destination}_{i}sa"
        destination_page.create_destination_email(session, base_url, org_id, serviceaccount_name, token, email_serviceaccount, template_serviceaccount_email, destination_serviceaccount_email)  

        destination_serviceaccount_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}sa"
        destination_page.create_destination_pipeline(session, base_url, org_id, serviceaccount_name, token, destination_serviceaccount_pipeline)

        folder_serviceaccount = f"folder_{folder_page.Unique_value_folder}_{i}sa"
        folder_id = folder_page.create_folder(session, base_url, serviceaccount_name, token, org_id, folder_serviceaccount)

        dashboard_serviceaccount = f"dashboard_{dashboard_page.Unique_value_dashboard}_{i}sa"
        dashboard_id = dashboard_page.create_dashboard(session, base_url, serviceaccount_name, token, org_id, stream_name, folder_id, dashboard_serviceaccount)

        enrichment_serviceaccount = f"enrichment_{enrichment_page.Unique_value_enrichment}_{i}sa"
        enrichment_page.create_enrichment(session, base_url, serviceaccount_name, token, org_id, enrichment_serviceaccount)

        function_serviceaccount = f"function_{function_page.Unique_value_function}_{i}sa"
        function_page.create_function(session, base_url, serviceaccount_name, token, org_id, function_serviceaccount)

    
        scheduled_report_serviceaccount = f"scheduled_report_{report_page.Unique_value_report}_{i}sa"
        report_page.create_scheduled_report(session, base_url, serviceaccount_name, token, org_id, dashboard_id, folder_id, scheduled_report_serviceaccount)

        cached_report_serviceaccount = f"cached_report_{report_page.Unique_value_report}_{i}sa"
        report_page.create_cached_report(session, base_url, serviceaccount_name, token, org_id, dashboard_id, folder_id, cached_report_serviceaccount)

        savedview_serviceaccount = f"savedview_{savedview_page.Unique_value_savedview}_{i}sa"
        savedview_page.create_savedView(session, base_url, serviceaccount_name, token, org_id, stream_name, savedview_serviceaccount)

        # email_address_serviceaccount = f"sa{user_page.Unique_value_user}{i}@gmail.com"
        # serviceaccount_page.create_service_account(session, base_url, serviceaccount_name, token, org_id, email_address_serviceaccount)

        # Create alerts
        alert_webhook_serviceaccount = f"alert_web_{alert_page.Unique_value_alert}_{i}sa"
        alert_page.create_standard_alert(session, base_url, serviceaccount_name, token, org_id, stream_name, template_serviceaccount_webhook, destination_serviceaccount_webhook, alert_webhook_serviceaccount) 

        alert_email_serviceaccount = f"alert_email_{alert_page.Unique_value_alert}_{i}sa"  
        alert_page.create_standard_alert(session, base_url, serviceaccount_name, token, org_id, stream_name, template_serviceaccount_email, destination_serviceaccount_email, alert_email_serviceaccount)

        alert_cron_serviceaccount = f"alert_cron_{alert_page.Unique_value_alert}_{i}sa"
        alert_page.create_standard_alert_cron(session, base_url, serviceaccount_name, token, org_id, stream_name, template_serviceaccount_email, destination_serviceaccount_email, alert_cron_serviceaccount)

        alert_real_time_serviceaccount = f"alert_real_time_{alert_page.Unique_value_alert}_{i}sa"
        alert_page.create_real_time_alert(session, base_url, serviceaccount_name, token, org_id, stream_name, template_serviceaccount_webhook, destination_serviceaccount_webhook, alert_real_time_serviceaccount)

        alert_sql_serviceaccount = f"alert_sql_{alert_page.Unique_value_alert}_{i}sa"
        alert_page.create_standard_alert_sql(session, base_url, serviceaccount_name, token, org_id, stream_name, template_serviceaccount_webhook, destination_serviceaccount_webhook, alert_sql_serviceaccount)

        # Create search
        search_page.search_partition_logs_query_2_hours_stream(session, base_url, serviceaccount_name, token, org_id, stream_name)   
        search_page.search_cache_logs_query_2_hours_stream(session, base_url, serviceaccount_name, token, org_id, stream_name)
        search_page.search_histogram_logs_query_2_hours_stream(session, base_url, serviceaccount_name, token, org_id, stream_name)


        # Test cases for Version 2 API
        # Create templates
        template_v2_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}sav2"
        template_page.create_template_webhook(session, base_url, serviceaccount_name, token, org_id, template_v2_webhook)
        # Create destinations
        destination_v2_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}sv2"
        destination_page.create_destination_webhook(session, base_url, org_id, serviceaccount_name, token, template_v2_webhook, destination_v2_webhook)
        # Create folder
        folder_v2_serviceaccount = f"folder_{folder_page.Unique_value_folder}_{i}sav2"
        folder_id = folder_page.create_folder_alert_v2(session, base_url, serviceaccount_name, token, org_id, folder_v2_serviceaccount)
        # Create alert
        alert_v2_serviceaccount = f"alert_{alert_v2_page.Unique_value_alert}_{i}sav2"
        alert_v2_page.create_scheduled_sql_alert(session, base_url, serviceaccount_name, token, org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_serviceaccount)
        alert_v2_serviceaccount_no_trigger = f"alert_{alert_v2_page.Unique_value_alert}_{i}sav2_no_trigger"
        alert_v2_page.create_scheduled_sql_alert_vrl_no_trigger(session, base_url, serviceaccount_name, token, org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_serviceaccount_no_trigger)
        alert_v2_serviceaccount_trigger = f"alert_{alert_v2_page.Unique_value_alert}_{i}sav2_trigger"
        alert_v2_page.create_scheduled_sql_alert_vrl_trigger(session, base_url, serviceaccount_name, token, org_id, stream_name, destination_v2_webhook, folder_id, alert_v2_serviceaccount_trigger)
        
