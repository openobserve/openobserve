/**
 * Logs Patterns Multi-Stream Guard (OSS).
 *
 * The Patterns extraction runs on a dedicated single-stream API. This spec verifies the
 * client-side guard in Index.vue's extractPatternsForCurrentQuery(): when more than one
 * stream is selected in non-SQL mode it cancels the in-flight extraction, clears stale
 * patterns and surfaces an error toast BEFORE any API call. The Patterns toggle button is
 * enterprise-gated, so in OSS we enter patterns mode via the URL query param
 * (logs_visualize_toggle=patterns). No ingestion/FTS/patterns-config setup is required —
 * the guard fires on selectedStream.length alone.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { waitForStreamListed } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// Unique per-test stream names so parallel tests never collide. cleanup.spec.js reclaims
// these via the /^e2e_multi_patterns/ prefix.
function makeStreamName(letter) {
    return `e2e_multi_patterns_${letter}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

test.describe("Logs Patterns Multi-Stream Guard testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        testLogger.info('Test setup completed');
    });

    test.afterEach(async ({}, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    test("should show an error toast and refuse patterns when multiple streams are selected @P0 @smoke", {
        tag: ['@logs-patterns-multi-stream-guard', '@all', '@smoke', '@logs']
    }, async ({ page }) => {
        testLogger.info('Test: multi-stream patterns guard fires an error toast');

        // The guard fires before any network call, so the streams only need to exist.
        const streamA = makeStreamName('a');
        const streamB = makeStreamName('b');
        await pm.streamsPage.createStream(streamA, 'logs');
        await pm.streamsPage.createStream(streamB, 'logs');
        await waitForStreamListed(page, streamA, 'logs');
        await waitForStreamListed(page, streamB, 'logs');

        // Enter patterns mode via URL (the toggle is enterprise-gated in OSS). restoreUrlQueryParams
        // splits `stream` on ',' into [a, b], so the guard condition is true on mount and the toast fires.
        const logsUrl = `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}`;
        await pm.logsPage.startToastRecorder();
        await page.goto(`${logsUrl}&stream_type=logs&stream=${streamA},${streamB}&logs_visualize_toggle=patterns`, { waitUntil: 'domcontentloaded' });

        await pm.logsPage.expectMultiStreamPatternsToast();
        testLogger.info('PASSED: multi-stream guard error toast shown');
    });

    test("should not show the multi-stream patterns toast for a single stream @P1", {
        tag: ['@logs-patterns-multi-stream-guard', '@all', '@logs']
    }, async ({ page }) => {
        testLogger.info('Test: single-stream patterns skips the multi-stream guard');

        const streamA = makeStreamName('a');
        await pm.streamsPage.createStream(streamA, 'logs');
        await waitForStreamListed(page, streamA, 'logs');

        const logsUrl = `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}`;
        await pm.logsPage.startToastRecorder();
        await page.goto(`${logsUrl}&stream_type=logs&stream=${streamA}&logs_visualize_toggle=patterns`, { waitUntil: 'domcontentloaded' });

        // selectedStream.length is 1, so the guard is skipped and extraction proceeds. The exact
        // multi-stream error message must never appear (a generic errorExtractingPatterns toast may).
        await pm.logsPage.expectNoMultiStreamPatternsToast();
        testLogger.info('PASSED: no multi-stream toast for a single stream');
    });
});
