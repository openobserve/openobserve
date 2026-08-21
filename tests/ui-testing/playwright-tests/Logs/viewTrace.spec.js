// viewTrace.spec.js
// Tests for the Logs "View Trace" action — jump from a log record to the trace
// that produced it. Covers both entry points (expanded-row JsonPreview and the
// row-detail drawer DetailTable header) plus the negative gate (no trace_id) and
// the default traces-stream picker selection.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require("../../fixtures/log.json");
const { ingestTraces } = require('../utils/trace-ingestion.js');
const { ingestCustomData, waitForFieldValueSearchable } = require('../utils/data-ingestion.js');

/**
 * Generates a per-test unique suffix so parallel tests never collide on a
 * stream name (each worker ingests its own stream + trace).
 * @returns {string}
 */
function uniqueStreamSuffix() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Ingests one trace (capturing its id) and one log record whose `trace_id`
 * matches, into the given stream, then waits until the field is queryable.
 * This is the setup contract's exact pattern (trace-ingestion.js + data-ingestion.js).
 * @param {import('@playwright/test').Page} page
 * @param {string} streamName
 * @returns {Promise<string>} the captured trace id
 */
async function ingestViewTraceFixture(page, streamName) {
    testLogger.info(`Ingesting trace + matching log record into ${streamName}`);
    const { traceIds } = await ingestTraces(page, 1);
    const traceId = traceIds[0];

    const ingestResponse = await ingestCustomData(page, streamName, [
        { trace_id: traceId, message: "view-trace e2e record" },
    ]);
    if (ingestResponse.status !== 200) {
        testLogger.warn(`Log ingestion returned ${ingestResponse.status} for ${streamName}`, {
            data: JSON.stringify(ingestResponse.data || {}),
        });
    }

    const searchable = await waitForFieldValueSearchable(page, streamName, "trace_id", traceId, 60000);
    if (!searchable) {
        throw new Error(`trace_id=${traceId} never became searchable in stream ${streamName}`);
    }
    return traceId;
}

