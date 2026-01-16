/**
 * Metrics PromQL Query Persistence Test Suite
 *
 * This suite tests the fix for the bug where queries were not persisted when switching between tabs
 * in the metrics console PromQL custom mode.
 *
 * Bug: In metrics console, whenever we write a query in tab1 and go to other tab and come back to tab1,
 * the previous query was not being persisted.
 *
 * Fix PR: https://github.com/openobserve/openobserve/pull/9688
 * Reference Test PR: https://github.com/openobserve/openobserve/pull/9720
 *
 * Test scenarios covered:
 * 1. Auto-populated query appears when stream is selected in Tab 1
 * 2. Query persists in Tab 1 after switching to Tab 2 and back
 * 3. Multiple tabs maintain their own separate queries
 * 4. Queries persist after multiple tab switches
 * 5. Custom queries persist alongside auto-populated queries
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const metricsTestData = require('../utils/metrics-test-data.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');
const { verifyDataOnUI } = require('../utils/metrics-assertions.js');

test.describe('Metrics PromQL Query Persistence Tests', () => {
    test.describe.configure({ mode: 'parallel' });

    let pm; // Page Manager instance
    const METRICS_STREAM = 'e2e_metrics_query_test';

    /**
     * Setup: Ingest sample metrics data for testing
     */
    test.beforeAll(async () => {
        await ensureMetricsIngested();
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        // Use navigateToBase helper for consistent navigation
        await navigateToBase(page);
        pm = new PageManager(page);

        // Navigate to metrics page
        await pm.metricsPage.gotoMetricsPage();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        testLogger.info('Test setup completed - navigated to metrics page');
    });

    test.afterEach(async ({ page }, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    /**
     * P1 Test: Verify auto-populated query appears when stream is selected in Tab 1
     *
     * Scenario:
     * 1. Go to metrics page PromQL custom mode
     * 2. Select stream type (metrics)
     * 3. Select stream name
     * 4. Verify that a related query is automatically populated
     */
    test('P1: Auto-populated query appears when stream is selected in Tab 1', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P1']
    }, async ({ page }) => {
        testLogger.info('Test: Verify auto-populated query in Tab 1');

        // Step 1: Switch to PromQL mode (if not already)
        await pm.metricsPage.switchToPromQLMode();

        // Step 2: Select stream type
        await pm.metricsPage.selectStreamType('metrics');

        // Step 3: Select a stream name
        const streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
        await streamDropdown.click();
        await page.waitForTimeout(1000);

        // Get first available stream
        const firstStream = page.locator('[role="option"]').first();
        const streamName = await firstStream.textContent().catch(() => null);

        if (streamName) {
            await firstStream.click();
            await page.waitForTimeout(2000);

            testLogger.info(`Selected stream: ${streamName}`);

            // Step 4: Verify auto-populated query
            const autoQuery = await pm.metricsPage.getAutoPopulatedQuery();

            // Query should contain the stream name or metric reference
            expect(autoQuery).toBeTruthy();
            expect(autoQuery.length).toBeGreaterThan(0);

            testLogger.info(`✓ Auto-populated query found: ${autoQuery.substring(0, 100)}...`);
        } else {
            testLogger.warn('No streams available for testing - test skipped');
            test.skip();
        }
    });

    /**
     * P0 Test: Query persists in Tab 1 after switching to Tab 2 and back
     *
     * This is the CORE bug fix test.
     *
     * Scenario:
     * 1. In Tab 1, select stream and get auto-populated query
     * 2. Add a second tab (Tab 2)
     * 3. Switch to Tab 2
     * 4. Switch back to Tab 1
     * 5. Verify the query in Tab 1 is still there (not lost)
     */
    test('P0: Query persists in Tab 1 after switching to Tab 2 and back', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P0', '@criticalBugFix']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence when switching between tabs');

        // Step 1: Setup Tab 1 with a query
        testLogger.info('Setting up Tab 1 with auto-populated query');

        await pm.metricsPage.switchToPromQLMode();
        await pm.metricsPage.selectStreamType('metrics');

        // Select first available stream
        const streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
        await streamDropdown.click();
        await page.waitForTimeout(1000);

        const firstStream = page.locator('[role="option"]').first();
        const streamName = await firstStream.textContent().catch(() => '');

        if (!streamName) {
            testLogger.warn('No streams available - test skipped');
            test.skip();
            return;
        }

        await firstStream.click();
        await page.waitForTimeout(2000);

        // Get the auto-populated query from Tab 1
        const tab1Query = await pm.metricsPage.getAutoPopulatedQuery();
        expect(tab1Query).toBeTruthy();

        testLogger.info(`Tab 1 query captured: ${tab1Query.substring(0, 100)}...`);

        // Step 2: Add a second tab
        testLogger.info('Adding Tab 2');
        await pm.metricsPage.addNewQueryTab();
        await page.waitForTimeout(1000);

        // Verify Tab 2 was created
        const tab2Exists = await pm.metricsPage.verifyTabExists(2);
        expect(tab2Exists).toBe(true);

        testLogger.info('✓ Tab 2 created successfully');

        // Step 3: Switch to Tab 2 (should now be active)
        testLogger.info('Verifying Tab 2 is active');
        const activeTab = await pm.metricsPage.getActiveTabIndex();

        // Tab 2 should be auto-selected after creation, but let's ensure it
        if (activeTab !== 2) {
            await pm.metricsPage.switchToQueryTab(2);
        }

        testLogger.info('✓ Switched to Tab 2');

        // Step 4: Switch back to Tab 1
        testLogger.info('Switching back to Tab 1');
        await pm.metricsPage.switchToQueryTab(1);
        await page.waitForTimeout(1000);

        // Step 5: Verify query is still there (THE CRITICAL CHECK)
        testLogger.info('Verifying query persistence in Tab 1');
        const tab1QueryAfterSwitch = await pm.metricsPage.getCurrentQuery();

        // Normalize whitespace for comparison
        const normalizedOriginal = tab1Query.replace(/\s+/g, ' ').trim();
        const normalizedAfterSwitch = tab1QueryAfterSwitch.replace(/\s+/g, ' ').trim();

        // The query should be the same as before
        expect(normalizedAfterSwitch).toContain(normalizedOriginal);

        testLogger.info('✓ SUCCESS: Query persisted correctly in Tab 1 after tab switch');
        testLogger.info(`Original: ${normalizedOriginal.substring(0, 100)}...`);
        testLogger.info(`After switch: ${normalizedAfterSwitch.substring(0, 100)}...`);
    });

    /**
     * P1 Test: Multiple tabs maintain their own separate queries
     *
     * Scenario:
     * 1. Create Tab 1 with Query A
     * 2. Create Tab 2 with Query B
     * 3. Verify Tab 1 still has Query A
     * 4. Verify Tab 2 still has Query B
     * 5. Switch between tabs multiple times and verify both queries persist
     */
    test('P1: Multiple tabs maintain separate queries independently', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P1']
    }, async ({ page }) => {
        testLogger.info('Test: Multiple tabs maintain separate queries');

        // Step 1: Setup Tab 1 with Query A
        testLogger.info('Setting up Tab 1');

        await pm.metricsPage.switchToPromQLMode();

        // Enter a custom query in Tab 1
        const queryA = 'up{job="prometheus"}';
        await pm.metricsPage.enterPromQLQuery(queryA);
        await page.waitForTimeout(1000);

        const tab1Query = await pm.metricsPage.getCurrentQuery();
        testLogger.info(`Tab 1 query set: ${tab1Query}`);

        // Step 2: Create Tab 2 and add Query B
        testLogger.info('Creating Tab 2');
        await pm.metricsPage.addNewQueryTab();
        await page.waitForTimeout(1000);

        // Enter a different query in Tab 2
        const queryB = 'node_cpu_seconds_total{mode="idle"}';
        await pm.metricsPage.enterPromQLQuery(queryB);
        await page.waitForTimeout(1000);

        const tab2Query = await pm.metricsPage.getCurrentQuery();
        testLogger.info(`Tab 2 query set: ${tab2Query}`);

        // Step 3: Switch back to Tab 1 and verify Query A
        testLogger.info('Verifying Tab 1 query persistence');
        await pm.metricsPage.switchToQueryTab(1);
        await page.waitForTimeout(1000);

        await pm.metricsPage.verifyQueryPersisted(queryA, 'Tab 1 query should persist');

        // Step 4: Switch to Tab 2 and verify Query B
        testLogger.info('Verifying Tab 2 query persistence');
        await pm.metricsPage.switchToQueryTab(2);
        await page.waitForTimeout(1000);

        await pm.metricsPage.verifyQueryPersisted(queryB, 'Tab 2 query should persist');

        // Step 5: Multiple switches
        testLogger.info('Testing multiple rapid tab switches');

        for (let i = 0; i < 3; i++) {
            await pm.metricsPage.switchToQueryTab(1);
            await page.waitForTimeout(500);
            await pm.metricsPage.verifyQueryPersisted(queryA, `Tab 1 query (iteration ${i + 1})`);

            await pm.metricsPage.switchToQueryTab(2);
            await page.waitForTimeout(500);
            await pm.metricsPage.verifyQueryPersisted(queryB, `Tab 2 query (iteration ${i + 1})`);
        }

        testLogger.info('✓ SUCCESS: Both tabs maintained their queries through multiple switches');
    });

    /**
     * P2 Test: Query persistence with stream selection changes
     *
     * Scenario:
     * 1. Tab 1: Select Stream A, get auto-query
     * 2. Tab 2: Select Stream A (same stream), should get same auto-query
     * 3. Switch back to Tab 1, verify original query still there
     * 4. Tab 2: Change stream to Stream B
     * 5. Verify Tab 1 still has Stream A query (not affected by Tab 2 change)
     */
    test('P2: Query persistence when changing streams across tabs', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P2']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence with stream changes across tabs');

        // This test requires at least 2 streams to be available
        await pm.metricsPage.switchToPromQLMode();
        await pm.metricsPage.selectStreamType('metrics');

        // Get available streams
        const streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
        await streamDropdown.click();
        await page.waitForTimeout(1000);

        const streamOptions = page.locator('[role="option"]');
        const streamCount = await streamOptions.count();

        if (streamCount < 2) {
            testLogger.warn('Not enough streams for this test - skipping');
            test.skip();
            return;
        }

        // Select first stream in Tab 1
        const stream1 = streamOptions.nth(0);
        const stream1Name = await stream1.textContent();
        await stream1.click();
        await page.waitForTimeout(2000);

        const tab1OriginalQuery = await pm.metricsPage.getAutoPopulatedQuery();
        testLogger.info(`Tab 1 with ${stream1Name}: ${tab1OriginalQuery.substring(0, 50)}...`);

        // Create Tab 2
        await pm.metricsPage.addNewQueryTab();
        await page.waitForTimeout(1000);

        // Select second stream in Tab 2
        await streamDropdown.click();
        await page.waitForTimeout(1000);

        const stream2 = streamOptions.nth(1);
        const stream2Name = await stream2.textContent();
        await stream2.click();
        await page.waitForTimeout(2000);

        const tab2Query = await pm.metricsPage.getAutoPopulatedQuery();
        testLogger.info(`Tab 2 with ${stream2Name}: ${tab2Query.substring(0, 50)}...`);

        // Switch back to Tab 1
        await pm.metricsPage.switchToQueryTab(1);
        await page.waitForTimeout(1000);

        // Verify Tab 1 query is unchanged
        const tab1AfterSwitch = await pm.metricsPage.getCurrentQuery();

        expect(tab1AfterSwitch.replace(/\s+/g, ' ').trim())
            .toContain(tab1OriginalQuery.replace(/\s+/g, ' ').trim());

        testLogger.info('✓ SUCCESS: Tab 1 query preserved despite stream change in Tab 2');
    });

    /**
     * P2 Test: Custom query persistence (manually edited queries)
     *
     * Scenario:
     * 1. Tab 1: Get auto-query, then manually edit it
     * 2. Tab 2: Add new tab
     * 3. Switch back to Tab 1
     * 4. Verify the manually edited query is preserved
     */
    test('P2: Manually edited queries persist correctly', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P2']
    }, async ({ page }) => {
        testLogger.info('Test: Manually edited query persistence');

        await pm.metricsPage.switchToPromQLMode();

        // Enter a custom manual query
        const customQuery = 'rate(http_requests_total{job="api-server"}[5m])';

        await pm.metricsPage.enterPromQLQuery(customQuery);
        await page.waitForTimeout(1000);

        testLogger.info(`Entered custom query: ${customQuery}`);

        // Verify it was entered correctly
        await pm.metricsPage.verifyQueryPersisted(customQuery, 'Initial custom query');

        // Add Tab 2
        await pm.metricsPage.addNewQueryTab();
        await page.waitForTimeout(1000);

        // Enter different query in Tab 2
        const tab2Query = 'avg(cpu_usage)';
        await pm.metricsPage.enterPromQLQuery(tab2Query);
        await page.waitForTimeout(1000);

        // Switch back to Tab 1
        await pm.metricsPage.switchToQueryTab(1);
        await page.waitForTimeout(1000);

        // Verify custom query is still there
        await pm.metricsPage.verifyQueryPersisted(customQuery, 'Custom query after tab switch');

        testLogger.info('✓ SUCCESS: Manually edited query persisted correctly');
    });

    /**
     * P3 Test: Query persistence after rapid tab switching
     *
     * Scenario:
     * 1. Create 3 tabs with different queries
     * 2. Rapidly switch between tabs 10 times
     * 3. Verify all queries are still intact
     */
    test('P3: Query persistence under rapid tab switching', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P3', '@stressTest']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence under rapid tab switching');

        await pm.metricsPage.switchToPromQLMode();

        // Create 3 tabs with different queries
        const queries = [
            'up{job="prometheus"}',
            'rate(http_requests_total[5m])',
            'node_memory_Active_bytes'
        ];

        // Set query in Tab 1
        await pm.metricsPage.enterPromQLQuery(queries[0]);
        await page.waitForTimeout(500);

        // Create and set Tab 2
        await pm.metricsPage.addNewQueryTab();
        await page.waitForTimeout(500);
        await pm.metricsPage.enterPromQLQuery(queries[1]);
        await page.waitForTimeout(500);

        // Create and set Tab 3
        await pm.metricsPage.addNewQueryTab();
        await page.waitForTimeout(500);
        await pm.metricsPage.enterPromQLQuery(queries[2]);
        await page.waitForTimeout(500);

        testLogger.info('Created 3 tabs with different queries');

        // Rapid switching
        testLogger.info('Starting rapid tab switching (10 iterations)');

        const switchPattern = [1, 2, 3, 1, 3, 2, 1, 2, 3, 1];

        for (let i = 0; i < switchPattern.length; i++) {
            const tabIndex = switchPattern[i];
            await pm.metricsPage.switchToQueryTab(tabIndex);
            await page.waitForTimeout(300);
        }

        testLogger.info('Rapid switching completed, verifying queries');

        // Verify all queries are intact
        for (let i = 0; i < queries.length; i++) {
            const tabIndex = i + 1;
            await pm.metricsPage.switchToQueryTab(tabIndex);
            await page.waitForTimeout(500);

            await pm.metricsPage.verifyQueryPersisted(
                queries[i],
                `Tab ${tabIndex} query after stress test`
            );

            testLogger.info(`✓ Tab ${tabIndex} query verified`);
        }

        testLogger.info('✓ SUCCESS: All queries persisted after rapid switching');
    });
});
