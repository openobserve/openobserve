// Logs with the filter builder turned on; every other spec runs on the default query editor.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData, ingestCustomData, waitForStreamData } = require('../utils/data-ingestion.js');
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
        // Clear and build deletes the query, so it asks first; Cancel keeps the query.
        const confirmDialog = page.locator('[data-test="confirm-dialog-provider"]');
        await page.locator(`[data-test="${PREFIX}-clear-and-build"]`).click();
        await expect(confirmDialog).toBeVisible();
        await confirmDialog.locator('[data-test="o-dialog-secondary-btn"]').click();
        await expect(confirmDialog).toBeHidden();
        await expect(banner).toBeVisible();

        await page.locator(`[data-test="${PREFIX}-clear-and-build"]`).click();
        await confirmDialog.locator('[data-test="o-dialog-primary-btn"]').click();
        await expect(banner).toBeHidden();
        await expect(builder.barInput).toBeVisible();
        await expect.poll(() => editorText(page, HOST)).toBe('');
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
        await page.addInitScript(() => {
            try { localStorage.setItem('o2.logs.queryInput', 'builder'); } catch (_) {}
        });
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
