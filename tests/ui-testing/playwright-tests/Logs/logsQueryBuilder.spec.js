/**
 * Logs Query Builder E2E Tests
 *
 * Feature: Auto Query Builder on Logs Page (PR #10305)
 * Tests the Build tab functionality including:
 * - Tab navigation (Logs <-> Build)
 * - Builder Mode (for parseable queries)
 * - Custom SQL Mode (for complex queries)
 * - Chart type selection and auto-selection
 * - X/Y axis and breakdown field manipulation
 *
 * Chart type auto-selection logic (from BuildQueryPage.vue):
 * - Histogram (X+Y axes)  → "bar" (default, not overridden)
 * - Count-only (Y only)   → "metric" (auto-selected)
 * - CTE / Subquery         → "table" (custom mode)
 * - SELECT *               → "table" (custom mode)
 *
 * @tags @queryBuilder @logs @all
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData } = require('../utils/data-ingestion.js');

// ============================================================================
// Utility Functions
// ============================================================================

async function applyQueryButton(pm) {
    const searchPromise = pm.page.waitForResponse(
        response => response.url().includes('/_search') && response.status() === 200,
        { timeout: 60000 }
    );

    // Strategic 1000ms wait for query preparation - this is functionally necessary
    await pm.page.waitForTimeout(1000);
    await pm.logsPage.clickRefreshButton();

    try {
        await searchPromise;
        testLogger.info('Search query completed successfully');
    } catch (error) {
        testLogger.warn('Search response wait timed out, continuing test');
        await pm.page.waitForTimeout(3000);
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

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
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

    test("SELECT star query selects table chart on Build tab", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT * query → table chart');

        const selectAllQuery = 'SELECT * FROM "e2e_automate" LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, selectAllQuery);

        // SELECT * produces empty fields → custom mode → "table" chart
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('SELECT * query → table chart - PASSED');
    });

    test("Simple SELECT column query selects table chart on Build tab", {
        tag: ['@queryBuilder', '@smoke', '@P0', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT _timestamp query → table chart');

        const simpleQuery = 'SELECT _timestamp FROM "e2e_automate"';
        await setupQueryAndSwitchToBuild(pm, page, simpleQuery);

        // Simple column select without aggregation → custom mode → "table" chart
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('SELECT _timestamp query → table chart - PASSED');
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

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
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

    test("SQL Mode auto-enables on Build tab", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SQL Mode auto-enables on Build tab');

        const sqlModeToggle = page.getByRole('switch', { name: 'SQL Mode' });
        const isChecked = await sqlModeToggle.getAttribute('aria-checked');

        if (isChecked === 'true') {
            await sqlModeToggle.click();
            await expect(sqlModeToggle).toHaveAttribute('aria-checked', 'false', { timeout: 5000 });
        }

        expect(await sqlModeToggle.getAttribute('aria-checked')).toBe('false');

        await pm.logsPage.clickBuildToggle();
        await pm.logsPage.waitForBuildTabLoaded();

        await expect(sqlModeToggle).toHaveAttribute('aria-checked', 'true', { timeout: 5000 });

        testLogger.info('SQL Mode auto-enables on Build tab - PASSED');
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
        const hasAggregation = queryText.toLowerCase().includes('count') ||
                               queryText.toLowerCase().includes('total');
        expect(hasAggregation).toBe(true);

        testLogger.info('Build tab preserves query state - PASSED');
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

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
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

    test("SELECT star query selects table chart type", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing SELECT * → table chart');

        const selectAllQuery = 'SELECT * FROM "e2e_automate" LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, selectAllQuery);

        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('SELECT * → table chart - PASSED');
    });

    test("Subquery selects table chart type", {
        tag: ['@queryBuilder', '@functional', '@P1', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Testing subquery → table chart');

        const subquery = 'SELECT * FROM (SELECT code, count(*) as cnt FROM "e2e_automate" GROUP BY code) subq LIMIT 10';
        await setupQueryAndSwitchToBuild(pm, page, subquery);

        // Subquery is unparseable → custom mode → "table"
        await pm.logsPage.verifyChartTypeSelected('table');

        testLogger.info('Subquery → table chart - PASSED');
    });
});
