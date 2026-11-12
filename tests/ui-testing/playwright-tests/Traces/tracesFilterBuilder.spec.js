// Traces with the filter builder on, the default the shared fixtures turn off for every other spec.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');
const { FilterBuilderDriver } = require('../../pages/generalPages/filterBuilderPage.js');
const { EDITOR_HOSTS, openTracesStream, seedEditor, editorText } = require('../utils/suggest-menu-helpers.js');

const HOST = EDITOR_HOSTS.traces;
const PREFIX = 'traces-search-bar-filter-builder';
const TOGGLE = '[data-test="traces-search-bar-filter-builder-toggle"]';
const FIELD = 'service_name';
const VALUE = 'api-gateway';
const UNPARSABLE_QUERY = `${FIELD} = upper(${FIELD})`;

test.describe('Traces filter builder', () => {
    test.describe.configure({ mode: 'serial' });
    const orgName = process.env['ORGNAME'] || 'default';
    let ingested = false;
    let builder;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        // Once per tab, so a toggle the test makes survives its own reloads; the fixture only fills an unset key.
        await page.addInitScript(() => {
            try {
                if (!sessionStorage.getItem('e2e.tracesBuilderSeeded')) {
                    localStorage.setItem('o2.traces.queryInput', 'builder');
                    sessionStorage.setItem('e2e.tracesBuilderSeeded', '1');
                }
            } catch (_) {}
        });
        await navigateToBase(page);
        if (!ingested) {
            const result = await ingestTraces(page, 10);
            expect(result.successful, 'traces ingested').toBeGreaterThan(0);
            ingested = true;
        }
        await openTracesStream(page, orgName);
        builder = new FilterBuilderDriver(page, `${PREFIX}-bar`);
        await expect(builder.barInput).toBeVisible({ timeout: 15000 });
    });

    test.afterEach(async ({}, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    test('builds a chip and writes it to the query', {
        tag: ['@all', '@traces', '@filterBuilder', '@P0'],
    }, async ({ page }) => {
        await builder.addCondition(FIELD, '=', VALUE);
        await builder.expectChipCount(1);
        await builder.expectChip(FIELD, VALUE);
        await builder.expectOperator(0, '=');
        await expect.poll(() => editorText(page, HOST)).toBe(`${FIELD} = '${VALUE}'`);
    });

    test('the toggle switches between the builder and the query editor, keeping the filter', {
        tag: ['@all', '@traces', '@filterBuilder', '@P1'],
    }, async ({ page }) => {
        await builder.addCondition(FIELD, '=', VALUE);
        await builder.expectChipCount(1);

        await page.locator(TOGGLE).click();
        await expect(page.locator(HOST)).toBeVisible();
        await expect(builder.barInput).toBeHidden();
        await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', 'false');
        await expect.poll(() => editorText(page, HOST)).toBe(`${FIELD} = '${VALUE}'`);

        await page.locator(TOGGLE).click();
        await expect(builder.barInput).toBeVisible();
        await expect(page.locator(TOGGLE)).toHaveAttribute('aria-pressed', 'true');
        await builder.expectChipCount(1);
        await builder.expectChip(FIELD, VALUE);
    });

    test('a query the builder cannot draw shows the unparsable banner', {
        tag: ['@all', '@traces', '@filterBuilder', '@P1'],
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
