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
        const crossLinkItemA = page.locator(`[data-test="log-details-cross-link-${crossLinkNameA}"]`);
        const crossLinkItemB = page.locator(`[data-test="log-details-cross-link-${crossLinkNameB}"]`);

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
        const crossLinkItemA = page.locator(`[data-test="log-details-cross-link-${crossLinkNameA}"]`);
        const crossLinkItemB = page.locator(`[data-test="log-details-cross-link-${crossLinkNameB}"]`);

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

    // P1: Dashboard table panel — single stream cross-link in drilldown menu
    test("should show cross-link in dashboard table panel drilldown menu for single stream", {
        tag: ['@crossLinking', '@multiStream', '@dashboard', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link in dashboard table panel (single stream)');

        const crossLinkName = `CL-Dash-${Date.now()}`;

        // Step 1: Set up cross-link on Stream A
        const featureEnabled = await setupStreamCrossLink(page, pm, STREAM_A, {
            name: crossLinkName,
            url: 'https://dashboard-single.example.com/?field=${field.__name}&value=${field.__value}&from=${start_time}&to=${end_time}',
            fields: ['kubernetes_container_name']
        });
        if (!featureEnabled) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        // Step 2: Create a dashboard with a table panel using Stream A
        const dashboardName = `CL-Multi-Dash-${Date.now()}`;
        const orgId = process.env["ORGNAME"] || 'default';
        await page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/dashboards?org_identifier=${orgId}`);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);

        await pm.dashboardCreate.createDashboard(dashboardName);
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStream(STREAM_A);
        await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "x");
        await pm.dashboardPanelActions.addPanelName("CrossLink Single Stream Panel");
        await pm.dashboardPanelActions.applyDashboardBtn();
        await page.waitForTimeout(3000);
        await pm.dashboardPanelActions.savePanel();
        await page.waitForTimeout(3000);

        testLogger.info('Dashboard with table panel created');

        // Step 3: Intercept window.open to capture cross-link URL
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.__originalOpen = window.open;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        try {
            // Step 4: Click a data cell in the table panel to trigger drilldown menu
            await page.waitForTimeout(2000);
            await page.evaluate(() => {
                const table = document.querySelector('[data-test="dashboard-panel-table"]');
                if (!table) return;
                const cells = table.querySelectorAll('td');
                for (const cell of cells) {
                    if (cell.offsetParent !== null && cell.textContent.trim()) {
                        cell.click();
                        return;
                    }
                }
            });
            await page.waitForTimeout(1500);

            // Step 5: Verify the crosslink-drilldown-menu appears with the cross-link
            const drilldownMenu = page.locator('.crosslink-drilldown-menu');
            const menuVisible = await drilldownMenu.isVisible().catch(() => false);

            expect(menuVisible, 'Drilldown menu should appear after clicking table cell').toBe(true);
            testLogger.info('Drilldown menu is visible');

            const crossLinkMenuItem = drilldownMenu.locator('.crosslink-drilldown-menu-item').filter({ hasText: crossLinkName });
            const crossLinkMenuVisible = await crossLinkMenuItem.isVisible().catch(() => false);

            expect(crossLinkMenuVisible, `Cross-link "${crossLinkName}" should be visible in drilldown menu`).toBe(true);
            testLogger.info('Cross-link menu item found in dashboard drilldown');

            testLogger.info('PASSED: Single stream cross-link visible in dashboard table panel drilldown');
        } finally {
            await page.evaluate(() => {
                if (window.__originalOpen) window.open = window.__originalOpen;
                delete window.__capturedCrossLinkUrl;
                delete window.__originalOpen;
            });

            // Cleanup: delete the test dashboard
            try {
                await pm.dashboardCreate.backToDashboardList();
                await page.waitForTimeout(1000);
                await pm.dashboardCreate.searchDashboard(dashboardName);
                await page.waitForTimeout(1000);
                await pm.dashboardCreate.deleteDashboard();
                await page.waitForTimeout(1000);
                testLogger.info('Test dashboard deleted');
            } catch (e) {
                testLogger.warn('Dashboard cleanup failed', { error: e.message });
            }
        }
    });

    // P1: Dashboard table panel with UNION ALL SQL + Dynamic Columns — cross-links from both streams
    test("should show cross-links from both streams in dashboard table panel with UNION ALL SQL", {
        tag: ['@crossLinking', '@multiStream', '@dashboard', '@join', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing multi-stream cross-links in dashboard table panel with UNION ALL SQL');

        const crossLinkNameA = `CL-DashA-${Date.now()}`;
        const crossLinkNameB = `CL-DashB-${Date.now()}`;

        // Step 1: Set up cross-links on both streams
        const featureEnabledA = await setupStreamCrossLink(page, pm, STREAM_A, {
            name: crossLinkNameA,
            url: 'https://dash-union-a.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });
        if (!featureEnabledA) {
            test.skip(true, 'Cross-linking feature not enabled');
        }

        const featureEnabledB = await setupStreamCrossLink(page, pm, STREAM_B, {
            name: crossLinkNameB,
            url: 'https://dash-union-b.example.com/${field.__value}',
            fields: ['kubernetes_container_name']
        });
        if (!featureEnabledB) {
            test.skip(true, 'Cross-linking feature not enabled on second stream');
        }

        testLogger.info('Both stream cross-links configured for dashboard UNION test', { crossLinkNameA, crossLinkNameB });

        // Step 2: Create a dashboard with a table panel using custom UNION ALL SQL
        const dashboardName = `CL-Union-Dash-${Date.now()}`;
        const orgId = process.env["ORGNAME"] || 'default';
        await page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/dashboards?org_identifier=${orgId}`);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);

        await pm.dashboardCreate.createDashboard(dashboardName);
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.dashboardPanelActions.addPanelName("CrossLink UNION Panel");

        // Open config sidebar and enable "Allow Dynamic Columns"
        await pm.dashboardPanelConfigs.openConfigPanel();
        await pm.dashboardPanelConfigs.selectDynamicColumns();
        await page.waitForTimeout(500);
        testLogger.info('Allow Dynamic Columns enabled');

        // Switch to Custom SQL mode and enter UNION ALL query
        await page.locator('[data-test="dashboard-sql-query-type"]').click();
        await page.locator('[data-test="dashboard-custom-query-type"]').click();
        await page.waitForTimeout(500);

        const unionQuery = `SELECT * FROM "${STREAM_A}" UNION ALL BY NAME SELECT * FROM "${STREAM_B}" LIMIT 100`;
        await pm.chartTypeSelector.enterCustomSQL(unionQuery);
        await page.waitForTimeout(500);
        testLogger.info('UNION ALL dashboard query entered', { query: unionQuery });

        // Apply query to execute and render the table
        await pm.dashboardPanelActions.applyDashboardBtn();
        await page.waitForTimeout(5000);

        // Track result_schema cross-link responses so we can wait for the dashboard
        // view to finish loading them after save (avoids race condition on CI).
        const crossLinkResponses = [];
        const crossLinkResponseHandler = (response) => {
            if (response.url().includes('result_schema') && response.url().includes('cross_linking=true')) {
                crossLinkResponses.push(Date.now());
            }
        };
        page.on('response', crossLinkResponseHandler);
        const crossLinkCountBeforeSave = crossLinkResponses.length;

        // Save the panel
        await pm.dashboardPanelActions.savePanel();
        await page.waitForTimeout(3000);

        testLogger.info('Dashboard with UNION ALL table panel created');

        // Step 3: Wait for the table panel to render with data in dashboard view
        const tablePanel = page.locator('[data-test="dashboard-panel-table"]');
        await tablePanel.waitFor({ state: 'visible', timeout: 15000 });

        await page.waitForFunction(() => {
            const table = document.querySelector('[data-test="dashboard-panel-table"]');
            if (!table) return false;
            const cells = table.querySelectorAll('td');
            return Array.from(cells).some(cell => cell.offsetParent !== null && cell.textContent.trim());
        }, { timeout: 15000 });
        testLogger.info('Table panel has data rows');

        // Wait for the dashboard view's result_schema cross-link API call to complete.
        // This prevents the race condition on CI where the async fetch hasn't returned
        // by the time the test clicks a table cell and checks the drilldown menu.
        const crossLinkDeadline = Date.now() + 20000;
        while (crossLinkResponses.length <= crossLinkCountBeforeSave && Date.now() < crossLinkDeadline) {
            await page.waitForTimeout(300);
        }
        page.off('response', crossLinkResponseHandler);
        testLogger.info('Cross-link API loaded', { responseCount: crossLinkResponses.length });
        await page.waitForTimeout(500);

        // Step 4: Intercept window.open
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.__originalOpen = window.open;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        try {
            // Step 5: Click a data cell in the table panel
            await page.waitForTimeout(2000);
            await page.evaluate(() => {
                const table = document.querySelector('[data-test="dashboard-panel-table"]');
                if (!table) return;
                const cells = table.querySelectorAll('td');
                for (const cell of cells) {
                    if (cell.offsetParent !== null && cell.textContent.trim()) {
                        cell.click();
                        return;
                    }
                }
            });
            await page.waitForTimeout(1500);

            // Step 6: Verify the crosslink-drilldown-menu appears with BOTH cross-links
            const drilldownMenu = page.locator('.crosslink-drilldown-menu');
            const menuVisible = await drilldownMenu.isVisible().catch(() => false);

            expect(menuVisible, 'Drilldown menu should appear after clicking table cell').toBe(true);
            testLogger.info('Drilldown menu is visible');

            const crossLinkMenuItemA = drilldownMenu.locator('.crosslink-drilldown-menu-item').filter({ hasText: crossLinkNameA });
            const crossLinkMenuItemB = drilldownMenu.locator('.crosslink-drilldown-menu-item').filter({ hasText: crossLinkNameB });

            const hasA = await crossLinkMenuItemA.isVisible().catch(() => false);
            const hasB = await crossLinkMenuItemB.isVisible().catch(() => false);

            testLogger.info('Dashboard UNION ALL cross-link visibility in drilldown', { streamA: hasA, streamB: hasB });

            expect(hasA, `Cross-link "${crossLinkNameA}" from ${STREAM_A} should be visible in dashboard drilldown`).toBe(true);
            expect(hasB, `Cross-link "${crossLinkNameB}" from ${STREAM_B} should be visible in dashboard drilldown`).toBe(true);

            testLogger.info('PASSED: Both streams cross-links visible in dashboard UNION ALL table panel drilldown');
        } finally {
            await page.evaluate(() => {
                if (window.__originalOpen) window.open = window.__originalOpen;
                delete window.__capturedCrossLinkUrl;
                delete window.__originalOpen;
            });

            // Cleanup: delete the test dashboard
            try {
                await pm.dashboardCreate.backToDashboardList();
                await page.waitForTimeout(1000);
                await pm.dashboardCreate.searchDashboard(dashboardName);
                await page.waitForTimeout(1000);
                await pm.dashboardCreate.deleteDashboard();
                await page.waitForTimeout(1000);
                testLogger.info('Test dashboard deleted');
            } catch (e) {
                testLogger.warn('Dashboard cleanup failed', { error: e.message });
            }
        }
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
        const crossLinkItem = page.locator(`[data-test="log-details-cross-link-${crossLinkName}"]`);
        const hasCrossLink = await crossLinkItem.isVisible().catch(() => false);

        testLogger.info('Single-stream cross-link visibility', { visible: hasCrossLink });

        expect(hasCrossLink, `Cross-link "${crossLinkName}" should be visible for single stream`).toBe(true);

        testLogger.info('PASSED: Single-stream cross-link regression verified');
    });
});
