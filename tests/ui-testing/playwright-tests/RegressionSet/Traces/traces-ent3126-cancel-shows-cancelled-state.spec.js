// Copyright 2026 OpenObserve Inc.
// o2-enterprise#3126 B2: after Cancel, Traces claimed the time window held no data. Cancel is enterprise-only.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  generateBasicTrace,
  buildTracePayload,
  generateHexId,
} = require('../../utils/service-graph-ingestion.js');
const { ingestOtlpTraces, waitForSearch, deleteStream } = require('../../utils/traces-api.js');

const FIXTURE_TRACES = 3;

test.describe('Cancelling a trace search (#3126 B2)', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;
  let operation;
  let releaseSearches = null;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const runId = generateHexId(4);
    stream = `e2e_ent3126c_${runId}`;
    operation = `cancel_${runId}`;
    await navigateToBase(page);
    pm = new PageManager(page);
    const traces = Array.from({ length: FIXTURE_TRACES }, () => generateBasicTrace({
      clientService: `e2eent3126c${runId}-web`, serverService: `e2eent3126c${runId}-api`, operationName: operation,
    }));
    await ingestOtlpTraces(page.request, stream, buildTracePayload(traces.flatMap((t) => t.payload.resourceSpans)));
    await waitForSearch(page.request, `SELECT COUNT(DISTINCT trace_id) AS traces FROM "${stream}"`, {
      size: 1,
      pick: (search) => (search.hits[0] || {}).traces,
      expected: FIXTURE_TRACES,
      message: 'every fixture trace must be searchable',
    });
  });

  test.afterEach(async ({ page }, testInfo) => {
    if (releaseSearches) await releaseSearches();
    releaseSearches = null;
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('cancelling a new search over shown results says it was cancelled and keeps no stale rows', {
    tag: ['@bug-ent3126', '@P3', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.tracesPage.navigateToTracesTab(stream, 'traces');
    await pm.tracesPage.expectTraceResultWithOperationName(operation);
    expect(await pm.tracesPage.getResultRowCount(), 'precondition: results are on screen before the search')
      .toBeGreaterThan(0);

    releaseSearches = await pm.tracesPage.holdTraceListSearches();
    await pm.tracesPage.startTraceSearch();
    await pm.tracesPage.cancelRunningSearch();

    await pm.tracesPage.expectSearchCancelledStateVisible();
    await pm.tracesPage.expectNoEventsStateHidden();
    expect(await pm.tracesPage.getResultRowCount()).toBe(0);

    await releaseSearches();
    releaseSearches = null;
    await pm.tracesPage.runQueryFromCancelledState();
    await pm.tracesPage.expectTraceResultWithOperationName(operation);
    await pm.tracesPage.expectSearchCancelledStateHidden();
  });

  test('cancelling the first search says it was cancelled, not that the window is empty', {
    tag: ['@bug-ent3126', '@P3', '@regression', '@tracesRegression'],
  }, async () => {
    releaseSearches = await pm.tracesPage.holdTraceListSearches();
    await pm.tracesPage.navigateToTracesTab(stream, 'traces');
    await pm.tracesPage.cancelRunningSearch();

    await pm.tracesPage.expectSearchCancelledStateVisible();
    await pm.tracesPage.expectNoEventsStateHidden();

    await releaseSearches();
    releaseSearches = null;
    await pm.tracesPage.runQueryFromCancelledState();
    await pm.tracesPage.expectTraceResultWithOperationName(operation);
    await pm.tracesPage.expectSearchCancelledStateHidden();
  });
});
