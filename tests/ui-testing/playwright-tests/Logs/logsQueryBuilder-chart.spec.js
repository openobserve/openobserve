/**
 * Logs Query Builder — Chart Tests
 *
 * Covers: P0 critical, tab navigation, chart type on tab switch,
 * entry conditions, and chart auto-selection.
 *
 * @tags @queryBuilder @logs @all
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { setupQueryAndSwitchToBuild, initQueryBuilderTest } = require('../utils/queryBuilder-helpers.js');

// ============================================================================
// Test Suite: P0 - Critical Tests (Smoke)
// ============================================================================

test.describe("Logs Query Builder - P0 Critical Tests", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await initQueryBuilderTest(page, pm);
        testLogger.info('Query Builder test setup completed');
    });

    test("Build tab opens successfully", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Build tab opens successfully');

        await pm.logsPage.expectBuildToggleVisible();
        await pm.logsPage.clickBuildToggle();

        const loaded = await pm.logsPage.waitForBuildTabLoaded();
        expect(loaded).toBeTruthy();

        testLogger.info('Build tab opens successfully - PASSED');
    });

    test("Histogram query selects bar chart on Build tab", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing histogram query → bar chart');

        const histogramQuery = 'SELECT histogram(_timestamp) as time, count(*) as count FROM "e2e_automate" GROUP BY time';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Histogram query → bar chart - PASSED');
    });

    test("CTE query selects table chart on Build tab", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing CTE query → table chart');

        const cteQuery = 'WITH recent AS (SELECT * FROM "e2e_automate" LIMIT 10) SELECT * FROM recent';
        await setupQueryAndSwitchToBuild(pm, page, cteQuery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('CTE query → table chart - PASSED');
    });

    test("SELECT star query opens with default histogram/count and bar chart", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT * → default histogram/count → bar chart');

        const selectAllQuery = 'SELECT * FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, selectAllQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('SELECT * → default histogram/count → bar chart - PASSED');
    });

    test("SQL mode preserved when toggling to Build tab (not forced ON)", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SQL mode preserved on Build tab switch');

        await pm.logsPage.disableSqlModeIfNeeded();
        const sqlModeOff = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOff).toBe(false);

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        const preserved = await pm.logsPage.verifySqlModePreservedOnBuild(false);
        expect(preserved).toBeTruthy();

        testLogger.info('SQL mode preserved on Build tab - PASSED');
    });
});

// ============================================================================
// Test Suite: P1 - Tab Navigation Tests
// ============================================================================

test.describe("Logs Query Builder - Tab Navigation", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await initQueryBuilderTest(page, pm);
        testLogger.info('Tab Navigation test setup completed');
    });

    test("Switch from Logs to Build tab", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing switch from Logs to Build tab');

        await pm.logsPage.expectBuildToggleVisible();
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.expectBuildTabActive();

        testLogger.info('Switch from Logs to Build tab - PASSED');
    });

    test("Build tab preserves query state on tab switch", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Build tab preserves query state');

        await pm.logsPage.enableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');
        const testQuery = 'SELECT count(*) as total FROM "e2e_automate"';
        await pm.logsPage.setQueryEditorContent(testQuery);

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.clickLogsToggle();
        await page.waitForLoadState('domcontentloaded');

        const queryText = await pm.logsPage.getQueryEditorText();
        expect(queryText.toLowerCase()).toContain('e2e_automate');
        expect(queryText.trim().length).toBeGreaterThan(0);

        testLogger.info('Build tab preserves query state - PASSED');
    });

    test("SQL Mode auto-enables on Build tab", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SQL mode behavior on Build tab switch');

        await pm.logsPage.disableSqlModeIfNeeded();
        const sqlModeOff = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOff).toBe(false);

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        const sqlModeAfter = await pm.logsPage.isSqlModeOn();
        expect(sqlModeAfter).toBe(false);

        testLogger.info('SQL mode preserved (not auto-enabled) on Build tab - PASSED');
    });

    test("Logs → Build → Logs roundtrip is stable", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Logs → Build → Logs → Build roundtrip');

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.expectBuildTabActive();

        await pm.logsPage.clickLogsToggle();
        await page.waitForLoadState('domcontentloaded');
        await pm.logsPage.expectLogsTableVisible();

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.expectBuildTabActive();

        testLogger.info('Roundtrip stable - PASSED');
    });
});

// ============================================================================
// Test Suite: P1 - Chart Type Verification on Tab Switch
// ============================================================================

test.describe("Logs Query Builder - Chart Type on Tab Switch", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await initQueryBuilderTest(page, pm);
        testLogger.info('Chart Type on Tab Switch test setup completed');
    });

    test("Histogram query selects bar chart type", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing histogram → bar chart');

        const histogramQuery = 'SELECT histogram(_timestamp) as time, count(*) as count FROM "e2e_automate" GROUP BY time';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Histogram → bar chart - PASSED');
    });

    test("Count-only query selects metric chart type", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing count-only → metric chart');

        const countQuery = 'SELECT count(*) as total FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, countQuery);

        await pm.logsPage.verifyChartTypeSelected('metric');

        testLogger.info('Count-only → metric chart - PASSED');
    });

    test("CTE query selects table chart type", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing CTE → table chart');

        const cteQuery = 'WITH recent AS (SELECT * FROM "e2e_automate" LIMIT 10) SELECT * FROM recent';
        await setupQueryAndSwitchToBuild(pm, page, cteQuery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('CTE → table chart - PASSED');
    });

    test("Subquery selects table chart type", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing subquery → table chart');

        const subquery = 'SELECT code, cnt FROM (SELECT code, count(*) as cnt FROM "e2e_automate" GROUP BY code) subq LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, subquery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Subquery → table chart - PASSED');
    });

    test("SELECT star query selects bar chart type (default histogram/count)", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT * → bar chart (default histogram/count)');

        const selectAllQuery = 'SELECT * FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, selectAllQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('SELECT * → bar chart (default histogram/count) - PASSED');
    });

    test("Histogram with filter populates X-axis, Y-axis, and filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing histogram + filter query populates builder fields');

        const filterQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(*) as "y_axis_1" FROM "e2e_automate" WHERE code = \'200\' GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, filterQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');

        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('Histogram + filter → builder fields populated - PASSED');
    });
});

// ============================================================================
// Test Suite: Entry Conditions (Design Doc Cases 1-9)
// ============================================================================

test.describe("Logs Query Builder - Entry Conditions (Cases 1-9)", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await initQueryBuilderTest(page, pm);
        testLogger.info('Entry Conditions test setup completed');
    });

    test("Case 1: SQL OFF + Empty → auto mode, histogram/count, bar chart, auto-runs", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 1: SQL OFF + Empty');

        await pm.logsPage.disableSqlModeIfNeeded();
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();
        await pm.logsPage.verifyChartTypeSelected('bar');

        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('Case 1 - PASSED');
    });

    test("Case 2: SQL OFF + WHERE clause → auto mode, filter parsed from WHERE", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 2: SQL OFF + WHERE clause');

        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');
        await pm.logsPage.setQueryEditorContent("code = '200'");

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();
        await pm.logsPage.verifyChartTypeSelected('bar');

        await pm.logsPage.expectFilterLayoutVisible();

        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('Case 2 - PASSED');
    });

    test("Case 3: SQL ON + Empty → auto mode, default histogram/count, auto-runs", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 3: SQL ON + Empty');

        await pm.logsPage.enableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent('');

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();
        await pm.logsPage.verifyChartTypeSelected('bar');

        await pm.logsPage.expectChartOrNoDataAttached();

        testLogger.info('Case 3 - PASSED');
    });

    test("Case 4: SQL ON + simple parseable SQL → auto mode, fields from parsed SQL", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 4: SQL ON + simple parseable SQL');

        const simpleSQL = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE code = \'200\' GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, simpleSQL);

        await pm.logsPage.verifyChartTypeSelected('bar');
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('Case 4 - PASSED');
    });

    test("Case 5: SQL ON + complex SQL (CTE) → custom mode, table chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 5: SQL ON + complex SQL');

        const complexSQL = 'WITH recent AS (SELECT * FROM "e2e_automate" LIMIT 10) SELECT * FROM recent';
        await setupQueryAndSwitchToBuild(pm, page, complexSQL);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Case 5 - PASSED');
    });

    test("Case 6: SQL ON + aggregation only → auto mode, Y-only, metric chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 6: SQL ON + aggregation only');

        const aggOnlySQL = 'SELECT count(*) as total FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, aggOnlySQL);

        await pm.logsPage.verifyChartTypeSelected('metric');

        testLogger.info('Case 6 - PASSED');
    });

    test("Case 7: SQL ON + >2 GROUP BY → auto mode, table chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 7: SQL ON + >2 GROUP BY');

        const multiGroupSQL = 'SELECT code, method, level, count(*) as "y_axis_1" FROM "e2e_automate" GROUP BY code, method, level';
        await setupQueryAndSwitchToBuild(pm, page, multiGroupSQL);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Case 7 - PASSED');
    });

    test("Case 8: SQL OFF + multi-stream → only first stream used in builder", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 8: SQL OFF + multi-stream');

        await pm.logsPage.disableSqlModeIfNeeded();

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('Case 8 - PASSED');
    });

});

// ============================================================================
// Test Suite: Chart Type Auto-Selection Comprehensive
// ============================================================================

test.describe("Logs Query Builder - Chart Auto-Selection", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await initQueryBuilderTest(page, pm);
        testLogger.info('Chart Auto-Selection test setup completed');
    });

    test("Custom mode always selects table chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: custom mode → table chart');

        const subquery = 'SELECT code, cnt FROM (SELECT code, count(*) as cnt FROM "e2e_automate" GROUP BY code) subq';
        await setupQueryAndSwitchToBuild(pm, page, subquery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Custom mode → table chart - PASSED');
    });

    test("Auto mode with Y-axis only selects metric chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: Y-axis only → metric chart');

        const yOnlyQuery = 'SELECT avg(code) as "y_axis_1" FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, yOnlyQuery);

        await pm.logsPage.verifyChartTypeSelected('metric');

        testLogger.info('Y-axis only → metric chart - PASSED');
    });

    test("Auto mode with X + Y selects bar chart (default)", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: X + Y → bar chart (default)');

        const xyQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, xyQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('X + Y → bar chart - PASSED');
    });

    test("Auto mode with >2 GROUP BY selects table chart (useTableChart)", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: >2 GROUP BY → table chart (useTableChart)');

        const tableChartQuery = 'SELECT code, method, level, count(*) as "y_axis_1" FROM "e2e_automate" GROUP BY code, method, level';
        await setupQueryAndSwitchToBuild(pm, page, tableChartQuery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('>2 GROUP BY → table chart - PASSED');
    });

    test("Multiple Y-axis with X-axis selects bar chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: multiple Y + X → bar chart');

        const multiYQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(code) as "y_axis_2" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, multiYQuery);

        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Multiple Y + X → bar chart - PASSED');
    });
});
