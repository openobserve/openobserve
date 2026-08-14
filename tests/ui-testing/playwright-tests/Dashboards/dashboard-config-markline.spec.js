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

test.describe("ConfigPanel — Mark Line Settings", () => {
  test.beforeEach(async ({ page }) => {
    await navigateToBase(page);
    await ingestion(page);
  });

  // Covers: section visible, add with average type + label, value input shown/hidden per type,
  // yAxis value field, apply → save → reopen → all values persist
  test("add mark line → set type/label/value → apply; reopen → persists", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const addBtn = pm.dashboardPanelConfigs.marklineAddBtn;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(addBtn);
    await expect(addBtn).toBeVisible();

    // Add mark line — default type is yAxis, value input should appear immediately
    await addBtn.click();
    const typeSelect = pm.dashboardPanelConfigs.getMarklineTypeSelect(0);
    await typeSelect.waitFor({ state: 'visible', timeout: 10000 });
    const valueInput = pm.dashboardPanelConfigs.getMarklineValue(0);
    await expect(valueInput).toBeVisible();
    testLogger.info("Value input visible for yAxis type");

    // Switch to average — value input should hide
    await typeSelect.click();
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Average").waitFor({ state: 'visible', timeout: 10000 });
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Average").click();
    // Wait for dropdown to close before checking value input visibility
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Average").waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await expect(valueInput).not.toBeVisible();
    testLogger.info("Value input hidden for Average type");

    // Switch back to yAxis — value input re-appears, fill it
    await typeSelect.click();
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Y-Axis").waitFor({ state: 'visible', timeout: 10000 });
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Y-Axis").click();
    // Wait for dropdown to close before interacting with value input
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Y-Axis").waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await expect(valueInput).toBeVisible();
    await valueInput.locator('[data-test$="-field"]').fill("100");
    await pm.dashboardPanelConfigs.getMarklineName(0).locator('[data-test$="-field"]').fill("threshold");
    testLogger.info("Mark line configured: yAxis, value=100, label=threshold");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    testLogger.info("Verifying mark line persists after save");
    await reopenPanelConfig(page, pm);

    const valueAfter = pm.dashboardPanelConfigs.getMarklineValue(0);
    const nameAfter = pm.dashboardPanelConfigs.getMarklineName(0);
    await pm.dashboardPanelConfigs.scrollSidebarToElement(valueAfter);
    // the select uses emit-value without map-options → displays raw stored value ("yAxis" not "Y-Axis")
    await expect(pm.dashboardPanelConfigs.getMarklineTypeTrigger(0)).toHaveAttribute('data-test-selected-value', 'yAxis');
    await expect(valueAfter.locator('[data-test$="-field"]')).toHaveValue("100");
    await expect(nameAfter.locator('[data-test$="-field"]')).toHaveValue("threshold");
    testLogger.info("Mark line type, value and label persisted");

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });

  // Covers: add two mark lines with independent config, remove first → second shifts to index 0
  test("add two mark lines → remove first → second shifts to index 0", async ({ page }) => {
    const pm = new PageManager(page);
    const dashboardName = generateDashboardName();

    await setupBarPanelWithConfig(page, pm, dashboardName);

    const addBtn = pm.dashboardPanelConfigs.marklineAddBtn;
    await pm.dashboardPanelConfigs.scrollSidebarToElement(addBtn);

    // Add first mark line
    await addBtn.click();
    const type0 = pm.dashboardPanelConfigs.getMarklineTypeSelect(0);
    await type0.waitFor({ state: 'visible', timeout: 10000 });
    // Scroll into sidebar viewport — waitFor only checks CSS visibility, not scroll position.
    await pm.dashboardPanelConfigs.scrollSidebarToElement(type0);
    await type0.click();
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Average").waitFor({ state: 'visible', timeout: 10000 });
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Average").click();
    // Wait for dropdown to close before filling name — avoids interaction with open dropdown
    await pm.dashboardPanelConfigs.getMarklineTypeOption(0, "Average").waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await pm.dashboardPanelConfigs.getMarklineName(0).locator('[data-test$="-field"]').fill("avg");

    // Add second mark line
    await pm.dashboardPanelConfigs.scrollSidebarToElement(addBtn);
    await addBtn.click();
    const type1 = pm.dashboardPanelConfigs.getMarklineTypeSelect(1);
    await type1.waitFor({ state: 'visible', timeout: 10000 });
    await pm.dashboardPanelConfigs.scrollSidebarToElement(type1);
    await type1.click();
    await pm.dashboardPanelConfigs.getMarklineTypeOption(1, "Max").waitFor({ state: 'visible', timeout: 10000 });
    await pm.dashboardPanelConfigs.getMarklineTypeOption(1, "Max").click();
    // Wait for dropdown to close before asserting state
    await pm.dashboardPanelConfigs.getMarklineTypeOption(1, "Max").waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await pm.dashboardPanelConfigs.getMarklineName(1).locator('[data-test$="-field"]').fill("max");

    await expect(pm.dashboardPanelConfigs.getMarklineTypeTrigger(0)).toHaveAttribute('data-test-selected-value', 'average');
    await expect(pm.dashboardPanelConfigs.getMarklineTypeTrigger(1)).toHaveAttribute('data-test-selected-value', 'max');
    testLogger.info("Two mark lines added with independent types");

    // Remove first row — second shifts to index 0
    await pm.dashboardPanelConfigs.getMarklineRemoveBtn(0).click();
    await expect(type1).not.toBeVisible();
    await expect(pm.dashboardPanelConfigs.getMarklineName(0).locator('[data-test$="-field"]')).toHaveValue("max");
    testLogger.info("First mark line removed, second shifted to index 0");

    await pm.dashboardPanelActions.applyDashboardBtn();
    await pm.dashboardPanelActions.waitForChartToRender().catch((e) => testLogger.warn("waitForChartToRender:", e.message));

    await pm.dashboardPanelActions.savePanel();
    await cleanupTestDashboard(page, pm, dashboardName);
  });
});
