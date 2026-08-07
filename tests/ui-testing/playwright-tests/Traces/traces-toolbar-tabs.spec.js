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

  test("P1: Search controls hide and services-catalog toolbar appears when switching to Services Catalog", {
    tag: ['@traces', '@tracesToolbarTabs', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying search controls visibility before tab switch ===');

    // Step 1: Confirm search toolbar is visible in default (spans) mode.
    await pm.tracesPage.expectSearchToolbarVisible();

    testLogger.info('=== Clicking Services Catalog toolbar tab ===');

    // Step 2: Switch to Services Catalog via the in-page toolbar tab.
    await pm.tracesPage.navigateToServicesViaTab();

    // Step 3: Assert services-catalog-specific toolbar renders.
    await pm.tracesPage.expectServicesCatalogToolbarVisible();

    // Step 4: Assert search controls are hidden (v-if removes from DOM).
    await pm.tracesPage.expectSearchToolbarHidden();

    // Step 5: Assert URL reflects the in-page tab.
    expect(page.url()).toMatch(/\/traces\?.*tab=services-catalog/);

    testLogger.info('Services Catalog tab: toolbar toggled, search controls hidden');
  });

  test("P1: Search controls hide and service-graph toolbar appears when switching to Service Graph (enterprise)", {
    tag: ['@traces', '@tracesToolbarTabs', '@enterprise', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying search controls before SG switch ===');

    await pm.tracesPage.expectSearchToolbarVisible();

    testLogger.info('=== Clicking Service Graph toolbar tab ===');

    // Switch to Service Graph via the in-page toolbar tab.
    await pm.tracesPage.navigateToServiceGraphViaTab();

    // Assert service-graph-specific toolbar renders.
    await pm.tracesPage.expectServiceGraphToolbarVisible();

    // Assert search controls are hidden.
    await pm.tracesPage.expectSearchToolbarHidden();

    // Assert URL reflects the in-page tab (NOT standalone route).
    expect(page.url()).toMatch(/\/traces\?.*tab=service-graph/);
    expect(page.url()).not.toMatch(/\/traces\/service-graph/);

    testLogger.info('Service Graph tab: toolbar toggled, search controls hidden');
  });

  test("P1: Switching back from Services Catalog to Traces restores search controls", {
    tag: ['@traces', '@tracesToolbarTabs', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Switching to Services Catalog tab first ===');

    await pm.tracesPage.navigateToServicesViaTab();
    await pm.tracesPage.expectServicesCatalogToolbarVisible();

    testLogger.info('=== Clicking Traces tab to return to search view ===');

    // Click the Traces tab to switch back.
    await pm.tracesPage.navigateToTracesTab();

    // Verify the Traces tab is active.
    await pm.tracesPage.expectTracesTabActive();

    // Verify search controls are visible again.
    await pm.tracesPage.expectSearchToolbarVisible();

    // Verify URL contains ?tab=traces.
    expect(page.url()).toMatch(/\/traces\?.*tab=traces/);

    testLogger.info('Round-trip: search controls restored after returning from Services Catalog');
  });

  test("P2: Spans to Traces toggle updates URL and active state", {
    tag: ['@traces', '@tracesToolbarTabs', '@functional', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Asserting default Spans mode is active ===');

    // Step 1: Default mode is Spans — assert its button is active.
    await pm.tracesPage.expectSpansTabActive();

    testLogger.info('=== Clicking Traces tab ===');

    // Step 2: Click the Traces tab.
    await pm.tracesPage.navigateToTracesTab();

    // Step 3: Traces tab is active, URL reflects the switch.
    await pm.tracesPage.expectTracesTabActive();
    expect(page.url()).toMatch(/\/traces\?.*tab=traces/);

    testLogger.info('=== Clicking Spans tab to return ===');

    // Step 4: Click the Spans tab to return.
    await pm.tracesPage.navigateToSpansTab();

    // Step 5: Spans tab is active again, and ?tab=traces is gone (Spans is default).
    await pm.tracesPage.expectSpansTabActive();
    expect(page.url()).not.toMatch(/[?&]tab=traces/);

    testLogger.info('Spans-Traces toggle: URL and active state synced correctly');
  });
});
