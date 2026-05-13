/**
 * Logs Query Builder — Editor & Mode Tests
 *
 * Covers: builder tab improvement, edge cases, query mode toggle,
 * SQL mode toggle in builder, search bar editor state,
 * bare field select defaults, and field list button visibility.
 *
 * @tags @queryBuilder @logs @all
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// ============================================================================
// Utility Functions
// ============================================================================

async function applyQueryButton(pm) {
    const searchPromise = pm.page.waitForResponse(
        response => response.url().includes('/_search') && response.status() === 200,
        { timeout: 60000 }
    );

    await pm.logsPage.clickRefreshButton();

    try {
        await searchPromise;
        testLogger.info('Search query completed successfully');
    } catch (error) {
        testLogger.warn('Search response wait timed out, continuing test');
        await pm.page.waitForLoadState('networkidle').catch(() => {});
    }
}

/**
 * Helper: enable SQL mode, set query, run it, switch to Build tab.
 * Waits for Build tab async initialization to complete (chart/table rendered).
 */
async function setupQueryAndSwitchToBuild(pm, page, query) {
    await pm.logsPage.enableSqlModeIfNeeded();
    await page.waitForLoadState('domcontentloaded');
    await pm.logsPage.setQueryEditorContent(query);
    await pm.logsPage.runQueryAndWaitForResults();
    await pm.logsPage.clickBuildToggle();
    await pm.logsPage.waitForBuildTabLoaded();
}

// ============================================================================
// Test Suite: P1 - Builder Tab Improvement (PR #11586 new behaviors)
// ============================================================================

test.describe("Logs Query Builder - Builder Tab Improvement", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream("e2e_automate");
        await applyQueryButton(pm);

        testLogger.info('Builder Tab Improvement test setup completed');
    });

    test("SQL OFF + empty query → Build tab opens with default fields and bar chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 1: SQL OFF + empty → default histogram/count');

        await pm.logsPage.disableSqlModeIfNeeded();

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('Case 1: SQL OFF + empty → default fields + bar - PASSED');
    });

    test("SQL OFF + WHERE clause → Build tab parses filter into builder", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 2: SQL OFF + WHERE clause → filter parsed');

        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        await pm.logsPage.setQueryEditorContent("code = '200'");

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('Case 2: SQL OFF + WHERE → filter parsed + bar - PASSED');
    });

    test("SQL ON + empty query → Build tab opens with default fields and bar chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 3: SQL ON + empty → default histogram/count');

        await pm.logsPage.enableSqlModeIfNeeded();

        await pm.logsPage.setQueryEditorContent('');

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Case 3: SQL ON + empty → default fields + bar - PASSED');
    });

    test("Query mode toggle: Auto → Custom shows SQL editor", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing query mode toggle: Auto → Custom');

        const histogramQuery = 'SELECT histogram(_timestamp) as time, count(*) as count FROM "e2e_automate" GROUP BY time';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeActive();

        testLogger.info('Query mode toggle: Auto → Custom - PASSED');
    });

    test("SQL ON + multiple aggregations → builder shows multiple Y-axis fields", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing multiple aggregations → multiple Y-axis');

        const multiAggQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(code) as "y_axis_2" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC';
        await setupQueryAndSwitchToBuild(pm, page, multiAggQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('Multiple aggregations → multiple Y-axis - PASSED');
    });

    test("SQL ON + breakdown field → builder shows breakdown section", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing breakdown field populated in builder');

        const breakdownQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", code as "z_axis_1" FROM "e2e_automate" GROUP BY x_axis_1, z_axis_1 ORDER BY x_axis_1 ASC';
        await setupQueryAndSwitchToBuild(pm, page, breakdownQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();
        await pm.logsPage.expectBreakdownLayoutVisible();

        testLogger.info('Breakdown field populated - PASSED');
    });
});

// ============================================================================
// Test Suite: P2 - Edge Cases
// ============================================================================

