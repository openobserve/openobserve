
# from pages.cipher_page import CipherPage
# from pages.template_page import TemplatePage
# from pages.destination_page import DestinationPage
# from pages.alert_page import AlertPage
# from pages.savedview_page import SavedViewPage
# from pages.folder_page import FolderPage
# from pages.dashboard_page import DashboardPage
# from pages.function_page import FunctionPage
# from pages.enrichment_page import EnrichmentPage
# from pages.pipeline_page import PipelinePage
# from pages.report_page import ReportPage
# from pages.user_page import UserPage
# from pages.serviceaccount_page import ServiceAccountPage
# from pages.role_page import RolePage
# from pages.uds_mqr_page import UdsMqrPage   

# def verify_objects(session, base_url, user_email, user_password, org_id, num_objects):
#     """Verify objects in the OpenObserve running instance."""
    
#     template_page = TemplatePage(session, base_url, org_id)
#     cipher_page = CipherPage(session, base_url, org_id)
   
#     for i in range(num_objects):
        
#         # # Retrieve cipher keys
#         # cipher_name_simpleOO = f"sim_{cipher_page.Unique_value_cipher}_{i}"
#         # cipher_page.retrieve_cipherKeys_simpleOO(session, base_url, user_email, user_password, org_id)
#         # cipher_page.retrieve_cipher_simpleOO(session, base_url, user_email, user_password, org_id, cipher_name_simpleOO)

#         # cipher_name_tinkOO = f"tink_{cipher_page.Unique_value_cipher}_{i}"
#         # cipher_page.retrieve_cipherKeys_tinkOO(session, base_url, user_email, user_password, org_id)
#         # cipher_page.retrieve_cipher_tinkOO(session, base_url, user_email, user_password, org_id, cipher_name_tinkOO)   

#         # Retrieve templates
#         template_name_webhook = f"template_webhook_{template_page.Unique_value_temp}_{i}"
#         template_page.retrieve_templates_webhook(session, base_url, user_email, user_password, org_id)
#         template_page.retrieve_template_webhook(session, base_url, user_email, user_password, org_id, template_name_webhook)

#         template_name_email = f"template_email_{template_page.Unique_value_temp}_{i}"
#         template_page.retrieve_templates_email(session, base_url, user_email, user_password, org_id)
#         template_page.retrieve_template_email(session, base_url, user_email, user_password, org_id, template_name_email)




