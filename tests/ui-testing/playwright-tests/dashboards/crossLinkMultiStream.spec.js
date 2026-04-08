const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTestData } = require('../utils/data-ingestion.js');

const STREAM_A = "e2e_automate";
const STREAM_B = "e2e_stream1";

test.describe("Cross-Linking Multi-Stream testcases", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;
    let dataIngested = false;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForTimeout(1000);

        if (!dataIngested) {
            await ingestTestData(page, STREAM_A);
            await ingestTestData(page, STREAM_B);
            await page.waitForTimeout(1000);
            dataIngested = true;
            testLogger.info('Test data ingested into both streams');
        }

        testLogger.info('Test setup completed');
    });

    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
    });

    test.afterAll(async ({ browser }) => {
        testLogger.info('Cleaning up cross-links on both streams after test suite');
        const context = await browser.newContext({
            storageState: 'playwright-tests/utils/auth/user.json'
        });
        const page = await context.newPage();
        try {
            const orgId = process.env["ORGNAME"] || 'default';
            await page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/streams?org_identifier=${orgId}`);
            await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
            const cleanupPm = new PageManager(page);
            await page.waitForTimeout(1000);

            for (const streamName of [STREAM_A, STREAM_B]) {
                try {
                    await cleanupPm.crossLinkPage.navigateToStreams();
                    await cleanupPm.crossLinkPage.searchStream(streamName);
                    await cleanupPm.crossLinkPage.openStreamDetail();

                    const isTabVisible = await cleanupPm.crossLinkPage.isCrossLinkingTabVisible();
                    if (isTabVisible) {
                        await cleanupPm.crossLinkPage.clickCrossLinkingTab();
                        await cleanupPm.crossLinkPage.deleteAllCrossLinks();
                        await cleanupPm.crossLinkPage.clickUpdateSettings();
                        await page.waitForTimeout(2000);
                        testLogger.info(`Cross-links cleaned up for ${streamName}`);
                    }
                } catch (e) {
                    testLogger.warn(`Cleanup failed for ${streamName}`, { error: e.message });
                }
            }
        } catch (e) {
            testLogger.warn('Cleanup failed', { error: e.message });
        } finally {
            await page.close();
            await context.close();
        }
    });

    /**
     * Helper: Set up a cross-link on a stream via the UI.
     * Navigates to the stream schema, opens the cross-linking tab,
     * cleans existing links, adds the new one, and persists.
     */
    async function setupStreamCrossLink(page, pm, streamName, crossLink) {
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(streamName);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            return false;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.deleteAllCrossLinks();
        await pm.crossLinkPage.addCrossLink(crossLink);
        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);
        testLogger.info(`Cross-link "${crossLink.name}" set up on ${streamName}`);
        return true;
    }

    // P0: Multi-stream non-SQL mode — cross-links from both streams appear
    test("should show cross-links from both streams when multiple streams are selected in non-SQL mode", {
        tag: ['@crossLinking', '@multiStream', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing multi-stream cross-links in non-SQL mode');

        const crossLinkNameA = `CL-StreamA-${Date.now()}`;
        const crossLinkNameB = `CL-StreamB-${Date.now()}`;

        // Step 1: Set up cross-link on Stream A
        const featureEnabledA = await setupStreamCrossLink(page, pm, STREAM_A, {
            name: crossLinkNameA,
            url: 'https://stream-a.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });
        if (!featureEnabledA) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        // Step 2: Set up cross-link on Stream B
        const featureEnabledB = await setupStreamCrossLink(page, pm, STREAM_B, {
            name: crossLinkNameB,
            url: 'https://stream-b.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });
        if (!featureEnabledB) {
            test.skip(true, 'Cross-linking feature not enabled on second stream');
        }

        testLogger.info('Both stream cross-links configured', { crossLinkNameA, crossLinkNameB });

        // Step 3: Navigate to logs and select both streams
        await pm.logsPage.selectIndexAndStreamJoinUnion(STREAM_A, STREAM_B);
        await page.waitForTimeout(2000);

        // Disable quick mode for full field visibility
        await pm.logsPage.ensureQuickModeState(false);
        await page.waitForTimeout(1000);

        // Run query
        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(3000);

        // Step 4: Expand a log row to reveal JSON preview
        const expandBtn = page.locator('[data-test="table-row-expand-menu"]').first();
        await expandBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expandBtn.click();
        await page.waitForTimeout(2000);

        // Step 5: Open kubernetes_container_name field action dropdown
        const fieldRow = page.locator('.log_json_content').filter({ hasText: 'kubernetes_container_name' }).first();
        await fieldRow.waitFor({ state: 'visible', timeout: 10000 });
        const fieldActionBtn = fieldRow.locator('[data-test="log-details-include-exclude-field-btn"]');
        await fieldActionBtn.click();
        await page.waitForTimeout(1500);

        // Step 6: Verify BOTH cross-links appear in the dropdown
        const crossLinkItemA = page.locator('.q-menu .q-item, .q-list .q-item').filter({ hasText: crossLinkNameA });
        const crossLinkItemB = page.locator('.q-menu .q-item, .q-list .q-item').filter({ hasText: crossLinkNameB });

        const hasA = await crossLinkItemA.isVisible().catch(() => false);
        const hasB = await crossLinkItemB.isVisible().catch(() => false);

        testLogger.info('Cross-link visibility in dropdown', { streamA: hasA, streamB: hasB });

        expect(hasA, `Cross-link "${crossLinkNameA}" from ${STREAM_A} should be visible`).toBe(true);
        expect(hasB, `Cross-link "${crossLinkNameB}" from ${STREAM_B} should be visible`).toBe(true);

        testLogger.info('PASSED: Both streams cross-links visible in non-SQL multi-stream mode');
    });

    // P0: UNION ALL SQL query — cross-links from both streams via backend merging
    test("should show cross-links from both streams when using UNION ALL SQL query", {
        tag: ['@crossLinking', '@multiStream', '@join', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing multi-stream cross-links with UNION ALL SQL query');

        const crossLinkNameA = `CL-UnionA-${Date.now()}`;
        const crossLinkNameB = `CL-UnionB-${Date.now()}`;

        // Step 1: Set up cross-links on both streams
        const featureEnabledA = await setupStreamCrossLink(page, pm, STREAM_A, {
            name: crossLinkNameA,
            url: 'https://union-a.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });
        if (!featureEnabledA) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        const featureEnabledB = await setupStreamCrossLink(page, pm, STREAM_B, {
            name: crossLinkNameB,
            url: 'https://union-b.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });
        if (!featureEnabledB) {
            test.skip(true, 'Cross-linking feature not enabled on second stream');
        }

        testLogger.info('Both stream cross-links configured for UNION test', { crossLinkNameA, crossLinkNameB });

        // Step 2: Navigate to logs, select both streams, enable SQL mode
        await pm.logsPage.selectIndexAndStreamJoinUnion(STREAM_A, STREAM_B);
        await page.waitForTimeout(2000);

        await pm.logsPage.enableSqlModeIfNeeded();
        await page.waitForTimeout(1000);

        // Step 3: Enter UNION ALL query
        const unionQuery = `SELECT * FROM "${STREAM_A}" UNION ALL BY NAME SELECT * FROM "${STREAM_B}" LIMIT 100`;
        await pm.logsPage.clearAndFillQueryEditor(unionQuery);
        await page.waitForTimeout(500);
        testLogger.info('UNION ALL query entered', { query: unionQuery });

        // Disable quick mode for full field visibility
        await pm.logsPage.ensureQuickModeState(false);
        await page.waitForTimeout(1000);

        // Run query
        await pm.logsPage.selectRunQuery();
        await page.waitForTimeout(3000);

        // Step 4: Expand a log row
        const expandBtn = page.locator('[data-test="table-row-expand-menu"]').first();
        await expandBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expandBtn.click();
        await page.waitForTimeout(2000);

        // Step 5: Open kubernetes_container_name field action dropdown
        const fieldRow = page.locator('.log_json_content').filter({ hasText: 'kubernetes_container_name' }).first();
        await fieldRow.waitFor({ state: 'visible', timeout: 10000 });
        const fieldActionBtn = fieldRow.locator('[data-test="log-details-include-exclude-field-btn"]');
        await fieldActionBtn.click();
        await page.waitForTimeout(1500);

        // Step 6: Verify BOTH cross-links appear (backend merges from both streams)
        const crossLinkItemA = page.locator('.q-menu .q-item, .q-list .q-item').filter({ hasText: crossLinkNameA });
        const crossLinkItemB = page.locator('.q-menu .q-item, .q-list .q-item').filter({ hasText: crossLinkNameB });

        const hasA = await crossLinkItemA.isVisible().catch(() => false);
        const hasB = await crossLinkItemB.isVisible().catch(() => false);

        testLogger.info('UNION ALL cross-link visibility', { streamA: hasA, streamB: hasB });

        expect(hasA, `Cross-link "${crossLinkNameA}" from ${STREAM_A} should be visible in UNION query`).toBe(true);
        expect(hasB, `Cross-link "${crossLinkNameB}" from ${STREAM_B} should be visible in UNION query`).toBe(true);

        testLogger.info('PASSED: Both streams cross-links visible in UNION ALL SQL query');
    });

    // P1: Network verification — multiple result_schema calls for multi-stream
    test("should fire separate result_schema calls for each stream in multi-stream mode", {
        tag: ['@crossLinking', '@multiStream', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing network calls for multi-stream cross-links');

        // Step 1: Navigate to logs and select both streams
        await pm.logsPage.selectIndexAndStreamJoinUnion(STREAM_A, STREAM_B);
        await page.waitForTimeout(2000);

        // Step 2: Set up network interception for result_schema calls
        const resultSchemaRequests = [];
        page.on('request', (request) => {
            const url = request.url();
            if (url.includes('result_schema') && url.includes('cross_linking=true')) {
                resultSchemaRequests.push(url);
            }
        });

        // Step 3: Run query (triggers result_schema calls for cross-links)
        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(3000);

        // Step 4: Verify multiple result_schema calls were fired
        testLogger.info('result_schema calls captured', {
            count: resultSchemaRequests.length,
            urls: resultSchemaRequests
        });

        expect(resultSchemaRequests.length,
            'Should fire at least 2 result_schema calls for 2 streams'
        ).toBeGreaterThanOrEqual(2);

        testLogger.info('PASSED: Multiple result_schema calls verified for multi-stream');
    });

    // P1: Single-stream regression — cross-links still work with one stream
    test("should still show cross-links correctly with single stream (regression)", {
        tag: ['@crossLinking', '@multiStream', '@regression', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing single-stream cross-links regression');

        const crossLinkName = `CL-Single-${Date.now()}`;

        // Step 1: Set up cross-link on Stream A only
        const featureEnabled = await setupStreamCrossLink(page, pm, STREAM_A, {
            name: crossLinkName,
            url: 'https://single.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });
        if (!featureEnabled) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        // Step 2: Navigate to logs, select only Stream A
        await pm.logsPage.navigateToLogs();
        await pm.logsPage.selectStream(STREAM_A);
        await page.waitForTimeout(2000);

        // Disable quick mode
        await pm.logsPage.ensureQuickModeState(false);
        await page.waitForTimeout(1000);

        // Run query
        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(3000);

        // Step 3: Expand a log row
        const expandBtn = page.locator('[data-test="table-row-expand-menu"]').first();
        await expandBtn.waitFor({ state: 'visible', timeout: 15000 });
        await expandBtn.click();
        await page.waitForTimeout(2000);

        // Step 4: Open kubernetes_container_name field action dropdown
        const fieldRow = page.locator('.log_json_content').filter({ hasText: 'kubernetes_container_name' }).first();
        await fieldRow.waitFor({ state: 'visible', timeout: 10000 });
        const fieldActionBtn = fieldRow.locator('[data-test="log-details-include-exclude-field-btn"]');
        await fieldActionBtn.click();
        await page.waitForTimeout(1500);

        // Step 5: Verify cross-link appears
        const crossLinkItem = page.locator('.q-menu .q-item, .q-list .q-item').filter({ hasText: crossLinkName });
        const hasCrossLink = await crossLinkItem.isVisible().catch(() => false);

        testLogger.info('Single-stream cross-link visibility', { visible: hasCrossLink });

        expect(hasCrossLink, `Cross-link "${crossLinkName}" should be visible for single stream`).toBe(true);

        testLogger.info('PASSED: Single-stream cross-link regression verified');
    });
});
