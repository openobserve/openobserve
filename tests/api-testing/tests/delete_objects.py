from pages.template_page import TemplatePage
from pages.destination_page import DestinationPage
def delete_objects(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Delete objects in the OpenObserve running instance."""

    template_page = TemplatePage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)

    for i in range(num_objects):

       
        # Delete destinations   
        destination_name_webhook = f"destination_webhook_{destination_page.Unique_value_destination}_{i}"
        destination_page.delete_destination(session, base_url, user_email, user_password, org_id, destination_name_webhook)

        destination_name_email = f"destination_email_{destination_page.Unique_value_destination}_{i}"
        destination_page.delete_destination(session, base_url, user_email, user_password, org_id, destination_name_email)

        destination_name_pipeline = f"destination_pipeline_{destination_page.Unique_value_destination}_{i}"
        destination_page.delete_destination(session, base_url, user_email, user_password, org_id, destination_name_pipeline)    

        # Delete templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.delete_template(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.delete_template(session, base_url, user_email, user_password, org_id, template_name_email)

