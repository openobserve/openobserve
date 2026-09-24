/**
 * Service Graph Side Panel Regression - Enterprise-Only Tests
 *
 * The service graph routes sit inside the #[cfg(feature = "enterprise")] block in
 * src/api/http/src/handler/http/router/mod.rs, so an OSS build 404s on them.
 * Excluded from the OSS regression workflow and appended via the enterprise overlay.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');
const {
  generateFullTopology,
  ingestTraces,
  waitForServiceGraphData,
} = require('../../utils/service-graph-ingestion.js');

const TARGET_SERVICE = 'api-gateway';
const LATENCY_COLUMNS = ['p75', 'p95', 'p99'];

test.describe('Service Graph Side Panel Regression', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeAll(async ({ browser }) => {
    // The rollup daemon wakes on an interval, so the wait dominates this setup.
    test.setTimeout(600000);
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();
    try {
      await ingestTraces(page, generateFullTopology({ tracesPerFlow: 3, errorRate: 0.2 }), { delayMs: 50 });
      const result = await waitForServiceGraphData(page, {
        maxWaitMs: 240000,
        pollIntervalMs: 10000,
        expectedMinEdges: 5,
      });
      testLogger.info(`Service graph setup: success=${result.success} edges=${(result.edges || []).length}`);
    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    // The panel reads the stream filter from localStorage, which may carry another run's value.
    await page.evaluate(() => localStorage.setItem('serviceGraph_streamFilter', 'default'));
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();
    await pm.serviceGraphPage.clickNodeByName(TARGET_SERVICE);
    await pm.serviceGraphPage.expectSidePanelVisible();
  });

  test('Operations table sorts on duration columns', {
    tag: ['@bug-11590', '@P1', '@regression', '@serviceGraph', '@tracesRegressionEnt', '@enterprise'],
  }, async () => {
    await pm.serviceGraphPage.expectOperationsSectionVisible();

    const rowCount = await pm.serviceGraphPage.getOperationsTableRowCount();
    // A single row is trivially ordered, so it cannot demonstrate sorting.
    test.skip(rowCount < 2, `needs at least 2 operations to order, got ${rowCount}`);

    await pm.serviceGraphPage.sortOperationsByColumn('p95');
    const ascOperations = await pm.serviceGraphPage.getOperationsColumnText('operation');
    const ascRatios = await pm.serviceGraphPage.getOperationsDurationRatios('p95');
    testLogger.info(`Ascending p95 ratios: ${ascRatios.join(', ')}`);

    // The defect was duration columns comparing as formatted strings, so assert
    // the latencies themselves rather than merely that the order changed.
    expect(ascRatios, 'p95 must order by latency ascending')
      .toEqual([...ascRatios].sort((a, b) => a - b));

    await pm.serviceGraphPage.sortOperationsByColumn('p95');
    const descOperations = await pm.serviceGraphPage.getOperationsColumnText('operation');
    const descRatios = await pm.serviceGraphPage.getOperationsDurationRatios('p95');
    testLogger.info(`Descending p95 ratios: ${descRatios.join(', ')}`);

    expect(descRatios, 'second click must reverse the latency order')
      .toEqual([...descRatios].sort((a, b) => b - a));
    expect(descOperations, 'descending rows must be the ascending rows reversed')
      .toEqual([...ascOperations].reverse());
  });

  test('Operations table exposes request, error and latency columns', {
    tag: ['@bug-11169', '@P2', '@regression', '@serviceGraph', '@tracesRegressionEnt', '@enterprise'],
  }, async () => {
    await pm.serviceGraphPage.expectOperationsSectionVisible();

    const columnIds = await pm.serviceGraphPage.getOperationsColumnIds();
    testLogger.info(`Operations columns: ${columnIds.join(', ')}`);

    for (const expected of ['operation', 'requests', 'errors', ...LATENCY_COLUMNS]) {
      expect(columnIds, `operations table must expose the ${expected} column`).toContain(expected);
    }
  });

  test('Resource tabs carry the operations table columns', {
    tag: ['@bug-11360', '@P2', '@regression', '@serviceGraph', '@tracesRegressionEnt', '@enterprise'],
  }, async () => {
    // Resource tabs are generated from the OTEL attributes present, so a dataset
    // without pod/node attributes legitimately renders neither tab.
    const tabIds = await pm.serviceGraphPage.getSidePanelTabIds();
    testLogger.info(`Side panel tabs: ${tabIds.join(', ')}`);
    test.skip(!tabIds.includes('nodes') && !tabIds.includes('pods'),
      `no node/pod resource tab in this dataset, tabs were: ${tabIds.join(', ')}`);

    if (tabIds.includes('nodes')) {
      await pm.serviceGraphPage.switchToNodesTab();
      await pm.serviceGraphPage.expectNodesTableVisible();
      const nodeColumns = await pm.serviceGraphPage.getResourceTableColumnIds(pm.serviceGraphPage.nodesTable);
      testLogger.info(`Nodes table columns: ${nodeColumns.join(', ')}`);
      for (const expected of ['requests', 'errors', ...LATENCY_COLUMNS]) {
        expect(nodeColumns, `nodes table must expose the ${expected} column`).toContain(expected);
      }
    }

    if (tabIds.includes('pods')) {
      await pm.serviceGraphPage.switchToPodsTab();
      await pm.serviceGraphPage.expectPodsTableVisible();
      const podColumns = await pm.serviceGraphPage.getResourceTableColumnIds(pm.serviceGraphPage.podsTable);
      testLogger.info(`Pods table columns: ${podColumns.join(', ')}`);
      for (const expected of ['requests', 'errors', ...LATENCY_COLUMNS]) {
        expect(podColumns, `pods table must expose the ${expected} column`).toContain(expected);
      }
    }
  });
});
