const { test, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, cleanupTestDashboard } from "./utils/dashCreation.js";
const testLogger = require("../utils/test-logger.js");

const PANEL_COUNT = 7;
const STREAM = "e2e_automate";
const Y_AXIS_FIELD = "kubernetes_pod_name";
const LAST_PANEL_INDEX = PANEL_COUNT - 1;

/**
 * Build a dashboard with N vertically-stacked panels. The first panel is added
 * via the empty-state button; the rest via add-panel-to-existing. Panels auto-stack
 * at increasing y, so the last one sits several viewports below the fold and only
 * renders a lazy placeholder until scrolled near the viewport.
 */
async function buildStackedDashboard(page, pm, panelCount = PANEL_COUNT) {
  for (let i = 0; i < panelCount; i++) {
    if (i === 0) {
      await pm.dashboardCreate.addPanel();
    } else {
      await pm.dashboardCreate.addPanelToExistingDashboard();
    }
    await pm.chartTypeSelector.selectChartType("line");
    await pm.chartTypeSelector.selectStream(STREAM);
    await pm.chartTypeSelector.removeField("y_axis_1", "y");
    await pm.chartTypeSelector.searchAndAddField(Y_AXIS_FIELD, "y");
    await pm.dashboardPanelActions.addPanelName(`Panel${i + 1}`);
    await pm.dashboardPanelActions.savePanel();
    // Grid slot, not panel container: off-screen panels only render a lazy
    // placeholder until scrolled near the viewport.
    await pm.dashboardLazyMounting
      .getGridStackItem(i)
      .waitFor({ state: "attached", timeout: 15000 });
  }
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
}

async function setupDashboard(page, pm, dashboardName) {
  await pm.dashboardList.menuItem("dashboards-item");
  await waitForDashboardPage(page);
  await pm.dashboardCreate.waitForDashboardUIStable();
  await pm.dashboardCreate.createDashboard(dashboardName);
  await pm.dashboardCreate.waitForAddPanelIfEmptyVisible(30000);
}

