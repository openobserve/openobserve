// The chip bar is the traces filter input; the query editor behind it still holds the query text.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');
const { FilterBuilderDriver } = require('../../pages/generalPages/filterBuilderPage.js');
const { EDITOR_HOSTS, openTracesStream, seedEditor, editorText } = require('../utils/suggest-menu-helpers.js');

const HOST = EDITOR_HOSTS.traces;
const PREFIX = 'traces-search-bar-filter-builder';
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

    test('a typed word is offered as a search function, which then asks for the field', {
        tag: ['@all', '@traces', '@filterBuilder', '@P1'],
    }, async ({ page }) => {
        // Trace streams have no full-text field, so the word fills the field functions instead of match_all.
        await builder.barInput.click();
        await builder.barInput.pressSequentially(VALUE);
        const contains = page.locator(`[data-test^="${PREFIX}-bar-suggest-item-"][data-test$="fn:contains"]`);
        await expect(contains).toContainText(`str_match(…, '${VALUE}')`);
        await contains.click();
        await builder.suggestion(FIELD).click();
        await builder.expectChip(FIELD, VALUE);
        await expect.poll(() => editorText(page, HOST)).toBe(`str_match(${FIELD}, '${VALUE}')`);
    });

    test('a query the bar cannot draw is kept whole as a locked chip', {
        tag: ['@all', '@traces', '@filterBuilder', '@P1'],
    }, async ({ page }) => {
        await seedEditor(page, HOST, UNPARSABLE_QUERY);
        await builder.expectChip('locked');
        await builder.expectChipCount(1);
        await builder.addCondition(FIELD, '=', VALUE);
        await builder.expectChipCount(2);
        await expect.poll(() => editorText(page, HOST)).toBe(`(${UNPARSABLE_QUERY}) AND ${FIELD} = '${VALUE}'`);
    });
});
