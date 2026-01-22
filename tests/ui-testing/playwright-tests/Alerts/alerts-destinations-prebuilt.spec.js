const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// Test timeout constants (in milliseconds)
const DEFAULT_TIMEOUT_MS = 60000;
const NETWORK_IDLE_TIMEOUT_MS = 30000;
const UI_STABILIZATION_WAIT_MS = 2000;
const EXTENDED_TIMEOUT_MS = 180000; // 3 minutes for consolidated tests

/**
 * Prebuilt Alert Destinations E2E Tests
 *
 * Tests the complete functionality of prebuilt alert destinations including:
 * - Navigation and button states
 * - Destination type selection with stepper UI
 * - Form validation and credential input
 * - Testing destination connectivity
 * - Creating, editing, and deleting destinations
 * - Support for all prebuilt types: Slack, Discord, Teams, PagerDuty, Opsgenie, ServiceNow
 *
 * Naming Convention: Uses 'auto_dest_' prefix for cleanup compatibility
 * Cleanup: Handled by cleanup.spec.js via 'auto_' prefix patterns
 */
test.describe("Prebuilt Alert Destinations E2E", () => {
  let pm;
  let sharedRandomValue;

  /**
   * Setup for each test
   * - Generates shared random suffix for unique destination names
   * - Navigates to Alert Destinations page
   */
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);

    // Generate shared random value if not already generated (lowercase for API compatibility)
    if (!sharedRandomValue) {
      sharedRandomValue = Date.now().toString().slice(-6);
      testLogger.info('Generated shared random suffix for this run', { sharedRandomValue });
    }

    // Navigate directly to alert destinations page
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/settings/alert_destinations?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

    testLogger.info('Navigated to Alert Destinations page');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ============================================================================
  // P0 - Critical Smoke Tests: UI Elements & Navigation
  // ============================================================================

  test("P0: Smoke - Verify destination selector UI and stepper navigation", {
    tag: ['@prebuiltDestinations', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('===== P0 SMOKE TEST: UI Elements & Navigation =====');

    // ----- PART 1: Verify New Destination button states -----
    testLogger.info('Part 1: Testing New Destination button state');
    await pm.alertDestinationsPage.expectNewDestinationButtonVisible();
    await pm.alertDestinationsPage.expectNewDestinationButtonEnabled();
    testLogger.info('✓ New Destination button is visible and enabled');

    // ----- PART 2: Verify Step 1 - Choose Type with all cards -----
    testLogger.info('Part 2: Testing stepper Step 1 - Choose Type');
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.expectStep1Visible();
    await pm.alertDestinationsPage.expectDestinationSelectorVisible();
    await pm.alertDestinationsPage.expectDestinationCardsVisible(8); // 7 prebuilt + 1 custom
    testLogger.info('✓ Step 1 displays correctly with 8 destination type cards');

    // ----- PART 3: Verify type selection shows indicator -----
    testLogger.info('Part 3: Testing selected destination indicator');
    await pm.alertDestinationsPage.selectDestinationType('slack');
    await pm.alertDestinationsPage.expectConnectionStepVisible();
    await pm.alertDestinationsPage.expectSelectedIndicatorVisible('Slack');
    await pm.alertDestinationsPage.expectCheckmarkVisible();
    testLogger.info('✓ Selected destination indicator displays correctly with checkmark');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();

    testLogger.info('===== P0 SMOKE TEST COMPLETED =====');
  });

  // ============================================================================
  // P1 - Slack Complete Flow: Create, Validate, Test, Edit
  // ============================================================================

  test("P1: Slack - Complete CRUD flow with validation and connectivity test", {
    tag: ['@prebuiltDestinations', '@slack', '@P1', '@all'],
    timeout: EXTENDED_TIMEOUT_MS
  }, async ({ page }) => {
    testLogger.info('===== P1 SLACK TEST: Complete CRUD Flow =====');

    const destinationName = `auto_dest_slack_${sharedRandomValue}`;
    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';
    const updatedWebhookUrl = 'https://hooks.slack.com/services/T11111111/B11111111/YYYYYYYYYYYYYYYYYYYY';

    // ----- PART 1: Webhook URL Validation -----
    testLogger.info('Part 1: Testing Slack webhook URL validation');
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('slack');
    await pm.alertDestinationsPage.fillWebhookUrl('https://invalid-url.com');
    await pm.alertDestinationsPage.expectValidationError();
    testLogger.info('✓ Invalid webhook URL shows validation error');
    await pm.alertDestinationsPage.clickCancel();

    // ----- PART 2: Test Button Functionality -----
    testLogger.info('Part 2: Testing Slack destination Test button');
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('slack');
    await pm.alertDestinationsPage.fillWebhookUrl(webhookUrl);
    await pm.alertDestinationsPage.expectTestButtonEnabled();
    await pm.alertDestinationsPage.clickTest();
    await pm.alertDestinationsPage.expectTestResultVisible();
    testLogger.info('✓ Test button functionality working');
    await pm.alertDestinationsPage.clickCancel();

    // ----- PART 3: Create Slack Destination -----
    testLogger.info('Part 3: Creating Slack destination');
    await pm.alertDestinationsPage.createSlackDestination(destinationName, webhookUrl);
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);
    testLogger.info('✓ Slack destination created and verified in list', { destinationName });

    // ----- PART 4: Edit Mode - Verify Form Loading -----
    testLogger.info('Part 4: Testing edit mode form loading');
    await pm.alertDestinationsPage.clickEditDestination(destinationName);
    await pm.alertDestinationsPage.expectEditFormLoaded(destinationName);
    await pm.alertDestinationsPage.expectStep1Skipped();
    await pm.alertDestinationsPage.expectDestinationTypeInEditMode('Slack');
    await pm.alertDestinationsPage.expectWebhookUrlPopulated();
    testLogger.info('✓ Edit form loads correctly with existing data');
    await pm.alertDestinationsPage.clickCancel();

    // ----- PART 5: Edit Mode - Update Webhook URL -----
    testLogger.info('Part 5: Updating Slack webhook URL');
    await pm.alertDestinationsPage.editSlackDestination(destinationName, updatedWebhookUrl);
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);
    testLogger.info('✓ Slack destination webhook URL updated successfully');

    // ----- CLEANUP -----
    testLogger.info('Cleanup: Deleting Slack destination');
    await pm.alertDestinationsPage.deleteDestination(destinationName);

    testLogger.info('===== P1 SLACK TEST COMPLETED =====');
  });

  // ============================================================================
  // P1 - Other Prebuilt Types: Discord, Teams, PagerDuty, Opsgenie, ServiceNow
  // ============================================================================

  test("P1: Prebuilt Types - Create and Edit for Discord, Teams, PagerDuty, Opsgenie, ServiceNow", {
    tag: ['@prebuiltDestinations', '@discord', '@teams', '@pagerduty', '@opsgenie', '@servicenow', '@P1', '@all'],
    timeout: EXTENDED_TIMEOUT_MS
  }, async ({ page }) => {
    test.slow(); // Mark as slow due to multiple destination types
    testLogger.info('===== P1 PREBUILT TYPES TEST: Discord, Teams, PagerDuty, Opsgenie, ServiceNow =====');

    // ----- DISCORD -----
    testLogger.info('===== Testing Discord Destination =====');
    const discordName = `auto_dest_discord_${sharedRandomValue}`;
    const discordWebhook = 'https://discord.com/api/webhooks/1234567890/AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEfGhIjKlMnOpQrStUvWxYz';
    const discordWebhookUpdated = 'https://discord.com/api/webhooks/9876543210/ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210ZyXwVuTsRqPoNmLkJiHgFeDcBa';

    await pm.alertDestinationsPage.createDiscordDestination(discordName, discordWebhook);
    await pm.alertDestinationsPage.expectDestinationInList(discordName);
    testLogger.info('✓ Discord destination created', { discordName });

    await pm.alertDestinationsPage.editDiscordDestination(discordName, discordWebhookUpdated);
    await pm.alertDestinationsPage.expectDestinationInList(discordName);
    testLogger.info('✓ Discord destination updated');

    await pm.alertDestinationsPage.deleteDestination(discordName);
    testLogger.info('✓ Discord destination deleted');

    // ----- MICROSOFT TEAMS -----
    testLogger.info('===== Testing Microsoft Teams Destination =====');
    const teamsName = `auto_dest_teams_${sharedRandomValue}`;
    const teamsWebhook = 'https://outlook.office.com/webhook/00000000-0000-0000-0000-000000000000@00000000-0000-0000-0000-000000000000/IncomingWebhook/00000000000000000000000000000000/00000000-0000-0000-0000-000000000000';
    const teamsWebhookUpdated = 'https://outlook.office.com/webhook/11111111-1111-1111-1111-111111111111@11111111-1111-1111-1111-111111111111/IncomingWebhook/11111111111111111111111111111111/11111111-1111-1111-1111-111111111111';

    await pm.alertDestinationsPage.createTeamsDestination(teamsName, teamsWebhook);
    await pm.alertDestinationsPage.expectDestinationInList(teamsName);
    testLogger.info('✓ Teams destination created', { teamsName });

    await pm.alertDestinationsPage.editTeamsDestination(teamsName, teamsWebhookUpdated);
    await pm.alertDestinationsPage.expectDestinationInList(teamsName);
    testLogger.info('✓ Teams destination updated');

    await pm.alertDestinationsPage.deleteDestination(teamsName);
    testLogger.info('✓ Teams destination deleted');

    // ----- PAGERDUTY -----
    testLogger.info('===== Testing PagerDuty Destination =====');
    const pagerdutyName = `auto_dest_pagerduty_${sharedRandomValue}`;
    const integrationKey = 'R01234ABCDEFGHIJKLMNOPQR01234567'; // 32 characters

    await pm.alertDestinationsPage.createPagerDutyDestination(pagerdutyName, integrationKey, 'Error');
    await pm.alertDestinationsPage.expectDestinationInList(pagerdutyName);
    testLogger.info('✓ PagerDuty destination created with Error severity', { pagerdutyName });

    // Edit and change severity (must re-provide integration key as password fields are cleared)
    await pm.alertDestinationsPage.editPagerDutyDestination(pagerdutyName, integrationKey, 'Warning');
    await pm.alertDestinationsPage.expectDestinationInList(pagerdutyName);
    testLogger.info('✓ PagerDuty destination severity updated to Warning');

    await pm.alertDestinationsPage.deleteDestination(pagerdutyName);
    testLogger.info('✓ PagerDuty destination deleted');

    // ----- OPSGENIE -----
    testLogger.info('===== Testing Opsgenie Destination =====');
    const opsgenieName = `auto_dest_opsgenie_${sharedRandomValue}`;
    const apiKey = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx1234'; // 40 characters (>30)

    await pm.alertDestinationsPage.createOpsgenieDestination(opsgenieName, apiKey, 'P2');
    await pm.alertDestinationsPage.expectDestinationInList(opsgenieName);
    testLogger.info('✓ Opsgenie destination created with P2 priority', { opsgenieName });

    // Edit and change priority (must re-provide API key as password fields are cleared)
    await pm.alertDestinationsPage.editOpsgenieDestination(opsgenieName, apiKey, 'P1');
    await pm.alertDestinationsPage.expectDestinationInList(opsgenieName);
    testLogger.info('✓ Opsgenie destination priority updated to P1');

    await pm.alertDestinationsPage.deleteDestination(opsgenieName);
    testLogger.info('✓ Opsgenie destination deleted');

    // ----- SERVICENOW -----
    testLogger.info('===== Testing ServiceNow Destination =====');
    const servicenowName = `auto_dest_servicenow_${sharedRandomValue}`;
    const instanceUrl = 'https://dev12345.service-now.com/api/now/table/incident';
    const instanceUrlUpdated = 'https://dev67890.service-now.com/api/now/table/incident';
    const username = 'test_user';
    const password = 'test_password';

    await pm.alertDestinationsPage.createServiceNowDestination(servicenowName, instanceUrl, username, password);
    await pm.alertDestinationsPage.expectDestinationInList(servicenowName);
    testLogger.info('✓ ServiceNow destination created', { servicenowName });

    await pm.alertDestinationsPage.editServiceNowDestination(servicenowName, instanceUrlUpdated);
    await pm.alertDestinationsPage.expectDestinationInList(servicenowName);
    testLogger.info('✓ ServiceNow destination instance URL updated');

    await pm.alertDestinationsPage.deleteDestination(servicenowName);
    testLogger.info('✓ ServiceNow destination deleted');

    testLogger.info('===== P1 PREBUILT TYPES TEST COMPLETED =====');
  });

  // ============================================================================
  // P1 - Custom Destination Flow: Create and Edit
  // ============================================================================

  test("P1: Custom Destination - Create and Edit flow", {
    tag: ['@prebuiltDestinations', '@custom', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('===== P1 CUSTOM DESTINATION TEST =====');

    const destinationName = `auto_dest_custom_${sharedRandomValue}`;
    const originalUrl = 'https://webhook.example.com/original';
    const updatedUrl = 'https://webhook.example.com/updated';

    // ----- PART 1: Verify Custom option still works -----
    testLogger.info('Part 1: Verifying Custom destination option');
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('custom');
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
    await pm.alertDestinationsPage.expectUrlInputVisible();
    testLogger.info('✓ Custom destination form displays correctly');
    await pm.alertDestinationsPage.clickCancel();

    // ----- PART 2: Create Custom Destination -----
    testLogger.info('Part 2: Creating custom destination');
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('custom');
    await pm.alertDestinationsPage.fillDestinationName(destinationName);
    await pm.alertDestinationsPage.selectTemplate(); // Select first available template
    await pm.alertDestinationsPage.fillCustomUrl(originalUrl);
    await pm.alertDestinationsPage.selectHttpMethod('POST');
    await pm.alertDestinationsPage.clickSave();
    await pm.alertDestinationsPage.expectSuccessNotification();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
    testLogger.info('✓ Custom destination created', { destinationName });

    // ----- PART 3: Edit Custom Destination URL -----
    testLogger.info('Part 3: Editing custom destination URL');
    await pm.alertDestinationsPage.clickEditDestination(destinationName);
    await pm.alertDestinationsPage.expectEditFormLoaded(destinationName);
    await pm.alertDestinationsPage.updateCustomUrl(updatedUrl);
    await pm.alertDestinationsPage.clickSave();
    await pm.alertDestinationsPage.expectSuccessNotification();
    await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);
    testLogger.info('✓ Custom destination URL updated successfully');

    // ----- CLEANUP -----
    await pm.alertDestinationsPage.deleteDestination(destinationName);
    testLogger.info('✓ Custom destination deleted');

    testLogger.info('===== P1 CUSTOM DESTINATION TEST COMPLETED =====');
  });

  // ============================================================================
  // P2 - Validation & Edge Cases
  // ============================================================================

  test("P2: Validation - Required fields and stepper behavior", {
    tag: ['@prebuiltDestinations', '@validation', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('===== P2 VALIDATION TEST =====');

    // ----- PART 1: Required Field Validation -----
    testLogger.info('Part 1: Testing required field validation');
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('slack');
    await pm.alertDestinationsPage.clickSave();
    await pm.alertDestinationsPage.expectValidationError();
    testLogger.info('✓ Required field validation working - Save blocked without webhook URL');
    await pm.alertDestinationsPage.clickCancel();

    // ----- PART 2: Edit Mode - Step 1 Skipped -----
    testLogger.info('Part 2: Verifying Step 1 is skipped in edit mode');
    const tempDestName = `auto_dest_edit_test_${sharedRandomValue}`;
    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';

    await pm.alertDestinationsPage.createSlackDestination(tempDestName, webhookUrl);
    await pm.alertDestinationsPage.clickEditDestination(tempDestName);
    await pm.alertDestinationsPage.expectEditFormLoaded(tempDestName);
    await pm.alertDestinationsPage.expectStep1Skipped();
    await pm.alertDestinationsPage.expectConnectionStepVisible();
    testLogger.info('✓ Step 1 correctly skipped in edit mode');
    await pm.alertDestinationsPage.clickCancel();

    // ----- PART 3: Credentials Restoration -----
    testLogger.info('Part 3: Verifying credentials restoration from metadata');
    await pm.alertDestinationsPage.clickEditDestination(tempDestName);
    await pm.alertDestinationsPage.expectEditFormLoaded(tempDestName);
    await pm.alertDestinationsPage.expectWebhookUrlPopulated();
    testLogger.info('✓ Credentials properly restored from metadata in edit mode');
    await pm.alertDestinationsPage.clickCancel();

    // ----- PART 4: Type Indicator Persistence in Edit Mode -----
    testLogger.info('Part 4: Verifying destination type indicator persistence');
    await pm.alertDestinationsPage.clickEditDestination(tempDestName);
    await pm.alertDestinationsPage.expectDestinationTypeInEditMode('Slack');
    await pm.alertDestinationsPage.expectCheckmarkVisible();
    testLogger.info('✓ Destination type indicator persists correctly in edit mode');
    await pm.alertDestinationsPage.clickCancel();

    // ----- CLEANUP -----
    await pm.alertDestinationsPage.deleteDestination(tempDestName);
    testLogger.info('✓ Temporary destination deleted');

    testLogger.info('===== P2 VALIDATION TEST COMPLETED =====');
  });

  // ============================================================================
  // P3 - Delete Flow
  // ============================================================================

  test("P3: Delete - Create and delete destination with verification", {
    tag: ['@prebuiltDestinations', '@delete', '@P3', '@all']
  }, async ({ page }) => {
    testLogger.info('===== P3 DELETE TEST =====');

    const destinationName = `auto_dest_delete_${sharedRandomValue}`;
    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';

    // Create destination
    testLogger.info('Creating destination for deletion test');
    await pm.alertDestinationsPage.createSlackDestination(destinationName, webhookUrl);
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);
    testLogger.info('✓ Destination created', { destinationName });

    // Delete destination
    testLogger.info('Deleting destination');
    await pm.alertDestinationsPage.deleteDestination(destinationName);

    // Verify deletion
    await pm.alertDestinationsPage.expectDestinationNotInList(destinationName);
    testLogger.info('✓ Destination deleted and verified not in list');

    testLogger.info('===== P3 DELETE TEST COMPLETED =====');
  });

  // ============================================================================
  // SKIPPED - Email Destination Tests
  // ============================================================================

  /**
   * Email Destination Tests - SKIPPED
   *
   * NOTE: These tests are currently skipped because:
   * 1. SMTP is not configured in the test environment
   * 2. Email destinations require a working mail server to validate
   * 3. The test environment does not have email infrastructure set up
   *
   * To enable these tests:
   * - Configure SMTP settings in the test environment
   * - Set up a test email server or use a mock SMTP service
   * - Update environment variables: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD
   *
   * Test coverage when enabled:
   * - Create email destination with single recipient
   * - Create email destination with multiple recipients
   * - Edit email destination - add/remove recipients
   * - Validate email address format
   * - Verify multiple recipients are preserved in edit mode
   */
  test.skip("Email - Create and edit destination (SMTP not configured)", {
    tag: ['@prebuiltDestinations', '@email', '@P1', '@skip']
  }, async ({ page }) => {
    testLogger.info('===== EMAIL TEST: SKIPPED - SMTP not configured =====');

    const destinationName = `auto_dest_email_${sharedRandomValue}`;
    const recipients = process.env["ZO_ROOT_USER_EMAIL"];
    const additionalRecipients = `${process.env["ZO_ROOT_USER_EMAIL"]}, test@example.com`;

    // Create Email destination
    await pm.alertDestinationsPage.createEmailDestination(destinationName, recipients);
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);
    testLogger.info('✓ Email destination created');

    // Edit and add recipients
    await pm.alertDestinationsPage.editEmailDestination(destinationName, additionalRecipients);
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);
    testLogger.info('✓ Email destination recipients updated');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
    testLogger.info('✓ Email destination deleted');
  });

  test.skip("Email - Validate email address format (SMTP not configured)", {
    tag: ['@prebuiltDestinations', '@email', '@validation', '@P1', '@skip']
  }, async ({ page }) => {
    testLogger.info('===== EMAIL VALIDATION TEST: SKIPPED - SMTP not configured =====');

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');
    await pm.alertDestinationsPage.fillEmailRecipients('invalid-email-format');
    await pm.alertDestinationsPage.expectValidationError();
    testLogger.info('✓ Email validation working');
    await pm.alertDestinationsPage.clickCancel();
  });
});
