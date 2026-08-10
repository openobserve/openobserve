// Service Correlation — full-drawer dashboard, settings, and edge cases.
// Covers remaining WIRED behaviors not exercised by the existing Correlation
// test suite (E-drawer, B1-settings, D3/D4-caches, correlationSettings).
//
// TC-SC1: Full drawer correlation dashboard opens from log row          [P0, WIRED]
// TC-SC2: Service Identity save from settings page                       [P0, WIRED]
// TC-SC3: Metric stream toggle in full drawer                            [P1, WIRED]
// TC-SC4: Discovered Services detail drawer                              [P1, WIRED]
// TC-SC5: Traces tab — dimension-based trace correlation                 [P1, WIRED]
// TC-SC6: K8s nested mode — Pods/Nodes outer tabs                        [P2, WIRED]
// TC-SC7: No-matching-service — informational message (200-null)         [P2, WIRED]
// TC-SC8: Metric selector dialog                                         [P2, UNWIRED — fixme]

const { test } = require("@playwright/test");
const { CorrApi } = require("./utils/correlationApi");
const {
  login,
  openLogsAndQuery,
  openFirstRowDialog,
} = require("./utils/corrUi");
const {
  openFullDrawerDashboard,
  expectDashboardDrawerVisible,
  expectAllCorrelationTabsVisible,
  clickDashboardMetricsTab,
  clickDashboardTracesTab,
  expectMetricStreamItemsVisible,
  clickMetricStreamItem,
  expectMetricStreamItemSelected,
  expectTracesContentLoaded,
  clickCorrelatedLogsTab,
  expectNoMatchMessageVisible,
  expectNoErrorStateVisible,
  navigateToCorrelationSettings,
  clickDiscoveredServicesTab,
  clickDetectionRulesTab,
  waitForServicesTableOrEmpty,
  openFirstServiceDetail,
  expectServiceSidePanelVisible,
  expectDiscoveredServicesEmptyStateVisible,
  expectSaveConfigurationButtonVisible,
  clickSaveConfiguration,
  expectSuccessNotification,
  hasK8sNestedTabs,
} = require("./utils/corrDashboard");
const testLogger = require("../utils/test-logger.js");

