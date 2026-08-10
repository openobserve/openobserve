/**
 * View Trace from Log Rows — Null Guard  (feature: view-trace, area: Logs)
 *
 * Tests the "View Trace" button that appears in expanded log rows and the detail
 * sidebar drawer when a log record contains a trace_id field. Covers:
 *   - Navigation from expanded row → trace details page (TC-VT-001)
 *   - Button hidden when log has no trace_id field (TC-VT-002)
 *   - Navigation from detail sidebar drawer (TC-VT-003)
 *   - Null guard: toast when redirectToTraces receives undefined (TC-VT-004 — fixme)
 *   - Trace stream picker auto-selects first traces stream (TC-VT-005)
 */

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const logData = require('../../fixtures/log.json');
const { ingestCustomData, waitForStreamData } = require('../utils/data-ingestion.js');

/**
 * Build custom log records for view-trace tests.
 * @param {boolean} includeTraceId - whether to include trace_id/span_id fields
 * @param {number} count - number of records to generate
 * @param {string} suffix - unique suffix to ensure unique IDs across parallel tests
 * @returns {Array<Object>}
 */
function buildTestData(includeTraceId, count, suffix) {
  const now = Date.now();
  const records = [];
  for (let i = 0; i < count; i++) {
    const record = {
      _timestamp: now * 1000 + i,
      message: `view-trace test log #${i} [${suffix}]`,
      level: i % 2 === 0 ? 'info' : 'error'
    };
    if (includeTraceId) {
      record.trace_id = `${suffix}-trace-${i}`;
      record.span_id = `${suffix}-span-${i}`;
    }
    records.push(record);
  }
  return records;
}

/**
 * Create a stream name that is unique per test to avoid parallel-test collisions.
 */
function uniqueStreamName(slug) {
  const safe = slug.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 24);
  return `e2e_vt_${safe}`;
}

