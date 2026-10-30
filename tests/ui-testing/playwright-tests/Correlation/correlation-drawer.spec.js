// Copyright 2026 OpenObserve Inc.

/**
 * Correlation — correlate-from-a-log drawer  [P0]  (enterprise-only)
 *
 * Opening a log record and correlating: the correlated-logs tab populates and
 * the wire SQL carries RAW (not lowercased) dimension values (F1); a stream
 * that can't resolve a dimension reports dropped_dimensions and the metrics tab
 * still renders without error (F14).
 *
 * Coverage:
 *  - DRAWER-01 (TC-E1): happy path — correlated logs populated, raw values on the wire
 *  - DRAWER-02 (TC-E2): dropped-dimensions reported; metrics tab renders (F14)
 *  - DRAWER-03 (TC-E4): filter edit propagates to both alias-divergent streams (F35)
 *    — fixme: no reachable UI entry from the logs journey on this branch (see below)
 *
 * Setup (fresh org, discovery is org-global) runs once in beforeAll via an
 * authed setup page. Shared plumbing: ../utils/correlation-api-helpers.js +
 * ../utils/correlation-ui-helpers.js.
 */

const { test, expect } = require("../utils/enhanced-baseFixtures.js");
const testLogger = require("../utils/test-logger.js");
const {
  createCorrelationOrg,
  deleteOrg,
  ingestLogs,
  ingestMetrics,
  saveIdentity,
  waitForServices,
} = require("../utils/correlation-api-helpers.js");
const {
  withSetupPage,
  openLogsAndQuery,
  openFirstRowDialog,
  sniff,
  waitFor,
} = require("../utils/correlation-ui-helpers.js");
const PageManager = require("../../pages/page-manager.js");

test.describe.configure({ mode: "serial" });

