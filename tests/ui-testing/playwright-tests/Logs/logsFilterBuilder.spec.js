// Logs with the filter builder on, the default the shared fixtures turn off for every other spec.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData, waitForStreamData } = require('../utils/data-ingestion.js');
const { FilterBuilderDriver } = require('../../pages/generalPages/filterBuilderPage.js');
const { EDITOR_HOSTS, seedEditor, editorText } = require('../utils/suggest-menu-helpers.js');

const HOST = EDITOR_HOSTS.logs;
const PREFIX = 'logs-search-bar-filter-builder';
const TOGGLE = '[data-test="logs-search-bar-filter-builder-toggle"]';
const FIELD = 'kubernetes_namespace_name';
const UNPARSABLE_QUERY = `${FIELD} = upper(${FIELD})`;

test.describe('Logs filter builder', () => {
    test.describe.configure({ mode: 'serial' });
    const streamName = 'e2e_automate';
    const orgName = process.env['ORGNAME'] || 'default';
    let pm;
    let builder;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        // Once per tab, so a toggle the test makes survives its own reloads; the fixture only fills an unset key.
        await page.addInitScript(() => {
            try {
                if (!sessionStorage.getItem('e2e.logsBuilderSeeded')) {
                    localStorage.setItem('o2.logs.queryInput', 'builder');
                    sessionStorage.setItem('e2e.logsBuilderSeeded', '1');
                }
            } catch (_) {}
        });
        await navigateToBase(page);
        pm = new PageManager(page);
        await ingestTestData(page);
        await waitForStreamData(page, streamName, 1).catch(() => {});
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
        await page.waitForLoadState('domcontentloaded');
        await pm.logsPage.selectStream(streamName);
        await pm.logsPage.disableSqlModeIfNeeded();
        builder = new FilterBuilderDriver(page, `${PREFIX}-bar`);
        await expect(builder.barInput).toBeVisible({ timeout: 15000 });
    });

    test.afterEach(async ({}, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    test('builds a chip and writes it to the query', {
        tag: ['@all', '@logs', '@filterBuilder', '@P0'],
    }, async ({ page }) => {
        await builder.addCondition(FIELD, '=', 'ziox');
        await builder.expectChipCount(1);
        await builder.expectChip(FIELD, 'ziox');
        await builder.expectOperator(0, '=');
        await expect.poll(() => editorText(page, HOST)).toBe(`${FIELD} = 'ziox'`);
    });

    test('the toggle switches between the builder and the query editor, keeping the filter', {
        tag: ['@all', '@logs', '@filterBuilder', '@P1'],
    }, async ({ page }) => {
        await builder.addCondition(FIELD, '=', 'ziox');
        await builder.expectChipCount(1);

        await page.locator(TOGGLE).click();
        await expect(page.locator(HOST)).toBeVisible();
        await expect(builder.barInput).toBeHidden();
        await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => editorText(page, HOST)).toBe(`${FIELD} = 'ziox'`);

        await page.locator(TOGGLE).click();
        await expect(builder.barInput).toBeVisible();
        await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', 'true');
        await builder.expectChipCount(1);
        await builder.expectChip(FIELD, 'ziox');
    });

    test('a query the builder cannot draw shows the unparsable banner', {
        tag: ['@all', '@logs', '@filterBuilder', '@P1'],
    }, async ({ page }) => {
        const banner = page.locator(`[data-test="${PREFIX}-unparsable"]`);

        await page.locator(TOGGLE).click();
        await seedEditor(page, HOST, UNPARSABLE_QUERY);
        await page.locator(TOGGLE).click();
        await expect(banner).toBeVisible();
        await expect(builder.barInput).toBeHidden();

        await page.locator(`[data-test="${PREFIX}-keep-query"]`).click();
        await expect(page.locator(HOST)).toBeVisible();
        await expect.poll(() => editorText(page, HOST)).toBe(UNPARSABLE_QUERY);

        await page.locator(TOGGLE).click();
        await expect(banner).toBeVisible();
        await page.locator(`[data-test="${PREFIX}-clear-and-build"]`).click();
        await expect(banner).toBeHidden();
        await expect(builder.barInput).toBeVisible();
        await expect.poll(() => editorText(page, HOST)).toBe('');
    });
});
