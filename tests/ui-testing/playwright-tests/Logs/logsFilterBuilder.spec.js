// The chip bar is the only filter-mode input on logs; SQL mode shows the query editor.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData, ingestCustomData, waitForStreamData } = require('../utils/data-ingestion.js');
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

test.describe('Logs filter builder: mixed AND/OR', () => {
    test.describe.configure({ mode: 'serial' });
    const stream = `e2e_fb_mixed_${Date.now()}`;
    const mix = { 'error|alpha': 3, 'warn|alpha': 2, 'error|beta': 4, 'warn|beta': 5, 'info|alpha': 1 };
    const rows = Object.entries(mix).flatMap(([key, n]) => {
        const [level, svc_name] = key.split('|');
        return Array.from({ length: n }, (_, i) => ({ level, svc_name, seq: i }));
    });
    let pm;
    let builder;

    test.beforeAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            expect((await ingestCustomData(page, stream, rows)).status, 'Precondition: rows must ingest').toBe(200);
        } finally {
            await page.close();
        }
    });

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        expect(await waitForStreamData(page, stream, rows.length, 60000), 'Precondition: rows searchable').toBe(true);
        await pm.logsPage.selectStream(stream);
        await pm.logsPage.disableSqlModeIfNeeded();
        builder = new FilterBuilderDriver(page, `${PREFIX}-bar`);
        await expect(builder.barInput).toBeVisible({ timeout: 15000 });
    });

    test.afterAll(async ({ browser }) => {
        const page = await browser.newPage();
        try {
            await new PageManager(page).streamsPage.deleteStreamViaAPI(stream);
        } catch (e) {
            testLogger.warn(`Cleanup of ${stream} failed: ${e.message}`);
        } finally {
            await page.close();
        }
    });

    test('adding an AND after an OR keeps the OR together, as the chips read', {
        tag: ['@all', '@logs', '@filterBuilder', '@bug-16941', '@P1'],
    }, async ({ page }) => {
        await builder.addCondition('level', '=', 'error');
        await builder.addCondition('level', '=', 'warn');
        await builder.close();
        // The Logs bar has no "-root" wrapper, so the connector is found page-wide rather than via toggleConnector().
        await builder.connectors.first().click();
        await expect(builder.connectors.first()).toHaveText('OR');
        await builder.addCondition('svc_name', '=', 'alpha');

        await expect.poll(() => editorText(page, HOST))
            .toBe("(level = 'error' OR level = 'warn') AND svc_name = 'alpha'");

        await pm.logsPage.runQueryAndWaitForResults();
        expect(await pm.logsPage.getResultHitsCount()).toBe(mix['error|alpha'] + mix['warn|alpha']);
    });
});