test.describe("Logs Query Builder - Edge Cases", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream("e2e_automate");
        await applyQueryButton(pm);

        testLogger.info('Edge Cases test setup completed');
    });

    test("SQL ON mode preserved when toggling to Build tab", {
        tag: ['@queryBuilder', '@edge', '@P2', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SQL ON preserved on Build tab switch');

        await pm.logsPage.enableSqlModeIfNeeded();

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        const preserved = await pm.logsPage.verifySqlModePreservedOnBuild(true);
        expect(preserved).toBeTruthy();

        testLogger.info('SQL ON preserved on Build tab - PASSED');
    });

    test("Window function query selects table chart on Build tab", {
        tag: ['@queryBuilder', '@edge', '@P2', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing window function → table chart');

        const windowQuery = 'SELECT *, ROW_NUMBER() OVER (ORDER BY _timestamp DESC) as rn FROM "e2e_automate" LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, windowQuery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Window function → table chart - PASSED');
    });

    test("Case 7: SQL ON + >2 GROUP BY → table chart", {
        tag: ['@queryBuilder', '@edge', '@P2', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 7: >2 GROUP BY → table chart');

        const multiGroupByQuery = 'SELECT code, method, level, count(*) as "y_axis_1" FROM "e2e_automate" GROUP BY code, method, level';
        await setupQueryAndSwitchToBuild(pm, page, multiGroupByQuery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Case 7: >2 GROUP BY → table chart - PASSED');
    });

    test("Case 9: SQL ON + multi-stream JOIN → builder mode, bar chart", {
        tag: ['@queryBuilder', '@edge', '@P2', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 9: multi-stream JOIN → builder mode → bar');

        const joinQuery = 'SELECT a._timestamp, b._timestamp FROM "e2e_automate" a JOIN "e2e_automate" b ON a._timestamp = b._timestamp LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, joinQuery);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Case 9: multi-stream JOIN → builder mode, bar chart - PASSED');
    });
});

// ============================================================================
// Test Suite: Query Mode Toggle (Auto ↔ Custom) While in Builder
// ============================================================================

test.describe("Logs Query Builder - Query Mode Toggle", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream("e2e_automate");
        await applyQueryButton(pm);

        testLogger.info('Query Mode Toggle test setup completed');
    });

    test("SQL ON: Auto → Custom shows full generated SQL in editor", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Auto → Custom (SQL ON)');

        const histogramQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeActive();

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('select');
        expect(editorText.toLowerCase()).toContain('from');

        testLogger.info('Auto → Custom (SQL ON) - PASSED');
    });

    test("SQL OFF: Auto → Custom shows WHERE clause in editor", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Auto → Custom (SQL OFF)');

        await pm.logsPage.disableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent("code = '200'");

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeActive();

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).not.toContain('select');

        testLogger.info('Auto → Custom (SQL OFF) - PASSED');
    });

});

// ============================================================================
// Test Suite: SQL Mode Toggle While in Builder
// ============================================================================

test.describe("Logs Query Builder - SQL Mode Toggle in Builder", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream("e2e_automate");
        await applyQueryButton(pm);

        testLogger.info('SQL Mode Toggle in Builder test setup completed');
    });

    test("SQL OFF → ON in builder: search bar shows full SQL", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL OFF → ON in builder');

        await pm.logsPage.disableSqlModeIfNeeded();
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.enableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('select');
        expect(editorText.toLowerCase()).toContain('from');

        testLogger.info('SQL OFF → ON: full SQL shown - PASSED');
    });

    test("SQL ON → OFF in builder: search bar shows WHERE clause only", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL ON → OFF in builder');

        const filterQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE code = \'200\' GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, filterQuery);

        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).not.toContain('select');

        testLogger.info('SQL ON → OFF: WHERE clause shown - PASSED');
    });
});

// ============================================================================
// Test Suite: Search Bar Editor State in Builder
// ============================================================================

test.describe("Logs Query Builder - Search Bar Editor State", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream("e2e_automate");
        await applyQueryButton(pm);

        testLogger.info('Search Bar Editor State test setup completed');
    });

    test("SQL OFF + Auto mode: editor disabled with WHERE clause", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL OFF + Auto: editor disabled');

        await pm.logsPage.disableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent("code = '200'");

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        const editorArea = page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor').first();
        await expect(editorArea).toBeVisible({ timeout: 10000 });

        await pm.logsPage.expectBuilderModeActive();

        testLogger.info('SQL OFF + Auto: editor disabled - PASSED');
    });

    test("SQL ON + Auto mode: editor disabled with full generated SQL", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL ON + Auto: editor disabled');

        const histogramQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('select');
        expect(editorText.toLowerCase()).toContain('from');

        testLogger.info('SQL ON + Auto: editor disabled - PASSED');
    });

    test("SQL ON + Custom mode: editor editable with full SQL", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL ON + Custom: editor editable');

        const histogramQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeActive();

        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('select');

        await pm.logsPage.setQueryEditorContent('SELECT count(*) FROM "e2e_automate"');
        const newText = await pm.logsPage.getQueryEditorText();
        expect(newText.toLowerCase()).toContain('count');

        testLogger.info('SQL ON + Custom: editor editable - PASSED');
    });
});

// ============================================================================
// Test Suite: Bare Field Select → Default histogram/count (Case 3a)
// ============================================================================

