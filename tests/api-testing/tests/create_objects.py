import sys
from pathlib import Path

# Add the current directory to sys.path
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

from pages.template_page import TemplatePage
from pages.folder_page import FolderPage
from pages.dashboard_page import DashboardPage
from pages.destination_page import DestinationPage
from pages.user_page import UserPage
# Use environment variable
def create_objects(session, base_url, user_email, user_password, org_id, stream_name, num_objects):
    """Create objects in the OpenObserve running instance."""


    template_page = TemplatePage(session, base_url, org_id)
    destination_page = DestinationPage(session, base_url, org_id)
    folder_page = FolderPage(session, base_url, org_id)
    dashboard_page = DashboardPage(session, base_url, org_id)
    user_page = UserPage(session, base_url, org_id)

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
        folder_id = folder_page.create_folder(session, base_url, user_email, user_password, org_id, folder_name)

        dashboard_name = f"dashboard_{dashboard_page.Unique_value_dashboard}_{i}"
        dashboard_id = dashboard_page.create_dashboard(session, base_url, user_email, user_password, org_id, stream_name, folder_id, dashboard_name)

        