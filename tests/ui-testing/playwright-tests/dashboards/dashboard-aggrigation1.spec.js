


import { test, expect } from "../baseFixtures.js";
import logData from "../../cypress/fixtures/log.json";
import logsdata from "../../../test-data/logs_data.json";
import { login } from "../utils/dashLogin.js";
import { ingestion, removeUTFCharacters } from "../utils/dashIngestion.js";
import {
  waitForDashboardPage,
  applyQueryButton,
  deleteDashboard,
} from "../utils/dashCreation.js";

import { DashboardClass } from "../utils/dashboard_commFun.js";

export const randomDashboardName =
  "Dashboard_" + Math.random().toString(36).substr(2, 9);

test.describe.configure({ mode: "parallel" });

test.describe("dashboard filter testcases", () => {
  test.beforeEach(async ({ page }) => {
    console.log("running before each");
    await login(page);
    await page.waitForTimeout(1000);
    await ingestion(page);
    await page.waitForTimeout(2000);

    const orgNavigation = page.goto(
      `${logData.logsUrl}?org_identifier=${process.env["ORGNAME"]}`
    );
    await orgNavigation;
  });

  test("Should update the query when adding different types of aggregations and verify that the query is updated correctly.", async ({
    page,
  }) => {
    // Navigate to dashboards
    const dashboardObject = new DashboardClass(page, "kubernetes_namespace_name");

     await dashboardObject.createDashboard();
    //  await dashboardObject.setDateFilter();
        await dashboardObject.streamSelect(page);
        await dashboardObject.configureYAxis();
        await dashboardObject.aggregation();
        await dashboardObject.clickApplyButton();
        await dashboardObject.verifyQueryInspector();
        await dashboardObject.savePanel();
        await dashboardObject.deleteDashboard();
  });
});
