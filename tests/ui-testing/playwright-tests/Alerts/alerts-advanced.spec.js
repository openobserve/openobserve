/**
 * Alerts Advanced Tests - Coverage Expansion
 *
 * Tests for:
 * 1. Advanced Conditions - Multiple conditions with AND/OR logic
 * 2. Bulk Operations - Bulk pause/unpause alerts
 *
 * Note: Each test is independent and creates its own test data.
 * Cleanup is handled by cleanup.spec.js via 'auto_' prefix patterns.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

const TEST_STREAM = 'e2e_automate';

// Test timeout constants (in milliseconds)
const NETWORK_IDLE_TIMEOUT_MS = 30000;

// Notification sink URL for the destinations these tests create. These tests only need a
// destination that SAVES; delivery is never triggered or asserted here.
// NOTE: must be a PUBLIC host. Pointing at this instance's own ingest (ZO_BASE_URL) fails on
// cloud/alpha, where ZO_BASE_URL resolves to a private IP and the backend's SSRF guard rejects
// the save ("Destination URL blocked by SSRF guard: private IP ... not allowed"), leaving the
// form open forever. example.com is IANA-reserved for documentation: it resolves to a public IP
// (passes the SSRF guard) and is never actually delivered to (no third-party dependency / rate limit).
const notificationSinkUrl = () => 'https://example.com/webhook';

test.describe("Alerts Advanced Coverage Tests", () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
        await page.goto(alertsUrl);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
        await pm.alertsPage.waitForAddAlertButton();
    });

    // ==================== ADVANCED CONDITIONS TESTS ====================

    test("Create alert with multiple AND conditions", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@multiCondition']
    }, async ({ page }) => {
        const uniqueSuffix = Math.random().toString(36).substring(2, 8);
        testLogger.info('Testing multi-condition alert creation', { uniqueSuffix });

        // This test focuses on UI validation of multi-condition alert creation
        // Trigger verification is covered by e2e-flow and alerts-import tests
        const templateName = 'auto_template_multicond_' + uniqueSuffix;
        const destinationName = 'auto_dest_multicond_' + uniqueSuffix;

        await pm.alertTemplatesPage.navigateToTemplates();
        await pm.alertTemplatesPage.waitForTemplateListReady();
        await pm.alertTemplatesPage.createTemplate(templateName);
        testLogger.info('Template created', { templateName });

        await pm.alertDestinationsPage.navigateToDestinations();
        await pm.alertDestinationsPage.waitForDestinationListReady();
        const destinationUrl = notificationSinkUrl();
        await pm.alertDestinationsPage.createDestination(destinationName, destinationUrl, templateName);
        testLogger.info('Destination created', { destinationName });

        const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
        await page.goto(alertsUrl);
        await pm.alertsPage.waitForAddAlertButton();

        const alertName = await pm.alertsPage.createAlertWithMultipleConditions(
            TEST_STREAM,
            destinationName,
            uniqueSuffix
        );

        await pm.alertsPage.verifyAlertCreated(alertName);
        testLogger.info('Multi-condition alert created and verified successfully', { alertName });
    });

    test("Verify condition operator toggle (AND to OR)", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@conditionOperator']
    }, async ({ page }) => {
        const uniqueSuffix = Math.random().toString(36).substring(2, 8);
        testLogger.info('Testing condition operator toggle', { uniqueSuffix });

        // The Add Alert button needs a template to exist
        const templateName = 'auto_template_toggle_' + uniqueSuffix;

        await pm.alertTemplatesPage.navigateToTemplates();
        await pm.alertTemplatesPage.waitForTemplateListReady();
        await pm.alertTemplatesPage.createTemplate(templateName);
        testLogger.info('Template created', { templateName });

        // Navigate back to alerts page
        const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
        await page.goto(alertsUrl);
        await pm.alertsPage.waitForAddAlertButton();

        // Verifies: multiple conditions can be added, AND is default, can toggle to OR
        const result = await pm.alertsPage.testConditionOperatorToggle(TEST_STREAM, uniqueSuffix);

        expect(result.toggleSuccessful, `Condition operator toggle failed: ${result.message || 'unknown reason'}`).toBe(true);
        testLogger.info('Successfully toggled condition operator from AND to OR');
    });

    // ==================== BULK OPERATIONS TESTS ====================

    test("Bulk pause and unpause multiple alerts", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@bulkOperations']
    }, async ({ page }) => {
        const uniqueSuffix = Math.random().toString(36).substring(2, 8);
        const templateName = 'auto_template_bulk_' + uniqueSuffix;
        const destinationName = 'auto_dest_bulk_' + uniqueSuffix;

        testLogger.info('Testing bulk pause/unpause operations', { uniqueSuffix });

        await pm.alertTemplatesPage.navigateToTemplates();
        await pm.alertTemplatesPage.waitForTemplateListReady();
        await pm.alertTemplatesPage.createTemplate(templateName);
        testLogger.info('Template created', { templateName });

        await pm.alertDestinationsPage.navigateToDestinations();
        await pm.alertDestinationsPage.waitForDestinationListReady();
        const destinationUrl = notificationSinkUrl();
        await pm.alertDestinationsPage.createDestination(destinationName, destinationUrl, templateName);
        testLogger.info('Destination created', { destinationName });

        const alertsUrl = `${logData.alertUrl}?org_identifier=${getOrgIdentifier()}`;
        await page.goto(alertsUrl);
        await pm.alertsPage.waitForAddAlertButton();

        // Create two alerts for bulk operations
        await pm.alertsPage.createAlertWithDefaults(TEST_STREAM, destinationName, 'bulk1_' + uniqueSuffix);
        await pm.alertsPage.waitForAddAlertButton();
        const createdAlert1 = pm.alertsPage.currentAlertName;
        testLogger.info('Created first alert for bulk test', { alertName: createdAlert1 });

        await pm.alertsPage.createAlertWithDefaults(TEST_STREAM, destinationName, 'bulk2_' + uniqueSuffix);
        await pm.alertsPage.waitForAddAlertButton();
        const createdAlert2 = pm.alertsPage.currentAlertName;
        testLogger.info('Created second alert for bulk test', { alertName: createdAlert2 });

        await pm.alertsPage.selectMultipleAlerts([createdAlert1, createdAlert2]);
        await pm.alertsPage.verifyBulkPauseButtonVisible();
        await pm.alertsPage.bulkPauseAlerts();
        testLogger.info('Bulk pause completed');

        // Wait for alert list table to be ready before re-selecting
        await pm.alertsPage.waitForAddAlertButton();

        // Selection cleared after operation, re-select
        await pm.alertsPage.selectMultipleAlerts([createdAlert1, createdAlert2]);
        await pm.alertsPage.verifyBulkUnpauseButtonVisible();
        await pm.alertsPage.bulkUnpauseAlerts();
        testLogger.info('Bulk unpause completed');

        testLogger.info('Bulk operations test completed successfully');
    });
});
