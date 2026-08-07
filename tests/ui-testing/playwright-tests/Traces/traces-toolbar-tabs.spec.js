// traces-toolbar-tabs.spec.js
// E2E tests for the IN-PAGE Service Graph / Services Catalog tabs on the
// Traces page toolbar. Clicking a tab switches the view inline — the URL stays
// on /traces and gains ?tab=service-graph / ?tab=services-catalog, and the
// shared search context (stream, time range) carries implicitly. The rail
// flyout is a separate access path that navigates to the standalone routes
// (/traces/service-graph, /traces/services) — dual semantics, both covered.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces toolbar tabs (in-page)", () => {
  test.describe.configure({ mode: 'serial' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);

    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    await pm.tracesPage.navigateToTraces();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    testLogger.info('Test setup completed for traces toolbar tabs');
  });

  test.afterEach(async ({ }, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("P1: Service Graph tab switches the view in-page (?tab=service-graph)", {
    tag: ['@traces', '@tracesToolbarTabs', '@enterprise', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Clicking Service Graph toolbar tab ===');

    await pm.tracesPage.navigateToServiceGraphViaTab();

    // URL stays on /traces with ?tab= — NOT the standalone route
    expect(page.url()).toMatch(/\/traces\?.*tab=service-graph/);
    expect(page.url()).not.toMatch(/\/traces\/service-graph/);
    // Inline graph view renders (selectors live in ServiceGraph.vue, so they
    // work in-page): the chart when topology data exists, else the no-data
    // state — this suite doesn't seed the service-graph daemon's topology.
    await pm.tracesPage.expectServiceGraphViewVisible();
    testLogger.info('Service Graph rendered inline from toolbar tab');
  });

  test("P1: Services Catalog tab switches the view in-page (?tab=services-catalog)", {
    tag: ['@traces', '@tracesToolbarTabs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Clicking Services Catalog toolbar tab ===');

    await pm.tracesPage.navigateToServicesViaTab();

    expect(page.url()).toMatch(/\/traces\?.*tab=services-catalog/);
    expect(page.url()).not.toMatch(/\/traces\/services(\?|$)/);
    // Inline catalog renders — table with data, or the empty state
    await pm.tracesPage.expectServicesCatalogVisible();
    testLogger.info('Services Catalog rendered inline from toolbar tab');
  });

  test("P1: Search context carries into the catalog tab and ?tab= survives reload", {
    tag: ['@traces', '@tracesToolbarTabs', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Setting non-default period on Traces, then switching to catalog tab ===');

    // Non-default relative period (default is 15m)
    await pm.tracesPage.setTimeRange('30m');

    await pm.tracesPage.navigateToServicesViaTab();

    // All per-mode DateTime instances bind to the same searchObj.data.datetime,
    // so the chosen period carries into the catalog toolbar implicitly.
    await pm.tracesPage.expectServicesCatalogTimeRange('Past 30 Minutes');

    // Reload — mandatory: a warm in-app visit does NOT re-run
    // restoreUrlQueryParams (pre-#13659-faithful); only a cold load proves the
    // old ?tab= bookmark behavior.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // The catalog tab is active again after the cold load
    await pm.tracesPage.expectServicesCatalogTabActive();
    await pm.tracesPage.expectServicesCatalogVisible();
    testLogger.info('Catalog tab restored from ?tab= after reload');
  });

  test("P1: Rail flyout still navigates to the standalone Service Graph route", {
    tag: ['@traces', '@tracesToolbarTabs', '@enterprise', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Opening rail flyout and clicking Service Graph ===');

    await pm.tracesPage.switchToServiceMaps();

    // The flyout path IS the standalone route — proving the dual semantics coexist
    expect(page.url()).toMatch(/\/traces\/service-graph/);
    await pm.tracesPage.expectStandaloneServiceGraphPageVisible();
    testLogger.info('Standalone Service Graph page rendered from flyout');
  });
});
