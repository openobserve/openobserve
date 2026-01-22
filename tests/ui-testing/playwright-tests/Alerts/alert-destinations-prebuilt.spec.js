const { test, expect } = require('../utils/enhanced-baseFixtures.js');
const logData = require("../../fixtures/log.json");
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');

// Test timeout constants (in milliseconds)
const DEFAULT_TIMEOUT_MS = 60000;
const NETWORK_IDLE_TIMEOUT_MS = 30000;

/**
 * Prebuilt Alert Destinations E2E Tests
 *
 * Tests the complete functionality of prebuilt alert destinations including:
 * - Navigation and button states
 * - Destination type selection with stepper UI
 * - Form validation and credential input
 * - Testing destination connectivity
 * - Creating, editing, and deleting destinations
 * - Support for all prebuilt types: Slack, Teams, Email, PagerDuty, Opsgenie, ServiceNow
 */
test.describe("Prebuilt Alert Destinations E2E", () => {
  let pm;
  let randomSuffix;

  /**
   * Setup for each test
   * - Navigates to Alert Destinations page
   * - Generates unique suffix for destination names
   */
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    pm = new PageManager(page);

    // Generate random suffix for unique destination names
    randomSuffix = Date.now().toString().slice(-6);
    testLogger.info('Generated random suffix', { randomSuffix });

    // Navigate directly to alert destinations page
    await page.goto(`${process.env["ZO_BASE_URL"]}/web/settings/alert_destinations?org_identifier=${process.env["ORGNAME"]}`);
    await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});

    testLogger.info('Navigated to Alert Destinations page');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ============================================================================
  // P0 - Critical Smoke Tests
  // ============================================================================

  test("Verify New Destination button is enabled without templates", {
    tag: ['@prebuiltDestinations', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing New Destination button state');

    await pm.alertDestinationsPage.expectNewDestinationButtonVisible();
    await pm.alertDestinationsPage.expectNewDestinationButtonEnabled();

    testLogger.info('✓ New Destination button is enabled');
  });

  test("Navigate through stepper - Step 1: Choose Type", {
    tag: ['@prebuiltDestinations', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing stepper Step 1 - Choose Type');

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.expectStep1Visible();
    await pm.alertDestinationsPage.expectDestinationSelectorVisible();
    await pm.alertDestinationsPage.expectDestinationCardsVisible(8); // 7 prebuilt + 1 custom

    testLogger.info('✓ Step 1 displays correctly with destination types');
  });

  // ============================================================================
  // P1 - Slack Destination Tests
  // ============================================================================

  test("Create Slack destination - Complete flow", {
    tag: ['@prebuiltDestinations', '@slack', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Slack destination creation flow');

    const destinationName = `test_slack_${randomSuffix}`;
    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';

    // Complete flow: Create Slack destination
    await pm.alertDestinationsPage.createSlackDestination(destinationName, webhookUrl);

    // Verify destination appears in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Slack destination created successfully');

    // Cleanup: Delete the destination
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Validate Slack webhook URL format", {
    tag: ['@prebuiltDestinations', '@slack', '@validation', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing Slack webhook URL validation');

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('slack');

    // Test invalid webhook URL
    await pm.alertDestinationsPage.fillWebhookUrl('https://invalid-url.com');

    // Verify validation error appears
    await pm.alertDestinationsPage.expectValidationError();

    testLogger.info('✓ Slack webhook validation working');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();
  });

  test("Test Slack destination connectivity", {
    tag: ['@prebuiltDestinations', '@slack', '@test', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing Slack destination Test button');

    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('slack');
    await pm.alertDestinationsPage.fillWebhookUrl(webhookUrl);

    // Click Test button
    await pm.alertDestinationsPage.expectTestButtonEnabled();
    await pm.alertDestinationsPage.clickTest();

    // Verify test result is displayed
    await pm.alertDestinationsPage.expectTestResultVisible();

    testLogger.info('✓ Test button functionality working');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();
  });

  // ============================================================================
  // P1 - Discord Destination Tests
  // ============================================================================

  test("Create Discord destination - Complete flow", {
    tag: ['@prebuiltDestinations', '@discord', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Discord destination creation flow');

    const destinationName = `test_discord_${randomSuffix}`;
    const webhookUrl = 'https://discord.com/api/webhooks/1234567890/AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEfGhIjKlMnOpQrStUvWxYz';

    // Complete flow: Create Discord destination
    await pm.alertDestinationsPage.createDiscordDestination(destinationName, webhookUrl);

    // Verify destination appears in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Discord destination created successfully');

    // Cleanup: Delete the destination
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  // ============================================================================
  // P1 - Microsoft Teams Destination Tests
  // ============================================================================

  test("Create Microsoft Teams destination", {
    tag: ['@prebuiltDestinations', '@teams', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Microsoft Teams destination creation');

    const destinationName = `test_teams_${randomSuffix}`;
    const webhookUrl = 'https://outlook.office.com/webhook/00000000-0000-0000-0000-000000000000@00000000-0000-0000-0000-000000000000/IncomingWebhook/00000000000000000000000000000000/00000000-0000-0000-0000-000000000000';

    // Create Teams destination
    await pm.alertDestinationsPage.createTeamsDestination(destinationName, webhookUrl);

    // Verify in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Microsoft Teams destination created successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  // ============================================================================
  // P1 - Email Destination Tests
  // ============================================================================

  test.skip("Create Email destination with multiple recipients", {
    tag: ['@prebuiltDestinations', '@email', '@P1', '@all']
  }, async ({ page }) => {
    // SKIPPED: SMTP not configured in test environment
    testLogger.info('Testing Email destination creation');

    const destinationName = `test_email_${randomSuffix}`;
    const recipients = process.env["ZO_ROOT_USER_EMAIL"]; // Use actual test user email

    // Create Email destination
    await pm.alertDestinationsPage.createEmailDestination(destinationName, recipients);

    // Verify in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Email destination created successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test.skip("Validate email address format", {
    tag: ['@prebuiltDestinations', '@email', '@validation', '@P1']
  }, async ({ page }) => {
    // SKIPPED: SMTP not configured in test environment
    testLogger.info('Testing email validation');

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('email');

    // Test invalid email
    await pm.alertDestinationsPage.fillEmailRecipients('invalid-email-format');

    // Verify validation error
    await pm.alertDestinationsPage.expectValidationError();

    testLogger.info('✓ Email validation working');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();
  });

  // ============================================================================
  // P2 - PagerDuty Destination Tests
  // ============================================================================

  test("Create PagerDuty destination with severity", {
    tag: ['@prebuiltDestinations', '@pagerduty', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing PagerDuty destination creation');

    const destinationName = `test_pagerduty_${randomSuffix}`;
    const integrationKey = 'R01234ABCDEFGHIJKLMNOPQR01234567'; // 32 characters

    // Create PagerDuty destination
    await pm.alertDestinationsPage.createPagerDutyDestination(destinationName, integrationKey, 'Error');

    // Verify in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ PagerDuty destination created successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  // ============================================================================
  // P2 - Stepper Navigation Tests
  // ============================================================================

  // REMOVED: Test Back button navigation - obsolete (UI no longer uses stepper)
  // UI redesign removed stepper navigation, all destination types show on single screen

  test("Verify Custom Destination option still works", {
    tag: ['@prebuiltDestinations', '@custom', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Custom Destination option');

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('custom');

    // Verify custom form fields appear
    await page.waitForTimeout(2000);
    await pm.alertDestinationsPage.expectUrlInputVisible();

    testLogger.info('✓ Custom destination option working');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();
  });

  // ============================================================================
  // P2 - Required Field Validation Tests
  // ============================================================================

  test("Verify Save button validation for missing fields", {
    tag: ['@prebuiltDestinations', '@validation', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing required field validation');

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('slack');

    // Try to save without filling required fields
    await pm.alertDestinationsPage.clickSave();

    // Verify validation error appears
    await pm.alertDestinationsPage.expectValidationError();

    testLogger.info('✓ Required field validation working');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();
  });

  // ============================================================================
  // P3 - Delete Destination Tests
  // ============================================================================

  test("Delete prebuilt destination", {
    tag: ['@prebuiltDestinations', '@delete', '@P3']
  }, async ({ page }) => {
    testLogger.info('Testing destination deletion');

    const destinationName = `test_delete_${randomSuffix}`;
    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';

    // First, create a destination
    await pm.alertDestinationsPage.createSlackDestination(destinationName, webhookUrl);

    // Now delete it
    testLogger.info('Deleting destination');
    await pm.alertDestinationsPage.deleteDestination(destinationName);

    // Verify it's gone from the list
    await pm.alertDestinationsPage.expectDestinationNotInList(destinationName);

    testLogger.info('✓ Destination deleted successfully');
  });

  // ============================================================================
  // P1 - Stepper UI Verification Tests
  // ============================================================================

  test("Verify selected destination indicator with Slack", {
    tag: ['@prebuiltDestinations', '@slack', '@stepperUI', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing selected destination indicator');

    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('slack');

    // Verify Step 2 is displayed
    await pm.alertDestinationsPage.expectConnectionStepVisible();

    // Verify selected destination indicator
    await pm.alertDestinationsPage.expectSelectedIndicatorVisible('Slack');

    // Verify green checkmark
    await pm.alertDestinationsPage.expectCheckmarkVisible();

    testLogger.info('✓ Selected destination indicator displays correctly');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();
  });

  // ============================================================================
  // P1 - EDIT MODE Tests for Prebuilt Destinations
  // ============================================================================

  test("Edit Slack destination - verify form loads with existing webhook URL", {
    tag: ['@prebuiltDestinations', '@slack', '@edit', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Slack destination edit form loading');

    const destinationName = `test_slack_edit_load_${randomSuffix}`;
    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';

    // Create destination first
    await pm.alertDestinationsPage.createSlackDestination(destinationName, webhookUrl);

    // Click Edit button
    await pm.alertDestinationsPage.clickEditDestination(destinationName);

    // Verify edit form loads with existing data
    await pm.alertDestinationsPage.expectEditFormLoaded(destinationName);

    // Verify Step 1 is skipped and we're on Step 2
    await pm.alertDestinationsPage.expectStep1Skipped();

    // Verify destination type indicator shows "Slack"
    await pm.alertDestinationsPage.expectDestinationTypeInEditMode('Slack');

    // Verify webhook URL is populated
    await pm.alertDestinationsPage.expectWebhookUrlPopulated();

    testLogger.info('✓ Slack edit form loaded correctly with existing data');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit Slack destination - change webhook URL and save", {
    tag: ['@prebuiltDestinations', '@slack', '@edit', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Slack destination webhook URL update');

    const destinationName = `test_slack_edit_update_${randomSuffix}`;
    const originalWebhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';
    const newWebhookUrl = 'https://hooks.slack.com/services/T11111111/B11111111/YYYYYYYYYYYYYYYYYYYY';

    // Create destination first
    await pm.alertDestinationsPage.createSlackDestination(destinationName, originalWebhookUrl);

    // Edit and update webhook URL
    await pm.alertDestinationsPage.editSlackDestination(destinationName, newWebhookUrl);

    // Verify destination still exists in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Slack destination webhook URL updated successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit Discord destination - update webhook URL", {
    tag: ['@prebuiltDestinations', '@discord', '@edit', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Discord destination edit');

    const destinationName = `test_discord_edit_${randomSuffix}`;
    const originalWebhookUrl = 'https://discord.com/api/webhooks/1234567890/AbCdEfGhIjKlMnOpQrStUvWxYz1234567890AbCdEfGhIjKlMnOpQrStUvWxYz';
    const newWebhookUrl = 'https://discord.com/api/webhooks/9876543210/ZyXwVuTsRqPoNmLkJiHgFeDcBa9876543210ZyXwVuTsRqPoNmLkJiHgFeDcBa';

    // Create destination first
    await pm.alertDestinationsPage.createDiscordDestination(destinationName, originalWebhookUrl);

    // Edit and update webhook URL
    await pm.alertDestinationsPage.editDiscordDestination(destinationName, newWebhookUrl);

    // Verify destination still exists in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Discord destination updated successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit Microsoft Teams destination - update webhook URL", {
    tag: ['@prebuiltDestinations', '@teams', '@edit', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Microsoft Teams destination edit');

    const destinationName = `test_teams_edit_${randomSuffix}`;
    const originalWebhookUrl = 'https://outlook.office.com/webhook/00000000-0000-0000-0000-000000000000@00000000-0000-0000-0000-000000000000/IncomingWebhook/00000000000000000000000000000000/00000000-0000-0000-0000-000000000000';
    const newWebhookUrl = 'https://outlook.office.com/webhook/11111111-1111-1111-1111-111111111111@11111111-1111-1111-1111-111111111111/IncomingWebhook/11111111111111111111111111111111/11111111-1111-1111-1111-111111111111';

    // Create destination first
    await pm.alertDestinationsPage.createTeamsDestination(destinationName, originalWebhookUrl);

    // Edit and update webhook URL
    await pm.alertDestinationsPage.editTeamsDestination(destinationName, newWebhookUrl);

    // Verify destination still exists in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Teams destination updated successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test.skip("Edit Email destination - add/remove recipients", {
    tag: ['@prebuiltDestinations', '@email', '@edit', '@P1', '@all']
  }, async ({ page }) => {
    // SKIPPED: SMTP not configured in test environment
    testLogger.info('Testing Email destination recipients update');

    const destinationName = `test_email_edit_${randomSuffix}`;
    const originalRecipients = process.env["ZO_ROOT_USER_EMAIL"];
    const newRecipients = `${process.env["ZO_ROOT_USER_EMAIL"]}, test@example.com`;

    // Create destination first
    await pm.alertDestinationsPage.createEmailDestination(destinationName, originalRecipients);

    // Edit and update recipients
    await pm.alertDestinationsPage.editEmailDestination(destinationName, newRecipients);

    // Verify destination still exists in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Email destination recipients updated successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit PagerDuty destination - change severity level", {
    tag: ['@prebuiltDestinations', '@pagerduty', '@edit', '@P1']
  }, async ({ page }) => {
    testLogger.info('Testing PagerDuty destination severity update');

    const destinationName = `test_pagerduty_edit_${randomSuffix}`;
    const integrationKey = 'R01234ABCDEFGHIJKLMNOPQR01234567'; // 32 characters

    // Create destination with 'Error' severity
    await pm.alertDestinationsPage.createPagerDutyDestination(destinationName, integrationKey, 'Error');

    // Edit and change severity to 'Warning' (must re-provide integration key as password fields are cleared in edit mode)
    await pm.alertDestinationsPage.editPagerDutyDestination(destinationName, integrationKey, 'Warning');

    // Verify destination still exists in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ PagerDuty destination severity updated successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit destination - verify Step 1 is skipped and goes directly to Step 2", {
    tag: ['@prebuiltDestinations', '@edit', '@stepperUI', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Step 1 is skipped in edit mode');

    const destinationName = `test_step_skip_${randomSuffix}`;
    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';

    // Create destination first
    await pm.alertDestinationsPage.createSlackDestination(destinationName, webhookUrl);

    // Click Edit button
    await pm.alertDestinationsPage.clickEditDestination(destinationName);

    // Verify edit form loads
    await pm.alertDestinationsPage.expectEditFormLoaded(destinationName);

    // Verify Step 1 is skipped - we should be directly on Step 2
    await pm.alertDestinationsPage.expectStep1Skipped();
    await pm.alertDestinationsPage.expectConnectionStepVisible();

    testLogger.info('✓ Step 1 correctly skipped in edit mode');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit destination - verify credentials are properly restored from metadata", {
    tag: ['@prebuiltDestinations', '@edit', '@credentials', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing credentials restoration in edit mode');

    const destinationName = `test_credentials_restore_${randomSuffix}`;
    const webhookUrl = 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXX';

    // Create Slack destination
    await pm.alertDestinationsPage.createSlackDestination(destinationName, webhookUrl);

    // Click Edit button
    await pm.alertDestinationsPage.clickEditDestination(destinationName);

    // Verify edit form loads
    await pm.alertDestinationsPage.expectEditFormLoaded(destinationName);

    // Verify webhook URL is restored (credentials from metadata)
    await pm.alertDestinationsPage.expectWebhookUrlPopulated();

    testLogger.info('✓ Credentials properly restored from metadata');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  // REMOVED: Test "Edit destination - change destination name" - obsolete (name is now read-only)
  // Destination names cannot be changed in edit mode

  // REMOVED: Test "Edit destination - cancel without saving" - obsolete (depends on name editing)
  // Test used updateDestinationName which tries to edit read-only name field

  test.skip("Edit Email destination - verify multiple recipients are preserved", {
    tag: ['@prebuiltDestinations', '@email', '@edit', '@P2']
  }, async ({ page }) => {
    // SKIPPED: SMTP not configured in test environment
    testLogger.info('Testing Email destination multiple recipients preservation');

    const destinationName = `test_email_multi_recipients_${randomSuffix}`;
    const recipients = `${process.env["ZO_ROOT_USER_EMAIL"]}, test1@example.com, test2@example.com`;

    // Create destination with multiple recipients
    await pm.alertDestinationsPage.createEmailDestination(destinationName, recipients);

    // Click Edit button
    await pm.alertDestinationsPage.clickEditDestination(destinationName);

    // Verify edit form loads
    await pm.alertDestinationsPage.expectEditFormLoaded(destinationName);

    // Verify all recipients are populated
    await pm.alertDestinationsPage.expectEmailRecipientsPopulated();

    testLogger.info('✓ Multiple email recipients preserved in edit mode');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit destination - verify destination type indicator is persistent", {
    tag: ['@prebuiltDestinations', '@edit', '@stepperUI', '@P2']
  }, async ({ page }) => {
    testLogger.info('Testing destination type indicator persistence in edit mode');

    const destinationName = `test_type_indicator_${randomSuffix}`;
    const webhookUrl = 'https://outlook.office.com/webhook/00000000-0000-0000-0000-000000000000@00000000-0000-0000-0000-000000000000/IncomingWebhook/00000000000000000000000000000000/00000000-0000-0000-0000-000000000000';

    // Create Teams destination
    await pm.alertDestinationsPage.createTeamsDestination(destinationName, webhookUrl);

    // Click Edit button
    await pm.alertDestinationsPage.clickEditDestination(destinationName);

    // Verify edit form loads
    await pm.alertDestinationsPage.expectEditFormLoaded(destinationName);

    // Verify destination type indicator shows "Microsoft Teams" with checkmark
    await pm.alertDestinationsPage.expectDestinationTypeInEditMode('Microsoft Teams');
    await pm.alertDestinationsPage.expectCheckmarkVisible();

    testLogger.info('✓ Destination type indicator persists correctly in edit mode');

    // Close the form
    await pm.alertDestinationsPage.clickCancel();

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  // ============================================================================
  // P1 - Opsgenie Destination Tests (Create + Edit)
  // ============================================================================

  test("Create Opsgenie destination with priority", {
    tag: ['@prebuiltDestinations', '@opsgenie', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Opsgenie destination creation');

    const destinationName = `test_opsgenie_${randomSuffix}`;
    const apiKey = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx1234'; // 40 characters (>30)

    // Create Opsgenie destination
    await pm.alertDestinationsPage.createOpsgenieDestination(destinationName, apiKey, 'P2');

    // Verify in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Opsgenie destination created successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit Opsgenie destination - change priority", {
    tag: ['@prebuiltDestinations', '@opsgenie', '@edit', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Opsgenie destination priority update');

    const destinationName = `test_opsgenie_edit_${randomSuffix}`;
    const apiKey = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx1234'; // 40 characters (>30)

    // Create destination with 'P2' priority
    await pm.alertDestinationsPage.createOpsgenieDestination(destinationName, apiKey, 'P2');

    // Edit and change priority to 'P1' (must re-provide API key as password fields are cleared in edit mode)
    await pm.alertDestinationsPage.editOpsgenieDestination(destinationName, apiKey, 'P1');

    // Verify destination still exists in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Opsgenie destination priority updated successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  // ============================================================================
  // P1 - ServiceNow Destination Tests (Create + Edit)
  // ============================================================================

  test("Create ServiceNow destination", {
    tag: ['@prebuiltDestinations', '@servicenow', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing ServiceNow destination creation');

    const destinationName = `test_servicenow_${randomSuffix}`;
    const instanceUrl = 'https://dev12345.service-now.com/api/now/table/incident';
    const username = 'test_user';
    const password = 'test_password';

    // Create ServiceNow destination
    await pm.alertDestinationsPage.createServiceNowDestination(destinationName, instanceUrl, username, password);

    // Verify in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ ServiceNow destination created successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  test("Edit ServiceNow destination - update instance URL", {
    tag: ['@prebuiltDestinations', '@servicenow', '@edit', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing ServiceNow destination instance URL update');

    const destinationName = `test_servicenow_edit_${randomSuffix}`;
    const originalInstanceUrl = 'https://dev12345.service-now.com/api/now/table/incident';
    const newInstanceUrl = 'https://dev67890.service-now.com/api/now/table/incident';
    const username = 'test_user';
    const password = 'test_password';

    // Create destination first
    await pm.alertDestinationsPage.createServiceNowDestination(destinationName, originalInstanceUrl, username, password);

    // Edit and update instance URL
    await pm.alertDestinationsPage.editServiceNowDestination(destinationName, newInstanceUrl);

    // Verify destination still exists in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ ServiceNow destination updated successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });

  // ============================================================================
  // P2 - Custom Destination Edit Test
  // ============================================================================

  test("Edit Custom destination - change URL", {
    tag: ['@prebuiltDestinations', '@custom', '@edit', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('Testing Custom destination edit');

    const destinationName = `test_custom_edit_${randomSuffix}`;
    const originalUrl = 'https://webhook.example.com/original';
    const newUrl = 'https://webhook.example.com/updated';

    // Create custom destination first
    await pm.alertDestinationsPage.clickNewDestination();
    await pm.alertDestinationsPage.selectDestinationType('custom');

    // Fill custom destination details
    await pm.alertDestinationsPage.fillDestinationName(destinationName);
    await pm.alertDestinationsPage.selectTemplate(); // Select first available template (required!)
    await pm.alertDestinationsPage.fillCustomUrl(originalUrl);
    await pm.alertDestinationsPage.selectHttpMethod('POST');
    await pm.alertDestinationsPage.clickSave();
    await pm.alertDestinationsPage.expectSuccessNotification();
    await page.waitForTimeout(3000);

    // Edit and update URL
    await pm.alertDestinationsPage.clickEditDestination(destinationName);
    await pm.alertDestinationsPage.expectEditFormLoaded(destinationName);

    // Update URL
    await pm.alertDestinationsPage.updateCustomUrl(newUrl);
    await pm.alertDestinationsPage.clickSave();
    await pm.alertDestinationsPage.expectSuccessNotification();
    await page.waitForTimeout(3000);

    // Verify destination still exists in list
    await pm.alertDestinationsPage.expectDestinationInList(destinationName);

    testLogger.info('✓ Custom destination updated successfully');

    // Cleanup
    await pm.alertDestinationsPage.deleteDestination(destinationName);
  });
});
