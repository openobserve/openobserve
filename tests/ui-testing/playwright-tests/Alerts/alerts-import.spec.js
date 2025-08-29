const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

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
      testLogger.info('Generated shared random value for this run', { sharedRandomValue });
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
    testLogger.info('Created template', { templateName });

    // Create destination
    const destinationName = 'auto_playwright_destination_' + sharedRandomValue;
    const slackUrl = "DEMO";
    await pm.alertDestinationsPage.ensureDestinationExists(destinationName, slackUrl, templateName);
    testLogger.info('Created destination', { destinationName });

    // Navigate to alerts page
    await pm.commonActions.navigateToAlerts();

    // Create folder
    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    testLogger.info('Created folder', { folderName });

    // Create alert
    const streamName = 'auto_playwright_stream';
    const column = 'job';
    const value = 'test';
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(2000);
    const alertName = await pm.alertsPage.createAlert(streamName, column, value, destinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created alert', { alertName });
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
    testLogger.info('WEBHOOK URL template IMPORTED', { templateName: urlWebhookTemplateName });
    
    // Verify imported webhook template exists
    await pm.alertTemplatesPage.verifyImportedTemplateExists(urlWebhookTemplateName);
    testLogger.info('Successfully verified imported webhook template exists', { templateName: urlWebhookTemplateName });
    
    // Delete URL imported webhook template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(urlWebhookTemplateName);
    testLogger.info('WEBHOOK URL template DELETED', { templateName: urlWebhookTemplateName });

    // Test 2: Valid template import from URL (Email template)
    const urlEmailTemplateName = 'auto_url_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.importTemplateFromUrl(emailTemplateUrl, urlEmailTemplateName, 'valid');
    testLogger.info('EMAIL URL template IMPORTED', { templateName: urlEmailTemplateName });
    
    // Verify imported email template exists
    await pm.alertTemplatesPage.verifyImportedTemplateExists(urlEmailTemplateName);
    testLogger.info('Successfully verified imported email template exists', { templateName: urlEmailTemplateName });
    
    // Delete URL imported email template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(urlEmailTemplateName);
    testLogger.info('EMAIL URL template DELETED', { templateName: urlEmailTemplateName });

    // Test 3: Valid direct webhook template creation
    const directWebhookTemplateName = 'auto_direct_webhook_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplateFromFile('utils/webhookTemplateImport.json', directWebhookTemplateName, 'valid');
    testLogger.info('WEBHOOK Direct template IMPORTED', { templateName: directWebhookTemplateName });
    
    // Verify direct webhook template exists
    await pm.alertTemplatesPage.verifyImportedTemplateExists(directWebhookTemplateName);
    testLogger.info('Successfully verified direct webhook template exists', { templateName: directWebhookTemplateName });
    
    // Delete direct webhook template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(directWebhookTemplateName);
    testLogger.info('WEBHOOK Direct template DELETED', { templateName: directWebhookTemplateName });

    // Test 4: Valid direct email template creation
    const directEmailTemplateName = 'auto_direct_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplateFromFile('utils/emailTemplateImport.json', directEmailTemplateName, 'valid');
    testLogger.info('EMAIL Direct template IMPORTED', { templateName: directEmailTemplateName });
    
    // Verify direct email template exists
    await pm.alertTemplatesPage.verifyImportedTemplateExists(directEmailTemplateName);
    testLogger.info('Successfully verified direct email template exists', { templateName: directEmailTemplateName });
    
    // Delete direct email template
    await pm.alertTemplatesPage.deleteTemplateAndVerify(directEmailTemplateName);
    testLogger.info('EMAIL Direct template DELETED', { templateName: directEmailTemplateName });
    
    testLogger.info('All template import tests completed successfully with cleanup');
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
    testLogger.info('Created webhook template', { templateName: webhookTemplateName });

    // Import email template for email destination
    const emailTemplateUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Email_Template_Import.json';
    const emailTemplateName = 'auto_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.importTemplateFromUrl(emailTemplateUrl, emailTemplateName, 'valid');
    testLogger.info('Imported email template', { templateName: emailTemplateName });
    await pm.alertTemplatesPage.verifyImportedTemplateExists(emailTemplateName);
    testLogger.info('Successfully verified imported email template exists', { templateName: emailTemplateName });

    // Navigate to destinations page
    await pm.alertDestinationsPage.navigateToDestinations();
    testLogger.info('Navigated to destinations page');

    // Test 1: Import webhook destination from URL
    const webhookDestinationUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Webhook_Destination_Import.json';
    const webhookDestinationName = 'auto_dest_name_' + sharedRandomValue;
    await pm.alertDestinationsPage.importDestinationFromUrl(webhookDestinationUrl, webhookTemplateName, webhookDestinationName);
    await expect(page.getByText('Successfully imported')).toBeVisible();
    testLogger.info('Imported webhook destination from URL', { destinationName: webhookDestinationName });
    await pm.alertDestinationsPage.verifyDestinationExists(webhookDestinationName);
    testLogger.info('Successfully verified webhook destination exists');
    await pm.alertDestinationsPage.deleteDestinationWithSearch(webhookDestinationName);
    testLogger.info('Successfully deleted webhook destination');

    // Test 2: Import webhook destination from file
    await pm.alertDestinationsPage.importDestinationFromFile('utils/webhookDestinationImport.json', webhookTemplateName, webhookDestinationName);
    testLogger.info('Imported webhook destination from file', { destinationName: webhookDestinationName });
    await expect(page.getByText('Successfully imported')).toBeVisible();
    await pm.alertDestinationsPage.verifyDestinationExists(webhookDestinationName);
    testLogger.info('Successfully verified webhook destination exists');
    await pm.alertDestinationsPage.deleteDestinationWithSearch(webhookDestinationName);
    testLogger.info('Successfully deleted webhook destination');

    // Test 3: Import email destination from URL
    const emailDestinationUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Email_Destination_Import.json';
    const emailDestinationName = 'auto_email_dest_' + sharedRandomValue;
    await pm.alertDestinationsPage.importDestinationFromUrl(emailDestinationUrl, emailTemplateName, emailDestinationName);
    testLogger.info('Imported email destination from URL', { destinationName: emailDestinationName });
    await expect(page.getByText('Destination - 1: "')).toBeVisible();
    await pm.alertDestinationsPage.cancelDestinationImport();
    testLogger.info('Successfully cancelled email destination import');

    // Test 4: Import email destination from file
    await pm.alertDestinationsPage.importDestinationFromFile('utils/emailDestinationImport.json', emailTemplateName, emailDestinationName);
    testLogger.info('Imported email destination from file', { destinationName: emailDestinationName });
    await expect(page.getByText('Destination - 1: "')).toBeVisible();
    await pm.alertDestinationsPage.cancelDestinationImport();
    testLogger.info('Successfully cancelled email destination import');

    // Navigate to templates page for cleanup
    await pm.alertTemplatesPage.navigateToTemplates();
    testLogger.info('Navigated to templates page for cleanup');

    // Clean up templates
    await pm.alertTemplatesPage.deleteTemplateAndVerify(webhookTemplateName);
    testLogger.info('Webhook template deleted', { templateName: webhookTemplateName });
    await pm.alertTemplatesPage.deleteTemplateAndVerify(emailTemplateName);
    testLogger.info('Email template deleted', { templateName: emailTemplateName });

    testLogger.info('All destination import tests completed successfully with cleanup');
  });
}); 