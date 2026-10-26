/**
 * Traces filter editor: the same chain, values and AND/OR lead as the Logs filter.
 *
 * Each row reads ZO_EDITOR_SUGGEST_MODE from the page, so the file runs once per mode.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');
const {
    EDITOR_HOSTS,
    openTracesStream,
    getSuggestMode,
    seedEditor,
    focusEditorAtEnd,
    editorText,
    waitForMenu,
    waitForMenuRow,
} = require('../utils/suggest-menu-helpers.js');

const HOST = EDITOR_HOSTS.traces;
const SERVICES = /^'(api-gateway|order-service|payment-service|user-service|profile-service|auth-service)'$/;

test.describe('Traces autocomplete in filter mode', () => {
    test.describe.configure({ mode: 'serial' });
    const orgName = process.env['ORGNAME'] || 'default';
    let ingested = false;
    let mode;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        if (!ingested) {
            const result = await ingestTraces(page, 10);
            expect(result.successful, 'traces ingested').toBeGreaterThan(0);
            ingested = true;
        }
        await openTracesStream(page, orgName);
        mode = await getSuggestMode(page);
        testLogger.info(`ZO_EDITOR_SUGGEST_MODE in the browser: ${mode}`);
    });

    test('a field and a space open the operators, not the field list', {
        tag: ['@all', '@autosuggestions', '@traces', '@filtermode'],
    }, async ({ page }) => {
        await seedEditor(page, HOST, 'service_name');
        await page.keyboard.type(' ');
        const menu = await waitForMenu(page);
        expect(menu.rows[0]).toBe('=');
        const lastOperator = menu.rows.indexOf('IS NOT NULL');
        expect(lastOperator).toBeGreaterThan(0);
        // off keeps one flat list, as on Logs: the operators lead and the fields follow them.
        for (const field of ['_timestamp', 'duration', 'span_status']) {
            if (mode === 'off') expect(menu.rows.slice(0, lastOperator), `field ${field} above an operator`).not.toContain(field);
            else expect(menu.rows, `field ${field} offered after a field`).not.toContain(field);
        }
        if (mode !== 'off') expect(menu.headers[0]).toBe('Operators');
    });

    test('field = typed right after the page loads offers quoted values', {
        tag: ['@all', '@autosuggestions', '@traces', '@values'],
    }, async ({ page }) => {
        await focusEditorAtEnd(page, HOST);
        await page.keyboard.type('service_name = ', { delay: 10 });
        const menu = await waitForMenuRow(page, SERVICES, 10000);
        expect(menu, 'a service value in the first value menu').not.toBeNull();
        expect(menu.rows.filter((r) => SERVICES.test(r)).length).toBeGreaterThan(0);
    });

    test('after a complete condition, AND and OR lead', {
        tag: ['@all', '@autosuggestions', '@traces', '@lead'],
    }, async ({ page }) => {
        await seedEditor(page, HOST, "service_name = 'x'");
        await page.keyboard.type(' ');
        const menu = await waitForMenu(page);
        expect(menu.rows.slice(0, 2)).toEqual(['AND', 'OR']);
        if (mode !== 'off') expect(menu.focused).toBeNull();
        expect(await editorText(page, HOST)).toBe("service_name = 'x' ");
    });

    test('a field after AND opens the operators too', {
        tag: ['@all', '@autosuggestions', '@traces', '@filtermode'],
    }, async ({ page }) => {
        await seedEditor(page, HOST, "service_name = 'x' AND span_status");
        await page.keyboard.type(' ');
        const menu = await waitForMenu(page);
        expect(menu.rows).toContain('=');
        expect(menu.rows).not.toContain('_timestamp');
    });
});
