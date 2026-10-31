// Copyright 2026 OpenObserve Inc.
// o2-enterprise#3126 B1: the service side panel opened from a Services Catalog row always said Healthy.
const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  generateErrorRateTraces,
  buildTracePayload,
  generateHexId,
} = require('../../utils/service-graph-ingestion.js');
const { ingestOtlpTraces, waitForSearch, deleteStream } = require('../../utils/traces-api.js');

// 3 of 10 calls fail (30%, Critical) and 2 of 25 fail (8%, Warning).
const CRITICAL = { total: 10, errors: 3 };
const WARNING = { total: 25, errors: 2 };

test.describe('Services Catalog side panel health badge (#3126 B1)', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;
  let stream;
  let services;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    const runId = generateHexId(4);
    stream = `e2e_3126_${runId}`;
    services = {
      client: `e2e3126${runId}-api`,
      critical: `e2e3126${runId}-db`,
      warning: `e2e3126${runId}-cache`,
    };
    await navigateToBase(page);
    pm = new PageManager(page);
    const traces = [
      ...generateErrorRateTraces({
        clientService: services.client, serverService: services.critical,
        totalCount: CRITICAL.total, errorCount: CRITICAL.errors,
      }),
      ...generateErrorRateTraces({
        clientService: services.client, serverService: services.warning,
        totalCount: WARNING.total, errorCount: WARNING.errors,
      }),
    ];
    await ingestOtlpTraces(page.request, stream, buildTracePayload(traces.flatMap((t) => t.payload.resourceSpans)));
    await waitForSearch(page.request, `SELECT COUNT(*) AS spans FROM "${stream}"`, {
      size: 1,
      pick: (search) => (search.hits[0] || {}).spans,
      expected: traces.length * 2,
      message: 'every fixture span must be searchable',
    });
    await pm.tracesPage.navigateToTracesUrlWithStream(stream);
    await pm.tracesPage.navigateToServicesViaTab();
    await pm.servicesCatalogPage.waitForLoad();
  });

  test.afterEach(async ({ page }, testInfo) => {
    await deleteStream(page.request, stream);
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test('the panel badge matches a Critical row', {
    tag: ['@bug-ent3126', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.servicesCatalogPage.expectStatusBadge(services.critical, 'Critical');

    await pm.servicesCatalogPage.clickServiceRow(services.critical);

    await pm.servicesCatalogPage.expectSidePanelHealthBadge('Critical');
    await pm.servicesCatalogPage.expectSidePanelTitle(services.critical);
  });

  test('the panel badge matches a Warning row, on the same scale as the catalog', {
    tag: ['@bug-ent3126', '@P2', '@regression', '@tracesRegression'],
  }, async () => {
    await pm.servicesCatalogPage.expectStatusBadge(services.warning, 'Warning');

    await pm.servicesCatalogPage.clickServiceRow(services.warning);

    await pm.servicesCatalogPage.expectSidePanelHealthBadge('Warning');
    await pm.servicesCatalogPage.expectSidePanelTitle(services.warning);
  });
});
