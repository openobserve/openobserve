/**
 * Enter inside an open value quote with no menu row highlighted closes the quote
 * instead of breaking the string across lines.
 *
 * Each row reads ZO_EDITOR_SUGGEST_MODE from the page, so the file runs once per mode.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestTestData, waitForStreamData } = require('../utils/data-ingestion.js');
const {
    EDITOR_HOSTS,
    enterAfterUnmatchedValue,
    getSuggestMode,
    seedEditor,
    editorText,
} = require('../utils/suggest-menu-helpers.js');

const HOST = EDITOR_HOSTS.logs;

test.describe('Logs autocomplete: Enter in an open quote', () => {
    test.describe.configure({ mode: 'serial' });
    const streamName = 'e2e_automate';
    const orgName = process.env['ORGNAME'] || 'default';
    let pm;
    let mode;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await ingestTestData(page);
        await waitForStreamData(page, streamName, 1).catch(() => {});
        await page.goto(`${logData.logsUrl}?org_identifier=${orgName}`);
        await page.waitForLoadState('domcontentloaded');
        await pm.logsPage.selectStream(streamName);
        mode = await getSuggestMode(page);
    });

    test('in the filter, Enter closes the quote and adds no line', {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract', '@quote'],
    }, async ({ page }) => {
        test.skip(mode === 'off', 'off is the editor before the fix');
        test.skip(await pm.logsPage.isSqlModeEnabled(), 'the Logs filter is in full SQL mode');
        await enterAfterUnmatchedValue(page, HOST, 'kubernetes_namespace_name = ');
        await expect.poll(() => editorText(page, HOST)).toBe("kubernetes_namespace_name = 'zzqx'");
    });

    test('in full SQL, Enter closes the quote and adds no line', {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract', '@quote'],
    }, async ({ page }) => {
        test.skip(mode === 'off', 'off is the editor before the fix');
        await pm.logsPage.enableSqlModeIfDisabled();
        const where = `SELECT * FROM "${streamName}" WHERE kubernetes_namespace_name = `;
        await enterAfterUnmatchedValue(page, HOST, where);
        await expect.poll(() => editorText(page, HOST)).toBe(`${where}'zzqx'`);
    });

    test('with the closing quote already there, Enter steps over it', {
        tag: ['@all', '@autosuggestions', '@logs', '@keycontract', '@quote'],
    }, async ({ page }) => {
        test.skip(mode === 'off', 'off is the editor before the fix');
        test.skip(await pm.logsPage.isSqlModeEnabled(), 'the Logs filter is in full SQL mode');
        await seedEditor(page, HOST, "kubernetes_namespace_name = 'zzqx'");
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('Enter');
        await expect.poll(() => editorText(page, HOST)).toBe("kubernetes_namespace_name = 'zzqx'");
        await page.keyboard.type(' ');
        await expect.poll(() => editorText(page, HOST)).toBe("kubernetes_namespace_name = 'zzqx' ");
    });
});
