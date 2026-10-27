const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: 'parallel' });

// until GET /{org}/passcode lands the snippet substitutes an empty password and answers 401
test.describe("Ingestion snippet credential loading", () => {
    const SLUG = 'curl';
    const CURL_GUIDE = '/ingestion/custom/logs/curl';
    const PASSCODE_ROUTE = /\/api\/[^/]+\/passcode(\?|$)/;

    test("Code block stays uncopyable until the org token lands, then copies it in full", {
        tag: ['@ingestion-passcode-loading', '@ingestion', '@all', '@P2'],
    }, async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);

        await navigateToBase(page);
        const pm = new PageManager(page);

        // held open until the load-window assertions have run, so that window is observable
        let releasePasscode;
        const passcodeGate = new Promise((resolve) => { releasePasscode = resolve; });
        await page.route(PASSCODE_ROUTE, async (route) => {
            await passcodeGate;
            await route.continue();
        });

        try {
            await pm.ingestionConfigPage.navigateToIntegration(CURL_GUIDE, getOrgIdentifier());
            await pm.ingestionConfigPage.expectCodeBlockLoading(SLUG);
            await pm.ingestionConfigPage.expectCodeBlockNotCopyable(SLUG);
        } finally {
            releasePasscode();
        }
        await page.unroute(PASSCODE_ROUTE);

        await pm.ingestionConfigPage.expectCodeBlockVisible(SLUG);
        await pm.ingestionConfigPage.expectCodeBlockNotLoading(SLUG);

        await pm.ingestionConfigPage.clickCodeBlockCopyBtn(SLUG);
        const copied = (await pm.ingestionConfigPage.readClipboard()).trim();
        expect(copied).toMatch(/-u [^:\s]+:\S/);

        // Reveal shows the same real command Copy puts on the clipboard, so a mask leak fails here
        await pm.ingestionConfigPage.clickCodeBlockRevealBtn(SLUG);
        const revealed = (await pm.ingestionConfigPage.getCodeBlockText(SLUG)).trim();
        expect(revealed).not.toContain('•');
        expect(copied).toBe(revealed);

        testLogger.info('Test completed');
    });
});
