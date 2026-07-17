const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const PageManager = require('../../pages/page-manager.js');
const testLogger = require('../utils/test-logger.js');
const logsdata = require("../../../test-data/logs_data.json");
const { getAuthHeaders, getOrgIdentifier } = require('../utils/cloud-auth.js');

test.describe.configure({ mode: 'parallel' });

test.describe("Schema testcases", () => {
    let pm;
    const streamName = `stream${Date.now()}`;

    // Ingestion helper function 
    async function ingestion(page, testStreamName) {
        testLogger.debug('Starting ingestion for test stream', { testStreamName });
        const orgId = getOrgIdentifier();

        const headers = {
            ...getAuthHeaders(),
            "Content-Type": "application/json",
        };

        const response = await page.evaluate(async ({ url, headers, orgId, streamName, logsdata }) => {
            const fetchResponse = await fetch(`${url}/api/${orgId}/${streamName}/_json`, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(logsdata)
            });

            const contentType = fetchResponse.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return await fetchResponse.json();
            } else {
                const text = await fetchResponse.text();
                return { error: text, status: fetchResponse.status };
            }
        }, {
            url: process.env.INGESTION_URL,
            headers: headers,
            orgId: orgId,
            streamName: testStreamName,
            logsdata: logsdata
        });
        
        testLogger.debug('Ingestion response', { response });
    }

    /**
     * Backend-readiness gate: poll the streams list API until the freshly-created
     * stream is actually listed by the backend.
     *
     * WHY: On cloud under load (--workers=5), a just-ingested stream is not
     * immediately visible in the logs stream-list dropdown due to streams-list
     * indexing/consistency lag. logsPage.selectStream() reloads the logs page 5x
     * internally, but if the backend still hasn't listed the stream those retries
     * are exhausted and the test fails with
     * `selectStream: Failed to find stream "..." after N attempts`.
     *
     * This gates on the REAL readiness signal the dropdown itself consumes
     * (GET /api/{org}/streams?type=logs -> body.list contains the stream), so the
     * subsequent selectStream() succeeds deterministically instead of racing.
     * Not a blind retry bump.
     *
     * @param {import('@playwright/test').Page} page
     * @param {string} targetStreamName stream that must appear in the list
     */
    async function waitForStreamListed(page, targetStreamName) {
        const orgId = getOrgIdentifier();
        // Use the SAME base the app's own stream-readiness check uses
        // (logsPage.waitForStreamAvailable: INGESTION_URL || ZO_BASE_URL) so we poll
        // the exact host/endpoint that feeds selectStream's dropdown. On cloud these
        // two hosts differ, so matching the canonical order avoids hitting the wrong one.
        const rawBase = process.env.INGESTION_URL || process.env.ZO_BASE_URL || '';
        const baseUrl = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
        const streamsUrl = `${baseUrl}/api/${orgId}/streams?type=logs`;
        const headers = getAuthHeaders();

        // Bounded poll: ~60s worst case (20 attempts x 3s backoff), well above the
        // observed consistency lag while still failing fast if the stream is truly
        // never created. Transient network errors are tolerated and retried.
        const maxAttempts = 20;
        const backoffMs = 3000;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            let listed = false;
            try {
                const response = await page.request.get(streamsUrl, {
                    headers,
                    timeout: 15000,
                });
                if (response.ok()) {
                    const body = await response.json().catch(() => null);
                    const list = (body && body.list) || [];
                    listed = list.some((s) => s && s.name === targetStreamName);
                } else {
                    testLogger.debug('waitForStreamListed non-OK response', {
                        status: response.status(),
                        targetStreamName,
                        attempt,
                    });
                }
            } catch (error) {
                // Transient Connection timeout / ECONNRESET etc. — retry.
                testLogger.debug('waitForStreamListed request error (will retry)', {
                    error: error.message,
                    targetStreamName,
                    attempt,
                });
            }

            if (listed) {
                testLogger.info('Stream is listed by backend — safe to selectStream', {
                    targetStreamName,
                    attempt,
                });
                return;
            }

            if (attempt < maxAttempts) {
                // Documented consistency backoff (streams-list indexing lag on cloud).
                await page.waitForTimeout(backoffMs);
            }
        }

        throw new Error(
            `waitForStreamListed: stream "${targetStreamName}" was not listed by ` +
            `GET ${streamsUrl} after ${maxAttempts} attempts (~${(maxAttempts * backoffMs) / 1000}s). ` +
            `Backend never made the ingested stream available.`
        );
    }

    test('stream schema settings updated to be displayed under logs', async ({ page }, testInfo) => {
        const testStreamName = "test1";
        
        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        
        // Navigate to base URL with authentication 
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        
        // Perform ingestion for this test
        await ingestion(page, testStreamName);
        await page.waitForLoadState('domcontentloaded');

        // Navigate to logs page with VRL editor enabled
        await pm.logsPage.navigateToLogs(getOrgIdentifier());
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

        // Backend-readiness gate: ensure the just-ingested stream is actually listed
        // by the streams API before selecting it, avoiding streams-list lag races.
        await waitForStreamListed(page, testStreamName);
        await pm.logsPage.selectStream(testStreamName);

        const allsearch = page.waitForResponse(`**/api/${getOrgIdentifier()}/_search**`, { timeout: 60000 });
        await pm.schemaPage.applyQuery();
        await allsearch;
        
        // Start of actual test - simplified schema workflow
        await pm.schemaPage.completeStreamSettingsSchemaWorkflow(testStreamName);
        
        // Verify schema workflow completed by checking no error messages are present
        await pm.schemaPage.verifyNoErrorMessages();
        testLogger.assertion('Schema workflow completed without errors', true);
        
        testLogger.info('Stream schema settings test completed');
    });

    test('should display stream details on navigating from blank stream to stream with details', async ({ page }, testInfo) => {
        const testStreamName = "test2";
        
        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        
        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        
        // Perform ingestion for this test
        await ingestion(page, testStreamName);
        await page.waitForLoadState('domcontentloaded');

        // Navigate to logs page with VRL editor enabled
        await pm.logsPage.navigateToLogs(getOrgIdentifier());

        // Backend-readiness gate: ensure the just-ingested stream is actually listed
        // by the streams API before selecting it, avoiding streams-list lag races.
        await waitForStreamListed(page, testStreamName);
        await pm.logsPage.selectStream(testStreamName);
        const allsearch2 = page.waitForResponse(`**/api/${getOrgIdentifier()}/_search**`, { timeout: 60000 });
        await pm.schemaPage.applyQuery();
        await allsearch2;

        // Start of actual test - complete blank to detailed stream workflow
        await pm.schemaPage.completeBlankToDetailedStreamWorkflow(streamName, testStreamName);
        
        // Verify navigation workflow completed by checking streams page is accessible
        await pm.schemaPage.verifyStreamsPageAccessible();
        testLogger.assertion('Stream navigation workflow completed successfully', true);
    });

    test('should add a new field and delete it from schema', async ({ page }, testInfo) => {
        const testStreamName = "test3";
        
        // Initialize test setup
        testLogger.testStart(testInfo.title, testInfo.file);
        
        // Navigate to base URL with authentication
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        
        // Perform ingestion for this test
        await ingestion(page, testStreamName);
        await page.waitForLoadState('domcontentloaded');

        // Navigate to logs page with VRL editor enabled
        await pm.logsPage.navigateToLogs(getOrgIdentifier());

        // Backend-readiness gate: ensure the just-ingested stream is actually listed
        // by the streams API before selecting it, avoiding streams-list lag races.
        await waitForStreamListed(page, testStreamName);
        await pm.logsPage.selectStream(testStreamName);
        const allsearch3 = page.waitForResponse(`**/api/${getOrgIdentifier()}/_search**`, { timeout: 60000 });
        await pm.schemaPage.applyQuery();
        await allsearch3;

        // Start of actual test - use original working enhanced framework method
        await pm.schemaPage.completeAddAndDeleteFieldWorkflow(testStreamName);
        
        testLogger.assertion('Add/delete field workflow completed successfully', true);
    });
});
