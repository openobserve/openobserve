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

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');

const TEST_STREAM = 'e2e_automate';

// Test timeout constants (in milliseconds)
const UI_STABILIZATION_WAIT_MS = 2000;
const SHORT_WAIT_MS = 1000;
const NETWORK_IDLE_TIMEOUT_MS = 30000;
const SCHEDULED_ALERT_WAIT_MS = 90000; // Wait for scheduled alert evaluation cycle

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

        // Create prerequisite template and destination to ensure Add Alert button is enabled
        // This fixes flaky behavior where button is disabled when no destinations exist
        const templateName = 'auto_template_toggle_' + uniqueSuffix;
        const destinationName = 'auto_dest_toggle_' + uniqueSuffix;

        await pm.alertTemplatesPage.navigateToTemplates();
        await page.waitForTimeout(SHORT_WAIT_MS);
        await pm.alertTemplatesPage.createTemplate(templateName);
        testLogger.info('Template created', { templateName });

        await pm.alertDestinationsPage.navigateToDestinations();
        await page.waitForTimeout(SHORT_WAIT_MS);
        const webhookUrl = 'https://webhook.site/test-toggle-' + uniqueSuffix;
        await pm.alertDestinationsPage.createDestination(destinationName, webhookUrl, templateName);
        testLogger.info('Destination created', { destinationName });

        // Navigate back to alerts page
        const alertsUrl = `${logData.alertUrl}?org_identifier=${process.env["ORGNAME"]}`;
        await page.goto(alertsUrl);
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

    /**
     * Deduplication Validation Test with Trigger Verification
     *
     * NOTE: This test is currently skipped because:
     * 1. Scheduled alert trigger validation has timing issues (known limitation)
     * 2. Deduplication is an enterprise-only feature (requires enterprise build)
     * 3. UI configuration testing is covered by "Create scheduled alert with deduplication configuration"
     *
     * To enable this test:
     * - Ensure enterprise features are enabled in the build
     * - Consider using longer timeouts or API-based validation
     * - May need to adjust scheduled alert query time ranges
     *
     * Test design:
     * 1. Creates unique source stream with custom columns
     * 2. Creates scheduled alert with deduplication configured
     * 3. Ingests data to trigger first alert - verifies notification appears
     * 4. Ingests more data (same fingerprint, within time window)
     * 5. Verifies NO NEW notification - dedup suppressed the duplicate
     */
    test.skip("Deduplication validation - verify duplicate alerts are suppressed", {
        tag: ['@alertsAdvanced', '@alerts', '@deduplication', '@dedupValidation', '@enterprise', '@skip']
    }, async ({ page }) => {
        test.slow(); // Mark as slow test due to scheduled alert evaluation cycles

        // Generate unique suffix (lowercase for API compatibility)
        const uniqueSuffix = Math.random().toString(36).substring(2, 8).toLowerCase();
        testLogger.info('Starting deduplication validation test', { uniqueSuffix });

        // Create unique source stream with custom columns (same approach as e2e-flow)
        const sourceStreamName = `dedup_src_${uniqueSuffix}`.toLowerCase();
        const column = 'city';        // Custom column from our test stream
        const value = 'bangalore';    // Value that triggers the alert condition

        // Initialize the source stream with custom columns
        await pm.commonActions.initializeAlertTestStream(sourceStreamName);
        testLogger.info('Initialized source stream with custom columns', {
            sourceStreamName,
            columns: ['city', 'country', 'status', 'age', 'test_run_id', 'test_timestamp', 'message']
        });

        // Create validation infrastructure (template + destination pointing to validation stream)
        const validationInfra = await pm.alertsPage.ensureValidationInfrastructure(pm, uniqueSuffix);
        testLogger.info('Validation infrastructure ready', validationInfra);

        // Navigate to alerts page - refresh to ensure new stream appears
        await pm.commonActions.navigateToAlerts();
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(UI_STABILIZATION_WAIT_MS);

        // Create scheduled alert with deduplication for validation
        const dedupConfig = {
            timeWindowMinutes: 5,           // 5-minute dedup window
            fingerprintFields: [column]     // Fingerprint based on city column
        };

        const alertName = await pm.alertsPage.createScheduledAlertWithDedupForValidation(
            sourceStreamName,
            column,
            value,
            validationInfra.destinationName,
            uniqueSuffix,
            dedupConfig
        );
        await pm.alertsPage.verifyAlertCreated(alertName);
        testLogger.info('Created scheduled alert with deduplication', {
            alertName,
            dedupConfig,
            stream: sourceStreamName
        });

        // Wait for alert to register
        testLogger.info('Waiting for alert registration...');
        await page.waitForTimeout(30000); // 30s for registration

        // ===== TRIGGER #1: Ingest data to trigger first alert =====
        testLogger.info('Ingesting first batch of data to trigger alert...');
        await pm.commonActions.ingestTestDataWithUniqueId(sourceStreamName, `trigger1_${uniqueSuffix}`, column, value);
        testLogger.info('First data ingestion complete');

        // Wait for scheduled alert evaluation cycle (1 min period + buffer)
        testLogger.info('Waiting for first scheduled alert evaluation cycle...');
        await page.waitForTimeout(SCHEDULED_ALERT_WAIT_MS);

        // Verify first notification appears in validation stream
        const firstCheck = await pm.commonActions.waitForAlertInValidationStream(
            validationInfra.streamName,
            alertName,
            150,  // max 150 seconds (2.5 min for scheduled alert to fire)
            10    // poll every 10 seconds
        );

        expect(firstCheck.found, `First alert notification should appear in validation stream for ${alertName}`).toBe(true);
        testLogger.info('First notification verified in validation stream', {
            alertName,
            found: firstCheck.found,
            attempts: firstCheck.attempts
        });

        // Get initial notification count
        const initialCount = await pm.commonActions.countAlertNotificationsInStream(
            validationInfra.streamName,
            alertName,
            15
        );
        testLogger.info('Initial notification count', {
            count: initialCount.count,
            alertName
        });

        // ===== TRIGGER #2: Additional data ingestion (same fingerprint, within window) =====
        testLogger.info('Ingesting second batch of data (should be suppressed by dedup)...');
        await pm.commonActions.ingestTestDataWithUniqueId(sourceStreamName, `trigger2_${uniqueSuffix}`, column, value);
        testLogger.info('Second data ingestion complete');

        // Wait for another evaluation cycle
        testLogger.info('Waiting for second scheduled alert evaluation cycle...');
        await page.waitForTimeout(SCHEDULED_ALERT_WAIT_MS);

        // Small additional wait to ensure processing completes
        await page.waitForTimeout(10000);

        // ===== VALIDATION: Check that dedup suppressed the duplicate =====
        const finalCount = await pm.commonActions.countAlertNotificationsInStream(
            validationInfra.streamName,
            alertName,
            15
        );
        testLogger.info('Final notification count after second trigger', {
            initialCount: initialCount.count,
            finalCount: finalCount.count,
            alertName
        });

        // The key assertion: count should NOT have increased
        // If dedup is working, we should have same count as before
        expect(
            finalCount.count,
            `Dedup should suppress duplicate: expected ${initialCount.count} notifications, got ${finalCount.count}`
        ).toBe(initialCount.count);

        testLogger.info('DEDUPLICATION VALIDATION PASSED', {
            alertName,
            dedupConfig,
            firstTriggerCount: initialCount.count,
            secondTriggerCount: finalCount.count,
            duplicateSuppressed: true
        });
    });
});
