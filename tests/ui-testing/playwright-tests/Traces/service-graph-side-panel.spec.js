// Service Graph's own entry is enterprise-only, so OSS CI drives the shared side panel through Services Catalog.

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

  test("P0: Side panel opens non-modally with no scrim and an unblocked page behind", {
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

    await pm.serviceGraphPage.expectSidePanelNonModal();
    testLogger.info('No modal scrim rendered and <body> still accepts pointer events');
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
    await pm.serviceGraphPage.markSidePanelNode();
    testLogger.info(`Panel opened on "${firstService}"`);

    await pm.servicesCatalogPage.clickServiceRow(secondService);

    // The title only swaps if the click behind the panel reached the catalog row.
    await pm.serviceGraphPage.expectSidePanelServiceName(secondService);
    // A dismiss-then-reopen would also swap the title, but on a freshly mounted node.
    await pm.serviceGraphPage.expectSidePanelNodeUnchanged();
    testLogger.info(`Panel stayed open and swapped in place to "${secondService}"`);
  });

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
    expect(rowCount).toBeGreaterThan(0);

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

    const streamsPresent = await pm.serviceGraphPage.clickMetricsTabAndWait();
    testLogger.info(`Metrics tab resolved: streamsPresent=${streamsPresent}`);

    const terminalState = await pm.serviceGraphPage.getMetricsTerminalState();
    const buildType = await pm.routeGuardPage.getBuildType();
    testLogger.info(`Metrics tab terminal state: ${terminalState} (build_type=${buildType})`);
    expect(['correlation', 'empty', 'error']).toContain(terminalState);
    if (buildType === 'opensource') {
      // OSS registers no correlation route, so the tab can only end in its error state.
      expect(terminalState).toBe('error');
    }
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

    await expect(page).toHaveURL(/\/traces\?.*tab=traces/);
    const tracesQuery = await pm.serviceGraphPage.getTracesUrlQuery();
    testLogger.info(`Traces query carried over: ${tracesQuery}`);
    expect(tracesQuery).toContain(`service_name = '${firstService}'`);
    testLogger.info('Navigated to traces search via View Related → Traces');
  });
});
