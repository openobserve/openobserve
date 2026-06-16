/**
 * Traces Regression - Enterprise-Only Tests
 *
 * Tests in this file depend on enterprise-only features (e.g. service graph toggle,
 * which is only rendered when config.isEnterprise == 'true').
 * They are excluded from the OSS regression workflow and run only via the enterprise CI.
 */

const { test, expect, navigateToBase } = require('../../utils/enhanced-baseFixtures.js');
const testLogger = require('../../utils/test-logger.js');
const PageManager = require('../../../pages/page-manager.js');

test.describe('Traces Regression - Enterprise Features', () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await pm.tracesPage.navigateToTraces();

    await pm.tracesPage.isStreamSelectVisible();
    await pm.tracesPage.selectTraceStream('default');
    await page.waitForTimeout(2000);

    testLogger.info('Traces enterprise regression test setup completed');
  });

  // ==========================================================================
  // Bug #11687: String.replace $ pattern vulnerability in ServiceGraphNodeSidePanel
  // https://github.com/openobserve/openobserve/issues/11687
  // Enterprise-only: service graph toggle is gated behind config.isEnterprise == 'true'
  // ==========================================================================
  test('Service graph node side panel should render without errors after $ pattern fix', {
    tag: ['@bug-11687', '@P0', '@regression', '@tracesRegressionEnt', '@serviceGraph', '@enterprise'],
  }, async ({ page }) => {
    testLogger.info('Test: Verify service graph side panel renders without errors (Bug #11687)');

    const consoleErrors = [];
    const errorHandler = msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    };
    page.on('console', errorHandler);

    const sgPage = pm.serviceGraphPage;
    await sgPage.navigateToServiceGraph();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    const graphVisible = await sgPage.isServiceGraphVisible();
    expect(graphVisible, 'Bug #11687: Service graph should be visible').toBe(true);
    testLogger.info('✓ Service graph loaded');

    let nodeClicked = false;

    const topology = await sgPage.getTopologyViaAPI();
    const nodes = topology.data?.nodes || topology.data?.data?.nodes || [];
    const nodeNames = nodes.map(n => n.label || n.id).filter(Boolean);

    for (const nodeName of nodeNames) {
      try {
        await sgPage.clickNodeByName(nodeName);
        testLogger.info(`✓ Clicked service node: ${nodeName}`);
        nodeClicked = true;
        break;
      } catch (e) {
        testLogger.debug(`Service node "${nodeName}" not found, trying next...`);
      }
    }

    if (!nodeClicked) {
      testLogger.warn(`No service nodes available to click from ${nodeNames.length} discovered nodes — skipping side panel verification`);
      page.removeListener('console', errorHandler);
      test.skip(true, 'No service nodes available to click — cannot verify #11687 side panel');
    }

    const sidePanelVisible = await sgPage.isSidePanelVisible();
    expect(sidePanelVisible, 'Bug #11687: Side panel should be visible after clicking a service node').toBe(true);
    testLogger.info('✓ Side panel rendered successfully');

    page.removeListener('console', errorHandler);
    if (consoleErrors.length > 0) {
      testLogger.warn(`Console errors detected: ${consoleErrors.length}`, { errors: consoleErrors.slice(0, 5) });
    }
    const replaceErrors = consoleErrors.filter(e =>
      e.includes('.replace') || e.includes('replace is not a function')
    );
    expect(replaceErrors.length, 'Bug #11687: Should not have replace/null related console errors in side panel').toBe(0);

    testLogger.info('✓ PASSED: Service graph side panel $ pattern fix test completed');
  });

  test.afterEach(async () => {
    testLogger.info('Traces enterprise regression test completed');
  });
});
