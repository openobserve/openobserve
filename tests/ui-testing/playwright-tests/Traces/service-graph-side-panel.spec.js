// service-graph-side-panel.spec.js
// E2E tests for the Service Graph node side panel (non-modal drawer).
// The drawer is shared (ServiceGraphNodeSidePanel + ODrawer) across Service Graph,
// Services Catalog and Overview. The Service Graph entry is enterprise-gated (the
// topology endpoint is #[cfg(feature = "enterprise")] and 404s in OSS), so the OSS
// CI drives the panel through Services Catalog, which reuses the pre-seeded
// `default` traces stream — the non-modal mechanics under test are edition-independent.
// Uses existing default stream data (no beforeAll ingestion) — like service-catalog.spec.js.

const { test, expect, navigateToBase } = require('../utils/enhanced-baseFixtures.js');
const testLogger = require('../utils/test-logger.js');
const PageManager = require('../../pages/page-manager.js');

test.describe("Service Graph Side Panel (non-modal drawer) testcases", () => {
  test.describe.configure({ mode: 'parallel' });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);

    await pm.servicesCatalogPage.navigate('7d');
    await pm.servicesCatalogPage.waitForLoad();
    testLogger.info('Navigated to services catalog tab');
  });

  test.afterEach(async ({}, testInfo) => {
    testLogger.testEnd(testInfo.title, testInfo.status);
  });

  // =========================================================================
  // P0: SMOKE TESTS — the non-modal mechanics
  // =========================================================================

  test("P0: Side panel opens with a transparent non-blocking overlay", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying side panel opens non-modally ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — row click requires data');

    const firstService = await pm.servicesCatalogPage.getFirstServiceName();
    testLogger.info(`Clicking service: ${firstService}`);

    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();
    testLogger.info('Side panel is visible after row click');

    // Headline `:seamless="true"` + `:modal="false"` behaviour: the overlay is
    // present but non-blocking (pointer-events-none, transparent — no dim).
    await pm.serviceGraphPage.expectOverlayNonBlocking();
    testLogger.info('Overlay is present and non-blocking (pointer-events-none)');
  });

  test("P0: Clicking outside the panel keeps it open and the behind page stays interactive", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@smoke', '@P0', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying outside click keeps panel open + behind page interactive ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — outside click requires data');

    const names = await pm.servicesCatalogPage.getVisibleServiceNames();
    test.skip(names.length < 2, `need ≥2 services to test behind-page interactivity, got ${names.length}`);
    const firstService = names[0];
    const secondService = names[1];

    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();
    testLogger.info(`Panel opened on "${firstService}"`);

    // Click a second catalog row BEHIND the open panel. The non-modal drawer must
    // ignore the outside click (not dismiss) while the catalog still receives it.
    await pm.servicesCatalogPage.clickServiceRow(secondService);

    // Panel is still open after the outside click — no dismissal.
    await pm.servicesCatalogPage.expectSidePanelVisible();

    // Panel content swapped in place to the newly selected row — proving the
    // behind-page click was delivered to the catalog (page stayed interactive).
    await pm.serviceGraphPage.expectSidePanelServiceName(secondService);
    testLogger.info(`Panel stayed open and swapped in place to "${secondService}"`);
  });

  // =========================================================================
  // P1: FUNCTIONAL TESTS — close/reopen, content surface, navigation
  // =========================================================================

  test("P1: Close button dismisses the panel; reopening shows the correct service", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying close/reopen lifecycle ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — close/reopen requires data');

    const names = await pm.servicesCatalogPage.getVisibleServiceNames();
    test.skip(names.length < 2, `need ≥2 services to reopen on a different service, got ${names.length}`);
    const firstService = names[0];
    const secondService = names[1];

    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();

    await pm.serviceGraphPage.closeSidePanel();
    await pm.serviceGraphPage.expectSidePanelNotVisible();
    testLogger.info('Panel closed via close button');

    await pm.servicesCatalogPage.clickServiceRow(secondService);
    await pm.servicesCatalogPage.expectSidePanelVisible();
    await pm.serviceGraphPage.expectSidePanelServiceName(secondService);
    testLogger.info(`Panel reopened with "${secondService}"`);
  });

  test("P1: Escape key closes the non-modal panel", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying Escape closes the panel ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — Escape requires data');

    const firstService = await pm.servicesCatalogPage.getFirstServiceName();
    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();
    testLogger.info('Panel open; focus is in the panel (not the filter input)');

    await page.keyboard.press('Escape');
    await pm.serviceGraphPage.expectSidePanelNotVisible();
    testLogger.info('Escape closed the panel');
  });

  test("P1: RED charts and Operations table render for a concrete stream", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying RED charts + operations table ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — panel content requires data');

    const firstService = await pm.servicesCatalogPage.getFirstServiceName();
    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();

    await pm.serviceGraphPage.expectRedChartsSectionVisible();
    testLogger.info('RED charts section is visible');

    await pm.serviceGraphPage.expectOperationsSectionVisible();
    const rowCount = await pm.serviceGraphPage.getOperationsTableRowCount();
    testLogger.info(`Operations table rows: ${rowCount}`);

    // Assert the expected RED columns are present (verified against
    // buildEntityTableColumns: operation, requests, errors, p99, p95, p75).
    const columns = await pm.serviceGraphPage.getOperationsColumnIds();
    testLogger.info(`Operations columns: ${columns.join(', ')}`);
    for (const expected of ['operation', 'requests', 'errors', 'p99', 'p95', 'p75']) {
      expect(columns).toContain(expected);
    }
  });

  test("P1: Metrics tab resolves without hanging", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying Metrics tab resolves ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — metrics tab requires data');

    const firstService = await pm.servicesCatalogPage.getFirstServiceName();
    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();

    // clickMetricsTabAndWait() races the real content hooks and THROWS if the tab
    // hangs; reaching here means it resolved into a terminal state.
    const streamsPresent = await pm.serviceGraphPage.clickMetricsTabAndWait();
    testLogger.info(`Metrics tab resolved: streamsPresent=${streamsPresent}`);

    // Assert WHICH terminal state was reached, re-read independently of the
    // Promise.race above. correlation / empty / error are all acceptable in a
    // traces-only env; 'unknown' means the tab did not actually resolve.
    const terminalState = await pm.serviceGraphPage.getMetricsTerminalState();
    testLogger.info(`Metrics tab terminal state: ${terminalState}`);
    expect(['correlation', 'empty', 'error']).toContain(terminalState);
  });

  test("P1: View Related Traces navigates to traces search", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@functional', '@P1', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying View Related → Traces ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — View Related requires data');

    const firstService = await pm.servicesCatalogPage.getFirstServiceName();
    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();

    await pm.serviceGraphPage.clickViewRelated('traces');

    // viewRelatedTraces → navigateToTraces({ mode: 'traces' }) → the Traces page
    // sets searchMode 'traces', and the URL watcher writes ?tab=traces.
    await expect(page).toHaveURL(/\/traces\?.*tab=traces/);
    testLogger.info('Navigated to traces search via View Related → Traces');
  });

  // =========================================================================
  // P2: EDGE CASE TESTS — data-dependent, skip gracefully
  // =========================================================================

  test("P2: Resource tabs render for a service with resource attributes", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying resource tabs ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — resource tabs require data');

    const firstService = await pm.servicesCatalogPage.getFirstServiceName();
    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();

    const resourceTabs = await pm.serviceGraphPage.getResourceTabIds();
    test.skip(resourceTabs.length === 0, 'no resource tabs (k8s pod/node attributes not seeded in this env)');
    testLogger.info(`Discovered resource tabs: ${resourceTabs.join(', ')}`);

    const tabId = resourceTabs[0];
    await pm.serviceGraphPage.switchToResourceTab(tabId);
    await pm.serviceGraphPage.expectResourceTableVisible(tabId);
    testLogger.info(`Resource tab "${tabId}" rendered its table`);
  });

  test("P2: Operations empty state renders without hanging when a service has no operations", {
    tag: ['@service-graph-side-panel-non-modal', '@traces', '@serviceCatalog', '@edge', '@P2', '@all']
  }, async ({ page }) => {
    testLogger.info('=== Verifying operations empty state ===');

    const hasEmpty = await pm.servicesCatalogPage.isEmptyStateVisible();
    test.skip(hasEmpty, 'no services in this environment — operations table requires data');

    const firstService = await pm.servicesCatalogPage.getFirstServiceName();
    await pm.servicesCatalogPage.clickServiceRow(firstService);
    await pm.servicesCatalogPage.expectSidePanelVisible();

    await pm.serviceGraphPage.expectOperationsSectionVisible();
    const rowCount = await pm.serviceGraphPage.getOperationsTableRowCount();
    testLogger.info(`Operations rows: ${rowCount}`);

    // The empty branch only applies to a service with zero operations in the
    // window — skip (don't weaken) when this service has operations data.
    test.skip(rowCount > 0, `service has ${rowCount} operations — empty state not applicable`);

    const emptyVisible = await pm.serviceGraphPage.isOperationsEmptyStateVisible();
    expect(emptyVisible).toBeTruthy();
    testLogger.info('Operations empty state rendered without hanging');
  });
});