test.describe("Dashboard Lazy Panel Mounting testcases", { tag: ['@dashboards', '@dashboard-lazy-panel-mounting', '@all'] }, () => {
  test.describe.configure({ mode: "parallel" });

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
    testLogger.info("Test setup completed");
  });

  test("should mount on-screen panels and render a placeholder for off-screen panels", { tag: ['@dashboards', '@dashboard-lazy-panel-mounting', '@all', '@P0'] }, async ({ page }) => {
    testLogger.info("Building stacked dashboard and asserting placeholder vs mounted container");
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_LazyMount_${Date.now()}`;

    await setupDashboard(page, pm, dashboardName);
    await buildStackedDashboard(page, pm, PANEL_COUNT);

    const firstId = await pm.dashboardLazyMounting.getPanelIdFromGridSlot(0);
    const lastId = await pm.dashboardLazyMounting.getPanelIdFromGridSlot(LAST_PANEL_INDEX);

    // The top panel is within the fold → full PanelContainer mounted.
    await pm.dashboardLazyMounting.expectContainerVisible(firstId);
    // The far-down panel is a placeholder, with no PanelContainer in the DOM.
    await pm.dashboardLazyMounting.expectPlaceholderVisible(lastId);
    await pm.dashboardLazyMounting.expectContainerCount(lastId, 0);

    testLogger.info("Placeholder vs mounted container verified");

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("should mount a placeholder panel on scroll and keep it mounted when scrolling away", { tag: ['@dashboards', '@dashboard-lazy-panel-mounting', '@all', '@P0'] }, async ({ page }) => {
    testLogger.info("Asserting one-way mount: placeholder → container, then persists after scrolling away");
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_LazyMountScroll_${Date.now()}`;

    await setupDashboard(page, pm, dashboardName);
    await buildStackedDashboard(page, pm, PANEL_COUNT);

    const targetId = await pm.dashboardLazyMounting.getPanelIdFromGridSlot(LAST_PANEL_INDEX);

    // Confirm the far-down panel starts as a placeholder (not mounted).
    await pm.dashboardLazyMounting.expectPlaceholderVisible(targetId);
    await pm.dashboardLazyMounting.expectContainerCount(targetId, 0);

    // Scroll it into view → the observer mounts the full container.
    await pm.dashboardLazyMounting.scrollGridSlotIntoView(LAST_PANEL_INDEX);
    await pm.dashboardLazyMounting.expectContainerVisible(targetId);
    await pm.dashboardLazyMounting.expectPlaceholderCount(targetId, 0);

    // Scroll back to the top: mounting is one-way, so the container persists.
    await pm.dashboardLazyMounting.scrollDashboardToTop();
    await pm.dashboardLazyMounting.expectContainerVisible(targetId);
    await pm.dashboardLazyMounting.expectPlaceholderCount(targetId, 0);

    testLogger.info("One-way mount on scroll verified");

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("should render the placeholder with the panel title but no chart or table body", { tag: ['@dashboards', '@dashboard-lazy-panel-mounting', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info("Asserting the placeholder is a lightweight card: title only, no renderer");
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_LazyMountPlaceholder_${Date.now()}`;

    await setupDashboard(page, pm, dashboardName);
    await buildStackedDashboard(page, pm, PANEL_COUNT);

    const targetId = await pm.dashboardLazyMounting.getPanelIdFromGridSlot(LAST_PANEL_INDEX);
    const panelTitle = `Panel${PANEL_COUNT}`;

    // The placeholder shows the panel title but no chart/table/no-data renderer.
    await pm.dashboardLazyMounting.expectPlaceholderVisible(targetId);
    await pm.dashboardLazyMounting.expectPlaceholderContainsTitle(targetId, panelTitle);
    await pm.dashboardLazyMounting.expectNoRendererInsidePlaceholder(targetId);

    testLogger.info("Placeholder is a lightweight card with title only");

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("should not fetch panel data until the placeholder panel is scrolled into view", { tag: ['@dashboards', '@dashboard-lazy-panel-mounting', '@all', '@P1'] }, async ({ page }) => {
    testLogger.info("Asserting the data-fetch gate: no renderer before scroll, renderer after mount + visibility");
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_LazyMountDataGate_${Date.now()}`;

    await setupDashboard(page, pm, dashboardName);
    await buildStackedDashboard(page, pm, PANEL_COUNT);

    const targetId = await pm.dashboardLazyMounting.getPanelIdFromGridSlot(LAST_PANEL_INDEX);

    // Before scroll: placeholder with no data renderer (no query ran for it).
    await pm.dashboardLazyMounting.expectPlaceholderVisible(targetId);
    await pm.dashboardLazyMounting.expectNoRendererInsidePlaceholder(targetId);

    // Scroll into view: gate 1 (mount) then gate 2 (data visibility) resolve.
    await pm.dashboardLazyMounting.scrollGridSlotIntoView(LAST_PANEL_INDEX);
    await pm.dashboardLazyMounting.expectContainerVisible(targetId);
    await pm.dashboardLazyMounting.expectRendererVisibleInPanel(targetId);

    testLogger.info("Data fetch stays gated until the panel is visible");

    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test.fixme("should render section-header panels as bare headings — deferred: needs an o2SectionHeader dashboard fixture (no editor UI / no committed JSON; RenderDashboardCharts.vue:152)", { tag: ['@dashboards', '@dashboard-lazy-panel-mounting', '@all', '@P2'] }, async ({ page }) => {
    testLogger.info("Section-header rendering is WIRED but blocked on a data fixture");
    const pm = new PageManager(page);
    const dashboardName = `Dashboard_LazyMountSectionHeader_${Date.now()}`;
    // o2SectionHeader is set only in the dashboard JSON; there is no dashboard-editor
    // UI to create it and no committed sample fixture in this checkout. When an
    // imported/sample dashboard with an o2SectionHeader panel is available, drive it here.

    await setupDashboard(page, pm, dashboardName);

    const headerId = await pm.dashboardLazyMounting.getPanelIdFromGridSlot(0);
    // A section header renders as a bare <h2>, not a placeholder card or container.
    await pm.dashboardLazyMounting.expectSectionHeaderVisible(headerId);
    await pm.dashboardLazyMounting.expectContainerCount(headerId, 0);
    await pm.dashboardLazyMounting.expectPlaceholderCount(headerId, 0);

    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
