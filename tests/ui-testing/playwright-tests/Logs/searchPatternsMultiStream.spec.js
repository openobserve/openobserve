/**
 * Logs Patterns Multi-Stream Guard (OSS).
 *
 * Patterns is enterprise-gated, so on the OSS build a link asking for the Patterns tab
 * opens Logs instead; the multi-stream guard in Index.vue's extractPatternsForCurrentQuery()
 * is then unreachable and no toast or extraction request may appear.
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { waitForStreamListed } = require('../utils/data-ingestion.js');
const { getOrgIdentifier } = require('../utils/cloud-auth.js');

// POST /api/{org}/streams/{stream}/patterns/extract — the single-stream extraction API
// the guard exists to keep multi-stream selections away from (web/src/services/patterns.ts).
const PATTERNS_EXTRACT_URL = /\/streams\/[^/]+\/patterns\/extract/;

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

    test("should open Logs and not call patterns when a multi-stream link asks for Patterns on OSS @P0 @smoke", {
        tag: ['@logs-patterns-multi-stream-guard', '@all', '@smoke', '@logs']
    }, async ({ page }) => {
        testLogger.info('Test: OSS Patterns link with multiple streams falls back to Logs');

        const streamA = makeStreamName('a');
        const streamB = makeStreamName('b');
        await pm.streamsPage.createStream(streamA, 'logs');
        await pm.streamsPage.createStream(streamB, 'logs');
        await waitForStreamListed(page, streamA, 'logs');
        await waitForStreamListed(page, streamB, 'logs');

        const extractCalls = [];
        page.on('request', (req) => {
            if (PATTERNS_EXTRACT_URL.test(req.url())) extractCalls.push(req.url());
        });

        const logsUrl = `${process.env.ZO_BASE_URL}/web/logs?org_identifier=${getOrgIdentifier()}`;
        await pm.logsPage.startToastRecorder();
        await page.goto(`${logsUrl}&stream_type=logs&stream=${streamA},${streamB}&logs_visualize_toggle=patterns`, { waitUntil: 'domcontentloaded' });

        await pm.logsPage.expectPatternsToggleNotVisible();
        await pm.logsPage.expectNoMultiStreamPatternsToast();
        expect(extractCalls, `patterns/extract must not be called on OSS, got: ${extractCalls.join(', ')}`).toHaveLength(0);
        testLogger.info('PASSED: OSS Patterns link opened Logs, no toast, no extraction request');
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