test.describe("Correlation — correlate-from-a-log drawer", { tag: ["@correlation", "@P0"] }, () => {
  let org;

  test.beforeEach(async ({}, testInfo) => {
    testLogger.testStart(testInfo.title, testInfo.file);
    test.setTimeout(600_000);
  });

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(600_000);
    await withSetupPage(browser, async (page) => {
      org = await createCorrelationOrg(page, "corr_ui_drawer");
      // environment is part of the identity so streams lacking an environment
      // field (e_logs_b, e_cpu) produce dropped_dimensions (F14 / DRAWER-02).
      const save = await saveIdentity(page, org, {
        sets: [{ id: "k8s", label: "K8s", distinguish_by: ["k8s-cluster", "environment"] }],
        tracked_alias_ids: ["k8s-cluster", "environment"],
        service_optional: false,
      });
      if (save.status !== 200) throw new Error(`cfg save failed: ${JSON.stringify(save.body)}`);

      // Two alias-divergent log streams (k8s_cluster vs cluster) + one metrics
      // stream missing 'environment' (banner trigger for DRAWER-02).
      await ingestLogs(page, org, "e_logs_a", [
        { service: "esvc", k8s_cluster: "C1-East", environment: "Prod-EU", message: "a1" },
        { service: "esvc", k8s_cluster: "C1-East", environment: "Prod-EU", message: "a2" },
      ]);
      await ingestLogs(page, org, "e_logs_b", [
        { service: "esvc", cluster: "C1-East", message: "b1" },
      ]);
      // Second cluster value so the DRAWER-03 dimension-filter OSelect has an option to switch to.
      await ingestLogs(page, org, "e_logs_a", [
        { service: "esvc", k8s_cluster: "C2-West", environment: "Prod-EU", message: "a3" },
      ]);
      await ingestLogs(page, org, "e_logs_b", [
        { service: "esvc", cluster: "C2-West", message: "b2" },
      ]);
      await ingestMetrics(page, org, [
        { __name__: "e_cpu", service: "esvc", k8s_cluster: "C1-East" },
      ]);
      await waitForServices(
        page,
        org,
        (r) =>
          r.some(
            (row) =>
              row.service_name === "esvc" &&
              (row.logs_streams || []).includes("e_logs_a") &&
              (row.logs_streams || []).includes("e_logs_b") &&
              (row.metrics_streams || []).includes("e_cpu"),
          ),
        "esvc discovered across all three streams",
      );
    });
  });

  test.afterAll(async ({ browser }) => {
    await withSetupPage(browser, (page) => deleteOrg(page, org));
  });

  test("DRAWER-01: happy path — correlated logs populated, raw values on the wire (F1) (TC-E1)", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const traffic = sniff(page);
    await openLogsAndQuery(page, org, "e_logs_a");
    await openFirstRowDialog(page);

    const logsTab = pm.correlationDrawerPage.getCorrelatedLogsTab();
    await logsTab.waitFor({ state: "visible", timeout: 15_000 });
    await logsTab.click();

    // Related rows render (correlated-logs-table with content).
    const table = pm.correlationDrawerPage.getCorrelatedLogsTable();
    await table.waitFor({ state: "visible", timeout: 30_000 });
    // Wait specifically for a correlated-tab query carrying the raw value.
    // The first (newest) row may carry either cluster value — accept both.
    await waitFor(() => traffic.searchBodies.some((b) => /C[12]-(East|West)/.test(b)), {
      label: "correlated-logs query carrying a raw-case cluster value",
      deadlineMs: 40_000,
    });

    // F1 wire contract: raw-case values, never lowercased predicates.
    const all = traffic.searchBodies.join("\n");
    expect(/'c[12]-(east|west)'/.test(all), "no lowercased predicate on the wire").toBe(false);

    // Chips render for the matched dimensions.
    const chips = pm.correlationDrawerPage.getEventHeaderChips();
    expect(await chips.count()).toBeGreaterThan(0);
  });

  test("DRAWER-02: dropped-dimensions reported; metrics tab renders without error (F14) (TC-E2)", async ({
    page,
  }) => {
    const pm = new PageManager(page);
    const traffic = sniff(page);
    await openLogsAndQuery(page, org, "e_logs_a");
    await openFirstRowDialog(page);

    const metricsTab = pm.correlationDrawerPage.getCorrelatedMetricsTab();
    await metricsTab.waitFor({ state: "visible", timeout: 15_000 });
    await metricsTab.click();

    // API tier: the correlate response itself reports the dropped dimension.
    const res = await waitFor(
      () => traffic.correlateResponses.find((r) => r && r.all_streams),
      { label: "correlate response", deadlineMs: 40_000 },
    );
    const withDrops = (res.all_streams || []).filter(
      (s) => (s.dropped_dimensions || []).length > 0,
    );
    expect(
      withDrops.length,
      `expected at least one stream reporting dropped_dimensions, got ${JSON.stringify(res.all_streams)}`,
    ).toBeGreaterThan(0);

    // UI tier: the dropped-dimensions warning banner was REMOVED by review
    // decision (commit f0e912117a) — the F14 contract is the API field asserted
    // above. UI-side we only require the metrics tab to render without an error
    // state despite the partial-resolution stream.
    await expect(
      pm.correlationDrawerPage.getErrorState(),
      "metrics tab must not error on a partially-resolvable stream",
    ).not.toBeVisible();
  });

  test("DRAWER-03: editing a dimension filter updates BOTH alias-divergent streams' queries (F35) (TC-E4)", async ({
    page,
  }) => {
    // FINDING (2026-08-07): the editable DimensionFiltersBar is currently
    // UNREACHABLE from the logs correlate journey on this branch —
    // openLogDetailsWithCorrelation always opens the Source Details dialog
    // (which passes hide-dimension-filters), and the standalone dashboard's
    // v-if requires showDetailTab=false, which that same caller forces true
    // (SearchResult.vue:1640-1672, :1809, :1336). F35's apply path has no live
    // UI entry point from logs; re-enable when one exists.
    test.fixme(
      true,
      "dimension-filter editing has no reachable UI entry from the logs journey (see comment)",
    );
    const pm = new PageManager(page);
    const traffic = sniff(page);
    await openLogsAndQuery(page, org, "e_logs_a");

    const firstRow = pm.correlationDrawerPage.getLogsResultTableRows().first();
    const expander = firstRow
      .locator('[data-test="o2-table-expand-cell"], [data-test^="o2-table-expand-"]')
      .first();
    await expander.waitFor({ state: "visible", timeout: 15_000 });
    await expander.click();
    const corrBtn = pm.correlationDrawerPage.getLogCorrelationBtn();
    await corrBtn.waitFor({ state: "visible", timeout: 15_000 });
    await corrBtn.click();

    const filter = pm.correlationDrawerPage.getDimensionFilter("k8s-cluster");
    await filter.waitFor({ state: "visible", timeout: 30_000 });
    await filter.click();
    await pm.correlationDrawerPage
      .getOptionByName(/C2-West/i)
      .first()
      .click()
      .catch(async () => {
        await pm.correlationDrawerPage.getEventTextByName("C2-West").last().click();
      });

    const applyBtn = pm.correlationDrawerPage.getApplyDimensionFiltersButton();
    if (await applyBtn.isVisible().catch(() => false)) await applyBtn.click();

    // F35: the re-issued queries must carry the new value under EACH stream's own alias spelling.
    await waitFor(
      () => (traffic.searchBodies.join("\n").includes("'C2-West'") ? true : null),
      { label: "post-edit search traffic", deadlineMs: 30_000 },
    );
    const all = traffic.searchBodies.join("\n");
    const aliasA = /k8s_cluster\\?" *= *'C2-West'|k8s_cluster *= *'C2-West'/.test(all);
    const aliasB = /[^_]cluster\\?" *= *'C2-West'|[^_]cluster *= *'C2-West'/.test(all);
    expect(aliasA, "e_logs_a query must use k8s_cluster='C2-West'").toBe(true);
    expect(aliasB, "e_logs_b query must use its own alias cluster='C2-West' (F35)").toBe(true);
  });
});