test.describe("View Trace testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    const logsUrl = `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`;
    await page.goto(logsUrl);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  // ─────────────────────────────────────────────────────────────
  // TC-VT-001 (P0): View Trace from expanded log row → trace details
  // ─────────────────────────────────────────────────────────────
  test("TC-VT-001: should navigate to trace details when clicking View Trace from expanded log row", {
    tag: ['@viewTrace', '@logs', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Starting TC-VT-001: View Trace from expanded row');
    const slug = 'vt001';
    const streamName = uniqueStreamName(slug);
    const data = buildTestData(true, 3, slug);

    // 1. Ingest custom data with trace_id
    testLogger.info(`Ingesting ${data.length} records to stream: ${streamName}`);
    await ingestCustomData(page, streamName, data);
    await waitForStreamData(page, streamName, 3, 30000);
    // Schema hydration settle
    await page.waitForTimeout(2000);

    // 2. Select stream and run query
    await pm.logsPage.selectStream(streamName);
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await pm.logsPage.waitForResultsLoaded();

    // 3. Expand first row
    await pm.logsPage.clickExpandRow(0);
    // Wait for expanded content to render
    await page.waitForTimeout(1500);

    // 4. Assert View Trace button and trace stream picker are visible
    await pm.logsPage.expectViewTraceButtonVisible();
    await pm.logsPage.expectTraceStreamPickerVisible();

    // 5. Click View Trace
    testLogger.info('Clicking View Trace button');
    await pm.logsPage.clickViewTraceButton();

    // 6. Wait for navigation to /web/traces
    await page.waitForURL(/\/web\/traces/, { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 7. Assert URL contains trace_id, stream, span_id
    const url = page.url();
    expect(url).toContain('trace_id=');
    expect(url).toContain('stream=');
    expect(url).toContain('span_id=');

    // 8. Assert trace details page loaded
    await pm.tracesPage.expectTraceDetailsHeaderVisible();

    testLogger.info('TC-VT-001 completed successfully');
  });

  // ─────────────────────────────────────────────────────────────
  // TC-VT-002 (P0): View Trace button hidden when log has no trace_id
  // ─────────────────────────────────────────────────────────────
  test("TC-VT-002: should hide View Trace button when log has no trace_id field", {
    tag: ['@viewTrace', '@logs', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Starting TC-VT-002: Button hidden without trace_id');
    const slug = 'vt002';
    const streamName = uniqueStreamName(slug);

    // Build data: first record WITH trace_id, second WITHOUT
    const withTrace = buildTestData(true, 1, `${slug}-with`);
    const withoutTrace = buildTestData(false, 1, `${slug}-without`);
    const data = [...withTrace, ...withoutTrace];

    // 1. Ingest custom data (mix of with/without trace_id)
    testLogger.info(`Ingesting ${data.length} records to stream: ${streamName}`);
    await ingestCustomData(page, streamName, data);
    await waitForStreamData(page, streamName, 2, 30000);
    await page.waitForTimeout(2000);

    // 2. Select stream and run query
    await pm.logsPage.selectStream(streamName);
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await pm.logsPage.waitForResultsLoaded();

    // 3. Expand row 0 (HAS trace_id) → button should be visible
    await pm.logsPage.clickExpandRow(0);
    await page.waitForTimeout(1500);
    await pm.logsPage.expectViewTraceButtonVisible();

    // 4. Collapse row 0
    await pm.logsPage.clickExpandRow(0);
    await page.waitForTimeout(500);

    // 5. Expand row 1 (NO trace_id) → button should NOT be visible
    await pm.logsPage.clickExpandRow(1);
    await page.waitForTimeout(1500);
    await pm.logsPage.expectViewTraceButtonHidden();

    testLogger.info('TC-VT-002 completed successfully');
  });

  // ─────────────────────────────────────────────────────────────
  // TC-VT-003 (P1): View Trace from detail sidebar drawer
  // ─────────────────────────────────────────────────────────────
  test("TC-VT-003: should navigate to trace details when clicking View Trace from detail drawer", {
    tag: ['@viewTrace', '@logs', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Starting TC-VT-003: View Trace from detail drawer');
    const slug = 'vt003';
    const streamName = uniqueStreamName(slug);
    const data = buildTestData(true, 3, slug);

    // 1. Ingest custom data with trace_id
    testLogger.info(`Ingesting ${data.length} records to stream: ${streamName}`);
    await ingestCustomData(page, streamName, data);
    await waitForStreamData(page, streamName, 3, 30000);
    await page.waitForTimeout(2000);

    // 2. Select stream and run query
    await pm.logsPage.selectStream(streamName);
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await pm.logsPage.waitForResultsLoaded();

    // 3. Open detail sidebar drawer by clicking a table row
    await pm.logsPage.openLogDetailSidebar();
    await page.waitForTimeout(1500);

    // 4. Assert View Trace button is visible inside the drawer
    await pm.logsPage.expectViewTraceButtonVisible();

    // 5. Click View Trace in the drawer
    testLogger.info('Clicking View Trace button from detail drawer');
    await pm.logsPage.clickViewTraceButton();

    // 6. Wait for navigation to /web/traces
    await page.waitForURL(/\/web\/traces/, { timeout: 15000 });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 7. Assert URL contains trace_id
    expect(page.url()).toContain('trace_id=');

    // 8. Assert trace details page loaded
    await pm.tracesPage.expectTraceDetailsHeaderVisible();

    testLogger.info('TC-VT-003 completed successfully');
  });

  // ─────────────────────────────────────────────────────────────
  // TC-VT-004 (P1): Null guard — toast shown when log data is undefined
  // ─────────────────────────────────────────────────────────────
  test.fixme(
    "TC-VT-004 — not e2e-triggerable: null guard covered by unit test at web/src/plugins/logs/SearchResult.viewTrace.spec.ts",
    {
      tag: ['@viewTrace', '@logs', '@all', '@P1']
    },
    async ({ page }) => {
      testLogger.info('Starting TC-VT-004: Null guard toast (not reproducible in E2E)');

      // This test exists as documentation. The null guard in redirectToTraces
      // (SearchResult.vue:1911 and CorrelatedLogsTable.vue:1232) protects against
      // undefined payloads with a toast: "Could not open the trace for this log record."
      //
      // In E2E, the only way to trigger this path is a race condition where the
      // expansion slot row is recycled before the View Trace click handler fires —
      // this is not reliably reproducible. The unit test at
      // web/src/plugins/logs/SearchResult.viewTrace.spec.ts covers both
      // redirectToTraces(undefined) (null guard) and redirectToTraces({...valid})
      // (happy path) with full assertions.

      // If a reliable E2E trigger is discovered (e.g., fast row-recycling with
      // virtual scroll), uncomment the assertions below:

      // const toast = page.locator('[role="alert"]');
      // await expect(toast).toBeVisible({ timeout: 5000 });
      // await expect(toast).toContainText('Could not open the trace for this log record.');
      // const urlBefore = page.url();
      // expect(page.url()).toBe(urlBefore); // URL should NOT change
    }
  );

  // ─────────────────────────────────────────────────────────────
  // TC-VT-005 (P2): Trace stream picker auto-selects first traces stream
  // ─────────────────────────────────────────────────────────────
  test("TC-VT-005: should auto-select first traces stream in trace stream picker", {
    tag: ['@viewTrace', '@logs', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Starting TC-VT-005: Stream picker auto-select');
    const slug = 'vt005';
    const streamName = uniqueStreamName(slug);
    const data = buildTestData(true, 3, slug);

    // 1. Ingest custom data with trace_id
    testLogger.info(`Ingesting ${data.length} records to stream: ${streamName}`);
    await ingestCustomData(page, streamName, data);
    await waitForStreamData(page, streamName, 3, 30000);
    await page.waitForTimeout(2000);

    // 2. Select stream and run query
    await pm.logsPage.selectStream(streamName);
    await pm.logsPage.applyQueryAndWaitForSearchResponse();
    await pm.logsPage.waitForResultsLoaded();

    // 3. Expand first row
    await pm.logsPage.clickExpandRow(0);
    await page.waitForTimeout(1500);

    // 4. Assert trace stream picker is visible
    await pm.logsPage.expectTraceStreamPickerVisible();

    // 5. Assert the picker has a selected value (auto-selected first traces stream)
    await pm.logsPage.expectTraceStreamPickerHasValue();

    testLogger.info('TC-VT-005 completed successfully');
  });
});