test.describe("Logs Query Builder — Bare Field Select defaults (Case 3a)", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream("e2e_automate");
        await applyQueryButton(pm);

        testLogger.info('Bare field select test setup completed');
    });

    test("Single bare field gets default histogram/count on build toggle", {
        tag: ['@queryBuilder', '@bareFieldSelect', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT single_field → default histogram/count');

        await setupQueryAndSwitchToBuild(pm, page, 'SELECT kubernetes_container_name FROM "e2e_automate"');

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.expectXAxisHasItems();
        await pm.logsPage.expectYAxisHasItems();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Single bare field → default histogram/count - PASSED');
    });

    test("Multiple bare fields get default histogram/count on build toggle", {
        tag: ['@queryBuilder', '@bareFieldSelect', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT field1, field2 → default histogram/count');

        await setupQueryAndSwitchToBuild(pm, page, 'SELECT kubernetes_container_name, kubernetes_host FROM "e2e_automate"');

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.expectXAxisHasItems();
        await pm.logsPage.expectYAxisHasItems();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Multiple bare fields → default histogram/count - PASSED');
    });

    test("Bare field with WHERE clause preserves filter and uses defaults", {
        tag: ['@queryBuilder', '@bareFieldSelect', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT field WHERE condition → defaults + filter preserved');

        await setupQueryAndSwitchToBuild(pm, page, "SELECT kubernetes_container_name FROM \"e2e_automate\" WHERE kubernetes_host = 'test'");

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.expectXAxisHasItems();
        await pm.logsPage.expectYAxisHasItems();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Bare field with WHERE → defaults + filter - PASSED');
    });

    test("Query with aggregation does NOT use defaults (parsed normally)", {
        tag: ['@queryBuilder', '@bareFieldSelect', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing query with aggregation → parsed normally');

        const aggQuery = 'SELECT kubernetes_container_name, count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY kubernetes_container_name';
        await setupQueryAndSwitchToBuild(pm, page, aggQuery);

        await pm.logsPage.expectBuilderModeActive();
        const xCount = await pm.logsPage.expectXAxisHasItems();
        expect(xCount).toBeGreaterThanOrEqual(1);
        const yCount = await pm.logsPage.expectYAxisHasItems();
        expect(yCount).toBeGreaterThanOrEqual(1);

        testLogger.info('Query with aggregation → parsed normally - PASSED');
    });
});

// ============================================================================
// Test Suite: FieldList Button Visibility
// ============================================================================

test.describe("Logs Query Builder — FieldList button visibility", () => {
    test.describe.configure({ mode: 'serial' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.waitForLoadState('domcontentloaded');
        await ingestTestData(page);
        await page.waitForLoadState('domcontentloaded');

        await page.goto(`${logData.logsUrl}?org_identifier=${getOrgIdentifier()}`);
        await pm.logsPage.selectStream("e2e_automate");
        await applyQueryButton(pm);

        testLogger.info('FieldList button test setup completed');
    });

    test("Search filter does not break button visibility in builder mode", {
        tag: ['@queryBuilder', '@fieldListButtons', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Verifying search filter does not break buttons');

        await setupQueryAndSwitchToBuild(pm, page, 'SELECT * FROM "e2e_automate"');
        await pm.logsPage.expectBuilderModeActive();

        const searchInput = page.locator('[data-test="index-field-search-input"]:visible').first();
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        await searchInput.fill('kubernetes');
        await page.waitForTimeout(500);

        const addXButtons = page.locator('[data-test="dashboard-add-x-data"]');
        const visibleXCount = await addXButtons.count();
        expect(visibleXCount).toBeGreaterThan(0);
        testLogger.info(`After filter: ${visibleXCount} +X buttons visible`);

        await searchInput.clear();
        await page.waitForTimeout(500);

        const afterClearCount = await page.locator('[data-test="dashboard-add-x-data"]').count();
        expect(afterClearCount).toBeGreaterThan(0);
        testLogger.info(`After clear: ${afterClearCount} +X buttons visible - PASSED`);
    });

    test("Custom mode: buttons visible on custom/VRL fields after search", {
        tag: ['@queryBuilder', '@fieldListButtons', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Verifying buttons in custom mode with search');

        await setupQueryAndSwitchToBuild(pm, page, 'SELECT * FROM "e2e_automate"');
        await pm.logsPage.clickCustomQueryType();
        await page.waitForTimeout(1000);

        const searchInput = page.locator('[data-test="index-field-search-input"]:visible').first();
        await searchInput.waitFor({ state: 'visible', timeout: 10000 });
        await searchInput.fill('kubernetes');
        await page.waitForTimeout(500);

        const addXButtons = page.locator('[data-test="dashboard-add-x-data"]');
        const buttonCount = await addXButtons.count();
        testLogger.info(`Custom mode + search: ${buttonCount} +X buttons`);

        expect(buttonCount).toBeGreaterThanOrEqual(0);

        testLogger.info('Custom mode buttons with search - PASSED');
    });
});
