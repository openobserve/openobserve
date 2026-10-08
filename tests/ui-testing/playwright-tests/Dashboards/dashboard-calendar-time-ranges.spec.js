const { test, expect, navigateToBase } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
import { ingestion } from "./utils/dashIngestion.js";
import PageManager from "../../pages/page-manager.js";
import { waitForDashboardPage, deleteDashboard } from "./utils/dashCreation.js";
import { generateDashboardName } from "./utils/configPanelHelpers.js";

// A past month reads "Aug 2026"; the month itself depends on the run date.
const OLDER_MONTH_LABEL = /^[A-Z][a-z]{2} \d{4}$/;
const ABSOLUTE_RANGE_TOOLTIP = /^\d{4}\/\d{2}\/\d{2} 00:00:00 - \d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2} \(.+\)$/;

test.describe.configure({ mode: "parallel" });

test.describe("Dashboard calendar time ranges", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    await ingestion(page);
  });

  const createEmptyDashboard = async (page, pm) => {
    const dashboardName = generateDashboardName();
    await pm.dashboardList.menuItem("dashboards-item");
    await waitForDashboardPage(page);
    await pm.dashboardCreate.createDashboard(dashboardName);
    await pm.dashboardCreate.waitForAddPanelIfEmptyVisible();
    return dashboardName;
  };

  test(
    "This month steps back to Last month and older months with the arrows",
    { tag: ["@dashboard", "@datetime-picker", "@calendar-time-ranges", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = await createEmptyDashboard(page, pm);

      await pm.dateTimeHelper.setCalendarPeriod("month", "this");
      await pm.dateTimeHelper.expectGlobalTimeLabel("This month");
      await pm.dateTimeHelper.expectPeriodInURL("calendar:month:0");
      await pm.dateTimeHelper.expectGlobalNextDisabled();
      await pm.dateTimeHelper.expectGlobalTimeTooltip(ABSOLUTE_RANGE_TOOLTIP);

      await pm.dateTimeHelper.clickGlobalPrev();
      await pm.dateTimeHelper.expectGlobalTimeLabel("Last month");
      await pm.dateTimeHelper.expectPeriodInURL("calendar:month:-1");

      await pm.dateTimeHelper.clickGlobalPrev();
      await pm.dateTimeHelper.expectGlobalTimeLabel(OLDER_MONTH_LABEL);
      await pm.dateTimeHelper.expectPeriodInURL("calendar:month:-2");

      await pm.dateTimeHelper.clickGlobalNext();
      await pm.dateTimeHelper.expectGlobalTimeLabel("Last month");
      await pm.dateTimeHelper.expectPeriodInURL("calendar:month:-1");

      await pm.dateTimeHelper.clickGlobalNext();
      await pm.dateTimeHelper.expectGlobalTimeLabel("This month");
      await pm.dateTimeHelper.expectPeriodInURL("calendar:month:0");
      await pm.dateTimeHelper.expectGlobalNextDisabled();

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "Today and Yesterday apply and survive a reload",
    { tag: ["@dashboard", "@datetime-picker", "@calendar-time-ranges", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = await createEmptyDashboard(page, pm);

      await pm.dateTimeHelper.setCalendarPeriod("today", "day");
      await pm.dateTimeHelper.expectGlobalTimeLabel("Today");
      await pm.dateTimeHelper.expectPeriodInURL("calendar:day:0");

      await pm.dateTimeHelper.setCalendarPeriod("yesterday", "day");
      await pm.dateTimeHelper.expectGlobalTimeLabel("Yesterday");
      await pm.dateTimeHelper.expectPeriodInURL("calendar:day:-1");

      await page.reload();
      await pm.dashboardCreate.waitForDashboardContentLoaded();
      await pm.dateTimeHelper.expectGlobalTimeLabel("Yesterday");
      await pm.dateTimeHelper.expectPeriodInURL("calendar:day:-1");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );

  test(
    "This month as the dashboard default duration persists and opens the dashboard",
    { tag: ["@dashboard", "@dashboard-settings", "@calendar-time-ranges", "@P1"] },
    async ({ page }) => {
      const pm = new PageManager(page);
      const dashboardName = await createEmptyDashboard(page, pm);

      await pm.dashboardSetting.openSetting();
      await pm.dashboardSetting.calendarTimeSelection("month", "this");
      await pm.dashboardSetting.saveSetting();
      await expect(
        pm.dashboardSetting.getToastMessageByText("Dashboard updated successfully")
      ).toBeVisible({ timeout: 30000 });
      await pm.dashboardSetting.closeSettingDashboard();

      await pm.dashboardSetting.openSetting();
      await expect(pm.dashboardSetting.getDefaultDurationLabel()).toHaveText("This month");
      await pm.dashboardSetting.closeSettingDashboard();

      // Without period/from/to in the URL the dashboard resolves its saved default.
      const url = new URL(page.url());
      ["period", "from", "to"].forEach((key) => url.searchParams.delete(key));
      await page.goto(url.toString());
      await pm.dashboardCreate.waitForDashboardContentLoaded();
      await pm.dateTimeHelper.expectGlobalTimeLabel("This month");
      await pm.dateTimeHelper.expectPeriodInURL("calendar:month:0");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashboardName);
    }
  );
});
