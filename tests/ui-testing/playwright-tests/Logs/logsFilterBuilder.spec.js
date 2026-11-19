// The chip bar is the only filter-mode input on logs; SQL mode shows the query editor.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData, waitForStreamData } = require('../utils/data-ingestion.js');
const { FilterBuilderDriver } = require('../../pages/generalPages/filterBuilderPage.js');
const { EDITOR_HOSTS, seedEditor, editorText } = require('../utils/suggest-menu-helpers.js');

const HOST = EDITOR_HOSTS.logs;
const PREFIX = 'logs-search-bar-filter-builder';
const FIELD = 'kubernetes_namespace_name';
const VALUE = 'ziox';
const UNPARSABLE_QUERY = `${FIELD} = upper(${FIELD})`;

test.describe('Logs filter builder', () => {
    test.describe.configure({ mode: 'serial' });
    const streamName = 'e2e_automate';
    const orgName = process.env['ORGNAME'] || 'default';
    let pm;
    let builder;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
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
        await builder.addCondition(FIELD, '=', VALUE);
        await builder.expectChipCount(1);
        await builder.expectChip(FIELD, VALUE);
        await builder.expectOperator(0, '=');
        await expect.poll(() => editorText(page, HOST)).toBe(`${FIELD} = '${VALUE}'`);
    });

    test('a typed word is offered as a search function and becomes a chip', {
        tag: ['@all', '@logs', '@filterBuilder', '@P1'],
    }, async ({ page }) => {
        await builder.barInput.click();
        await builder.barInput.pressSequentially(VALUE);
        const fullText = page.locator(`[data-test^="${PREFIX}-bar-suggest-item-"][data-test$="free-text"]`);
        await expect(fullText).toContainText(`match_all('${VALUE}')`);
        await fullText.click();
        await builder.expectChip('text', VALUE);
        await expect.poll(() => editorText(page, HOST)).toBe(`match_all('${VALUE}')`);
    });

    test('a query the bar cannot draw is kept whole as a locked chip', {
        tag: ['@all', '@logs', '@filterBuilder', '@P1'],
    }, async ({ page }) => {
        await seedEditor(page, HOST, UNPARSABLE_QUERY);
        await pm.logsPage.waitForSearchQueryCommitted(UNPARSABLE_QUERY);
        await builder.expectChip('locked');
        await builder.expectChipCount(1);
        await builder.addCondition(FIELD, '=', VALUE);
        await builder.expectChipCount(2);
        await expect.poll(() => editorText(page, HOST)).toBe(`(${UNPARSABLE_QUERY}) AND ${FIELD} = '${VALUE}'`);
    });
});