test.describe("Logs View Trace Action testcases", () => {
    test.describe.configure({ mode: 'parallel' });
    let pm;

    test.beforeEach(async ({ page }, testInfo) => {
        testLogger.testStart(testInfo.title, testInfo.file);
        await navigateToBase(page);
        pm = new PageManager(page);
        await page.goto(`${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        testLogger.info('Test setup completed');
    });

    test.afterEach(async ({}, testInfo) => {
        testLogger.testEnd(testInfo.title, testInfo.status);
    });

    test("should navigate to trace details from the expanded log row View Trace action", {
        tag: ['@view-trace', '@logs', '@all', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Test: expanded-row View Trace navigates to trace details');

        const streamName = `e2e_view_trace_${uniqueStreamSuffix()}`;
        const traceId = await ingestViewTraceFixture(page, streamName);

        await pm.logsPage.selectStream(streamName);
        await pm.logsPage.setDateTimeTo15Minutes();
        await pm.logsPage.clickRefresh();
        await pm.logsPage.waitForSearchResultRows();

        await pm.logsPage.openFirstLogDetails();
        await pm.logsPage.expectExpandedRowViewTraceVisible();
        await pm.logsPage.clickExpandedRowViewTrace();

        await pm.tracesPage.expectTraceDetailsResolved(traceId);
        testLogger.info('PASSED: expanded-row View Trace navigated to trace details');
    });

    test("should navigate to trace details from the row-detail drawer View Trace action", {
        tag: ['@view-trace', '@logs', '@all', '@P0', '@smoke']
    }, async ({ page }) => {
        testLogger.info('Test: drawer View Trace navigates to trace details');

        const streamName = `e2e_view_trace_${uniqueStreamSuffix()}`;
        const traceId = await ingestViewTraceFixture(page, streamName);

        await pm.logsPage.selectStream(streamName);
        await pm.logsPage.setDateTimeTo15Minutes();
        await pm.logsPage.clickRefresh();
        await pm.logsPage.waitForSearchResultRows();

        await pm.logsPage.openLogDetailSidebar();
        await pm.logsPage.expectDrawerViewTraceVisible();
        await pm.logsPage.clickDrawerViewTrace();

        await pm.tracesPage.expectTraceDetailsResolved(traceId);
        testLogger.info('PASSED: drawer View Trace navigated to trace details');
    });

    test("should hide the View Trace action when the record has no trace_id", {
        tag: ['@view-trace', '@logs', '@all', '@P1', '@negative']
    }, async ({ page }) => {
        testLogger.info('Test: View Trace action hidden for records without trace_id');

        // Global e2e_automate stream (ingested by global setup) carries no trace_id field.
        await pm.logsPage.selectStream(logData.Stream);
        await pm.logsPage.setDateTimeTo15Minutes();
        await pm.logsPage.clickRefresh();
        await pm.logsPage.waitForSearchResultRows();

        await pm.logsPage.openFirstLogDetails();
        await pm.logsPage.expectExpandedRowViewTraceHidden();

        await pm.logsPage.openLogDetailSidebar();
        await pm.logsPage.expectDrawerViewTraceHidden();
        testLogger.info('PASSED: View Trace action hidden in both entry points');
    });

    test("should render the traces-stream picker with a default stream selected in the detail drawer", {
        tag: ['@view-trace', '@logs', '@all', '@P1']
    }, async ({ page }) => {
        testLogger.info('Test: drawer traces-stream picker defaults to the first traces stream');

        const streamName = `e2e_view_trace_${uniqueStreamSuffix()}`;
        await ingestViewTraceFixture(page, streamName);

        await pm.logsPage.selectStream(streamName);
        await pm.logsPage.setDateTimeTo15Minutes();
        await pm.logsPage.clickRefresh();
        await pm.logsPage.waitForSearchResultRows();

        await pm.logsPage.openLogDetailSidebar();
        await pm.logsPage.expectDrawerViewTraceStreamSelectVisible();

        const selectedText = await pm.logsPage.getDrawerViewTraceStreamSelectText();
        expect(selectedText.length).toBeGreaterThan(0);
        testLogger.info(`Drawer traces-stream picker selected: ${selectedText}`);
    });

    test("should navigate without crashing when the trace_id does not resolve to a real trace", {
        tag: ['@view-trace', '@logs', '@all', '@P2']
    }, async ({ page }) => {
        testLogger.info('Test: navigation succeeds even when the trace_id has no matching trace');

        const streamName = `e2e_view_trace_${uniqueStreamSuffix()}`;
        // 32-char hex id that intentionally matches no ingested trace.
        const mismatchTraceId = "ffffffffffffffffffffffffffffffff";

        const ingestResponse = await ingestCustomData(page, streamName, [
            { trace_id: mismatchTraceId, message: "view-trace mismatch e2e record" },
        ]);
        if (ingestResponse.status !== 200) {
            testLogger.warn(`Log ingestion returned ${ingestResponse.status} for ${streamName}`, {
                data: JSON.stringify(ingestResponse.data || {}),
            });
        }
        const searchable = await waitForFieldValueSearchable(page, streamName, "trace_id", mismatchTraceId, 60000);
        if (!searchable) {
            throw new Error(`trace_id=${mismatchTraceId} never became searchable in stream ${streamName}`);
        }

        await pm.logsPage.selectStream(streamName);
        await pm.logsPage.setDateTimeTo15Minutes();
        await pm.logsPage.clickRefresh();
        await pm.logsPage.waitForSearchResultRows();

        await pm.logsPage.openFirstLogDetails();
        await pm.logsPage.expectExpandedRowViewTraceVisible();
        await pm.logsPage.clickExpandedRowViewTrace();

        await pm.tracesPage.expectTraceDetailsResolved(mismatchTraceId);
        testLogger.info('PASSED: navigation occurred for unresolved trace_id without crashing');
    });
});
