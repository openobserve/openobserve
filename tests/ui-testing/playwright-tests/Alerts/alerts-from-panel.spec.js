// Create Alert from Dashboard Panel - E2E Tests
// Covers the shared "create an alert from here" confirm dialog when entered from
// a dashboard panel (source: "panel"). The headline path is a multi-query panel
// opening the dialog in pickQueryOnly mode (query picker + picked query, with
// threshold/window/preview suppressed), plus the disabled menu item and cancel.

import {
  test,
  expect,
  navigateToBase,
} from "../utils/enhanced-baseFixtures.js";
import PageManager from "../../pages/page-manager";
import { ingestion } from "../Dashboards/utils/dashIngestion.js";
import {
  waitForDashboardPage,
  deleteDashboard,
} from "../Dashboards/utils/dashCreation.js";
import { waitForStreamComplete } from "../utils/streaming-helpers.js";
import testLogger from "../utils/test-logger.js";

test.describe("Create Alert from Dashboard Panel testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let pm;

  test.beforeEach(async ({ page }, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    await navigateToBase(page);
    pm = new PageManager(page);
    await ingestion(page);

    // navigateToBase() alone can land on the wrong org's page on cloud; force
    // the correct org with an explicit navigation to a real feature page.
    await page.goto(
      `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=default`
    );
    await page.waitForLoadState("domcontentloaded");
    testLogger.info("Test setup completed");
  });

  test(
    "should open the query-picker confirm dialog from a multi-query panel and land on the pre-filled alert form",
    { tag: ["@create-alert-from-panel", "@alerts", "@all", "@P0"] },
    async ({ page }) => {
      testLogger.info("Testing multi-query panel -> confirm dialog -> alert form");

      const dashName =
        "Dashboard_Alert_MQ_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-mq");

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashName);

      // Bar chart panel with two visible queries, each on e2e_automate.
      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      // Q1
      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // Q2 — a new query tab becomes active; give it its own stream + measure.
      await pm.dashboardMultiSQL.addQueryTab(1);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_namespace_name",
        "y"
      );

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      const dashboardStreamPromise = waitForStreamComplete(page, 30000);
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;
      await pm.dashboardPanelActions
        .getChartRendererCanvasElement()
        .first()
        .waitFor({ state: "visible", timeout: 15000 });

      await pm.dashboardPanelEdit.getPanelContainer().first().hover();
      await pm.dashboardPanelEdit.createAlertFromPanelMenu(panelName);

      // The confirm dialog appears only because there are >= 2 queries.
      await pm.createAlertFromSourceDialog.expectDialogVisible();
      await pm.createAlertFromSourceDialog.expectQueryPickerVisible();

      // pickQueryOnly shows the picked query; threshold/window/preview are suppressed.
      await pm.createAlertFromSourceDialog.expectPickedQueryTextVisible();
      expect(
        await pm.createAlertFromSourceDialog.getPickedQueryText()
      ).not.toBe("");
      await pm.createAlertFromSourceDialog.expectThresholdShapeHidden();
      await pm.createAlertFromSourceDialog.expectWindowHidden();
      await pm.createAlertFromSourceDialog.expectQueryPreviewHidden();

      await pm.createAlertFromSourceDialog.clickContinue();

      await page.waitForURL(/.*alerts\/add.*prefill=panel.*/, {
        timeout: 30000,
      });
      const currentUrl = page.url();
      expect(currentUrl).toContain("prefill=panel");
      // The panel payload rides sessionStorage, not the URL.
      expect(currentUrl).not.toContain("panelData=");

      // The alert name is an OFormInlineEdit title: in display mode the value
      // is a span, not an <input>, so read the committed value via the helper.
      const alertNameValue = pm.alertsPage.getAlertNameValueLocator();
      await expect(alertNameValue).toBeVisible({ timeout: 30000 });
      expect((await alertNameValue.textContent()) ?? "").toContain("Alert_from_");
      testLogger.info("Landed on the alert form pre-filled from the panel");

      // Navigate back to the dashboard folder and clean up.
      await page.goto(
        `${process.env["ZO_BASE_URL"]}/web/dashboards?org_identifier=${process.env["ORGNAME"]}&folder=default`
      );
      await page.waitForLoadState("domcontentloaded");
      await waitForDashboardPage(page);
      await pm.dashboardFolder
        .getFolderCardByName("default")
        .waitFor({ state: "visible", timeout: 30000 });
      await pm.dashboardFolder.openFolderByName("default");
      await deleteDashboard(page, dashName);

      testLogger.info("Test completed: multi-query panel confirm dialog");
    }
  );

  test(
    "should update the picked-query text when a different query is selected in the dialog",
    { tag: ["@create-alert-from-panel", "@alerts", "@all", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing query picker re-parameterisation (rebuild)");

      const dashName =
        "Dashboard_Alert_RB_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-rebuild");

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashName);

      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      await pm.dashboardMultiSQL.addQueryTab(1);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_namespace_name",
        "y"
      );

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      const dashboardStreamPromise = waitForStreamComplete(page, 30000);
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;
      await pm.dashboardPanelActions
        .getChartRendererCanvasElement()
        .first()
        .waitFor({ state: "visible", timeout: 15000 });

      await pm.dashboardPanelEdit.getPanelContainer().first().hover();
      await pm.dashboardPanelEdit.createAlertFromPanelMenu(panelName);

      await pm.createAlertFromSourceDialog.expectDialogVisible();
      const initialText =
        await pm.createAlertFromSourceDialog.getPickedQueryText();
      expect(initialText).not.toBe("");

      await pm.createAlertFromSourceDialog.selectQuery(1);

      // The picked-query display follows the newly chosen query.
      await expect
        .poll(
          async () =>
            await pm.createAlertFromSourceDialog.getPickedQueryText(),
          { timeout: 15000 }
        )
        .not.toBe(initialText);

      await pm.createAlertFromSourceDialog.clickCancel();
      await pm.createAlertFromSourceDialog.expectDialogHidden();

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);

      testLogger.info("Test completed: query picker rebuild");
    }
  );

  test(
    "should close the confirm dialog on Cancel and stay on the dashboard",
    { tag: ["@create-alert-from-panel", "@alerts", "@all", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing Cancel on the confirm dialog");

      const dashName =
        "Dashboard_Alert_Cancel_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-cancel");

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashName);

      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      await pm.dashboardMultiSQL.addQueryTab(1);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_namespace_name",
        "y"
      );

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      const dashboardStreamPromise = waitForStreamComplete(page, 30000);
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;
      await pm.dashboardPanelActions
        .getChartRendererCanvasElement()
        .first()
        .waitFor({ state: "visible", timeout: 15000 });

      await pm.dashboardPanelEdit.getPanelContainer().first().hover();
      await pm.dashboardPanelEdit.createAlertFromPanelMenu(panelName);

      await pm.createAlertFromSourceDialog.expectDialogVisible();
      await pm.createAlertFromSourceDialog.clickCancel();
      await pm.createAlertFromSourceDialog.expectDialogHidden();

      // No route change: still on the dashboard, not the alert form.
      expect(page.url()).not.toContain("alerts/add");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);

      testLogger.info("Test completed: Cancel closes the confirm dialog");
    }
  );

  test(
    "should disable the Create Alert menu item with a reason when the panel has no visible query",
    { tag: ["@create-alert-from-panel", "@alerts", "@all", "@P1"] },
    async ({ page }) => {
      testLogger.info("Testing disabled Create Alert menu item (no visible query)");

      const dashName =
        "Dashboard_Alert_Dsb_" + Math.random().toString(36).slice(2, 11);
      const panelName =
        pm.dashboardPanelActions.generateUniquePanelName("alert-disabled");

      await pm.dashboardList.menuItem("dashboards-item");
      await waitForDashboardPage(page);

      await pm.dashboardCreate.createDashboard(dashName);

      await pm.dashboardCreate.addPanel();
      await pm.dashboardPanelActions.addPanelName(panelName);

      await pm.chartTypeSelector.selectChartType("bar");
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_container_name",
        "y"
      );

      // The visibility toggle only appears from the second query onwards, so
      // add a second query and hide BOTH to leave the panel with no visible query.
      await pm.dashboardMultiSQL.addQueryTab(1);
      await pm.chartTypeSelector.selectStreamType("logs");
      await pm.chartTypeSelector.selectStream("e2e_automate");
      await pm.chartTypeSelector.searchAndAddField(
        "kubernetes_namespace_name",
        "y"
      );

      const streamPromise = waitForStreamComplete(page);
      await pm.dashboardPanelActions.applyDashboardBtn();
      await streamPromise;
      await pm.dashboardPanelActions.waitForChartToRender();

      // Hide both queries so the saved panel has zero visible queries.
      await pm.dashboardMultiSQL.toggleQueryVisibility(0);
      await pm.dashboardMultiSQL.toggleQueryVisibility(1);

      const dashboardStreamPromise = waitForStreamComplete(page, 30000);
      await pm.dashboardPanelActions.savePanel();
      await dashboardStreamPromise;

      await pm.dashboardPanelEdit.getPanelContainer().first().hover();
      await pm.dashboardPanelActions.getEditPanelDropdown(panelName).click();

      const createAlertItem = pm.dashboardPanelEdit.getCreateAlertFromPanelItem();
      await expect(createAlertItem).toBeVisible({ timeout: 10000 });
      await expect(createAlertItem).toBeDisabled();
      await expect(
        pm.dashboardPanelEdit.getCreateAlertFromPanelReason()
      ).toHaveText("This panel has no queries to create an alert from");

      await pm.dashboardCreate.backToDashboardList();
      await deleteDashboard(page, dashName);

      testLogger.info("Test completed: disabled Create Alert menu item");
    }
  );

  test.fixme(
    "should block Continue in the confirm dialog when the prefill carries an unresolved-query warning — deferred: unresolved-variable panel setup unproven in CI (fromPanel.ts:293-295)",
    { tag: ["@create-alert-from-panel", "@alerts", "@all", "@P2"] },
    async ({ page }) => {
      // A panel query referencing an unresolved dashboard variable ($var) with
      // no executedQuery produces a blocking `unresolvedQuery` warning, which
      // disables Continue. Constructing that panel deterministically (a $var
      // that does not resolve) has no proven helper in the suite yet.
      testLogger.info("Testing blocking warning disables Continue (deferred)");

      await pm.createAlertFromSourceDialog.expectWarningVisible("unresolvedQuery");
      await pm.createAlertFromSourceDialog.expectContinueDisabled();
    }
  );
});
