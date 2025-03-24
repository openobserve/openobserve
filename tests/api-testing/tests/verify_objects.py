from pages.template_page import TemplatePage
from pages.destination_page import DestinationPage

def verify_objects(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Verify objects in the OpenObserve running instance."""

    template_page = TemplatePage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)
    for i in range(num_objects):

        
        # Retrieve templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.retrieve_templates_webhook(session, base_url, user_email, user_password, org_id)
        template_page.retrieve_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.retrieve_templates_email(session, base_url, user_email, user_password, org_id)
        template_page.retrieve_template_email(session, base_url, user_email, user_password, org_id, template_name_email)

        # Retrieve destinations
        destination_name_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}"
        destination_page.retrieve_destinations_webhook(session, base_url, user_email, user_password, org_id)
        destination_page.retrieve_destination_webhook(session, base_url, user_email, user_password, org_id, destination_name_webhook)

        destination_name_email = f"destination_email_{destination_page.Unique_value_destination}_{i}"
        destination_page.retrieve_destinations_email(session, base_url, user_email, user_password, org_id)
        destination_page.retrieve_destination_email(session, base_url, user_email, user_password, org_id, destination_name_email)

        destination_name_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}"
        destination_page.retrieve_destinations_pipeline(session, base_url, user_email, user_password, org_id)
        destination_page.retrieve_destination_pipeline(session, base_url, user_email, user_password, org_id, destination_name_pipeline)
