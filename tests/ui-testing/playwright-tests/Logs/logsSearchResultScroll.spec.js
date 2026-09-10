const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");

// Function to generate a random 9-character alphabetic stream name.
function generateRandomStreamName() {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    let randomName = '';
    for (let i = 0; i < 9; i++) {
        randomName += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
    }
    return randomName;
}

test.describe("Logs Search Result Scroll Reset testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    // One stream per worker process: the scroll-reset assertions are read-only, so a
    // single ingested fixture is reused across the worker's tests. Module state is per
    // worker (workers are separate processes), so parallel workers stay isolated and
    // never contend on the same stream name.
    let streamName;
    let streamReady = false;

    const orgId = process.env.ORGNAME || "default";

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);

        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        if (!streamReady) {
            streamName = generateRandomStreamName();
            await pm.ingestionPage.ingestionMultiOrgStream(orgId, streamName);
            // Wait for stream to be indexed — cloud can take 30-60s
            await pm.logsPage.waitForStreamAvailable(streamName, 120000, 1000);
            streamReady = true;
        }

        // Non-SQL mode keeps logsVisualizeToggle === 'logs' so pagination and the
        // records-per-page dropdown render (they are hidden in SQL mode).
        await pm.logsPage.disableSqlModeIfNeeded();
        await pm.logsPage.selectIndexStream(streamName);
        await pm.logsPage.typeQuery(`SELECT * FROM "${streamName}"`);
        await pm.logsPage.selectRunQuery();
        await pm.logsPage.waitForResultsLoaded();

        testLogger.info('Test setup completed');
    });

    test("Scroll resets to top when changing rows-per-page from 10 to 25", {
        tag: ['@logs-search-result-scroll-reset', '@all', '@logs', '@P0'],
    }, async ({ page }) => {
        testLogger.info('Testing scroll reset on rows-per-page change (10 -> 25)');

        await pm.logsPage.scrollToResultsBottom();
        const scrollAfterScroll = await pm.logsPage.getScrollContainerPosition();
        testLogger.info(`Scrolled to: ${scrollAfterScroll}`);
        expect(scrollAfterScroll).toBeGreaterThan(10);

        await pm.logsPage.selectRecordsPerPage(25);

        const currentPage = await pm.logsPage.getCurrentPageNumber();
        expect(currentPage).toBe('1');

        const scrollTop = await pm.logsPage.getScrollContainerPosition();
        expect(scrollTop).toBeLessThanOrEqual(1);
        testLogger.info('Scroll correctly reset to top on rows-per-page change');
    });

    test("Scroll resets to top when navigating from page 2 back to page 1 via Prev button", {
        tag: ['@logs-search-result-scroll-reset', '@all', '@logs', '@P1'],
    }, async ({ page }) => {
        testLogger.info('Testing scroll reset on page 2 -> page 1 via Prev button');

        await pm.logsPage.clickPageNumber('2');
        const page2Check = await pm.logsPage.getCurrentPageNumber();
        testLogger.info(`Current page: ${page2Check}`);
        expect(page2Check).toBe('2');

        await pm.logsPage.scrollToResultsBottom();
        const scrollOnPage2 = await pm.logsPage.getScrollContainerPosition();
        testLogger.info(`Scrolled to on page 2: ${scrollOnPage2}`);
        expect(scrollOnPage2).toBeGreaterThan(10);

        await pm.logsPage.clickPrevPage();
        const currentPage = await pm.logsPage.getCurrentPageNumber();
        expect(currentPage).toBe('1');

        const scrollTop = await pm.logsPage.getScrollContainerPosition();
        expect(scrollTop).toBeLessThanOrEqual(1);
        testLogger.info('Scroll correctly reset to top via Prev button');
    });

    test.fixme("patterns extraction scroll reset — not wired in OSS: SearchBar.vue:105 (enterprise toggle), usePatterns.ts:89", {
        tag: ['@logs-search-result-scroll-reset', '@all', '@logs', '@P2'],
    }, async ({ page }) => {
        testLogger.info('Testing scroll reset on patterns extraction start (enterprise-only, UNWIRED in OSS)');

        // In the wired enterprise build this drives the full cycle: scroll to bottom,
        // switch to the Patterns view, trigger a fresh extraction, and assert the
        // shared pane returns to the top when patternsState.loading flips true.
        await pm.logsPage.scrollToResultsBottom();
        const scrollAfterScroll = await pm.logsPage.getScrollContainerPosition();
        expect(scrollAfterScroll).toBeGreaterThan(10);

        const scrollTop = await pm.logsPage.getScrollContainerPosition();
        expect(scrollTop).toBeLessThanOrEqual(1);
        testLogger.info('Scroll correctly reset to top on patterns extraction start');
    });
});
