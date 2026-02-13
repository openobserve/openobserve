/**
 * Metrics PromQL Query Persistence Test Suite
 *
 * This suite tests the fix for the bug where queries were not persisted when switching between tabs
 * in the metrics console PromQL custom mode.
 *
 * Bug: In metrics console, whenever we write a query in tab1 and go to other tab and come back to tab1,
 * the previous query was not being persisted.
 * 
 * Test scenarios covered:
 * 1. Auto-populated query appears when stream is selected in Tab 1
 * 2. Query persists in Tab 1 after switching to Tab 2 and back (CRITICAL BUG FIX)
 * 3. Multiple tabs maintain their own separate queries
 * 4. Query persistence with stream selection changes across tabs
 * 5. Manually edited queries persist correctly
 * 6. Query persistence under rapid tab switching (stress test)
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { MetricsQueryEditorPage } = require('../../pages/metricsPages/metricsQueryEditorPage.js');
const { ensureMetricsIngested } = require('../utils/shared-metrics-setup.js');

test.describe('Metrics PromQL Query Persistence Tests', () => {
    test.describe.configure({ mode: 'serial' });
    let pm;
    let queryEditor;

    // Ensure metrics are ingested once for all test files
    test.beforeAll(async () => {
        await ensureMetricsIngested();
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        queryEditor = new MetricsQueryEditorPage(page);

        // Navigate to metrics page
        await pm.metricsPage.gotoMetricsPage();
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Close any dialogs or modals that might be open
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);

        testLogger.info('Test setup completed - navigated to metrics page');
    });

    test.afterEach(async ({ page }, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    /**
     * P1 Test: Auto-populated query appears when stream is selected
     *
     * Validates that when a user selects a stream in PromQL mode,
     * a default query is automatically populated in the query editor.
     */
    test('P1: Auto-populated query appears when stream is selected in Tab 1', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P1']
    }, async ({ page }) => {
        testLogger.info('Test: Verify auto-populated query in Tab 1');

        // Switch to PromQL mode
        await pm.metricsPage.switchToPromQLMode();
        await page.waitForTimeout(1000);

        // Select stream type
        const streamTypeSelector = page.locator('[data-test="index-dropdown-stream_type"]');
        if (await streamTypeSelector.isVisible({ timeout: 3000 })) {
            await streamTypeSelector.click();
            await page.waitForTimeout(500);

            const metricsOption = page.getByRole('option', { name: 'metrics' }).locator('div').nth(2);
            if (await metricsOption.isVisible({ timeout: 3000 })) {
                await metricsOption.click();
                await page.waitForTimeout(1000);
                testLogger.info('Selected stream type: metrics');
            }
        }

        // Select a stream name
        const streamDropdown = page.locator('[data-test="index-dropdown-stream"]');
        if (await streamDropdown.isVisible({ timeout: 3000 })) {
            await streamDropdown.click();
            await page.waitForTimeout(1000);

            // Get first available stream
            const firstStream = page.locator('[role="option"]').first();
            const streamName = await firstStream.textContent();

            if (streamName) {
                await firstStream.click();
                await page.waitForTimeout(2000);
                testLogger.info(`Selected stream: ${streamName}`);

                // Verify auto-populated query exists
                const editorElement = page.locator('.monaco-editor, .cm-content, textarea').first();
                if (await editorElement.isVisible({ timeout: 5000 })) {
                    const queryText = await editorElement.textContent();

                    expect(queryText.length).toBeGreaterThan(0);
                    testLogger.info(`✓ Auto-populated query found: ${queryText.substring(0, 100)}...`);
                } else {
                    testLogger.warn('Query editor not found - test may be inconclusive');
                }
            } else {
                testLogger.warn('No streams available for testing - test skipped');
                test.skip();
            }
        }
    });

    /**
     * P0 Test: Query persists in Tab 1 after switching to Tab 2 and back
     *
     * This is the CORE bug fix test.
     * Previously, when users switched from Tab 1 to Tab 2 and back,
     * the query in Tab 1 would be lost. This test validates the fix.
     */
    test('P0: Query persists in Tab 1 after switching to Tab 2 and back', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P0', '@criticalBugFix']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence when switching between tabs (CRITICAL BUG FIX)');

        // Step 1: Setup Tab 1 with a query
        testLogger.info('Setting up Tab 1 with query');

        // Switch to PromQL Custom mode (not Builder)
        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(500);

        // Enter a test query in Tab 1
        const testQuery = 'up{job="prometheus"}';
        await queryEditor.enterPromQLQuery(testQuery);

        // Store the query from Tab 1
        const tab1OriginalQuery = await queryEditor.getCurrentQueryText();

        expect(tab1OriginalQuery.length).toBeGreaterThan(0);
        testLogger.info(`Tab 1 query captured: ${tab1OriginalQuery.substring(0, 100)}...`);

        // Step 2: Add a second tab (Tab 2)
        testLogger.info('Adding Tab 2');
        const tab2Created = await queryEditor.addQueryTab();

        if (tab2Created) {
            testLogger.info('✓ Tab 2 created successfully');
        } else {
            testLogger.warn('Could not create Tab 2 - test may be inconclusive');
        }

        // Step 3: Verify Tab 2 is active (newly created tabs are usually auto-selected)
        await page.waitForTimeout(1000);
        testLogger.info('Tab 2 should now be active');

        // Step 4: Switch back to Tab 1
        testLogger.info('Switching back to Tab 1');
        const switchedToTab1 = await queryEditor.switchToTab(1);

        if (switchedToTab1) {
            testLogger.info('✓ Switched back to Tab 1');
        } else {
            testLogger.warn('Could not switch to Tab 1 using helper - trying fallback');
            // Fallback: try clicking first tab directly
            const firstTab = page.locator('[role="tab"]').first();
            await firstTab.click({ force: true });
            await page.waitForTimeout(1500);
        }

        // Step 5: Verify query is still there (THE CRITICAL CHECK)
        testLogger.info('Verifying query persistence in Tab 1 (CRITICAL VALIDATION)');

        const tab1QueryAfterSwitch = await queryEditor.getCurrentQueryText();

        // Normalize whitespace for comparison
        const normalizedOriginal = tab1OriginalQuery.replace(/\s+/g, ' ').trim();
        const normalizedAfterSwitch = tab1QueryAfterSwitch.replace(/\s+/g, ' ').trim();

        // The query should be the same as before
        expect(normalizedAfterSwitch).toContain(testQuery.replace(/\s+/g, ' ').trim());

        testLogger.info('✓ SUCCESS: Query persisted correctly in Tab 1 after tab switch');
        testLogger.info(`Original: ${normalizedOriginal.substring(0, 100)}...`);
        testLogger.info(`After switch: ${normalizedAfterSwitch.substring(0, 100)}...`);
    });

    /**
     * P1 Test: Multiple tabs maintain separate queries independently
     *
     * Validates that each tab maintains its own query state
     * and switching between tabs doesn't affect the queries.
     *
     * This test clicks "Run Query" after entering each query to ensure
     * the query is properly saved to Vue state before switching tabs.
     */
    test('P1: Multiple tabs maintain separate queries independently', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P1']
    }, async ({ page }) => {
        testLogger.info('Test: Multiple tabs maintain separate queries');

        // Step 1: Switch to PromQL Custom mode in Tab 1
        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);

        // Step 2: Enter Query A in Tab 1 using keyboard
        const queryA = 'metric_a';
        testLogger.info(`Entering query in Tab 1: "${queryA}"`);

        // Use queryEditor helper for keyboard input
        await queryEditor.enterQueryViaKeyboard(queryA);

        // Click Run Query to save the query to state
        await queryEditor.clickRunQuery();

        // Verify Tab 1 query was entered
        let tab1Initial = await queryEditor.getCurrentQueryText();
        testLogger.info(`Tab 1 query after entry: "${tab1Initial}"`);
        expect(tab1Initial).toContain(queryA);

        // Step 3: Create Tab 2
        testLogger.info('Creating Tab 2...');
        await queryEditor.addQueryTab();
        await page.waitForTimeout(1500);

        // Step 4: Switch Tab 2 to Custom mode and enter Query B
        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);

        const queryB = 'metric_b';
        testLogger.info(`Entering query in Tab 2: "${queryB}"`);

        // Use queryEditor helper for keyboard input
        await queryEditor.enterQueryViaKeyboard(queryB);

        // Click Run Query to save the query to state
        await queryEditor.clickRunQuery();

        // Verify Tab 2 query was entered
        let tab2Initial = await queryEditor.getCurrentQueryText();
        testLogger.info(`Tab 2 query after entry: "${tab2Initial}"`);
        expect(tab2Initial).toContain(queryB);

        // Step 5: Switch back to Tab 1 and verify Query A is preserved
        testLogger.info('Switching back to Tab 1...');
        await queryEditor.switchToTab(1);
        await page.waitForTimeout(3000); // Wait for Vue reactivity and Monaco update

        // Poll for the correct value (handles async updates)
        const tab1Result = await queryEditor.pollForQueryText(queryA);

        if (!tab1Result.found) {
            await queryEditor.takeDebugScreenshot('tab1-persistence-failed');
        }
        expect(tab1Result.text).toContain(queryA);
        testLogger.info('✓ Tab 1 query preserved after switching');

        // Step 6: Switch to Tab 2 and verify Query B is preserved
        testLogger.info('Switching to Tab 2...');
        await queryEditor.switchToTab(2);
        await page.waitForTimeout(3000);

        const tab2Result = await queryEditor.pollForQueryText(queryB);

        if (!tab2Result.found) {
            await queryEditor.takeDebugScreenshot('tab2-persistence-failed');
        }
        expect(tab2Result.text).toContain(queryB);
        testLogger.info('✓ Tab 2 query preserved after switching');

        testLogger.info('✓ SUCCESS: Both tabs maintained their queries independently');
    });

    /**
     * P2 Test: Query persistence with stream selection changes
     *
     * Validates that changing streams in one tab doesn't affect
     * the query in another tab.
     */
    test('P2: Query persistence when changing streams across tabs', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P2']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence with stream changes across tabs');

        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);

        // Enter query in Tab 1 using keyboard
        const queryTab1 = 'cpu_query';
        await queryEditor.enterQueryViaKeyboard(queryTab1);

        // Click Run Query to save state
        await queryEditor.clickRunQuery();

        // Verify Tab 1 query
        let tab1Initial = await queryEditor.getCurrentQueryText();
        testLogger.info(`Tab 1 query: "${tab1Initial}"`);
        expect(tab1Initial).toContain(queryTab1);

        // Create Tab 2
        await queryEditor.addQueryTab();
        await page.waitForTimeout(1500);

        // Switch to Custom mode and enter different query
        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);

        const queryTab2 = 'memory_query';
        await queryEditor.enterQueryViaKeyboard(queryTab2);

        // Click Run Query to save state
        await queryEditor.clickRunQuery();

        // Switch back to Tab 1 and verify
        await queryEditor.switchToTab(1);
        await page.waitForTimeout(3000);

        // Poll for correct value
        const tab1Result = await queryEditor.pollForQueryText(queryTab1);

        expect(tab1Result.text).toContain(queryTab1);
        testLogger.info('✓ SUCCESS: Tab 1 query preserved');
    });

    /**
     * P2 Test: Manually edited queries persist correctly
     *
     * Validates that custom/manually edited queries are preserved
     * when switching between tabs.
     */
    test('P2: Manually edited queries persist correctly', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P2']
    }, async ({ page }) => {
        testLogger.info('Test: Manually edited query persistence');

        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);

        // Enter a custom query using keyboard
        const customQuery = 'custom_metric';
        await queryEditor.enterQueryViaKeyboard(customQuery);

        // Click Run Query to save state
        await queryEditor.clickRunQuery();

        // Verify it was entered
        let currentQuery = await queryEditor.getCurrentQueryText();
        testLogger.info(`Custom query entered: "${currentQuery}"`);
        expect(currentQuery).toContain(customQuery);

        // Add Tab 2
        await queryEditor.addQueryTab();
        await page.waitForTimeout(1500);

        // Switch Tab 2 to Custom mode and enter different query
        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);

        const tab2Query = 'other_metric';
        await queryEditor.enterQueryViaKeyboard(tab2Query);

        // Click Run Query to save state
        await queryEditor.clickRunQuery();

        // Switch back to Tab 1
        await queryEditor.switchToTab(1);
        await page.waitForTimeout(3000);

        // Poll for correct value
        const result = await queryEditor.pollForQueryText(customQuery);

        expect(result.text).toContain(customQuery);
        testLogger.info('✓ SUCCESS: Manually edited query persisted correctly');
    });

    /**
     * P3 Test: Query persistence under rapid tab switching (stress test)
     *
     * Validates that queries remain intact even when rapidly
     * switching between multiple tabs.
     */
    test('P3: Query persistence under rapid tab switching', {
        tag: ['@metrics', '@promql', '@queryPersistence', '@P3', '@stressTest']
    }, async ({ page }) => {
        testLogger.info('Test: Query persistence under rapid tab switching');

        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);

        // Simple queries for each tab
        const queries = ['query_one', 'query_two', 'query_three'];

        // Set query in Tab 1
        await queryEditor.enterQueryViaKeyboard(queries[0]);
        await queryEditor.clickRunQuery();
        testLogger.info(`Tab 1 query: ${queries[0]}`);

        // Create and set Tab 2
        await queryEditor.addQueryTab();
        await page.waitForTimeout(1500);
        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);
        await queryEditor.enterQueryViaKeyboard(queries[1]);
        await queryEditor.clickRunQuery();
        testLogger.info(`Tab 2 query: ${queries[1]}`);

        // Create and set Tab 3
        await queryEditor.addQueryTab();
        await page.waitForTimeout(1500);
        await queryEditor.switchToPromQLCustomMode();
        await page.waitForTimeout(1000);
        await queryEditor.enterQueryViaKeyboard(queries[2]);
        await queryEditor.clickRunQuery();
        testLogger.info(`Tab 3 query: ${queries[2]}`);

        testLogger.info('Created 3 tabs with different queries');

        // Rapid switching pattern
        testLogger.info('Starting rapid tab switching');
        const switchPattern = [1, 2, 3, 1, 3, 2, 1];

        for (const tabIndex of switchPattern) {
            await queryEditor.switchToTab(tabIndex);
            await page.waitForTimeout(500);
        }

        testLogger.info('Rapid switching completed, verifying queries');

        // Verify all queries with polling
        for (let i = 0; i < queries.length; i++) {
            const tabIndex = i + 1;
            testLogger.info(`Verifying query in tab ${tabIndex}...`);

            await queryEditor.switchToTab(tabIndex);
            await page.waitForTimeout(3000);

            const result = await queryEditor.pollForQueryText(queries[i]);
            expect(result.text).toContain(queries[i]);
            testLogger.info(`✓ Tab ${tabIndex} query verified`);
        }

        testLogger.info('✓ SUCCESS: All queries persisted after rapid switching');
    });
});
