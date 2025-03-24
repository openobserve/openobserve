from pages.template_page import TemplatePage

def delete_objects(session, base_url, user_email, user_password, org_id, num_objects):
    """Delete objects in the OpenObserve running instance."""

    template_page = TemplatePage(session, base_url, org_id)
 

    for i in range(num_objects):

       
        # Delete templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.delete_template(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.delete_template(session, base_url, user_email, user_password, org_id, template_name_email)
