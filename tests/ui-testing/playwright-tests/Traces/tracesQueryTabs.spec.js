// tracesQueryTabs.spec.js
// E2E tests for the reorganized Traces query tabs (PR #13852). All four
// sub-views (Spans, Traces, Service Graph, Services Catalog) now live on the
// single /traces route, switched by ?tab=. This spec encodes the NEW semantics:
//   - tabless /traces canonicalizes to ?tab=spans (DEFAULT_TRACE_SEARCH_MODE)
//   - the in-page toolbar toggle switches views and rewrites the URL to ?tab=
//   - the rail flyout navigates to /traces?tab=<mode> (same route, not the old
//     standalone /traces/service-graph or /traces/services routes)
//   - Service Graph is enterprise-gated: absent from flyout + toolbar in OSS,
//     and its URLs degrade to ?tab=spans
//   - legacy /traces/services redirects to ?tab=services-catalog (query kept)
//   - ?tab= survives a cold reload; search context carries across flyout nav
//
// OSS run: every Service Graph assertion is an absence/redirect assertion,
// never a presence assertion. Navigation is pure client-side routing — no trace
// data or ingestion is required (global setup pre-seeds the default stream).

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Traces Query Tab Navigation testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    testLogger.info('Test setup completed');
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  test("P0: Tabless /traces defaults to Spans view", {
    tag: ['@traces-query-tabs', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Navigating to tabless /traces ===');
    await pm.tracesPage.navigateToTraces();

    // The router beforeEnter canonicalizes the tabless URL to the default mode.
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);
    await pm.tracesPage.expectSpansTabActive();
    await pm.tracesPage.expectSearchViewVisible();
    testLogger.info('Tabless /traces canonicalized to ?tab=spans');
  });

  test("P0: Toolbar tab switch updates ?tab= and active state (Spans -> Traces -> Services Catalog -> Spans)", {
    tag: ['@traces-query-tabs', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Switching toolbar tabs in-page ===');
    await pm.tracesPage.navigateToTraces();
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);

    // Spans -> Traces
    await pm.tracesPage.switchToTracesTab();
    await expect(page).toHaveURL(/\/traces\?.*tab=traces/);
    expect(page.url()).not.toMatch(/\/traces\//);
    await pm.tracesPage.expectTracesTabActive();

    // Traces -> Services Catalog
    await pm.tracesPage.navigateToServicesViaTab();
    await expect(page).toHaveURL(/\/traces\?.*tab=services-catalog/);
    expect(page.url()).not.toMatch(/\/traces\/services(\?|$)/);
    await pm.tracesPage.expectServicesCatalogVisible();
    await pm.tracesPage.expectServicesCatalogTabActive();

    // Services Catalog -> Spans
    await pm.tracesPage.switchToSpansTab();
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);
    await pm.tracesPage.expectSpansTabActive();
    testLogger.info('Toolbar tabs switch the view and rewrite the URL to ?tab=');
  });

  test("P0: Rail flyout navigates to /traces?tab=services-catalog (same route)", {
    tag: ['@traces-query-tabs', '@traces', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Opening rail flyout and clicking Services Catalog ===');
    await pm.tracesPage.navigateToTraces();

    await pm.tracesPage.navigateToTracesTabViaFlyout('services-catalog');

    expect(page.url()).toMatch(/\/traces\?.*tab=services-catalog/);
    expect(page.url()).not.toMatch(/\/traces\/services(\?|$)/);
    await pm.tracesPage.expectServicesCatalogVisible();
    testLogger.info('Flyout navigated to /traces?tab=services-catalog');
  });

  test("P1: Service Graph is gated out in OSS (flyout item and toolbar toggle absent)", {
    tag: ['@traces-query-tabs', '@traces', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying Service Graph absence in OSS ===');
    await pm.tracesPage.navigateToTraces();

    await pm.tracesPage.expectFlyoutItemsVisible({ serviceGraphAbsent: true });
    await pm.tracesPage.expectServiceGraphToggleAbsent();
    testLogger.info('Service Graph absent from flyout and toolbar in OSS');
  });

  test("P1: Legacy /traces/services redirects to ?tab=services-catalog (query preserved)", {
    tag: ['@traces-query-tabs', '@traces', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying legacy /traces/services redirect ===');
    await page.goto(`/web/traces/services?org_identifier=${process.env["ORGNAME"]}&period=30m`);

    await expect(page).toHaveURL(/\/traces\?.*tab=services-catalog/);
    expect(page.url()).not.toMatch(/\/traces\/services(\?|$)/);
    expect(page.url()).toMatch(/period=30m/);
    expect(page.url()).not.toMatch(/search_mode/);
    await pm.tracesPage.expectServicesCatalogVisible();
    testLogger.info('Legacy /traces/services redirected with query preserved');
  });

  test("P1: Service Graph URLs degrade to Spans in OSS (legacy route and direct ?tab=service-graph)", {
    tag: ['@traces-query-tabs', '@traces', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying Service Graph URL degrade in OSS ===');

    // Legacy standalone route /traces/service-graph -> ?tab=spans in OSS.
    await page.goto(`/web/traces/service-graph?org_identifier=${process.env["ORGNAME"]}`);
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);
    expect(page.url()).not.toMatch(/service-graph/);
    await pm.tracesPage.expectSpansTabActive();

    // Direct ?tab=service-graph -> ?tab=spans in OSS.
    await page.goto(`/web/traces?org_identifier=${process.env["ORGNAME"]}&tab=service-graph`);
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);
    expect(page.url()).not.toMatch(/service-graph/);
    await pm.tracesPage.expectSpansTabActive();
    testLogger.info('Service Graph URLs degraded to ?tab=spans in OSS');
  });

  test("P1: Invalid ?tab= canonicalized to spans and search_mode stripped", {
    tag: ['@traces-query-tabs', '@traces', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying URL canonicalization ===');

    // Unknown tab resolves to the default spans mode.
    await page.goto(`/web/traces?org_identifier=${process.env["ORGNAME"]}&tab=bogus`);
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);
    expect(page.url()).not.toMatch(/tab=bogus/);
    await pm.tracesPage.expectSpansTabActive();

    // Deprecated search_mode is stripped; tab resolves to the default spans mode.
    await page.goto(`/web/traces?org_identifier=${process.env["ORGNAME"]}&search_mode=traces`);
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);
    expect(page.url()).not.toMatch(/search_mode/);
    await pm.tracesPage.expectSpansTabActive();
    testLogger.info('Invalid tab and search_mode canonicalized to ?tab=spans');
  });

  test("P1: ?tab= survives a cold reload", {
    tag: ['@traces-query-tabs', '@traces', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying ?tab= bookmark survives reload ===');
    await page.goto(`/web/traces?org_identifier=${process.env["ORGNAME"]}&tab=services-catalog`);
    await pm.tracesPage.expectServicesCatalogTabActive();
    await pm.tracesPage.expectServicesCatalogVisible();

    // Cold load (not a warm in-app visit) proves restoreUrlQueryParams ran.
    await page.reload();
    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});

    await pm.tracesPage.expectServicesCatalogTabActive();
    await pm.tracesPage.expectServicesCatalogVisible();
    testLogger.info('Catalog tab restored from ?tab= after reload');
  });

  test("P2: Flyout Spans and Traces items navigate to their ?tab=", {
    tag: ['@traces-query-tabs', '@traces', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying flyout Spans/Traces navigation ===');
    await pm.tracesPage.navigateToTraces();

    await pm.tracesPage.navigateToTracesTabViaFlyout('spans');
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);
    await pm.tracesPage.expectSpansTabActive();

    await pm.tracesPage.navigateToTracesTabViaFlyout('traces');
    await expect(page).toHaveURL(/\/traces\?.*tab=traces/);
    await pm.tracesPage.expectTracesTabActive();
    testLogger.info('Flyout Spans and Traces items navigate to their ?tab=');
  });

  test("P2: Search context (time range) preserved across a flyout tab switch", {
    tag: ['@traces-query-tabs', '@traces', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying search context preservation across flyout nav ===');
    await pm.tracesPage.navigateToTraces();
    await expect(page).toHaveURL(/\/traces\?.*tab=spans/);

    // Non-default relative period (default is 15m).
    await pm.tracesPage.setTimeRange('30m');
    await pm.tracesPage.navigateToTracesTabViaFlyout('services-catalog');

    await expect(page).toHaveURL(/\/traces\?.*tab=services-catalog/);
    await pm.tracesPage.expectServicesCatalogTimeRange('Past 30 Minutes');
    testLogger.info('Time range preserved across flyout tab switch');
  });
});
