const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// Test timeout constants (in milliseconds)
const FIVE_MINUTES_MS = 300000;
const ALERT_REGISTRATION_WAIT_MS = 30000; // Wait for alert to fully register and become active
const UI_STABILIZATION_WAIT_MS = 2000;
const ALERT_TRIGGER_TIMEOUT_MS = 90000; // Real-time alerts need time to process and fire

test.describe("Alerts Import/Export", () => {
  let pm;
  let sharedRandomValue;
  let validationInfra;
  let testStreamName; // Unique stream with custom columns for this test run

  test.beforeEach(async ({ page }, testInfo) => {
    pm = new PageManager(page);

    if (!sharedRandomValue) {
      // Lowercase to match API behavior (stream names are lowercased)
      sharedRandomValue = pm.alertsPage.generateRandomString().toLowerCase();
      testLogger.info('Generated shared random value for this run', { sharedRandomValue });
    }

    // Create unique test stream name for this test run (lowercase to match API behavior)
    testStreamName = `alert_import_${sharedRandomValue}`.toLowerCase();

    // Initialize the test stream with custom columns (city, country, status, age, etc.)
    // This ensures we have predictable columns for alert condition testing
    await pm.commonActions.initializeAlertTestStream(testStreamName);
    testLogger.info('Initialized test stream with custom columns', {
      testStreamName,
      columns: ['city', 'country', 'status', 'age', 'test_run_id', 'test_timestamp', 'message']
    });

    // Navigate to alerts page - stream will be available after page load
    await page.goto(
      `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`
    );

    // Refresh page to ensure newly created stream appears in dropdowns
    await page.reload();
    await page.waitForLoadState('networkidle');
  });

  test('Import/Export Alert Functionality', {
    tag: ['@all', '@alerts', '@alertsImportExport'],
    timeout: FIVE_MINUTES_MS
  }, async ({ page }) => {
    // This test covers import/export and includes trigger validation
    test.slow();

    validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, sharedRandomValue);
    testLogger.info('Validation infrastructure ready', validationInfra);

    const templateName = 'auto_playwright_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplate(templateName);
    testLogger.info('Created template', { templateName });

    await pm.commonActions.navigateToAlerts();

    const folderName = 'auto_' + sharedRandomValue;
    await pm.alertsPage.createFolder(folderName, 'Test Automation Folder');
    testLogger.info('Created folder', { folderName });

    // Use the dedicated test stream initialized in beforeEach with custom columns
    // This provides predictable columns (city, country, status, age) for alert conditions
    const triggerStreamName = testStreamName;
    const column = 'city';        // Custom column from our test stream
    const value = 'bangalore';    // Value that triggers the alert condition

    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
    const alertName = await pm.alertsPage.createAlert(triggerStreamName, column, value, validationInfra.destinationName, sharedRandomValue);
    await pm.alertsPage.verifyAlertCreated(alertName);
    testLogger.info('Successfully created alert', { alertName });

    // Wait for alert to register in the system before triggering
    await page.waitForTimeout(ALERT_REGISTRATION_WAIT_MS);

    // Trigger and validate alert fires (self-referential destination approach)
    const triggerResult = await pm.alertsPage.verifyAlertTrigger(
      pm,
      alertName,
      triggerStreamName,
      column,
      value,
      ALERT_TRIGGER_TIMEOUT_MS,
      validationInfra.streamName
    );
    expect(triggerResult.found, `Alert ${alertName} should fire and appear in validation stream`).toBe(true);
    testLogger.info('Alert trigger validation PASSED', { alertName, triggerResult });

    await pm.commonActions.navigateToAlerts();
    await pm.alertsPage.navigateToFolder(folderName);
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    const download = await pm.alertsPage.exportAlerts();
    const downloadPath = `./alerts-${new Date().toISOString().split('T')[0]}-${triggerStreamName}.json`;
    await download.saveAs(downloadPath);

    await pm.alertsPage.importInvalidFile('../test-data/invalid-alert.json');
    await pm.alertsPage.importValidFile(downloadPath);
    await pm.alertsPage.deleteImportedAlert(alertName);

    await pm.dashboardFolder.searchFolder(folderName);
    await pm.dashboardFolder.verifyFolderVisible(folderName);
    await pm.dashboardFolder.deleteFolder(folderName);

    await pm.alertsPage.cleanupDownloadedFile(downloadPath);
  });

  /**
   * Tests importing templates from URL and creating templates directly from files
   * Covers: webhook/email templates from URL and FILE
   */
  test('Template Import from URL and Direct Template Creation', {
    tag: ['@templateImport', '@all', '@alerts']
  }, async ({ page }) => {
    const webhookTemplateUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Webhook_Template_Import.json';
    const emailTemplateUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Email_Template_Import.json';

    // Test 1: Webhook template from URL
    const urlWebhookTemplateName = 'auto_url_webhook_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.importTemplateFromUrl(webhookTemplateUrl, urlWebhookTemplateName, 'valid');
    await pm.alertTemplatesPage.verifyImportedTemplateExists(urlWebhookTemplateName);
    await pm.alertTemplatesPage.deleteTemplateAndVerify(urlWebhookTemplateName);
    testLogger.info('Webhook URL template cycle complete', { templateName: urlWebhookTemplateName });

    // Test 2: Email template from URL
    const urlEmailTemplateName = 'auto_url_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.importTemplateFromUrl(emailTemplateUrl, urlEmailTemplateName, 'valid');
    await pm.alertTemplatesPage.verifyImportedTemplateExists(urlEmailTemplateName);
    await pm.alertTemplatesPage.deleteTemplateAndVerify(urlEmailTemplateName);
    testLogger.info('Email URL template cycle complete', { templateName: urlEmailTemplateName });

    // Test 3: Webhook template from FILE
    const directWebhookTemplateName = 'auto_direct_webhook_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplateFromFile('utils/webhookTemplateImport.json', directWebhookTemplateName, 'valid');
    await pm.alertTemplatesPage.verifyImportedTemplateExists(directWebhookTemplateName);
    await pm.alertTemplatesPage.deleteTemplateAndVerify(directWebhookTemplateName);
    testLogger.info('Webhook FILE template cycle complete', { templateName: directWebhookTemplateName });

    // Test 4: Email template from FILE
    const directEmailTemplateName = 'auto_direct_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplateFromFile('utils/emailTemplateImport.json', directEmailTemplateName, 'valid');
    await pm.alertTemplatesPage.verifyImportedTemplateExists(directEmailTemplateName);
    await pm.alertTemplatesPage.deleteTemplateAndVerify(directEmailTemplateName);
    testLogger.info('Email FILE template cycle complete', { templateName: directEmailTemplateName });

    testLogger.info('All template import tests completed successfully');
  });

  /**
   * Tests importing destinations from both URL and local files
   * Covers: webhook/email destinations from URL and FILE
   */
  test('Destination Import from URL and File', {
    tag: ['@destinationImport', '@all', '@alerts']
  }, async ({ page }) => {
    // Create templates needed for destinations
    const webhookTemplateName = 'auto_webhook_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.createTemplate(webhookTemplateName);
    testLogger.info('Created webhook template', { templateName: webhookTemplateName });

    const emailTemplateUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Email_Template_Import.json';
    const emailTemplateName = 'auto_email_template_' + sharedRandomValue;
    await pm.alertTemplatesPage.importTemplateFromUrl(emailTemplateUrl, emailTemplateName, 'valid');
    await pm.alertTemplatesPage.verifyImportedTemplateExists(emailTemplateName);
    testLogger.info('Imported email template', { templateName: emailTemplateName });

    await pm.alertDestinationsPage.navigateToDestinations();

    // Test 1: Webhook destination from URL
    const webhookDestinationUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Webhook_Destination_Import.json';
    const webhookDestinationName = 'auto_dest_name_' + sharedRandomValue;
    await pm.alertDestinationsPage.importDestinationFromUrl(webhookDestinationUrl, webhookTemplateName, webhookDestinationName);
    await pm.alertDestinationsPage.verifyDestinationExists(webhookDestinationName);
    await pm.alertDestinationsPage.deleteDestinationWithSearch(webhookDestinationName);
    testLogger.info('Webhook URL destination cycle complete');

    // Test 2: Webhook destination from file
    await pm.alertDestinationsPage.importDestinationFromFile('utils/webhookDestinationImport.json', webhookTemplateName, webhookDestinationName);
    await pm.alertDestinationsPage.verifySuccessfulImportMessage();
    await pm.alertDestinationsPage.verifyDestinationExists(webhookDestinationName);
    await pm.alertDestinationsPage.deleteDestinationWithSearch(webhookDestinationName);
    testLogger.info('Webhook FILE destination cycle complete');

    // Test 3: Email destination from URL (cancel after verifying count message)
    const emailDestinationUrl = 'https://raw.githubusercontent.com/openobserve/alert_tests/refs/heads/main/Email_Destination_Import.json';
    const emailDestinationName = 'auto_email_dest_' + sharedRandomValue;
    await pm.alertDestinationsPage.importDestinationFromUrl(emailDestinationUrl, emailTemplateName, emailDestinationName);
    await pm.alertDestinationsPage.verifyDestinationCountMessage();
    await pm.alertDestinationsPage.cancelDestinationImport();
    testLogger.info('Email URL destination import cancelled');

    // Test 4: Email destination from file (cancel after verifying count message)
    await pm.alertDestinationsPage.importDestinationFromFile('utils/emailDestinationImport.json', emailTemplateName, emailDestinationName);
    await pm.alertDestinationsPage.verifyDestinationCountMessage();
    await pm.alertDestinationsPage.cancelDestinationImport();
    testLogger.info('Email FILE destination import cancelled');

    // Cleanup templates
    await pm.alertTemplatesPage.navigateToTemplates();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    await pm.alertTemplatesPage.deleteTemplateAndVerify(webhookTemplateName);
    await pm.alertTemplatesPage.deleteTemplateAndVerify(emailTemplateName);
    testLogger.info('All destination import tests completed successfully');
  });
});
