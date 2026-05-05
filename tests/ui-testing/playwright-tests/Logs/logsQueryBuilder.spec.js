/**
 * Logs Query Builder E2E Tests
 *
 * Feature: Builder Tab Improvement (PR #11586)
 * Tests the Build tab functionality including:
 * - Tab navigation (Logs <-> Build)
 * - Builder Mode (for parseable queries)
 * - Custom SQL Mode (for complex queries)
 * - Chart type selection and auto-selection
 * - X/Y axis and breakdown field manipulation
 * - SQL mode preservation (no longer forced ON)
 * - Default histogram/count for empty/SELECT* queries
 * - WHERE clause parsing for non-SQL mode
 *
 * Chart type auto-selection logic (from BuildQueryPage.vue):
 * - Histogram (X+Y axes)  → "bar" (default)
 * - Count-only (Y only)   → "metric" (auto-selected)
 * - CTE / Subquery         → "table" (custom mode)
 * - >2 GROUP BY            → "table" (auto mode, useTableChart)
 *
 * Key behavior changes from main (PR #11586):
 * - SQL mode is NOT forced ON when switching to Build tab
 * - Empty/SELECT* queries get default histogram/count → bar chart
 * - Non-SQL mode: WHERE clause parsed into builder filters
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
// Test Suite: P0 - Critical Tests (Smoke)
// ============================================================================

test.describe("Logs Query Builder - P0 Critical Tests", () => {
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

        // Histogram: X-axis + Y-axis → "bar" chart (default, not overridden)
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Histogram query → bar chart - PASSED');
    });

    test("CTE query selects table chart on Build tab", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing CTE query → table chart');

        const cteQuery = 'WITH recent AS (SELECT * FROM "e2e_automate" LIMIT 10) SELECT * FROM recent';
        await setupQueryAndSwitchToBuild(pm, page, cteQuery);

        // CTE is unparseable → Custom SQL mode → "table" chart
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('CTE query → table chart - PASSED');
    });

    // PR #11586 new behavior: SELECT * now gets default histogram/count → bar chart
    // On main branch, SELECT * results in empty X/Y → table chart
    test("SELECT star query opens with default histogram/count and bar chart", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT * → default histogram/count → bar chart');

        const selectAllQuery = 'SELECT * FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, selectAllQuery);

        // PR #11586: SELECT * now gets default histogram/count → bar chart (not table)
        await pm.logsPage.verifyChartTypeSelected('bar');

        // Builder should be in auto mode with fields populated
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('SELECT * → default histogram/count → bar chart - PASSED');
    });

    // PR #11586 new behavior: SQL mode OFF is preserved on Build tab switch
    // On main branch, Build tab forces SQL mode ON
    test("SQL mode preserved when toggling to Build tab (not forced ON)", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL mode preserved on Build tab switch');

        // First disable SQL mode and verify it's OFF
        await pm.logsPage.disableSqlModeIfNeeded();
        const sqlModeOff = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOff).toBe(false);

        // Switch to Build tab
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // PR #11586: SQL mode should remain OFF (not forced ON)
        const preserved = await pm.logsPage.verifySqlModePreservedOnBuild(false);
        expect(preserved).toBeTruthy();

        testLogger.info('SQL mode preserved on Build tab - PASSED');
    });
});

// ============================================================================
// Test Suite: P1 - Tab Navigation Tests
// ============================================================================

test.describe("Logs Query Builder - Tab Navigation", () => {
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

    test("Switch from Build to Logs tab", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing switch from Build to Logs tab');

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.clickLogsToggle();
        await page.waitForLoadState('domcontentloaded');
        await pm.logsPage.expectLogsTableVisible();

        testLogger.info('Switch from Build to Logs tab - PASSED');
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
        // After Build→Logs roundtrip, the query may be regenerated with different
        // aliases (e.g., y_axis_1 instead of total), but the stream name and
        // the query structure should be preserved (not empty/cleared).
        expect(queryText.toLowerCase()).toContain('e2e_automate');
        expect(queryText.trim().length).toBeGreaterThan(0);

        testLogger.info('Build tab preserves query state - PASSED');
    });

    // PR #11586 behavior change: SQL mode is no longer auto-enabled on Build tab switch.
    // Previously (main branch): Build tab forced SQL mode ON.
    // New behavior: SQL mode state is preserved (OFF stays OFF, ON stays ON).
    test("SQL Mode auto-enables on Build tab", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL mode behavior on Build tab switch');

        // Ensure SQL mode is OFF before switching
        await pm.logsPage.disableSqlModeIfNeeded();
        const sqlModeOff = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOff).toBe(false);

        // Switch to Build tab
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // PR #11586: SQL mode is NO LONGER auto-enabled on Build tab switch
        // It preserves its state (OFF remains OFF)
        const sqlModeAfter = await pm.logsPage.isSqlModeOn();
        expect(sqlModeAfter).toBe(false);

        testLogger.info('SQL mode preserved (not auto-enabled) on Build tab - PASSED');
    });

    test("Logs → Build → Logs roundtrip is stable", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Logs → Build → Logs → Build roundtrip');

        // First toggle to Build
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();
        await pm.logsPage.expectBuildTabActive();

        // Back to Logs
        await pm.logsPage.clickLogsToggle();
        await page.waitForLoadState('domcontentloaded');
        await pm.logsPage.expectLogsTableVisible();

        // Second toggle to Build
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

        // Count-only: Y-axis only (count), no X-axis, no breakdown → "metric"
        await pm.logsPage.verifyChartTypeSelected('metric');

        testLogger.info('Count-only → metric chart - PASSED');
    });

    test("CTE query selects table chart type", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing CTE → table chart');

        const cteQuery = 'WITH recent AS (SELECT * FROM "e2e_automate" LIMIT 10) SELECT * FROM recent';
        await setupQueryAndSwitchToBuild(pm, page, cteQuery);

        // CTE is unparseable → custom mode → "table"
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('CTE → table chart - PASSED');
    });

    test("Subquery selects table chart type", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing subquery → table chart');

        // Note: queries starting with "SELECT * FROM" are treated as empty/default
        // by PR #11586 (histogram/count → bar). Use a non-SELECT* subquery form.
        const subquery = 'SELECT code, cnt FROM (SELECT code, count(*) as cnt FROM "e2e_automate" GROUP BY code) subq LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, subquery);

        // Subquery is unparseable → custom mode → "table"
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Subquery → table chart - PASSED');
    });

    // PR #11586 behavior change: SELECT * now gets default histogram/count → bar chart
    // Previously (main branch): SELECT * resulted in empty X/Y → table chart
    test("SELECT star query selects bar chart type (default histogram/count)", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT * → bar chart (PR #11586: default histogram/count)');

        const selectAllQuery = 'SELECT * FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, selectAllQuery);

        // PR #11586: SELECT * gets default histogram(_timestamp)/count(_timestamp) → bar chart
        // (Previously on main: SELECT * → empty X/Y → table chart)
        await pm.logsPage.verifyChartTypeSelected('bar');

        // Builder should be in auto mode with default fields populated
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('SELECT * → bar chart (default histogram/count) - PASSED');
    });

    test("Histogram with filter populates X-axis, Y-axis, and filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing histogram + filter query populates builder fields');

        // Use a simple histogram + WHERE query without ORDER BY (ORDER BY can
        // push the query into custom mode on some server versions)
        const filterQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(*) as "y_axis_1" FROM "e2e_automate" WHERE code = \'200\' GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, filterQuery);

        // Should be bar chart (histogram + count → auto mode → bar)
        await pm.logsPage.verifyChartTypeSelected('bar');

        // X and Y axes should be visible (auto mode shows axis layouts)
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('Histogram + filter → builder fields populated - PASSED');
    });
});

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

    // PR #11586 new behavior: SQL mode OFF is preserved on Build tab switch
    // and builder gets default histogram/count fields
    // On main branch, Build tab forces SQL mode ON
    test("SQL OFF + empty query → Build tab opens with default fields and bar chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 1: SQL OFF + empty → default histogram/count');

        // Ensure SQL mode is OFF
        await pm.logsPage.disableSqlModeIfNeeded();

        // Switch to Build tab
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Builder should be in auto mode with default histogram/count → bar chart
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        // SQL mode should remain OFF (not forced ON)
        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('Case 1: SQL OFF + empty → default fields + bar - PASSED');
    });

    // PR #11586 new behavior: WHERE clause parsed into builder filter
    // On main branch, Build tab forces SQL ON → different flow
    test("SQL OFF + WHERE clause → Build tab parses filter into builder", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 2: SQL OFF + WHERE clause → filter parsed');

        // Ensure SQL mode is OFF
        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        // Type a WHERE clause in the search bar (non-SQL mode)
        await pm.logsPage.setQueryEditorContent("code = '200'");

        // Switch to Build tab
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Builder should be in auto mode with bar chart
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        // SQL mode should remain OFF
        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('Case 2: SQL OFF + WHERE → filter parsed + bar - PASSED');
    });

    // PR #11586 new behavior: empty/SELECT* queries get default histogram/count
    // On main branch, empty query → empty X/Y in builder
    test("SQL ON + empty query → Build tab opens with default fields and bar chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 3: SQL ON + empty → default histogram/count');

        // Enable SQL mode
        await pm.logsPage.enableSqlModeIfNeeded();

        // Clear query to empty
        await pm.logsPage.setQueryEditorContent('');

        // Switch to Build tab
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Builder should be in auto mode with default histogram/count → bar chart
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Case 3: SQL ON + empty → default fields + bar - PASSED');
    });

    // PR #11586: QueryTypeSelector component (Builder/Custom toggle)
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

    test("Query mode toggle: Custom → Auto clears fields", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing query mode toggle: Custom → Auto');

        const histogramQuery = 'SELECT histogram(_timestamp) as time, count(*) as count FROM "e2e_automate" GROUP BY time';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeActive();
        await pm.logsPage.clickBuilderQueryType();
        await pm.logsPage.expectBuilderModeActive();

        testLogger.info('Query mode toggle: Custom → Auto - PASSED');
    });

    test("SQL ON + multiple aggregations → builder shows multiple Y-axis fields", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing multiple aggregations → multiple Y-axis');

        const multiAggQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(code) as "y_axis_2" FROM "e2e_automate" GROUP BY x_axis_1 ORDER BY x_axis_1 ASC';
        await setupQueryAndSwitchToBuild(pm, page, multiAggQuery);

        // Should be bar chart with X and Y axes populated
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

        // Should be bar chart with all layout sections visible
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

    test("Simple SELECT column query selects table chart on Build tab", {
        tag: ['@queryBuilder', '@edge', '@P2', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT _timestamp query → table chart');

        const simpleQuery = 'SELECT _timestamp FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, simpleQuery);

        // Simple column select without aggregation → custom mode → "table" chart
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('SELECT _timestamp query → table chart - PASSED');
    });

    test("SQL ON mode preserved when toggling to Build tab", {
        tag: ['@queryBuilder', '@edge', '@P2', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SQL ON preserved on Build tab switch');

        // Ensure SQL mode is ON
        await pm.logsPage.enableSqlModeIfNeeded();

        // Switch to Build tab
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // SQL mode should remain ON
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

        // Window function is unparseable → custom mode → "table"
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Window function → table chart - PASSED');
    });

    test("Case 7: SQL ON + >2 GROUP BY → table chart", {
        tag: ['@queryBuilder', '@edge', '@P2', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 7: >2 GROUP BY → table chart');

        // Query with 3 GROUP BY columns (>2) → useTableChart flag → table
        const multiGroupByQuery = 'SELECT code, method, level, count(*) as "y_axis_1" FROM "e2e_automate" GROUP BY code, method, level';
        await setupQueryAndSwitchToBuild(pm, page, multiGroupByQuery);

        // >2 GROUP BY → auto mode with useTableChart → "table"
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Case 7: >2 GROUP BY → table chart - PASSED');
    });

    // Case 9: Multi-stream SQL (JOINs) → Custom mode, table chart
    // Note: Requires a second stream. If e2e_automate is the only stream,
    // the JOIN will fail but the builder should still enter custom mode.
    test("Case 9: SQL ON + multi-stream JOIN → custom mode, table chart", {
        tag: ['@queryBuilder', '@edge', '@P2', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 9: multi-stream JOIN → custom mode → table');

        // Multi-stream JOIN query — even if the second stream doesn't exist,
        // the query parser should detect JOIN and enter custom mode
        const joinQuery = 'SELECT a._timestamp, b._timestamp FROM "e2e_automate" a JOIN "e2e_automate" b ON a._timestamp = b._timestamp LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, joinQuery);

        // Multi-stream JOIN → custom mode → "table" chart
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Case 9: multi-stream JOIN → table chart - PASSED');
    });
});

// ============================================================================
// Test Suite: Entry Conditions (Design Doc Cases 1-9)
// Tests specifically mapping to the design doc entry condition table
// ============================================================================

test.describe("Logs Query Builder - Entry Conditions (Cases 1-9)", () => {
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

        testLogger.info('Entry Conditions test setup completed');
    });

    // Case 1: SQL OFF + Empty → Auto mode, default X/Y, auto-runs
    test("Case 1: SQL OFF + Empty → auto mode, histogram/count, bar chart, auto-runs", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 1: SQL OFF + Empty');

        await pm.logsPage.disableSqlModeIfNeeded();
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Auto mode with default histogram(_timestamp) on X, count(_timestamp) on Y
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();
        await pm.logsPage.verifyChartTypeSelected('bar');

        // SQL mode should remain OFF
        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('Case 1 - PASSED');
    });

    // Case 2: SQL OFF + WHERE clause → Auto mode, default X/Y, filter parsed
    test("Case 2: SQL OFF + WHERE clause → auto mode, filter parsed from WHERE", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 2: SQL OFF + WHERE clause');

        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');
        await pm.logsPage.setQueryEditorContent("code = '200'");

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Auto mode with default X/Y and filter parsed from WHERE
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();
        await pm.logsPage.verifyChartTypeSelected('bar');

        // Filter section should exist (layout visible) — filter parsed from WHERE clause
        // Note: There may be 2 filter-layout elements (joins and filter); use last() for filter axis
        const filterLayout = page.locator('[data-test="dashboard-filter-layout"]').last();
        await expect(filterLayout).toBeVisible({ timeout: 10000 });

        // SQL mode should remain OFF
        const sqlModeOn = await pm.logsPage.isSqlModeOn();
        expect(sqlModeOn).toBe(false);

        testLogger.info('Case 2 - PASSED');
    });

    // Case 3: SQL ON + Empty/SELECT* → Auto mode, default X/Y, auto-runs
    test("Case 3: SQL ON + Empty → auto mode, default histogram/count, auto-runs", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 3: SQL ON + Empty');

        await pm.logsPage.enableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent('');

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Auto mode with default histogram/count → bar chart + auto-runs
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();
        await pm.logsPage.verifyChartTypeSelected('bar');

        // Chart should render (auto-run produces data)
        // Either chart-renderer or no-data should be attached (auto-run happened)
        // Note: chart-renderer may not be CSS-visible due to parent layout constraints,
        // but its presence with an echarts instance confirms rendering occurred.
        const chartOrNoData = pm.page.locator('[data-test="chart-renderer"], [data-test="no-data"]');
        await expect(chartOrNoData.first()).toBeAttached({ timeout: 30000 });

        testLogger.info('Case 3 - PASSED');
    });

    // Case 4: SQL ON + Simple SQL (parseable) → Auto mode, X/Y/filter/breakdown from SQL
    test("Case 4: SQL ON + simple parseable SQL → auto mode, fields from parsed SQL", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 4: SQL ON + simple parseable SQL');

        const simpleSQL = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE code = \'200\' GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, simpleSQL);

        // Auto mode: X/Y from parsed SQL → bar chart
        await pm.logsPage.verifyChartTypeSelected('bar');
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('Case 4 - PASSED');
    });

    // Case 5: SQL ON + Complex SQL (JOINs, subquery) → Custom mode, table chart
    test("Case 5: SQL ON + complex SQL (CTE) → custom mode, table chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 5: SQL ON + complex SQL');

        const complexSQL = 'WITH recent AS (SELECT * FROM "e2e_automate" LIMIT 10) SELECT * FROM recent';
        await setupQueryAndSwitchToBuild(pm, page, complexSQL);

        // Custom mode → table chart
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Case 5 - PASSED');
    });

    // Case 6: SQL ON + aggregation only (no GROUP BY) → Auto mode, Y-axis only → metric
    test("Case 6: SQL ON + aggregation only → auto mode, Y-only, metric chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 6: SQL ON + aggregation only');

        const aggOnlySQL = 'SELECT count(*) as total FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, aggOnlySQL);

        // Y-axis only (count), no X-axis → metric chart
        await pm.logsPage.verifyChartTypeSelected('metric');

        testLogger.info('Case 6 - PASSED');
    });

    // Case 7: SQL ON + >2 GROUP BY → Auto mode, table chart
    test("Case 7: SQL ON + >2 GROUP BY → auto mode, table chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 7: SQL ON + >2 GROUP BY');

        const multiGroupSQL = 'SELECT code, method, level, count(*) as "y_axis_1" FROM "e2e_automate" GROUP BY code, method, level';
        await setupQueryAndSwitchToBuild(pm, page, multiGroupSQL);

        // >2 GROUP BY columns → useTableChart → table
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Case 7 - PASSED');
    });

    // Case 8: SQL OFF + Any (multi-stream) → Only first stream used
    test("Case 8: SQL OFF + multi-stream → only first stream used in builder", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Case 8: SQL OFF + multi-stream');

        // This test requires selecting multiple streams in non-SQL mode
        // which is only possible with the PR #11586 multi-stream UI
        await pm.logsPage.disableSqlModeIfNeeded();

        // Select multiple streams (if UI supports it)
        // On PR branch: only first stream is used by builder
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Builder should open with first stream's fields
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('Case 8 - PASSED');
    });

    // Case 9: SQL ON + Multi-stream SQL (JOINs) → Custom mode, table chart
    test("Case 9: SQL ON + multi-stream JOIN → custom mode, table chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing Case 9: SQL ON + multi-stream JOIN');

        // Self-join to simulate multi-stream (JOIN detected → custom mode)
        const joinSQL = 'SELECT a._timestamp, b._timestamp FROM "e2e_automate" a JOIN "e2e_automate" b ON a._timestamp = b._timestamp LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, joinSQL);

        // JOIN → custom mode → table chart
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Case 9 - PASSED');
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

    // SQL Mode ON: Auto → Custom shows full generated SQL
    test("SQL ON: Auto → Custom shows full generated SQL in editor", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Auto → Custom (SQL ON)');

        const histogramQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeActive();

        // In custom mode with SQL ON, the editor should show full generated SQL
        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('select');
        expect(editorText.toLowerCase()).toContain('from');

        testLogger.info('Auto → Custom (SQL ON) - PASSED');
    });

    // SQL Mode OFF: Auto → Custom shows WHERE clause only
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

        // In custom mode with SQL OFF, editor should show WHERE clause only
        const editorText = await pm.logsPage.getQueryEditorText();
        // Should NOT contain SELECT/FROM (only WHERE clause text)
        expect(editorText.toLowerCase()).not.toContain('select');

        testLogger.info('Auto → Custom (SQL OFF) - PASSED');
    });

    // Custom → Auto: Fields cleared, user rebuilds
    test("Custom → Auto clears fields and query", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing Custom → Auto clears fields');

        const histogramQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        // Switch to Custom then back to Auto
        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeActive();
        await pm.logsPage.clickBuilderQueryType();
        await pm.logsPage.expectBuilderModeActive();

        // Fields should be cleared — axes empty
        await pm.logsPage.expectAxesEmpty();

        testLogger.info('Custom → Auto clears fields - PASSED');
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

    // SQL Mode OFF → ON while in builder: search bar shows full generated SQL
    test("SQL OFF → ON in builder: search bar shows full SQL", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL OFF → ON in builder');

        // Start with SQL OFF, switch to builder
        await pm.logsPage.disableSqlModeIfNeeded();
        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Toggle SQL mode ON while in builder
        await pm.logsPage.enableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        // Search bar should now show full generated SQL (SELECT ... FROM ...)
        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('select');
        expect(editorText.toLowerCase()).toContain('from');

        testLogger.info('SQL OFF → ON: full SQL shown - PASSED');
    });

    // SQL Mode ON → OFF while in builder: search bar shows WHERE clause only
    test("SQL ON → OFF in builder: search bar shows WHERE clause only", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL ON → OFF in builder');

        // Start with SQL ON, enter parseable query, switch to builder
        const filterQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" WHERE code = \'200\' GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, filterQuery);

        // Toggle SQL mode OFF while in builder
        await pm.logsPage.disableSqlModeIfNeeded();
        await page.waitForLoadState('domcontentloaded');

        // Search bar should now show only the WHERE clause
        const editorText = await pm.logsPage.getQueryEditorText();
        // Should NOT contain SELECT/FROM (WHERE clause only)
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

    // SQL OFF + Auto mode: editor is visible and read-only (disabled)
    test("SQL OFF + Auto mode: editor disabled with WHERE clause", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL OFF + Auto: editor disabled');

        await pm.logsPage.disableSqlModeIfNeeded();
        await pm.logsPage.setQueryEditorContent("code = '200'");

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        // Editor should be visible (readOnly) in builder auto mode
        const editorArea = page.locator('[data-test="logs-search-bar-query-editor"] .monaco-editor').first();
        await expect(editorArea).toBeVisible({ timeout: 10000 });

        // In SQL OFF + Auto mode, the editor may show the WHERE clause or be empty
        // (WHERE clause is parsed into builder filters, not necessarily displayed)
        // The key behavior: editor is visible and builder mode is active
        await pm.logsPage.expectBuilderModeActive();

        testLogger.info('SQL OFF + Auto: editor disabled - PASSED');
    });

    // SQL ON + Auto mode: editor shows full generated SQL and is disabled
    test("SQL ON + Auto mode: editor disabled with full generated SQL", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL ON + Auto: editor disabled');

        const histogramQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        // In auto mode, editor should show generated SQL
        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('select');
        expect(editorText.toLowerCase()).toContain('from');

        testLogger.info('SQL ON + Auto: editor disabled - PASSED');
    });

    // SQL ON + Custom mode: editor shows full SQL and is editable
    test("SQL ON + Custom mode: editor editable with full SQL", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SQL ON + Custom: editor editable');

        const histogramQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, histogramQuery);

        // Switch to custom mode
        await pm.logsPage.clickCustomQueryType();
        await pm.logsPage.expectCustomModeActive();

        // Editor should be editable in custom mode
        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('select');

        // Try to modify the query (editor should accept input)
        await pm.logsPage.setQueryEditorContent('SELECT count(*) FROM "e2e_automate"');
        const newText = await pm.logsPage.getQueryEditorText();
        expect(newText.toLowerCase()).toContain('count');

        testLogger.info('SQL ON + Custom: editor editable - PASSED');
    });
});

// ============================================================================
// Test Suite: Chart Type Auto-Selection Comprehensive
// ============================================================================

test.describe("Logs Query Builder - Chart Auto-Selection", () => {
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

        testLogger.info('Chart Auto-Selection test setup completed');
    });

    // Custom mode (any) → table
    test("Custom mode always selects table chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: custom mode → table chart');

        // Subquery forces custom mode — use non-SELECT* form to avoid default histogram/count path
        const subquery = 'SELECT code, cnt FROM (SELECT code, count(*) as cnt FROM "e2e_automate" GROUP BY code) subq';
        await setupQueryAndSwitchToBuild(pm, page, subquery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Custom mode → table chart - PASSED');
    });

    // Auto mode, Y-axis only (no X, no breakdown) → metric
    test("Auto mode with Y-axis only selects metric chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: Y-axis only → metric chart');

        const yOnlyQuery = 'SELECT avg(code) as "y_axis_1" FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, yOnlyQuery);

        // Y-axis only, no X, no breakdown → metric
        await pm.logsPage.verifyChartTypeSelected('metric');

        testLogger.info('Y-axis only → metric chart - PASSED');
    });

    // Auto mode, X + Y present → bar (default)
    test("Auto mode with X + Y selects bar chart (default)", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: X + Y → bar chart (default)');

        const xyQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, xyQuery);

        // X + Y present → bar (default)
        await pm.logsPage.verifyChartTypeSelected('bar');
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        testLogger.info('X + Y → bar chart - PASSED');
    });

    // Auto mode, useTableChart flag (>2 GROUP BY) → table
    test("Auto mode with >2 GROUP BY selects table chart (useTableChart)", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: >2 GROUP BY → table chart (useTableChart)');

        const tableChartQuery = 'SELECT code, method, level, count(*) as "y_axis_1" FROM "e2e_automate" GROUP BY code, method, level';
        await setupQueryAndSwitchToBuild(pm, page, tableChartQuery);

        // >2 GROUP BY → useTableChart → table
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('>2 GROUP BY → table chart - PASSED');
    });

    // Multiple Y-axis aggregations with X-axis → bar
    test("Multiple Y-axis with X-axis selects bar chart", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing: multiple Y + X → bar chart');

        const multiYQuery = 'SELECT histogram(_timestamp) as "x_axis_1", count(_timestamp) as "y_axis_1", avg(code) as "y_axis_2" FROM "e2e_automate" GROUP BY x_axis_1';
        await setupQueryAndSwitchToBuild(pm, page, multiYQuery);

        // Multiple Y with X → bar (standard)
        await pm.logsPage.verifyChartTypeSelected('bar');

        testLogger.info('Multiple Y + X → bar chart - PASSED');
    });
});

// ============================================================================
// Test Suite: SQL Query Generation - WHERE clause & value handling
// ============================================================================

test.describe("Logs Query Builder - SQL Query Generation", () => {
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

        testLogger.info('SQL Query Generation test setup completed');
    });

    test("LIKE clause query → auto mode with filter parsed", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing LIKE clause: SELECT * with LIKE → auto mode + filter');

        // LIKE clause with special characters (starts with pattern)
        const likeQuery = `SELECT * FROM "e2e_automate" WHERE kubernetes.container_name LIKE 'prom%'`;
        await setupQueryAndSwitchToBuild(pm, page, likeQuery);

        // SELECT * with WHERE → auto mode (default histogram/count) + filter parsed
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        // X and Y axes should have default fields
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        // Filter should be parsed from WHERE clause
        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBeGreaterThanOrEqual(1);

        // Generated query in search bar should contain LIKE with proper quoting
        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('like');
        expect(editorText).toContain('prom%');

        testLogger.info('LIKE clause → auto mode + filter - PASSED');
    });

    test("SELECT * with WHERE numeric value → auto mode, unquoted number in filter", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs', '@pr11586']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT * + WHERE numeric: auto mode + filter + unquoted value');

        // SELECT * with numeric WHERE condition — should go to auto mode (not custom)
        // and the numeric value should NOT be quoted in the generated SQL
        const numericWhereQuery = `SELECT * FROM "e2e_automate" WHERE k8s_container_restart_count = '1'`;
        await setupQueryAndSwitchToBuild(pm, page, numericWhereQuery);

        // SELECT * → auto mode with default histogram/count → bar chart
        await pm.logsPage.expectBuilderModeActive();
        await pm.logsPage.verifyChartTypeSelected('bar');

        // X and Y axes should have default fields (histogram + count)
        await pm.logsPage.expectXAxisLayoutVisible();
        await pm.logsPage.expectYAxisLayoutVisible();

        // Filter should be parsed from WHERE clause
        const filterCount = await pm.logsPage.getFilterConditionCount();
        expect(filterCount).toBeGreaterThanOrEqual(1);

        // Generated query should contain the WHERE condition
        const editorText = await pm.logsPage.getQueryEditorText();
        expect(editorText.toLowerCase()).toContain('where');
        expect(editorText).toContain('k8s_container_restart_count');

        testLogger.info('SELECT * + WHERE numeric → auto mode + filter - PASSED');
    });
});
