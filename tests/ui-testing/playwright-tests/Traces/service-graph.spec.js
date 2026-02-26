// service-graph.spec.js
// E2E tests for the Service Graph feature in Traces module
// Tests topology visualization, node/edge detail panels, and telemetry correlation

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');
const {
  generateFullTopology,
  generateAllEdgeCases,
  ingestTraces,
  waitForServiceGraphData,
  getTopology,
} = require('../utils/service-graph-ingestion.js');

test.describe("Service Graph testcases", { tag: '@enterprise' }, () => {
  test.describe.configure({ mode: 'parallel' });

  test.beforeAll(async ({ browser }) => {
    testLogger.info('=== SERVICE GRAPH SETUP: Ingesting trace data ===');
    const context = await browser.newContext({
      storageState: 'playwright-tests/utils/auth/user.json',
    });
    const page = await context.newPage();

    try {
      // Generate traces for full topology + edge cases
      const fullTraces = generateFullTopology({ tracesPerFlow: 3, errorRate: 0.2 });
      const edgeCaseTraces = generateAllEdgeCases();
      const allTraces = [...fullTraces, ...edgeCaseTraces];

      testLogger.info(`Generated ${allTraces.length} traces for ingestion`);

      // Ingest all traces
      await ingestTraces(page, allTraces, { delayMs: 50 });
      testLogger.info('Trace ingestion complete');

      // Wait for the service graph daemon to process (runs every ~30s)
      testLogger.info('Waiting for service graph daemon to process data...');
      const waitResult = await waitForServiceGraphData(page, {
        maxWaitMs: 120000,
        pollIntervalMs: 10000,
        expectedMinEdges: 10,
      });

      if (waitResult.success) {
        testLogger.info(`Service graph data ready: ${waitResult.edges.length} edges found after ${waitResult.waitedMs}ms`);
      } else {
        testLogger.warn(`Service graph data may be incomplete after ${waitResult.waitedMs}ms - continuing with available data`);
      }

      // Verify topology data is available
      const topoResult = await getTopology(page);
      const topoData = topoResult.data?.nodes ? topoResult.data : topoResult.data?.data;
      testLogger.info(`Topology available: ${topoData?.nodes?.length || 0} nodes, ${topoData?.edges?.length || 0} edges`);

    } finally {
      await page.close();
      await context.close();
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Set stream filter to 'default' — the test environment may have other streams in localStorage
    await page.evaluate(() => localStorage.setItem('serviceGraph_streamFilter', 'default'));

    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // ===== P0: SMOKE TESTS =====

  test("P0: Topology API returns expected nodes and edges after ingestion", {
    tag: ['@serviceGraph', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Verifying topology API data ===');

    const result = await pm.serviceGraphPage.getTopologyViaAPI();
    const data = result.data?.nodes ? result.data : result.data?.data;
    const nodes = data?.nodes || [];
    const edges = data?.edges || [];

    testLogger.info(`API returned: ${nodes.length} nodes, ${edges.length} edges`);

    // Verify minimum expected node count (15 production + edge case services)
    expect(nodes.length).toBeGreaterThanOrEqual(10);
    testLogger.info(`Node count check passed: ${nodes.length} >= 10`);

    // Verify minimum expected edge count
    expect(edges.length).toBeGreaterThanOrEqual(10);
    testLogger.info(`Edge count check passed: ${edges.length} >= 10`);

    // Verify key services exist as nodes
    const nodeLabels = nodes.map(n => n.label || n.id);
    const expectedServices = ['frontend-app', 'api-gateway', 'order-service', 'search-service', 'database'];
    for (const svc of expectedServices) {
      expect(nodeLabels).toContain(svc);
      testLogger.info(`Service '${svc}' found in topology`);
    }
  });

  test("P0: Navigate to service graph and verify chart renders", {
    tag: ['@serviceGraph', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Navigating to service graph ===');

    // Navigate directly via URL (reliable — avoids stale stream filter from traces page store)
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    testLogger.info('Navigated to service graph');

    // Verify URL contains service-graph tab parameter
    await expect(page).toHaveURL(/tab=service-graph/);
    testLogger.info('URL contains tab=service-graph');

    // Verify chart container is visible
    await pm.serviceGraphPage.expectServiceGraphPageVisible();
    testLogger.info('Service graph chart container is visible');

    // Take a screenshot for visual verification
    await pm.serviceGraphPage.takeGraphScreenshot('tree-view-default');
    testLogger.info('Screenshot captured');
  });

  test("P0: Click node and verify side panel opens with metrics", {
    tag: ['@serviceGraph', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Testing node detail panel ===');

    // Step 1: API validation — confirm api-gateway exists in topology
    const node = await pm.serviceGraphPage.findNodeByLabel('api-gateway');
    expect(node).toBeTruthy();
    testLogger.info(`API confirmed api-gateway exists: requests=${node.requests}, error_rate=${node.error_rate}`);

    // Step 2: UI validation — navigate directly to service graph via URL
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    await pm.serviceGraphPage.clickNodeByName('api-gateway');

    // Verify side panel opened
    await pm.serviceGraphPage.expectSidePanelVisible();
    testLogger.info('Side panel is visible');

    // Verify service name
    const serviceName = await pm.serviceGraphPage.getSidePanelServiceName();
    expect(serviceName).toContain('api-gateway');
    testLogger.info(`Service name: ${serviceName}`);

    // Verify metrics section is visible
    await pm.serviceGraphPage.expectMetricsSectionVisible();
    testLogger.info('Metrics section is visible');

    // Verify request rate is shown
    const requestRate = await pm.serviceGraphPage.getRequestRate();
    expect(requestRate).toBeTruthy();
    testLogger.info(`Request rate: ${requestRate}`);

    // Verify error rate is shown
    const errorRate = await pm.serviceGraphPage.getErrorRate();
    expect(errorRate).toBeTruthy();
    testLogger.info(`Error rate: ${errorRate}`);
  });

  // ===== P1: FUNCTIONAL TESTS =====

  test("P1: Verify api-gateway node has correct upstream and downstream services", {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Verifying api-gateway connections ===');

    // API validation of connections
    const result = await pm.serviceGraphPage.getTopologyViaAPI();
    const data = result.data?.nodes ? result.data : result.data?.data;
    const edges = data?.edges || [];

    // api-gateway upstream: edges where to === 'api-gateway'
    const upstreamEdges = edges.filter(e => e.to === 'api-gateway');
    const upstreamServices = upstreamEdges.map(e => e.from);
    testLogger.info(`api-gateway upstream services: ${upstreamServices.join(', ')}`);
    expect(upstreamServices).toContain('frontend-app');

    // api-gateway downstream: edges where from === 'api-gateway'
    const downstreamEdges = edges.filter(e => e.from === 'api-gateway');
    const downstreamServices = downstreamEdges.map(e => e.to);
    testLogger.info(`api-gateway downstream services: ${downstreamServices.join(', ')}`);

    // Expect at least 4 downstream services
    expect(downstreamServices.length).toBeGreaterThanOrEqual(4);

    // Verify key downstream services
    const expectedDownstream = ['order-service', 'user-service', 'search-service', 'auth-service'];
    for (const svc of expectedDownstream) {
      expect(downstreamServices).toContain(svc);
      testLogger.info(`Downstream '${svc}' confirmed`);
    }
  });

  test("P1: Verify user-service has degraded status and high error rate", {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Verifying user-service health status ===');

    // Step 1: API validation
    const node = await pm.serviceGraphPage.findNodeByLabel('user-service');
    expect(node).toBeTruthy();
    testLogger.info(`user-service node: ${JSON.stringify(node)}`);

    const apiErrorRate = node.error_rate || 0;
    testLogger.info(`user-service error_rate: ${apiErrorRate}`);
    expect(apiErrorRate).toBeGreaterThan(5);

    // Step 2: UI validation — click node and check health badge
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    await pm.serviceGraphPage.clickNodeByName('user-service');
    await pm.serviceGraphPage.expectSidePanelVisible();

    const status = await pm.serviceGraphPage.getHealthStatus();
    testLogger.info(`user-service health status: ${status}`);
    // Should be degraded (>5% error rate) or critical (>10%)
    expect(['degraded', 'critical']).toContain(status);

    await pm.serviceGraphPage.closeSidePanel();
  });

  test("P1: Verify search-service has healthy status and 0% error rate", {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Verifying search-service health status ===');

    // Step 1: API validation
    const node = await pm.serviceGraphPage.findNodeByLabel('search-service');
    expect(node).toBeTruthy();
    testLogger.info(`search-service node: ${JSON.stringify(node)}`);

    const apiErrorRate = node.error_rate || 0;
    testLogger.info(`search-service error_rate: ${apiErrorRate}`);
    expect(apiErrorRate).toBeLessThanOrEqual(5);

    // Step 2: UI validation — click node and check health badge
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    await pm.serviceGraphPage.clickNodeByName('search-service');
    await pm.serviceGraphPage.expectSidePanelVisible();

    const status = await pm.serviceGraphPage.getHealthStatus();
    testLogger.info(`search-service health status: ${status}`);
    expect(status).toBe('healthy');

    await pm.serviceGraphPage.closeSidePanel();
  });

  test("P1: Verify edge detail panel shows connection stats", {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Verifying edge detail panel ===');

    // Step 1: API validation — confirm edge data exists
    const edge = await pm.serviceGraphPage.findEdge('api-gateway', 'order-service');
    expect(edge).toBeTruthy();
    testLogger.info(`Edge api-gateway → order-service: ${JSON.stringify(edge)}`);

    expect(edge.total_requests).toBeGreaterThan(0);
    testLogger.info(`Total requests: ${edge.total_requests}`);

    // Verify latency metrics exist
    expect(edge.p50_latency_ns).toBeDefined();
    expect(edge.p95_latency_ns).toBeDefined();
    expect(edge.p99_latency_ns).toBeDefined();
    testLogger.info(`P50: ${edge.p50_latency_ns}ns, P95: ${edge.p95_latency_ns}ns, P99: ${edge.p99_latency_ns}ns`);

    // Step 2: UI validation — click edge and verify panel
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    await pm.serviceGraphPage.clickEdgeByServices('api-gateway', 'order-service');
    await pm.serviceGraphPage.expectEdgePanelVisible();

    const title = await pm.serviceGraphPage.getEdgePanelTitle();
    testLogger.info(`Edge panel title: ${title}`);

    await pm.serviceGraphPage.closeEdgePanel();
  });

  test("P1: Switch between Tree View and Graph View", {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Testing view mode switching ===');

    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    // Default should be Tree View
    const defaultView = await pm.serviceGraphPage.getActiveViewTab();
    testLogger.info(`Default view: ${defaultView}`);
    expect(defaultView).toContain('Tree');

    // Switch to Graph View
    await pm.serviceGraphPage.switchToGraphView();
    const graphView = await pm.serviceGraphPage.getActiveViewTab();
    testLogger.info(`After switch: ${graphView}`);
    expect(graphView).toContain('Graph');

    // Verify graph still renders
    await pm.serviceGraphPage.expectServiceGraphPageVisible();
    await pm.serviceGraphPage.takeGraphScreenshot('graph-view-force');
    testLogger.info('Graph View rendered successfully');

    // Switch back to Tree View
    await pm.serviceGraphPage.switchToTreeView();
    const treeView = await pm.serviceGraphPage.getActiveViewTab();
    expect(treeView).toContain('Tree');
    testLogger.info('Switched back to Tree View successfully');
  });

  test("P1: Show telemetry correlation dialog from node panel", {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Testing telemetry correlation ===');

    // Step 1: API validation — confirm api-gateway exists in topology
    const node = await pm.serviceGraphPage.findNodeByLabel('api-gateway');
    expect(node).toBeTruthy();
    testLogger.info('API confirmed api-gateway exists for telemetry test');

    // Step 2: UI — open side panel and click Show Telemetry
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    await pm.serviceGraphPage.clickNodeByName('api-gateway');
    await pm.serviceGraphPage.expectSidePanelVisible();
    testLogger.info('Side panel opened for api-gateway');

    // clickShowTelemetryAndWait() waits for the loading spinner to finish,
    // then returns true if the dialog opened, false if it didn't (error path).
    const dialogOpened = await pm.serviceGraphPage.clickShowTelemetryAndWait();
    testLogger.info(`Show Telemetry result: dialogOpened=${dialogOpened}`);

    if (dialogOpened) {
      // Happy path: service registry had the service, correlation dialog opened
      testLogger.info('Correlation dialog opened — validating tabs');

      const tabs = await pm.serviceGraphPage.getCorrelationTabs();
      testLogger.info(`Correlation tabs: ${tabs.join(', ')}`);

      // At minimum, Traces tab should be present
      const hasTracesTab = tabs.some(t => t.toLowerCase().includes('traces'));
      expect(hasTracesTab).toBeTruthy();
      testLogger.info('Traces tab found in correlation dialog');

      await pm.serviceGraphPage.closeCorrelationDialog();
      testLogger.info('Correlation dialog closed');
    } else {
      // Expected fallback: service registry is empty because trace data hasn't
      // been compacted from WAL to parquet yet (service discovery only runs
      // during parquet compaction, not during ingestion).
      // The UI shows a Quasar notification toast with the error message.
      testLogger.info('Dialog did not open — verifying error notification');

      const notification = page.locator('.q-notification');
      await expect(notification).toBeVisible({ timeout: 5000 });

      const notificationText = await notification.textContent();
      testLogger.info(`Notification text: ${notificationText}`);

      // The Vue component sets: 'Service not found in service registry.'
      // or 'No correlated streams found.' or 'Service Discovery is an enterprise feature.'
      const expectedMessages = [
        'service not found',
        'no correlated streams',
        'enterprise feature',
      ];
      const hasExpectedMessage = expectedMessages.some(msg =>
        notificationText.toLowerCase().includes(msg)
      );
      expect(hasExpectedMessage).toBeTruthy();
      testLogger.info('Error notification displayed with expected message — UI wiring validated');
    }
  });

  test("P1: Refresh button reloads graph data", {
    tag: ['@serviceGraph', '@traces', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Testing refresh functionality ===');

    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    // Click refresh
    await pm.serviceGraphPage.clickRefresh();
    testLogger.info('Clicked refresh button');

    // Wait for graph to reload
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // Verify graph is still visible after refresh
    await pm.serviceGraphPage.expectServiceGraphPageVisible();
    testLogger.info('Graph is visible after refresh');
  });

  // ===== P2: EDGE CASE TESTS =====

  test("P2: Search filter narrows displayed services", {
    tag: ['@serviceGraph', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Testing search filter ===');

    // API validation — confirm api-gateway exists in topology
    const node = await pm.serviceGraphPage.findNodeByLabel('api-gateway');
    expect(node).toBeTruthy();
    testLogger.info('API confirmed api-gateway exists for search filter test');

    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    // Type in search box to filter
    await pm.serviceGraphPage.typeInSearchBox('api-gateway');
    testLogger.info('Typed "api-gateway" in search box');

    // Wait for filter to apply (300ms debounce + render)
    await page.waitForTimeout(1000);

    // The graph should still be visible (with filtered nodes)
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    // Verify the search input retains the filter text
    const inputValue = await page.locator('input[placeholder="Search services..."]').inputValue();
    expect(inputValue).toBe('api-gateway');
    testLogger.info('Search input retains filter text');

    // Clear the filter
    await pm.serviceGraphPage.clearSearchBox();
    await page.waitForTimeout(1000);

    // Verify graph is still visible after clearing
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    // Verify search box is empty
    const clearedValue = await page.locator('input[placeholder="Search services..."]').inputValue();
    expect(clearedValue).toBe('');
    testLogger.info('Search cleared and graph restored');
  });

  test("P2: Recent traces appear in side panel for a service", {
    tag: ['@serviceGraph', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Testing recent traces in side panel ===');

    // Step 1: API validation — confirm api-gateway has requests
    const node = await pm.serviceGraphPage.findNodeByLabel('api-gateway');
    expect(node).toBeTruthy();
    expect(node.requests).toBeGreaterThan(0);
    testLogger.info(`API confirmed api-gateway has ${node.requests} requests`);

    // Step 2: UI validation — click node and check recent traces
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    await pm.serviceGraphPage.clickNodeByName('api-gateway');
    await pm.serviceGraphPage.expectSidePanelVisible();

    // Verify recent traces section is visible (10s auto-retry)
    await pm.serviceGraphPage.expectRecentTracesSectionVisible();
    testLogger.info('Recent traces section is visible');

    const traceCount = await pm.serviceGraphPage.getRecentTraceCount();
    testLogger.info(`Recent traces count: ${traceCount}`);
    expect(traceCount).toBeGreaterThan(0);

    await pm.serviceGraphPage.closeSidePanel();
  });

  test("P2: Close button dismisses side panel", {
    tag: ['@serviceGraph', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Testing side panel close button ===');

    // Step 1: API validation — confirm api-gateway exists
    const node = await pm.serviceGraphPage.findNodeByLabel('api-gateway');
    expect(node).toBeTruthy();
    testLogger.info(`API confirmed api-gateway exists`);

    // Step 2: UI validation — open and close side panel
    await pm.serviceGraphPage.navigateToServiceGraphUrl();
    await pm.serviceGraphPage.expectServiceGraphPageVisible();

    await pm.serviceGraphPage.clickNodeByName('api-gateway');
    await pm.serviceGraphPage.expectSidePanelVisible();
    testLogger.info('Side panel opened');

    // Close the panel
    await pm.serviceGraphPage.closeSidePanel();

    // Verify panel is no longer visible
    await pm.serviceGraphPage.expectSidePanelNotVisible();
    testLogger.info('Side panel closed successfully');
  });

  test("P2: Circular dependency services exist in topology (service-a, service-b, service-c)", {
    tag: ['@serviceGraph', '@traces', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    const pm = new PageManager(page);
    testLogger.info('=== Verifying edge case: circular dependencies ===');

    const result = await pm.serviceGraphPage.getTopologyViaAPI();
    const data = result.data?.nodes ? result.data : result.data?.data;
    const nodes = data?.nodes || [];
    const edges = data?.edges || [];
    const nodeLabels = nodes.map(n => n.label || n.id);

    // Verify at least some circular dependency services exist as nodes
    const circularServices = ['service-a', 'service-b', 'service-c'];
    const foundCircularNodes = circularServices.filter(svc => nodeLabels.includes(svc));
    testLogger.info(`Circular dependency services found: ${foundCircularNodes.join(', ') || 'none'}`);
    expect(foundCircularNodes.length).toBeGreaterThanOrEqual(1);

    // Check edges for circular pattern (a→b, b→c, c→a)
    const circularEdges = [
      { from: 'service-a', to: 'service-b' },
      { from: 'service-b', to: 'service-c' },
      { from: 'service-c', to: 'service-a' },
    ];

    let circularEdgesFound = 0;
    for (const ce of circularEdges) {
      const found = edges.find(e => e.from === ce.from && e.to === ce.to);
      if (found) {
        circularEdgesFound++;
        testLogger.info(`Circular edge ${ce.from} → ${ce.to} found`);
      }
    }
    testLogger.info(`Circular edges found: ${circularEdgesFound}/3`);
    expect(circularEdgesFound).toBeGreaterThanOrEqual(1);
  });
});
