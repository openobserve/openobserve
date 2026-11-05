// Copyright 2026 OpenObserve Inc.
// o2-enterprise#3126 B1: a real Graph View node click opened the side panel with a Healthy badge for a Critical node.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  generateErrorRateTraces,
  buildTracePayload,
  generateHexId,
} = require('../../utils/service-graph-ingestion.js');
const { ingestOtlpTraces, deleteStream } = require('../../utils/traces-api.js');

// The service-graph rollup lags ingestion by a few minutes on a local or CI server.
const TOPOLOGY_WAIT_MS = 6 * 60 * 1000;

test.describe('Service Graph side panel health badge (#3126 B1)', { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;
  let server;

  test.beforeEach(async ({ page }, testInfo) => {
    test.setTimeout(TOPOLOGY_WAIT_MS + 3 * 60 * 1000);
    testLogger.testStart(testInfo.title, testInfo.file);
    const runId = generateHexId(4);
    stream = `e2e_ent3126_${runId}`;
    server = `e2eent3126${runId}-db`;
    await navigateToBase(page);
    pm = new PageManager(page);
    const traces = generateErrorRateTraces({
      clientService: `e2eent3126${runId}-api`, serverService: server, totalCount: 10, errorCount: 3,
    });
    await ingestOtlpTraces(page.request, stream, buildTracePayload(traces.flatMap((t) => t.payload.resourceSpans)));
    await expect.poll(async () => (await pm.serviceGraphPage.findNodeByLabel(server))?.error_rate ?? -1, {
      timeout: TOPOLOGY_WAIT_MS,
      intervals: [10000],
      message: 'the failing service must reach the service-graph topology as Critical (>10% errors)',
    }).toBeGreaterThan(10);
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('a real click on a Critical node in Graph View shows Critical', {
    tag: ['@bug-ent3126', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.serviceGraphPage.navigateToServiceGraphTab(stream);
    await pm.serviceGraphPage.switchToGraphView();

    await pm.serviceGraphPage.clickGraphViewNode(server);

    await pm.serviceGraphPage.expectSidePanelHealthBadge('Critical');
  });
});