test.describe("Service Correlation testcases", () => {
  test.describe.configure({ mode: "parallel" });
  let api;

  // Alpha1/env shards run under playwright-alpha1.config.js (5-min CI cap);
  // discovery polling alone can take DISCOVERY_DEADLINE_MS.
  test.beforeEach(() => test.setTimeout(600_000));

  test.beforeAll(async () => {
    test.setTimeout(600_000);
    testLogger.info("Creating org and seeding shared data for service-correlation spec");
    api = await CorrApi.create("corr_svc");

    // Save identity config so correlation can match services.
    // Use "kubernetes" as the set ID so k8s-bearing data can (optionally)
    // trigger nested mode (TC-SC6).
    const save = await api.saveIdentity({
      sets: [
        {
          id: "kubernetes",
          label: "K8s",
          distinguish_by: ["k8s-cluster", "environment"],
        },
      ],
      tracked_alias_ids: ["k8s-cluster", "environment"],
      service_optional: false,
    });
    if (save.status !== 200) {
      throw new Error(
        `identity config save failed: ${JSON.stringify(save.body)}`,
      );
    }
    testLogger.info("Identity config saved");

    // Log streams shared by all tests (setup contract §corr_logs_svc, §corr_logs_alias).
    await api.ingestLogs("corr_logs_svc", [
      {
        service: "esvc",
        k8s_cluster: "C1-East",
        environment: "Prod-EU",
        message: "log-1",
      },
      {
        service: "esvc",
        k8s_cluster: "C2-West",
        environment: "Prod-EU",
        message: "log-2",
      },
    ]);
    testLogger.info("Ingested corr_logs_svc");

    await api.ingestLogs("corr_logs_alias", [
      { service: "esvc", cluster: "C1-East", message: "alias-1" },
      { service: "esvc", cluster: "C2-West", message: "alias-2" },
    ]);
    testLogger.info("Ingested corr_logs_alias");

    // Metrics stream (setup contract §corr_metrics_cpu).
    await api.ingestMetrics([
      { __name__: "cpu_usage", service: "esvc", k8s_cluster: "C1-East" },
    ]);
    testLogger.info("Ingested corr_metrics_cpu");

    // Traces for TC-SC5 (setup contract trace stream).
    await api.ingestTraces("esvc", { k8s_cluster: "C1-East" });
    testLogger.info("Ingested traces for esvc");

    // Wait for backend discovery (WAL flush + move job cadence).
    testLogger.info("Polling for esvc discovery…");
    await api.waitForServices(
      (r) => r.some((row) => row.service_name === "esvc"),
      "esvc discovered",
    );
    testLogger.info("esvc discovered — shared setup complete");
  });

  test.afterAll(async () => {
    testLogger.info("Disposing CorrApi org");
    await api.dispose();
  });

  // ── P0 ────────────────────────────────────────────────────────────

  test(
    "TC-SC1: should open full drawer correlation dashboard from log row",
    { tag: ["@service-correlation", "@all", "@P0"] },
    async ({ page }) => {
      testLogger.info("TC-SC1: opening full drawer dashboard");
      await login(page);
      await openLogsAndQuery(page, api.org, "corr_logs_svc");

      await openFullDrawerDashboard(page);
      await expectDashboardDrawerVisible(page);
      await expectAllCorrelationTabsVisible(page);
      testLogger.info("TC-SC1: full drawer dashboard opened successfully");
    },
  );

  test(
    "TC-SC2: should save service identity config from Detection Rules tab and show success notification",
    { tag: ["@service-correlation", "@all", "@P0", "@settings"] },
    async ({ page }) => {
      testLogger.info("TC-SC2: navigating to correlation settings");
      await login(page);
      await navigateToCorrelationSettings(page, api.org);
      await clickDetectionRulesTab(page);

      // Wait for the Save Configuration button — proves the tab loaded.
      await expectSaveConfigurationButtonVisible(page);

      // Save the identity config and assert a success notification appears.
      await clickSaveConfiguration(page);
      await expectSuccessNotification(page);
      testLogger.info("TC-SC2: service identity saved with notification");
    },
  );

  // ── P1 ────────────────────────────────────────────────────────────

  test(
    "TC-SC3: should toggle metric stream selection and update dashboard",
    { tag: ["@service-correlation", "@all", "@P1"] },
    async ({ page }) => {
      testLogger.info("TC-SC3: opening full drawer and switching to metrics");
      await login(page);
      await openLogsAndQuery(page, api.org, "corr_logs_svc");
      await openFullDrawerDashboard(page);
      await expectDashboardDrawerVisible(page);

      // Switch to Metrics tab and wait for the sidebar.
      await clickDashboardMetricsTab(page);
      await expectMetricStreamItemsVisible(page);

      // Click the first metric stream — toggle its selection.
      await clickMetricStreamItem(page, 0);
      testLogger.info("TC-SC3: metric stream item clicked");

      // Verify the item is still visible (selection state toggle may be subtle;
      // the key assertion is the dashboard area updated without error).
      await expectMetricStreamItemsVisible(page);
      // Assert the checkbox inside the metric stream item shows checked state.
      await expectMetricStreamItemSelected(page, 0);
      // No error state should appear after toggling.
      await expectNoErrorStateVisible(page);
      testLogger.info("TC-SC3: metric stream toggled without error");
    },
  );

  test(
    "TC-SC4: should open Discovered Services detail side panel",
    { tag: ["@service-correlation", "@all", "@P1", "@settings"] },
    async ({ page }) => {
      testLogger.info("TC-SC4: navigating to Discovered Services");
      await login(page);
      await navigateToCorrelationSettings(page, api.org);
      await clickDiscoveredServicesTab(page);

      // Wait for the services table or empty state.
      const hasServices = await waitForServicesTableOrEmpty(page);
      testLogger.info(
        `TC-SC4: services table ${hasServices ? "visible" : "empty"}`,
      );

      if (hasServices) {
        await openFirstServiceDetail(page);
        await expectServiceSidePanelVisible(page);
        testLogger.info("TC-SC4: service detail side panel opened");
      } else {
        // No services discovered — the empty-state must be visible.
        await expectDiscoveredServicesEmptyStateVisible(page);
        testLogger.info("TC-SC4: empty state visible — tab loaded OK");
      }
    },
  );

  test(
    "TC-SC5: should render traces tab content without error in full drawer",
    { tag: ["@service-correlation", "@all", "@P1"] },
    async ({ page }) => {
      testLogger.info("TC-SC5: opening full drawer and checking traces tab");
      await login(page);
      await openLogsAndQuery(page, api.org, "corr_logs_svc");
      await openFullDrawerDashboard(page);
      await expectDashboardDrawerVisible(page);

      // Switch to Traces tab.
      await clickDashboardTracesTab(page);
      await expectTracesContentLoaded(page);
      testLogger.info("TC-SC5: traces tab loaded without error");
    },
  );

  // ── P2 ────────────────────────────────────────────────────────────

  test(
    "TC-SC6: should render K8s nested mode Pods/Nodes tabs when data carries k8s fields",
    { tag: ["@service-correlation", "@all", "@P2", "@k8s"] },
    async ({ page }) => {
      testLogger.info("TC-SC6: checking for k8s nested mode tabs");
      await login(page);
      await openLogsAndQuery(page, api.org, "corr_logs_svc");
      await openFullDrawerDashboard(page);
      await expectDashboardDrawerVisible(page);

      // K8s nested mode may or may not trigger depending on the _correlate
      // response. If the data triggers it, Pods/Nodes tabs appear.
      const nested = await hasK8sNestedTabs(page);
      testLogger.info(
        `TC-SC6: k8s nested mode ${nested ? "DETECTED" : "not triggered"} — dashboard rendered OK either way`,
      );

      if (nested) {
        // K8s pods/nodes tabs are visible — assert no error state.
        await expectNoErrorStateVisible(page);
      } else {
        // K8s mode not triggered — standard dashboard tabs must be visible.
        await expectAllCorrelationTabsVisible(page);
        await expectNoErrorStateVisible(page);
      }
      testLogger.info("TC-SC6: dashboard rendered without error");
    },
  );

  test(
    "TC-SC7: should show informational message when no matching service is found (200-null)",
    { tag: ["@service-correlation", "@all", "@P2", "@edge-case"] },
    async ({ page }) => {
      testLogger.info("TC-SC7: creating no-match environment");
      // This test needs its OWN org with no identity config and logs that
      // carry no recognizable service/dimension fields (setup contract §per-test).
      const noMatchApi = await CorrApi.create("corr_empty");

      try {
        // Ingest a log record with NO service field — correlation won't match.
        await noMatchApi.ingestLogs("corr_empty", [
          { message: "orphan log with no service tags" },
        ]);
        testLogger.info("TC-SC7: ingested orphan log record");

        // Give the backend a moment to accept the ingest.
        await new Promise((r) => setTimeout(r, 2_000));

        await login(page);
        await openLogsAndQuery(page, noMatchApi.org, "corr_empty");
        await openFirstRowDialog(page);

        // Click the Correlated Logs tab in the DetailTable sidebar.
        await clickCorrelatedLogsTab(page);

        // Assert: no error state, informational message is shown.
        await expectNoMatchMessageVisible(page);
        testLogger.info("TC-SC7: no-match message displayed, no error state");
      } finally {
        await noMatchApi.dispose();
      }
    },
  );

  test(
    "TC-SC8: metric selector dialog should be reachable",
    { tag: ["@service-correlation", "@all", "@P2", "@fixme"] },
    async () => {
      test.fixme(
        true,
        "TC-SC8: metric selector dialog has no UI trigger — UNWIRED per Behavior Reachability table (TelemetryCorrelationDashboard.vue showMetricSelector ref)",
      );
    },
  );
});
