from pages.template_page import TemplatePage
from pages.destination_page import DestinationPage
from pages.user_page import UserPage
from pages.alert_page import AlertPage
import random

def edit_objects(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Edit objects in the OpenObserve running instance."""
    template_page = TemplatePage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)
    user_page = UserPage(session, base_url, org_id)
    alert_page = AlertPage(session, base_url, org_id)
    for i in range(num_objects):

    

        # Update templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.update_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.update_template_email(session, base_url, user_email, user_password, org_id, template_name_email)

        # Update destinations
        destination_name_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}"
        destination_page.update_destination_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook, destination_name_webhook)

        destination_name_email = f"destination_email_{destination_page.Unique_value_destination}_{i}"
        email_address_admin = f"admin_{destination_page.Unique_value_destination}_{i}@{random.randint(100000, 999999)}.com"
        user_page.create_user_admin(session, base_url, user_email, user_password, org_id, email_address_admin)
        destination_page.update_destination_email(session, base_url, user_email, user_password, org_id, email_address_admin, template_name_email, destination_name_email)

        destination_name_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}"
        destination_page.update_destination_pipeline(session, base_url, user_email, user_password, org_id, destination_name_pipeline)

        # Update alerts
        alert_webhook = f"alert_webhook_{alert_page.Unique_value_alert}_{i}"
        alert_page.update_standard_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_webhook)

        alert_email = f"alert_email_{alert_page.Unique_value_alert}_{i}"
        alert_page.update_standard_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_email, destination_name_email, alert_email)

        alert_cron = f"alert_cron_{alert_page.Unique_value_alert}_{i}"
        alert_page.update_standard_alert_cron(session, base_url, user_email, user_password, org_id, stream_name, template_name_email, destination_name_email, alert_cron)

        alert_real_time = f"alert_real_time_{alert_page.Unique_value_alert}_{i}"
        alert_page.update_real_time_alert(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_real_time)

        alert_sql = f"alert_sql_{alert_page.Unique_value_alert}_{i}"
        alert_page.update_standard_alert_sql(session, base_url, user_email, user_password, org_id, stream_name, template_name_webhook, destination_name_webhook, alert_sql)
    