from pages.template_page import TemplatePage

def verify_objects(session, base_url, user_email, user_password, org_id, num_objects):
    """Verify objects in the OpenObserve running instance."""

    template_page = TemplatePage(session, base_url, org_id)
            
    for i in range(num_objects):

        
        # Retrieve templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.retrieve_templates_webhook(session, base_url, user_email, user_password, org_id)
        template_page.retrieve_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.retrieve_templates_email(session, base_url, user_email, user_password, org_id)
        template_page.retrieve_template_email(session, base_url, user_email, user_password, org_id, template_name_email)
