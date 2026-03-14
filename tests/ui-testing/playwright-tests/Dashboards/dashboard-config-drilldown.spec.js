const {
  test,
  expect,
  navigateToBase,
} = require("../utils/enhanced-baseFixtures.js");
import PageManager from "../../pages/page-manager";
import { ingestion } from "./utils/dashIngestion.js";
import { cleanupTestDashboard } from "./utils/dashCreation.js";
import {
  generateDashboardName,
  setupBarPanelWithConfig,
  reopenPanelConfig,
} from "./utils/configPanelHelpers.js";
const testLogger = require('../utils/test-logger.js');

test.describe.configure({ mode: "parallel" });
test.describe.configure({ retries: 1 });

/**
 * Add a drilldown via the popup dialog.
 * Flow: click Add btn → popup opens → fill name → switch to Logs/Auto type
 *       (avoids needing folder+dashboard+tab which byDashboard requires) → click Save
 */
async function addDrilldown(page, pm, name) {
  const addBtn = page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').first();
  await pm.dashboardPanelConfigs.scrollSidebarToElement(addBtn);
  await addBtn.click();

  const popup = page.locator('[data-test="dashboard-drilldown-popup"]');
  await popup.waitFor({ state: "visible", timeout: 10000 });

  const nameInput = popup.locator('[data-test="dashboard-config-panel-drilldown-name"]');
  await nameInput.waitFor({ state: "visible", timeout: 5000 });
  await nameInput.fill(name);

  // Switch to Logs type — "auto" logsMode is default, so Save button becomes enabled.
  // (Default type is "byDashboard" which requires folder+dashboard+tab selections.)
  const logsBtn = popup.locator('[data-test="dashboard-drilldown-by-logs-btn"]');
  await logsBtn.waitFor({ state: "visible", timeout: 5000 });
  await logsBtn.click();

  // Save button is `confirm-button` scoped inside the drilldown popup
  const saveBtn = popup.locator('[data-test="confirm-button"]');
  await saveBtn.waitFor({ state: "visible", timeout: 5000 });
  await saveBtn.click();

  await popup.waitFor({ state: "hidden", timeout: 10000 });
  testLogger.info(`Drilldown added: ${name}`);
}

test.describe("ConfigPanel — Drilldown Configuration", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  test("drilldown add: add button visible → popup opens → fill name → save → item appears in list", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const addBtn = page.locator('[data-test="dashboard-addpanel-config-drilldown-add-btn"]').first();
    await pm.dashboardPanelConfigs.scrollSidebarToElement(addBtn);
    await expect(addBtn).toBeVisible();

    await addDrilldown(page, pm, "Test Drilldown");

    // After saving, the drilldown item appears in the list
    const drilldownItem = page.locator('[data-test="dashboard-addpanel-config-drilldown-name-0"]');
    await expect(drilldownItem).toBeVisible({ timeout: 5000 });
    await expect(drilldownItem).toContainText("Test Drilldown");
    testLogger.info("Drilldown item 'Test Drilldown' appears in list");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("drilldown remove: add drilldown → remove it → item disappears from list → apply → chart renders", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await addDrilldown(page, pm, "To Remove");

    const drilldownItem = page.locator('[data-test="dashboard-addpanel-config-drilldown-name-0"]');
    await expect(drilldownItem).toBeVisible({ timeout: 5000 });
    testLogger.info("Drilldown 'To Remove' added — now removing");

    // Click remove button at index 0
    const removeBtn = page.locator('[data-test="dashboard-addpanel-config-drilldown-remove-0"]');
    await removeBtn.waitFor({ state: "visible", timeout: 5000 });
    await removeBtn.click();

    // Item should disappear from the list
    await expect(drilldownItem).not.toBeVisible({ timeout: 5000 });
    testLogger.info("Drilldown removed — item no longer in list");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  test("drilldown persistence: add drilldown with name → save → reopen → name persists in list", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    await addDrilldown(page, pm, "Persistent Drilldown");

    const drilldownItem = page.locator('[data-test="dashboard-addpanel-config-drilldown-name-0"]');
    await expect(drilldownItem).toContainText("Persistent Drilldown");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender();
    await pm.dashboardPanelActions.verifyChartHasData(expect);

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying drilldown persists after save");
    await reopenPanelConfig(page, pm);

    // Scroll to drilldown section and verify the saved name is visible
    const savedItem = page.locator('[data-test="dashboard-addpanel-config-drilldown-name-0"]');
    await pm.dashboardPanelConfigs.scrollSidebarToElement(savedItem);
    await expect(savedItem).toContainText("Persistent Drilldown");
    testLogger.info("Drilldown 'Persistent Drilldown' persisted after save");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
