from pages.template_page import TemplatePage
from pages.destination_page import DestinationPage
from pages.alert_page import AlertPage

def delete_objects(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Delete objects in the OpenObserve running instance."""

    template_page = TemplatePage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)
    alert_page = AlertPage(session, base_url, org_id)
    
    for i in range(num_objects):
        # Delete alerts first since they depend on destinations
        standard_alert = f"standard_{AlertPage.Unique_value_alert}_{i}"
        alert_page.delete_alert(session, base_url, user_email, user_password, org_id, stream_name, standard_alert)

        standard_sql_alert = f"standard_sql_{AlertPage.Unique_value_alert}_{i}"
        alert_page.delete_alert(session, base_url, user_email, user_password, org_id, stream_name, standard_sql_alert)

        standard_cron_alert = f"standard_cron_{AlertPage.Unique_value_alert}_{i}"
        alert_page.delete_alert(session, base_url, user_email, user_password, org_id, stream_name, standard_cron_alert)

        real_time_alert = f"real_time_{AlertPage.Unique_value_alert}_{i}"
        alert_page.delete_alert(session, base_url, user_email, user_password, org_id, stream_name, real_time_alert)

        # Then delete destinations
        destination_name_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}"
        destination_page.delete_destination(session, base_url, user_email, user_password, org_id, destination_name_webhook)

        destination_name_email = f"destination_email_{destination_page.Unique_value_destination}_{i}"
        destination_page.delete_destination(session, base_url, user_email, user_password, org_id, destination_name_email)

        destination_name_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}"
        destination_page.delete_destination(session, base_url, user_email, user_password, org_id, destination_name_pipeline)    

        # Finally delete templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.delete_template(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.delete_template(session, base_url, user_email, user_password, org_id, template_name_email)

