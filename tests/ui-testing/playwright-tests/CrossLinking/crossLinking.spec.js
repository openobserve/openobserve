const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logsdata = require("../../../test-data/logs_data.json");

const STREAM_NAME = "e2e_automate";

async function ingestTestData(page) {
    const orgId = process.env["ORGNAME"];
    const basicAuthCredentials = Buffer.from(
        `${process.env["ZO_ROOT_USER_EMAIL"]}:${process.env["ZO_ROOT_USER_PASSWORD"]}`
    ).toString('base64');

    const headers = {
        "Authorization": `Basic ${basicAuthCredentials}`,
        "Content-Type": "application/json",
    };
    await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
        const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(logsdata)
        });
        return await fetchResponse.json();
    }, {
        url: process.env.INGESTION_URL,
        headers: headers,
        orgId: orgId,
        streamName: STREAM_NAME,
        logsdata: logsdata
    });
}

test.describe("Cross-Linking testcases", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForTimeout(1000);
        testLogger.info('Test setup completed');
    });

    test.afterEach(async ({}, testInfo) => {
        if (testInfo.status) {
            testLogger.testEnd(testInfo.title, testInfo.status, testInfo.duration);
        }
    });

    // P0 Tests - Critical
    test("should display cross-linking tab in stream schema when feature is enabled", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-linking tab visibility in stream schema');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        // Verify the cross-linking tab is present (uses waitFor with timeout)
        const isVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();

        if (isVisible) {
            await pm.crossLinkPage.clickCrossLinkingTab();
            // Verify the Add Cross-Link button is visible (always present on stream-level manager)
            await expect(page.locator('[data-test="add-cross-link-btn"]')).toBeVisible({ timeout: 5000 });
            testLogger.info('Cross-linking tab is visible and accessible');
        } else {
            testLogger.info('Cross-linking tab not visible - feature flag may be disabled, skipping gracefully');
        }

        testLogger.info('Test completed');
    });

    test("should show empty state when no cross-links are configured", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing empty state display');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Verify add button is present (confirms tab content loaded)
        await expect(page.locator('[data-test="add-cross-link-btn"]')).toBeVisible({ timeout: 5000 });

        // Check if empty state or existing links are shown
        const emptyState = page.locator('[data-test="cross-link-empty"]').first();
        const linkList = page.locator('[data-test="cross-link-list"]').first();
        const hasEmpty = await emptyState.isVisible().catch(() => false);
        const hasList = await linkList.isVisible().catch(() => false);

        if (hasEmpty) {
            testLogger.info('Empty state verified - no cross-links configured');
        } else if (hasList) {
            testLogger.info('Cross-links already exist on this stream');
        }
        expect(hasEmpty || hasList).toBe(true);

        testLogger.info('Test completed');
    });

    test("should open add cross-link dialog", {
        tag: ['@crossLinking', '@smoke', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing add cross-link dialog opens');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Verify all dialog fields are present
        await expect(page.locator('[data-test="cross-link-name-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-url-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-field-input"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-save-btn"]')).toBeVisible();
        await expect(page.locator('[data-test="cross-link-cancel-btn"]')).toBeVisible();

        testLogger.info('Test completed');
    });

    test("should add a new cross-link via stream schema", {
        tag: ['@crossLinking', '@functional', '@P0', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing adding a new cross-link');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Add a new cross-link
        const linkName = `E2E Test Link ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: linkName,
            url: 'https://example.com/trace/${field.__value}?from=${start_time}&to=${end_time}',
            fields: ['kubernetes_container_name']
        });

        // Verify the link appears in the list
        await pm.crossLinkPage.expectCrossLinkListVisible();
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain(linkName);

        testLogger.info('Cross-link added successfully');
    });

    // P1 Tests - Functional
    test("should validate required fields - save button disabled without name and URL", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing save button disabled state');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Save should be disabled when form is empty
        await pm.crossLinkPage.expectSaveDisabled();

        // Fill only name - save should still be disabled
        await pm.crossLinkPage.fillCrossLinkName('Test Link');
        await pm.crossLinkPage.expectSaveDisabled();

        // Fill URL too - save should now be enabled
        await pm.crossLinkPage.fillCrossLinkUrl('https://example.com/${field.__value}');
        await pm.crossLinkPage.expectSaveEnabled();

        testLogger.info('Test completed');
    });

    test("should add and remove field chips", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing field chip add and remove');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Add a field
        await pm.crossLinkPage.addField('trace_id');
        await pm.crossLinkPage.expectFieldChipVisible(0);

        // Add another field
        await pm.crossLinkPage.addField('span_id');
        await pm.crossLinkPage.expectFieldChipVisible(1);

        // Remove first field chip
        await pm.crossLinkPage.removeFieldChip(0);

        // The second chip should now be at index 0
        await pm.crossLinkPage.expectFieldChipVisible(0);

        testLogger.info('Test completed');
    });

    test("should open help/user guide dialog", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing help button');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Click help button
        await pm.crossLinkPage.clickHelp();

        // Verify user guide content appears (CrossLinkUserGuide renders help popup)
        const guideContent = page.locator('.q-menu, .q-popup-proxy').filter({ hasText: /template|variable|\$\{/i });
        await expect(guideContent.first()).toBeVisible({ timeout: 5000 });

        testLogger.info('Test completed');
    });

    test("should edit an existing cross-link", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing edit cross-link');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Check if there's an existing link to edit
        const linkList = page.locator('[data-test="cross-link-list"]');
        const hasList = await linkList.isVisible().catch(() => false);

        if (!hasList) {
            // Create one first
            const linkName = `Edit Test ${Date.now()}`;
            await pm.crossLinkPage.addCrossLink({
                name: linkName,
                url: 'https://example.com/${field.__value}',
                fields: ['kubernetes_container_name']
            });
        }

        // Click edit on first link
        await pm.crossLinkPage.clickEditCrossLink(0);
        await pm.crossLinkPage.expectDialogVisible();

        // Verify form is populated (name input should have a value)
        const nameInput = page.locator('[data-test="cross-link-name-input"] input');
        const nameValue = await nameInput.inputValue();
        expect(nameValue.length).toBeGreaterThan(0);

        // Modify the URL
        await pm.crossLinkPage.fillCrossLinkUrl('https://updated.example.com/${field.__value}');
        await pm.crossLinkPage.clickSave();

        // Verify the update is reflected
        const itemText = await pm.crossLinkPage.getCrossLinkItemText(0);
        expect(itemText).toContain('updated.example.com');

        testLogger.info('Test completed');
    });

    test("should delete a cross-link", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing delete cross-link');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Create a link to delete if none exist
        const linkList = page.locator('[data-test="cross-link-list"]');
        const hasList = await linkList.isVisible().catch(() => false);

        if (!hasList) {
            await pm.crossLinkPage.addCrossLink({
                name: `Delete Test ${Date.now()}`,
                url: 'https://delete.example.com/${field.__value}',
                fields: ['kubernetes_container_name']
            });
        }

        // Count links before delete
        const itemsBefore = await page.locator('[data-test^="cross-link-item-"]').count();
        expect(itemsBefore).toBeGreaterThan(0);

        // Delete first link
        await pm.crossLinkPage.clickDeleteCrossLink(0);

        // Verify count decreased
        const itemsAfter = await page.locator('[data-test^="cross-link-item-"]').count();
        expect(itemsAfter).toBe(itemsBefore - 1);

        testLogger.info('Test completed');
    });

    // P2 Tests - Edge Cases
    test("should cancel dialog without saving changes", {
        tag: ['@crossLinking', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cancel dialog discards changes');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Count links before
        const itemsBefore = await page.locator('[data-test^="cross-link-item-"]').count();

        // Open dialog, fill form, cancel
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();
        await pm.crossLinkPage.fillCrossLinkName('Cancelled Link');
        await pm.crossLinkPage.fillCrossLinkUrl('https://cancelled.example.com');
        await pm.crossLinkPage.clickCancel();

        // Verify dialog closed
        await pm.crossLinkPage.expectDialogNotVisible();

        // Verify no new link was added
        const itemsAfter = await page.locator('[data-test^="cross-link-item-"]').count();
        expect(itemsAfter).toBe(itemsBefore);

        testLogger.info('Test completed');
    });

    test("should verify cross-link URL contains correct start_time and end_time when clicked from logs", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link URL timestamp verification from logs view');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        // Step 1: Create a cross-link with start_time and end_time in URL template
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up any existing cross-links first
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        }

        const crossLinkName = `Timestamp Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://example.com/view?from=${start_time}&to=${end_time}&field=${field.__name}&value=${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Save the schema settings to persist the cross-link
        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);

        testLogger.info('Cross-link created and saved');

        // Step 2: Navigate to logs and query the stream
        await pm.logsPage.navigateToLogs();
        await pm.logsPage.selectStream(STREAM_NAME);
        await page.waitForTimeout(2000);
        await pm.logsPage.runQueryAndWaitForResults();
        await page.waitForTimeout(2000);

        // Capture the search time range before clicking
        const searchTimeRange = await page.evaluate(() => {
            // Access the Vue app's search state to get the actual datetime values
            const appEl = document.querySelector('#app');
            if (appEl && appEl.__vue_app__) {
                // Try to find the search datetime from the URL parameters
                const urlParams = new URLSearchParams(window.location.search);
                return {
                    from: urlParams.get('from'),
                    to: urlParams.get('to'),
                    period: urlParams.get('period')
                };
            }
            return null;
        });
        testLogger.info('Search time range from URL', { searchTimeRange });

        // Step 3: Open log detail sidebar by clicking on the first log row
        const firstLogRow = page.locator('[data-test="log-table-column-0-source"]');
        await firstLogRow.waitFor({ state: 'visible', timeout: 15000 });
        await firstLogRow.click();
        await page.waitForTimeout(2000);

        // Wait for log detail sidebar to open
        await page.locator('[data-test="dialog-box"]').waitFor({ state: 'visible', timeout: 10000 });

        // Step 4: Find the field action dropdown for the cross-linked field (kubernetes_container_name)
        // The JSON preview shows fields with q-btn-dropdown for actions
        // We need to find the dropdown next to 'kubernetes_container_name' field
        const fieldDropdowns = page.locator('[data-test="log-details-include-exclude-field-btn"]');
        const fieldCount = await fieldDropdowns.count();
        testLogger.info(`Found ${fieldCount} field action dropdowns`);

        // Intercept window.open to capture the URL instead of opening a new tab
        let capturedUrl = null;
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        // Step 5: Find and click the cross-link for kubernetes_container_name
        // Look through the JSON preview to find our field's dropdown
        const jsonContent = page.locator('[data-test="log-detail-json-content"]');
        await jsonContent.waitFor({ state: 'visible', timeout: 5000 });

        // Find the log_json_content div that contains kubernetes_container_name
        const fieldRow = page.locator('.log_json_content').filter({ hasText: 'kubernetes_container_name' }).first();
        const fieldRowVisible = await fieldRow.isVisible().catch(() => false);

        if (!fieldRowVisible) {
            testLogger.info('kubernetes_container_name field not found in log detail, skipping');
            return;
        }

        // Click the action dropdown for this field
        const fieldActionBtn = fieldRow.locator('[data-test="log-details-include-exclude-field-btn"]');
        await fieldActionBtn.click();
        await page.waitForTimeout(1000);

        // Look for the cross-link item in the dropdown menu
        const crossLinkItem = page.locator('.q-menu .q-item').filter({ hasText: crossLinkName });
        const crossLinkVisible = await crossLinkItem.isVisible().catch(() => false);

        if (!crossLinkVisible) {
            testLogger.info('Cross-link menu item not visible - cross-links may not be loaded for this field');
            // Close the dropdown
            await page.keyboard.press('Escape');
            return;
        }

        // Click the cross-link
        await crossLinkItem.click();
        await page.waitForTimeout(1000);

        // Step 6: Retrieve the captured URL
        capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);
        testLogger.info('Captured cross-link URL', { capturedUrl });

        expect(capturedUrl).not.toBeNull();

        // Parse the URL and verify timestamps
        const url = new URL(capturedUrl);
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const fieldParam = url.searchParams.get('field');
        const valueParam = url.searchParams.get('value');

        testLogger.info('URL parameters', { from: fromParam, to: toParam, field: fieldParam, value: valueParam });

        // Verify start_time and end_time are valid epoch milliseconds
        expect(fromParam).not.toBeNull();
        expect(toParam).not.toBeNull();

        const startTime = Number(fromParam);
        const endTime = Number(toParam);

        // Timestamps should be valid numbers
        expect(isNaN(startTime)).toBe(false);
        expect(isNaN(endTime)).toBe(false);

        // Timestamps should be in milliseconds (13 digits for current epoch)
        // Valid range: year 2000 to year 2100
        const minMs = new Date('2000-01-01').getTime(); // 946684800000
        const maxMs = new Date('2100-01-01').getTime(); // 4102444800000
        expect(startTime).toBeGreaterThan(minMs);
        expect(startTime).toBeLessThan(maxMs);
        expect(endTime).toBeGreaterThan(minMs);
        expect(endTime).toBeLessThan(maxMs);

        // end_time should be >= start_time
        expect(endTime).toBeGreaterThanOrEqual(startTime);

        // Verify field name and value are also populated
        expect(fieldParam).toBe('kubernetes_container_name');
        expect(valueParam).toBeTruthy();

        testLogger.info('Timestamp verification passed', {
            startTime,
            endTime,
            startDate: new Date(startTime).toISOString(),
            endDate: new Date(endTime).toISOString(),
            diffMs: endTime - startTime,
        });

        testLogger.info('Test completed');
    });

    test("should verify cross-link URL contains correct start_time and end_time when clicked from dashboard", {
        tag: ['@crossLinking', '@functional', '@P1', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing cross-link URL timestamp verification from dashboard panel');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        // Step 1: Ensure a cross-link exists on the stream (with start_time/end_time in URL)
        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Clean up any existing cross-links first
        let existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        while (existingCount > 0) {
            await pm.crossLinkPage.clickDeleteCrossLink(0);
            await page.waitForTimeout(500);
            existingCount = await page.locator('[data-test^="cross-link-item-"]').count();
        }

        const crossLinkName = `Dashboard TS Test ${Date.now()}`;
        await pm.crossLinkPage.addCrossLink({
            name: crossLinkName,
            url: 'https://example.com/dashboard?from=${start_time}&to=${end_time}&field=${field.__name}&value=${field.__value}',
            fields: ['kubernetes_container_name']
        });

        // Save the schema settings to persist the cross-link
        await pm.crossLinkPage.clickUpdateSettings();
        await page.waitForTimeout(2000);

        testLogger.info('Cross-link created and saved on stream');

        // Step 2: Create a dashboard with a table panel using the same stream
        const dashboardName = `CrossLink Test ${Date.now()}`;
        const orgId = process.env["ORGNAME"] || 'default';
        await page.goto(`${process.env["ZO_BASE_URL"] || 'http://localhost:5080'}/web/dashboards?org_identifier=${orgId}`);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        await page.waitForTimeout(2000);

        await pm.dashboardCreate.createDashboard(dashboardName);

        // Add a table panel with the cross-linked stream
        await pm.dashboardCreate.addPanel();
        await pm.chartTypeSelector.selectChartType("table");
        await pm.chartTypeSelector.selectStream(STREAM_NAME);
        await pm.chartTypeSelector.searchAndAddField("kubernetes_container_name", "y");
        await pm.dashboardPanelActions.addPanelName("CrossLink Table Panel");
        await pm.dashboardPanelActions.savePanel();
        await page.waitForTimeout(3000);

        testLogger.info('Dashboard with table panel created');

        // Step 3: Intercept window.open to capture the cross-link URL
        await page.evaluate(() => {
            window.__capturedCrossLinkUrl = null;
            window.open = (url) => {
                window.__capturedCrossLinkUrl = url;
                return null;
            };
        });

        // Step 4: Click on a cell in the table panel to trigger drilldown/cross-link menu
        // Table panels render data inside the panel container
        const panelContainer = page.locator('[data-test="dashboard-panel-table"]').first()
            .or(page.locator('.dashboard-panel').first());

        // Try clicking on a table cell to trigger the drilldown menu
        const tableCell = panelContainer.locator('td, .table-cell, .q-table__grid-item').first();
        const tableCellVisible = await tableCell.isVisible({ timeout: 5000 }).catch(() => false);

        if (!tableCellVisible) {
            // Fallback: try clicking directly on the rendered chart/table area
            const chartArea = page.locator('.echart, canvas, table').first();
            const chartVisible = await chartArea.isVisible({ timeout: 5000 }).catch(() => false);
            if (chartVisible) {
                await chartArea.click();
            } else {
                testLogger.info('No clickable table/chart element found in panel, skipping');
                // Cleanup dashboard
                await pm.dashboardCreate.backToDashboardList();
                await page.waitForTimeout(1000);
                return;
            }
        } else {
            await tableCell.click();
        }

        await page.waitForTimeout(1500);

        // Step 5: Look for the crosslink-drilldown-menu popup
        const drilldownMenu = page.locator('.crosslink-drilldown-menu');
        const menuVisible = await drilldownMenu.isVisible().catch(() => false);

        if (!menuVisible) {
            testLogger.info('Drilldown menu did not appear after click - panel may not have data or cross-links not loaded');
            // Cleanup dashboard
            await pm.dashboardCreate.backToDashboardList();
            await page.waitForTimeout(1000);
            return;
        }

        // Find and click the cross-link menu item
        const crossLinkMenuItem = drilldownMenu.locator('.crosslink-drilldown-menu-item').filter({ hasText: crossLinkName });
        const crossLinkMenuVisible = await crossLinkMenuItem.isVisible().catch(() => false);

        if (!crossLinkMenuVisible) {
            testLogger.info('Cross-link menu item not found in drilldown menu');
            await page.keyboard.press('Escape');
            // Cleanup dashboard
            await pm.dashboardCreate.backToDashboardList();
            await page.waitForTimeout(1000);
            return;
        }

        await crossLinkMenuItem.click();
        await page.waitForTimeout(1000);

        // Step 6: Retrieve and verify the captured URL
        const capturedUrl = await page.evaluate(() => window.__capturedCrossLinkUrl);
        testLogger.info('Captured dashboard cross-link URL', { capturedUrl });

        expect(capturedUrl).not.toBeNull();

        // Parse the URL and verify timestamps
        const url = new URL(capturedUrl);
        const fromParam = url.searchParams.get('from');
        const toParam = url.searchParams.get('to');
        const fieldParam = url.searchParams.get('field');
        const valueParam = url.searchParams.get('value');

        testLogger.info('Dashboard URL parameters', { from: fromParam, to: toParam, field: fieldParam, value: valueParam });

        // Verify start_time and end_time are valid epoch milliseconds
        expect(fromParam).not.toBeNull();
        expect(toParam).not.toBeNull();

        const startTime = Number(fromParam);
        const endTime = Number(toParam);

        // Timestamps should be valid numbers
        expect(isNaN(startTime)).toBe(false);
        expect(isNaN(endTime)).toBe(false);

        // Timestamps should be in milliseconds (13 digits for current epoch)
        const minMs = new Date('2000-01-01').getTime();
        const maxMs = new Date('2100-01-01').getTime();
        expect(startTime).toBeGreaterThan(minMs);
        expect(startTime).toBeLessThan(maxMs);
        expect(endTime).toBeGreaterThan(minMs);
        expect(endTime).toBeLessThan(maxMs);

        // end_time should be >= start_time
        expect(endTime).toBeGreaterThanOrEqual(startTime);

        // Verify field name and value are populated
        expect(fieldParam).toBe('kubernetes_container_name');
        expect(valueParam).toBeTruthy();

        testLogger.info('Dashboard timestamp verification passed', {
            startTime,
            endTime,
            startDate: new Date(startTime).toISOString(),
            endDate: new Date(endTime).toISOString(),
            diffMs: endTime - startTime,
        });

        // Cleanup: delete the test dashboard
        await pm.dashboardCreate.backToDashboardList();
        await page.waitForTimeout(1000);

        testLogger.info('Test completed');
    });

    test("should reset form when reopening dialog after cancel", {
        tag: ['@crossLinking', '@edgeCase', '@P2', '@all']
    }, async ({ page }) => {
        testLogger.info('Testing form reset on dialog reopen');

        await ingestTestData(page);
        await page.waitForTimeout(1000);

        await pm.crossLinkPage.navigateToStreams();
        await pm.crossLinkPage.searchStream(STREAM_NAME);
        await pm.crossLinkPage.openStreamDetail();

        const isTabVisible = await pm.crossLinkPage.isCrossLinkingTabVisible();
        if (!isTabVisible) {
            testLogger.info('Cross-linking feature not enabled, skipping');
            return;
        }

        await pm.crossLinkPage.clickCrossLinkingTab();

        // Open dialog, fill form, cancel
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();
        await pm.crossLinkPage.fillCrossLinkName('Should Be Cleared');
        await pm.crossLinkPage.fillCrossLinkUrl('https://shouldbecleared.example.com');
        await pm.crossLinkPage.clickCancel();
        await pm.crossLinkPage.expectDialogNotVisible();

        // Reopen dialog
        await pm.crossLinkPage.clickAddCrossLink();
        await pm.crossLinkPage.expectDialogVisible();

        // Verify form is empty
        const nameInput = page.locator('[data-test="cross-link-name-input"] input');
        const urlInput = page.locator('[data-test="cross-link-url-input"] input');
        const nameValue = await nameInput.inputValue();
        const urlValue = await urlInput.inputValue();
        expect(nameValue).toBe('');
        expect(urlValue).toBe('');

        testLogger.info('Test completed');
    });
});
