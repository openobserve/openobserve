from pages.template_page import TemplatePage

def edit_objects(session, base_url, user_email, user_password, org_id, num_objects):
    """Edit objects in the OpenObserve running instance."""
    template_page = TemplatePage(session, base_url, org_id)


    for i in range(num_objects):

    

        # Update templates
        template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
        template_page.update_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)

        template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
        template_page.update_template_email(session, base_url, user_email, user_password, org_id, template_name_email)
