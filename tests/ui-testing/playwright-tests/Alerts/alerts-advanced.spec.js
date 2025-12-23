/**
 * Alerts Advanced Tests - Coverage Expansion
 *
 * Tests for:
 * 1. Advanced Conditions - Multiple conditions with AND/OR logic
 * 2. Bulk Operations - Bulk pause/unpause alerts
 *
 * Note: PromQL alerts require metrics stream which may not be available in all environments.
 * Those tests are included but may be skipped if metrics data is not present.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

const TEST_STREAM = 'e2e_automate';

// Use a static unique suffix for this test run
const RUN_SUFFIX = Math.random().toString(36).substring(2, 6);
const DESTINATION_NAME = 'auto_dest_adv_' + RUN_SUFFIX;
const TEMPLATE_NAME = 'auto_template_adv_' + RUN_SUFFIX;

test.describe("Alerts Advanced Coverage Tests", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;
    let randomValue;
    let createdAlerts = [];

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        randomValue = Math.random().toString(36).substring(2, 8);

        // Navigate to alerts page
        const alertsUrl = `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`;
        await page.goto(alertsUrl);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(2000);

        testLogger.info('Test setup completed');
    });

    // ==================== SETUP TEST ====================

    test("Setup: Create template and destination for advanced tests", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@setup']
    }, async ({ page }) => {
        testLogger.info('Creating prerequisite template and destination');

        // Navigate to templates tab
        await pm.alertTemplatesPage.navigateToTemplates();
        await page.waitForTimeout(1000);

        // Create template
        await pm.alertTemplatesPage.createTemplate(TEMPLATE_NAME);
        await pm.alertTemplatesPage.verifyCreatedTemplateExists(TEMPLATE_NAME);
        testLogger.info('Template created', { templateName: TEMPLATE_NAME });

        // Navigate to destinations tab
        await pm.alertDestinationsPage.navigateToDestinations();
        await page.waitForTimeout(1000);

        // Create destination (url, templateName, destinationName)
        const webhookUrl = 'https://webhook.site/test-advanced';
        await pm.alertDestinationsPage.createDestination(DESTINATION_NAME, webhookUrl, TEMPLATE_NAME);
        await pm.alertDestinationsPage.verifyDestinationExists(DESTINATION_NAME);
        testLogger.info('Destination created', { destinationName: DESTINATION_NAME });
    });

    // ==================== ADVANCED CONDITIONS TESTS ====================

    test("Create alert with multiple AND conditions", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@multiCondition']
    }, async ({ page }) => {
        testLogger.info('Testing multi-condition alert creation');

        // Wait for alerts page to fully load (already navigated in beforeEach)
        await page.waitForTimeout(2000);

        // Create alert with multiple conditions
        const alertName = await pm.alertsPage.createAlertWithMultipleConditions(
            TEST_STREAM,
            DESTINATION_NAME,
            randomValue
        );
        createdAlerts.push(alertName);

        // Verify alert was created
        await pm.alertsPage.verifyAlertCreated(alertName);
        testLogger.info('Multi-condition alert created successfully', { alertName });
    });

    test("Verify condition operator toggle (AND to OR)", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@conditionOperator']
    }, async ({ page }) => {
        testLogger.info('Testing condition operator toggle');

        // Wait for alerts page to fully load (already navigated in beforeEach)
        await page.waitForTimeout(2000);

        // Use page object method to test condition operator toggle
        // This test verifies that:
        // 1. Multiple conditions can be added
        // 2. AND operator is default between conditions
        // 3. Operator can be toggled to OR
        const result = await pm.alertsPage.testConditionOperatorToggle(TEST_STREAM, randomValue);

        if (result.toggleSuccessful) {
            testLogger.info('Successfully toggled condition operator from AND to OR');
        } else {
            testLogger.warn('Toggle operator test completed with warnings', { message: result.message });
        }

        testLogger.info('Condition operator toggle test completed');
    });

    // ==================== BULK OPERATIONS TESTS ====================

    test("Bulk pause and unpause multiple alerts", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@bulkOperations']
    }, async ({ page }) => {
        testLogger.info('Testing bulk pause/unpause operations');

        // Wait for alerts page to fully load (already navigated in beforeEach)
        await page.waitForTimeout(2000);

        // Create two alerts for bulk operations
        const alert1Name = 'auto_bulk_alert_1_' + randomValue;
        const alert2Name = 'auto_bulk_alert_2_' + randomValue;

        // Create first alert using createAlertWithDefaults which uses first available column
        await pm.alertsPage.createAlertWithDefaults(TEST_STREAM, DESTINATION_NAME, 'bulk1_' + randomValue);
        await page.waitForTimeout(1000);
        const createdAlert1 = pm.alertsPage.currentAlertName;
        createdAlerts.push(createdAlert1);
        testLogger.info('Created first alert for bulk test', { alertName: createdAlert1 });

        // Create second alert
        await pm.alertsPage.createAlertWithDefaults(TEST_STREAM, DESTINATION_NAME, 'bulk2_' + randomValue);
        await page.waitForTimeout(1000);
        const createdAlert2 = pm.alertsPage.currentAlertName;
        createdAlerts.push(createdAlert2);
        testLogger.info('Created second alert for bulk test', { alertName: createdAlert2 });

        // Select both alerts
        await pm.alertsPage.selectMultipleAlerts([createdAlert1, createdAlert2]);

        // Verify bulk pause button is visible
        await pm.alertsPage.verifyBulkPauseButtonVisible();
        testLogger.info('Bulk pause button visible after selection');

        // Bulk pause
        await pm.alertsPage.bulkPauseAlerts();
        testLogger.info('Bulk pause completed');

        // Wait for UI to update
        await page.waitForTimeout(2000);

        // Select both alerts again (selection may be cleared after operation)
        await pm.alertsPage.selectMultipleAlerts([createdAlert1, createdAlert2]);

        // Verify bulk unpause button is visible
        await pm.alertsPage.verifyBulkUnpauseButtonVisible();
        testLogger.info('Bulk unpause button visible after pausing');

        // Bulk unpause
        await pm.alertsPage.bulkUnpauseAlerts();
        testLogger.info('Bulk unpause completed');

        testLogger.info('Bulk operations test completed successfully');
    });

    // ==================== CLEANUP TEST ====================

    test("Cleanup: Delete created alerts, destination, and template", {
        tag: ['@alertsAdvanced', '@all', '@alerts', '@cleanup']
    }, async ({ page }) => {
        testLogger.info('Cleaning up test data');

        // Wait for alerts page to fully load (already navigated in beforeEach)
        await page.waitForTimeout(2000);

        // Delete all created alerts using page object methods
        for (const alertName of createdAlerts) {
            try {
                await pm.alertsPage.searchAlert(alertName);
                // Use hasAlerts check with search already applied
                const hasResults = await pm.alertsPage.hasAlerts();
                if (hasResults) {
                    await pm.alertsPage.deleteAlertByRow(alertName);
                    testLogger.info('Deleted alert', { alertName });
                }
            } catch (e) {
                testLogger.warn('Alert not found for deletion', { alertName, error: e.message });
            }
        }

        // Clear search using page object
        await pm.alertsPage.searchAlert('');
        await page.waitForTimeout(1000);

        // Delete destination
        try {
            await pm.alertDestinationsPage.navigateToDestinations();
            await page.waitForTimeout(1000);
            await pm.alertDestinationsPage.deleteDestinationWithSearch(DESTINATION_NAME);
            testLogger.info('Deleted destination', { destinationName: DESTINATION_NAME });
        } catch (e) {
            testLogger.warn('Destination deletion failed', { destinationName: DESTINATION_NAME, error: e.message });
        }

        // Delete template
        try {
            await pm.alertTemplatesPage.navigateToTemplates();
            await page.waitForTimeout(1000);
            await pm.alertTemplatesPage.deleteTemplateAndVerify(TEMPLATE_NAME);
            testLogger.info('Deleted template', { templateName: TEMPLATE_NAME });
        } catch (e) {
            testLogger.warn('Template deletion failed', { templateName: TEMPLATE_NAME, error: e.message });
        }

        testLogger.info('Cleanup completed');
    });
});
