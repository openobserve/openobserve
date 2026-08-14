// traceDetails.spec.js
// Tests for OpenObserve Traces feature - Trace Details functionality
// Extended: span load path now goes through GET /traces/{trace_id}/details.
// Rewrote the stale "toggle timeline" step into a tab-switch assertion, and
// strengthened the copy/search/share assertions to assert real outcomes.
// Added: waterfall render (P0), span-selection -> sidebar (P0), error-span badge,
// trace-not-found redirect, search-input-hidden-on-non-waterfall-tabs.
// UNWIRED LLM/RUM/enterprise behaviors are parked as test.fixme.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const { ingestTraces } = require('../utils/trace-ingestion.js');

test.describe("Trace Details testcases", () => {
  test.describe.configure({ mode: 'serial' });
  let pm; // Page Manager instance

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    // Navigate to base URL with authentication
    await navigateToBase(page);
    pm = new PageManager(page);

    // Navigate to traces and set up a search on the seeded `default` stream
    await pm.tracesPage.navigateToTracesUrl();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    await pm.tracesPage.selectTraceStream('default');
    await pm.tracesPage.setTimeRange('15m');
    await pm.tracesPage.runTraceSearch();

    testLogger.info('Test setup completed for trace details - checking for traces');
  });

  test.afterEach(async ({ page }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  /**
   * Precondition helper: open the first trace result, wait for the details view
   * to mount (the operation-name header is the stable anchor), then switch to
   * the waterfall tab (the active tab is persisted per-browser) and wait for the
   * span tree to render.
   */
  async function openTraceDetails(page, pm, testName) {
    const hasResults = await pm.tracesPage.hasTraceResults();
    if (!hasResults) {
      throw new Error(`Precondition failed: No trace results available for ${testName}. Ensure trace data is ingested.`);
    }

    await pm.tracesPage.clickFirstTraceResult();
    await pm.tracesPage.expectTraceDetailsHeaderVisible();
    await pm.tracesPage.openTraceDetailsTab('waterfall');
    await pm.tracesPage.expectTraceDetailsVisible();
  }

  // ===== P0 — critical path =====

  test("P0: Open trace renders the span waterfall via the /details endpoint", {
    tag: ['@trace-details', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Opening a trace and verifying the waterfall tree renders via GET /traces/{id}/details');

    await openTraceDetails(page, pm, 'waterfall render test');

    const operationName = await pm.tracesPage.getTraceOperationName();
    const spanContainerCount = await pm.tracesPage.getSpanContainerCount();
    const spansCountText = await pm.tracesPage.getSpanCount();

    expect(spanContainerCount).toBeGreaterThanOrEqual(1);
    expect(operationName).not.toBe('');

    const spansCount = parseInt(spansCountText, 10);
    expect(Number.isInteger(spansCount)).toBe(true);
    expect(spansCount).toBeGreaterThanOrEqual(1);

    testLogger.info('Trace waterfall rendered via /details endpoint');
  });

  test("P0: Selecting a span opens the details sidebar with matching operation name", {
    tag: ['@trace-details', '@traces', '@all', '@P0']
  }, async ({ page }) => {
    testLogger.info('Selecting a span and verifying the sidebar opens with the matching operation name');

    await openTraceDetails(page, pm, 'span selection test');

    const firstSpanOperationName = await pm.tracesPage.getFirstSpanOperationName();
    expect(firstSpanOperationName).not.toBe('');

    await pm.tracesPage.selectFirstSpan();
    await pm.tracesPage.expectSidebarVisible();

    const sidebarOperationName = await pm.tracesPage.getSidebarOperationName();
    expect(sidebarOperationName).toBe(firstSpanOperationName);

    testLogger.info('Span selection opened the sidebar with the matching operation name');
  });

  // ===== P1 — important but non-blocking =====

  test("P1: Switching tabs renders the flame-graph and service map views", {
    tag: ['@trace-details', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Switching trace-details tabs and verifying each view renders');

    await openTraceDetails(page, pm, 'tab switch test');

    await pm.tracesPage.openTraceDetailsTab('flame-graph');
    await pm.tracesPage.expectTraceDetailsTabActive('flame-graph');

    await pm.tracesPage.openTraceDetailsTab('map');
    await pm.tracesPage.expectServiceMapChartVisible();

    await pm.tracesPage.openTraceDetailsTab('waterfall');
    await pm.tracesPage.expectTraceDetailsVisible();

    testLogger.info('Tab switching rendered flame-graph, service map, and waterfall views');
  });

  test("P1: In-trace search updates the match counter", {
    tag: ['@trace-details', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Searching within a trace and verifying the match counter updates');

    await openTraceDetails(page, pm, 'search test');

    // "HTTP" matches the root + client spans (HTTP POST ...) in every seeded trace.
    await pm.tracesPage.searchWithinTrace('HTTP');
    const total = await pm.tracesPage.getSearchResultTotal();

    expect(total).toBeGreaterThanOrEqual(2);

    testLogger.info('In-trace search produced a non-trivial match count');
  });

  test("P1: Copy trace ID shows a success toast", {
    tag: ['@trace-details', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Copying the trace ID and verifying the success toast');

    await openTraceDetails(page, pm, 'copy id test');

    const traceId = await pm.tracesPage.getTraceId();
    expect(traceId).not.toBe('');

    await pm.tracesPage.copyTraceId();
    await pm.tracesPage.expectToastVisible('Trace ID copied');

    testLogger.info('Copy trace ID produced the success toast');
  });

  test("P1: Share link runs the share flow and shows feedback", {
    tag: ['@trace-details', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Clicking share and verifying the share action produces feedback');

    await openTraceDetails(page, pm, 'share test');

    await pm.tracesPage.expectShareLinkButtonEnabled();
    await pm.tracesPage.shareTraceLink();
    await pm.tracesPage.expectAnyToastVisible();

    testLogger.info('Share link produced user feedback');
  });

  test("P1: View related logs redirects to /logs filtered by trace_id", {
    tag: ['@trace-details', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Opening related logs from trace details');

    await openTraceDetails(page, pm, 'view logs test');

    // The button is disabled until a log stream is selected; global setup ingests
    // exactly one log stream (e2e_automate), which is auto-selected. Select one
    // explicitly only if auto-selection has not happened.
    if (!(await pm.tracesPage.isViewLogsButtonEnabled())) {
      await pm.tracesPage.selectFirstLogStreamInTraceDetails();
    }
    await pm.tracesPage.expectViewLogsButtonEnabled();

    await pm.tracesPage.viewRelatedLogs();
    await pm.tracesPage.expectUrlContains(/logs/);
    expect(page.url()).toContain('trace_explorer');

    testLogger.info('Redirected to logs filtered by trace_id');
  });

  test("P1: Error-span badge appears for a deterministic error trace", {
    tag: ['@trace-details', '@traces', '@all', '@P1']
  }, async ({ page }) => {
    testLogger.info('Ingesting a deterministic error trace and verifying the error-span badge');

    const { traceIds } = await ingestTraces(page, 1, { forceScenario: 'error' });
    expect(traceIds.length).toBeGreaterThanOrEqual(1);
    const traceId = traceIds[0];

    const nowUs = Date.now() * 1000;
    const from = nowUs - 3600000000; // -1h in µs
    const to = nowUs + 3600000000; // +1h in µs

    // The just-ingested trace is indexed async; retry the direct route until the
    // tree renders (or the not-found redirect fires, in which case we re-navigate).
    let treeVisible = false;
    for (let attempt = 0; attempt < 3 && !treeVisible; attempt++) {
      await pm.tracesPage.navigateToTraceDetailsDirect({ stream: 'default', traceId, from, to });
      treeVisible = await pm.tracesPage.isTraceDetailsTreeVisible();
      if (!treeVisible) {
        await page.waitForTimeout(2000);
      }
    }
    await pm.tracesPage.openTraceDetailsTab('waterfall');
    await pm.tracesPage.expectTraceDetailsVisible();

    const errorSpansCountText = await pm.tracesPage.getErrorSpansCount();
    const errorSpansCount = parseInt(errorSpansCountText, 10);
    expect(errorSpansCount).toBeGreaterThanOrEqual(1);

    testLogger.info('Error-span badge populated for the error trace');
  });

  // ===== P2 — edge cases =====

  test("P2: Trace not found redirects back to the traces list", {
    tag: ['@trace-details', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Navigating to a non-existent trace id and verifying the not-found redirect');

    const nowUs = Date.now() * 1000;
    const from = nowUs - 3600000000; // -1h in µs
    const to = nowUs + 3600000000; // +1h in µs
    const nonExistentTraceId = '00000000000000000000000000000000';

    await pm.tracesPage.navigateToTraceDetailsDirect({ stream: 'default', traceId: nonExistentTraceId, from, to });
    await pm.tracesPage.expectTraceNotFoundToast();

    testLogger.info('Trace-not-found toast shown and redirected back to /traces');
  });

  test("P2: Search input is hidden on non-waterfall tabs", {
    tag: ['@trace-details', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    testLogger.info('Verifying the in-trace search input is hidden on flame-graph and map tabs');

    await openTraceDetails(page, pm, 'search input visibility test');

    await pm.tracesPage.openTraceDetailsTab('flame-graph');
    await pm.tracesPage.expectTraceDetailsTabActive('flame-graph');
    await pm.tracesPage.expectTraceDetailsSearchInputHidden();

    await pm.tracesPage.openTraceDetailsTab('map');
    await pm.tracesPage.expectTraceDetailsSearchInputHidden();

    await pm.tracesPage.openTraceDetailsTab('waterfall');
    await pm.tracesPage.expectTraceDetailsSearchInputVisible();

    testLogger.info('Search input visibility toggles per tab');
  });

  // ===== UNWIRED — feature-incomplete for OSS seed data, parked as fixme =====

  test.fixme("DAG tab (LLM traces) — not wired: seed spans have no gen_ai_* attrs (TraceDetails.vue:1740-1741)", {
    tag: ['@trace-details', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    await openTraceDetails(page, pm, 'dag tab');
    const opened = await pm.tracesPage.openTraceDetailsTab('dag');
    expect(opened).toBe(true);
    await pm.tracesPage.expectDagViewVisible();
  });

  test.fixme("Thread tab (LLM traces) — not wired: config.showLLMUI !== 'false' && hasLLMSpans (TraceDetails.vue:1745)", {
    tag: ['@trace-details', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    await openTraceDetails(page, pm, 'thread tab');
    const opened = await pm.tracesPage.openTraceDetailsTab('thread');
    expect(opened).toBe(true);
    await pm.tracesPage.expectTraceDetailsTabActive('thread');
  });

  test.fixme("Session replay button (RUM) — not wired: no rum_session_id spans (TraceDetails.vue:1432-1434)", {
    tag: ['@trace-details', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    await openTraceDetails(page, pm, 'session replay button');
    await pm.tracesPage.expectSessionReplayButtonVisible();
  });

  test.fixme("Enterprise annotate / dataset / evaluate buttons — not wired: gated on isEnterprise/isCloud (TraceDetails.vue:1589-1666)", {
    tag: ['@trace-details', '@traces', '@all', '@P2']
  }, async ({ page }) => {
    await openTraceDetails(page, pm, 'enterprise action buttons');
    await pm.tracesPage.expectEnterpriseActionButtonsVisible();
  });
});
