/**
 * Dashboards panel custom SQL: the menu works on a fresh page load, and a text
 * column named in SELECT keeps its type, so its values are quoted.
 *
 * Each row reads ZO_EDITOR_SUGGEST_MODE from the page, so the file runs once per mode.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestCustomData, waitForStreamData } = require('../utils/data-ingestion.js');
const { setupTestDashboard, deleteDashboard } = require('./utils/dashCreation.js');
const {
    openDashboardCustomSql,
    waitForMenu,
    waitForMenuRow,
    menuState,
} = require('../utils/suggest-menu-helpers.js');

const STREAM = 'e2e_ac_dash_values';
// Utf8 values that look like numbers: quoting them by their look instead of the column type breaks the query.
const RECORDS = ['200', '404', '500'].flatMap((status) =>
    Array.from({ length: 4 }, (_, i) => ({ status_text: status, service_tier: `tier-${i}` })),
);
const QUOTED = /^'(200|404|500)'$/;
const BARE = /^(200|404|500)$/;

test.describe('Dashboards custom SQL autocomplete', () => {
    test.describe.configure({ mode: 'serial' });
    let ingested = false;
    let pm;
    let name;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        if (!ingested) {
            const result = await ingestCustomData(page, STREAM, RECORDS);
            expect(result.status, 'custom stream ingested').toBe(200);
            await waitForStreamData(page, STREAM, RECORDS.length);
            ingested = true;
        }
        name = `AC_Values_${Date.now()}_${testInfo.repeatEachIndex}`;
        await setupTestDashboard(page, pm, name);
    });

    test.afterEach(async ({ page }) => {
        await pm.dashboardSqlAutocomplete.dismissAutocompleteAndBlur();
        await pm.dashboardSqlAutocomplete.discardPanelIfVisible();
        await pm.dashboardCreate.backToDashboardList();
        await deleteDashboard(page, name);
    });

    test('a dashboard opened by URL on a fresh page load still opens the menu', {
        tag: ['@all', '@autosuggestions', '@dashboard', '@sqlautocomplete', '@freshload'],
    }, async ({ page }) => {
        const dashboardUrl = page.url();
        expect(dashboardUrl).toContain('/dashboards/view');
        const serviceErrors = [];
        page.on('console', (msg) => {
            if (/depends on UNKNOWN service/.test(msg.text())) serviceErrors.push(msg.text());
        });
        await page.goto(dashboardUrl);
        await page.waitForLoadState('domcontentloaded');

        await openDashboardCustomSql(page, pm);
        await page.keyboard.type(`SELECT * FROM "${STREAM}" WHERE status_text`, { delay: 30 });
        await page.keyboard.type(' ');
        const menu = await waitForMenu(page, 10000);
        expect(menu.rows).toContain('=');
        expect(serviceErrors, 'Monaco services resolved before the first editor').toEqual([]);
    });

    test('a text column named in SELECT gets quoted values and the text operators', {
        tag: ['@all', '@autosuggestions', '@dashboard', '@sqlautocomplete', '@quoting'],
    }, async ({ page }) => {
        const mode = await openDashboardCustomSql(page, pm);
        await page.keyboard.type(`SELECT status_text, count(*) FROM "${STREAM}" `, { delay: 30 });
        // Long enough for the panel's debounced update to read the SELECT list.
        await page.waitForTimeout(1500);
        await page.keyboard.type('WHERE status_text', { delay: 30 });
        await page.keyboard.type(' ');
        const operators = await waitForMenu(page);
        expect(operators.rows).toContain('=');
        if (mode !== 'off') {
            expect(operators.rows.some((r) => r.startsWith('str_match')), 'the text lane offers str_match').toBe(true);
        }

        await page.keyboard.press('Escape');
        await page.keyboard.type('= ');
        const values = await waitForMenuRow(page, QUOTED, 12000);
        expect(values, 'quoted status values').not.toBeNull();
        expect((await menuState(page)).rows.filter((r) => BARE.test(r))).toEqual([]);
        expect(values.rows).not.toContain('x_axis_1');
        expect(values.rows).not.toContain('y_axis_1');
    });
});
