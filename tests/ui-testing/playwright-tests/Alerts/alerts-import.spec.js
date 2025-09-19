const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');

test.describe("Alerts Import/Export", () => {
  // Shared test variables
  let pm;
  let sharedRandomValue;

  /**
   * Setup for each test
   * - Logs in
   * - Initializes page objects
   * - Generates shared random value
   * - Ingests test data
   * - Navigates to alerts page
   */
  test.beforeEach(async ({ page }, testInfo) => {
    pm = new PageManager(page);

    // Generate shared random value if not already generated
    if (!sharedRandomValue) {
      sharedRandomValue = pm.alertsPage.generateRandomString();
      console.log('Generated shared random value for this run:', sharedRandomValue);
    }

    // Ingest test data using common actions
    const streamName = 'auto_playwright_stream';
    await pm.commonActions.ingestTestData(streamName);
    
    // Navigate to alerts page
    await page.goto(
      `${process.env["ZO_BASE_URL"]}${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
  });

  /**
   * Test: Import/Export Alert Functionality
   * Tests importing and exporting alerts
   */
  test('Import/Export Alert Functionality', {
    tag: ['@all', '@alerts', '@alertsImportExport']
  }, async ({ page }) => {
    // Create template
    const templateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplate(templateName);
    console.log('Created template:', templateName);

    // Create destination
    const destinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    console.log('Created destination:', destinationName);

    // Navigate to alerts page
    await pm.commonActions.navigateToAlerts();

    // Create folder
    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    console.log('Created folder:', folderName);

    // Create alert
    const streamName = 'auto_playwright_stream';
    const column = 'job';
    const value = 'test';
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, destinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    console.log('Successfully created alert:', alertName);
    await page.waitForTimeout(2000);

    // Export alerts
    const download = await pm.alertsPage.exportAlerts();
    const downloadPath = `./alerts-${new Date().toISOString().split('T')[0]}-${streamName}.json`;
    await download.saveAs(downloadPath);

    // Test invalid import
    await pm.alertsPage.importInvalidFile('utils/td150.json');

    // Import valid file
    await pm.alertsPage.importValidFile(downloadPath);

    // Clean up imported alert
    await pm.alertsPage.deleteImportedAlert(alertName);

    await pm.dashboardFolder.searchFolder(folderName);
    await expect(page.locator(`text=${folderName}`)).toBeVisible();
    await pm.dashboardFolder.deleteFolder(folderName);

    await pm.alertsPage.cleanupDownloadedFile(downloadPath);
  });

  /**
   * Test: Template Import from URL and Direct Creation
   * Tests importing templates from URL and creating templates directly from files
   */
  test('Template Import from URL and Direct Template Creation', {
    tag: ['@templateImport', '@all', '@alerts']
  }, async ({ page }) => {
    // Test URLs
    const webhookTemplateUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Webhook_Template_Import.json';
    const emailTemplateUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Email_Template_Import.json';

    // Test 1: Valid template import from URL (Webhook template)
    const urlWebhookTemplateName = 'auto_url_webhook_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.importTemplateFromUrl(webhookTemplateUrl, urlWebhookTemplateName, 'valid');
    console.log('WEBHOOK URL template IMPORTED:', urlWebhookTemplateName);
    
    // Verify imported webhook template exists
    await pm.alertTemplatesPage.verifyImportedTemplateExists(urlWebhookTemplateName);
    console.log('Successfully verified imported webhook template exists:', urlWebhookTemplateName);
    
    // Delete URL imported webhook template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(urlWebhookTemplateName);
    console.log('WEBHOOK URL template DELETED:', urlWebhookTemplateName);

    // Test 2: Valid template import from URL (Email template)
    const urlEmailTemplateName = 'auto_url_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.importTemplateFromUrl(emailTemplateUrl, urlEmailTemplateName, 'valid');
    console.log('EMAIL URL template IMPORTED:', urlEmailTemplateName);
    
    // Verify imported email template exists
    await pm.alertTemplatesPage.verifyImportedTemplateExists(urlEmailTemplateName);
    console.log('Successfully verified imported email template exists:', urlEmailTemplateName);
    
    // Delete URL imported email template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(urlEmailTemplateName);
    console.log('EMAIL URL template DELETED:', urlEmailTemplateName);

    // Test 3: Valid direct webhook template creation
    const directWebhookTemplateName = 'auto_direct_webhook_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplateFromFile('utils/webhookTemplateImport.json', directWebhookTemplateName, 'valid');
    console.log('WEBHOOK Direct template IMPORTED:', directWebhookTemplateName);
    
    // Verify direct webhook template exists
    await pm.alertTemplatesPage.verifyImportedTemplateExists(directWebhookTemplateName);
    console.log('Successfully verified direct webhook template exists:', directWebhookTemplateName);
    
    // Delete direct webhook template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(directWebhookTemplateName);
    console.log('WEBHOOK Direct template DELETED:', directWebhookTemplateName);

    // Test 4: Valid direct email template creation
    const directEmailTemplateName = 'auto_direct_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplateFromFile('utils/emailTemplateImport.json', directEmailTemplateName, 'valid');
    console.log('EMAIL Direct template IMPORTED:', directEmailTemplateName);
    
    // Verify direct email template exists
    await pm.alertTemplatesPage.verifyImportedTemplateExists(directEmailTemplateName);
    console.log('Successfully verified direct email template exists:', directEmailTemplateName);
    
    // Delete direct email template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(directEmailTemplateName);
    console.log('EMAIL Direct template DELETED:', directEmailTemplateName);
    
    console.log('All template import tests completed successfully with cleanup');
  });

  /**
   * Test: Destination Import from URL and File
   * Tests importing destinations from both URL and local files
   */
  test('Destination Import from URL and File', {
    tag: ['@destinationImport', '@all', '@alerts']
  }, async ({ page }) => {
    // Create webhook template for webhook destination
    const webhookTemplateName = 'auto_webhook_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplate(webhookTemplateName);
    console.log('Created webhook template:', webhookTemplateName);

    // Import email template for email destination
    const emailTemplateUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Email_Template_Import.json';
    const emailTemplateName = 'auto_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.importTemplateFromUrl(emailTemplateUrl, emailTemplateName, 'valid');
    console.log('Imported email template:', emailTemplateName);
    await pm.alertTemplatesPage.verifyImportedTemplateExists(emailTemplateName);
    console.log('Successfully verified imported email template exists:', emailTemplateName);

    // Navigate to destinations page
    await pm.alertDestinationsPage.navigateToDestinations();
    console.log('Navigated to destinations page');

    // Test 1: Import webhook destination from URL
    const webhookDestinationUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Webhook_Destination_Import.json';
    const webhookDestinationName = 'auto_dest_name_' + sharedRandomValue;
    await pm.alertDestinationsPage.importDestinationFromUrl(webhookDestinationUrl, webhookTemplateName, webhookDestinationName);
    await expect(page.getByText('Successfully imported')).toBeVisible();
    console.log('Imported webhook destination from URL:', webhookDestinationName);
    await pm.alertDestinationsPage.verifyDestinationExists(webhookDestinationName);
    console.log('Successfully verified webhook destination exists');
    await pm.alertDestinationsPage.deleteDestinationWithSearch(webhookDestinationName);
    console.log('Successfully deleted webhook destination');

    // Test 2: Import webhook destination from file
    await pm.alertDestinationsPage.importDestinationFromFile('utils/webhookDestinationImport.json', webhookTemplateName, webhookDestinationName);
    console.log('Imported webhook destination from file:', webhookDestinationName);
    await expect(page.getByText('Successfully imported')).toBeVisible();
    await pm.alertDestinationsPage.verifyDestinationExists(webhookDestinationName);
    console.log('Successfully verified webhook destination exists');
    await pm.alertDestinationsPage.deleteDestinationWithSearch(webhookDestinationName);
    console.log('Successfully deleted webhook destination');

    // Test 3: Import email destination from URL
    const emailDestinationUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Email_Destination_Import.json';
    const emailDestinationName = 'auto_email_dest_' + sharedRandomValue;
    await pm.alertDestinationsPage.importDestinationFromUrl(emailDestinationUrl, emailTemplateName, emailDestinationName);
    console.log('Imported email destination from URL:', emailDestinationName);
    await expect(page.getByText('Destination - 1: "')).toBeVisible();
    await pm.alertDestinationsPage.cancelDestinationImport();
    console.log('Successfully cancelled email destination import');

    // Test 4: Import email destination from file
    await pm.alertDestinationsPage.importDestinationFromFile('utils/emailDestinationImport.json', emailTemplateName, emailDestinationName);
    console.log('Imported email destination from file:', emailDestinationName);
    await expect(page.getByText('Destination - 1: "')).toBeVisible();
    await pm.alertDestinationsPage.cancelDestinationImport();
    console.log('Successfully cancelled email destination import');

    // Navigate to templates page for cleanup
    await pm.alertTemplatesPage.navigateToTemplates();
    console.log('Navigated to templates page for cleanup');

    // Clean up templates
    await pm.alertTemplatesPage.deleteTemplateAndVerify(webhookTemplateName);
    console.log('Webhook template deleted:', webhookTemplateName);
    await pm.alertTemplatesPage.deleteTemplateAndVerify(emailTemplateName);
    console.log('Email template deleted:', emailTemplateName);

    console.log('All destination import tests completed successfully with cleanup');
  });
}); 