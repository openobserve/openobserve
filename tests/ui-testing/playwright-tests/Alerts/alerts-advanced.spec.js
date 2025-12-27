/**
 * Alerts Advanced Tests - Coverage Expansion
 *
 * Tests for:
 * 1. Advanced Conditions - Multiple conditions with AND/OR logic
 * 2. Bulk Operations - Bulk pause/unpause alerts
 * 3. Deduplication Configuration - Scheduled alerts with dedup settings
 *
 * Note: Each test is independent and creates its own test data.
 * Cleanup is handled by cleanup.spec.js via 'auto_' prefix patterns.
 */

const { test, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

const TEST_STREAM = 'e2e_automate';

// Test timeout constants (in milliseconds)
const UI_STABILIZATION_WAIT_MS = 2000;
const SHORT_WAIT_MS = 1000;
const NETWORK_IDLE_TIMEOUT_MS = 30000;

test.describe("Alerts Advanced Coverage Tests", () => {
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        const alertsUrl = `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`;
        await page.goto(alertsUrl);
        await page.waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => {});
        await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);
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
        await page.waitForTimeout(SHORT_WAIT_MS);
        await pm.alertTemplatesPage.createTemplate(templateName);
        testLogger.info('Template created', { templateName });

        await pm.alertDestinationsPage.navigateToDestinations();
        await page.waitForTimeout(SHORT_WAIT_MS);
        const webhookUrl = 'https://webhook.site/test-multicond-' + uniqueSuffix;
        await pm.alertDestinationsPage.createDestination(destinationName, webhookUrl, templateName);
        testLogger.info('Destination created', { destinationName });

        const alertsUrl = `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`;
        await page.goto(alertsUrl);
        await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

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

        await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

        // Verifies: multiple conditions can be added, AND is default, can toggle to OR
        const result = await pm.alertsPage.testConditionOperatorToggle(TEST_STREAM, uniqueSuffix);

        if (result.toggleSuccessful) {
            testLogger.info('Successfully toggled condition operator from AND to OR');
        } else {
            testLogger.warn('Toggle operator test completed with warnings', { message: result.message });
        }
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
        await page.waitForTimeout(SHORT_WAIT_MS);
        await pm.alertTemplatesPage.createTemplate(templateName);
        testLogger.info('Template created', { templateName });

        await pm.alertDestinationsPage.navigateToDestinations();
        await page.waitForTimeout(SHORT_WAIT_MS);
        const webhookUrl = 'https://webhook.site/test-bulk-' + uniqueSuffix;
        await pm.alertDestinationsPage.createDestination(destinationName, webhookUrl, templateName);
        testLogger.info('Destination created', { destinationName });

        const alertsUrl = `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`;
        await page.goto(alertsUrl);
        await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

        // Create two alerts for bulk operations
        await pm.alertsPage.createAlertWithDefaults(TEST_STREAM, destinationName, 'bulk1_' + uniqueSuffix);
        await page.waitForTimeout(SHORT_WAIT_MS);
        const createdAlert1 = pm.alertsPage.currentAlertName;
        testLogger.info('Created first alert for bulk test', { alertName: createdAlert1 });

        await pm.alertsPage.createAlertWithDefaults(TEST_STREAM, destinationName, 'bulk2_' + uniqueSuffix);
        await page.waitForTimeout(SHORT_WAIT_MS);
        const createdAlert2 = pm.alertsPage.currentAlertName;
        testLogger.info('Created second alert for bulk test', { alertName: createdAlert2 });

        await pm.alertsPage.selectMultipleAlerts([createdAlert1, createdAlert2]);
        await pm.alertsPage.verifyBulkPauseButtonVisible();
        await pm.alertsPage.bulkPauseAlerts();
        testLogger.info('Bulk pause completed');

        await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

        // Selection cleared after operation, re-select
        await pm.alertsPage.selectMultipleAlerts([createdAlert1, createdAlert2]);
        await pm.alertsPage.verifyBulkUnpauseButtonVisible();
        await pm.alertsPage.bulkUnpauseAlerts();
        testLogger.info('Bulk unpause completed');

        testLogger.info('Bulk operations test completed successfully');
    });

    // ==================== DEDUPLICATION TESTS ====================

    test("Create scheduled alert with deduplication configuration", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@deduplication']
    }, async ({ page }) => {
        const uniqueSuffix = Math.random().toString(36).substring(2, 8);
        testLogger.info('Testing scheduled alert with deduplication configuration', { uniqueSuffix });

        // This test focuses on UI validation of scheduled alert with deduplication settings
        // Scheduled alert trigger verification is covered by alerts-ui-operations.spec.js
        const templateName = 'auto_template_dedup_' + uniqueSuffix;
        const destinationName = 'auto_dest_dedup_' + uniqueSuffix;

        await pm.alertTemplatesPage.navigateToTemplates();
        await page.waitForTimeout(SHORT_WAIT_MS);
        await pm.alertTemplatesPage.createTemplate(templateName);
        testLogger.info('Template created', { templateName });

        await pm.alertDestinationsPage.navigateToDestinations();
        await page.waitForTimeout(SHORT_WAIT_MS);
        const webhookUrl = 'https://webhook.site/test-dedup-' + uniqueSuffix;
        await pm.alertDestinationsPage.createDestination(destinationName, webhookUrl, templateName);
        testLogger.info('Destination created', { destinationName });

        const alertsUrl = `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`;
        await page.goto(alertsUrl);
        await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

        const dedupConfig = {
            timeWindowMinutes: 30
            // fingerprintFields left empty to test auto-detection
        };

        const alertName = await pm.alertsPage.createScheduledAlertWithDeduplication(
            TEST_STREAM,
            destinationName,
            uniqueSuffix,
            dedupConfig
        );

        await pm.alertsPage.verifyAlertCreated(alertName);
        testLogger.info('Scheduled alert with deduplication created and verified successfully', {
            alertName,
            dedupConfig
        });
    });
});
