
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

import { Dashboard } from "../../pages/dashboardPages/dashboard_commFun.js";
import {Aggregations} from "../../pages/dashboardPages/aggregation.js";


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

  test("Should update the query when adding 'Sum' aggregation types and verify.", async ({ page }) => {
    const dashboardObject = new Dashboard(page);
    const aggregationObject = new Aggregations(page, "code", "sum");

    await dashboardObject.createDashboard();
    await dashboardObject.streamSelect();
    await aggregationObject.configureYAxis();
    await aggregationObject.aggregation();
    await dashboardObject.clickApplyButton();
    await aggregationObject.verifyQueryInspector();
    await dashboardObject.savePanel(randomDashboardName);
    await dashboardObject.deleteDashboard();
  });
    
  test("Should update the query when adding 'average' aggregation types and verify.", async ({ page }) => {
    const dashboardObject = new Dashboard(page);
    const aggregationObject = new Aggregations(page, "kubernetes_namespace_name", "avg");

    await dashboardObject.createDashboard();
    await dashboardObject.streamSelect();
    await aggregationObject.configureYAxis();
    await aggregationObject.aggregation();
    await dashboardObject.clickApplyButton();
    await aggregationObject.verifyQueryInspector();
    await dashboardObject.savePanel(randomDashboardName);
    await dashboardObject.deleteDashboard();
  });

  test("Should update the query when adding 'Count (Distinct)' aggregations and verify that the query is updated correctly.", async ({
    page,
  }) => {
    const dashboardObject = new Dashboard(page);
    const aggregationObject = new Aggregations(page, "kubernetes_namespace_name", "Count (Distinct)");

    await dashboardObject.createDashboard();
    await dashboardObject.streamSelect();
    await aggregationObject.configureYAxis();
    await aggregationObject.aggregation();
    await dashboardObject.clickApplyButton();
    await aggregationObject.verifyQueryInspector();
    await dashboardObject.savePanel(randomDashboardName);
    await dashboardObject.deleteDashboard();
  });
  test("Should update the query when adding 'Max' aggregations and verify that the query is updated correctly.", async ({
    page,
  }) => {
    const dashboardObject = new Dashboard(page);
    const aggregationObject = new Aggregations(page, "code", "Max");
    await dashboardObject.createDashboard();
    await dashboardObject.streamSelect();
    await aggregationObject.configureYAxis();
    await aggregationObject.aggregation();
    await dashboardObject.clickApplyButton();
    await aggregationObject.verifyQueryInspector();
    await dashboardObject.savePanel(randomDashboardName);
    await dashboardObject.deleteDashboard();
  });
});
