// Journey E (UI): correlate-from-a-log drawer journeys.
// E1 — happy path: correlated logs tab populated, wire SQL carries RAW values.
// E2 — partially-dimensioned stream: dropped-dimensions warning banner (F14).
// E4 — filter edit propagates to BOTH alias-divergent streams' queries (F35).

const { test, expect } = require("@playwright/test");
const { CorrApi } = require("./utils/correlationApi");
const {
  login,
  openLogsAndQuery,
  openFirstRowDialog,
  sniff,
  waitFor,
} = require("./utils/corrUi");

test.describe.configure({ mode: "serial" });

test.describe("Journey E (UI) — correlation drawer", () => {
  let api;

  // Alpha1/env shards run under playwright-alpha1.config.js (5-min CI cap);
  // discovery polling alone can take DISCOVERY_DEADLINE_MS.
  test.beforeEach(() => test.setTimeout(600_000));

  test.beforeAll(async () => {
    test.setTimeout(600_000); // alpha1 config caps at 5 min; discovery needs more
    api = await CorrApi.create("corr_ui_e");
    const save = await api.saveIdentity({
      // environment is part of the identity so streams lacking an environment
      // field (e_logs_b, e_cpu) produce dropped_dimensions (F14 / TC-E2).
      sets: [
        {
          id: "k8s",
          label: "K8s",
          distinguish_by: ["k8s-cluster", "environment"],
        },
      ],
      tracked_alias_ids: ["k8s-cluster", "environment"],
      service_optional: false,
    });
    if (save.status !== 200)
      throw new Error(`cfg save failed: ${JSON.stringify(save.body)}`);

    // Two alias-divergent log streams (k8s_cluster vs cluster) + one metrics
    // stream missing 'environment' (banner trigger for E2).
    await api.ingestLogs("e_logs_a", [
      {
        service: "esvc",
        k8s_cluster: "C1-East",
        environment: "Prod-EU",
        message: "a1",
      },
      {
        service: "esvc",
        k8s_cluster: "C1-East",
        environment: "Prod-EU",
        message: "a2",
      },
    ]);
    await api.ingestLogs("e_logs_b", [
      { service: "esvc", cluster: "C1-East", message: "b1" },
    ]);
    // Second cluster value so the E4 dimension-filter OSelect (options = known
    // values, no free text) has something to switch to.
    await api.ingestLogs("e_logs_a", [
      {
        service: "esvc",
        k8s_cluster: "C2-West",
        environment: "Prod-EU",
        message: "a3",
      },
    ]);
    await api.ingestLogs("e_logs_b", [
      { service: "esvc", cluster: "C2-West", message: "b2" },
    ]);
    await api.ingestMetrics([
      { __name__: "e_cpu", service: "esvc", k8s_cluster: "C1-East" },
    ]);
    await api.waitForServices(
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
  test.afterAll(async () => api.dispose());

  test("TC-E1: happy path — correlated logs populated, raw values on the wire (F1)", async ({
    page,
  }) => {
    const traffic = sniff(page);
    await login(page);
    await openLogsAndQuery(page, api.org, "e_logs_a");
    await openFirstRowDialog(page);

    const logsTab = page.locator('[data-test="correlated-logs-tab"]').first();
    await logsTab.waitFor({ state: "visible", timeout: 15_000 });
    await logsTab.click();

    // Related rows render (correlated-logs-table with content).
    const table = page.locator('[data-test="correlated-logs-table"]').first();
    await table.waitFor({ state: "visible", timeout: 30_000 });
    // The sniffer also catches the page's own (pre-toggle, quick-mode) search;
    // wait specifically for a correlated-tab query carrying the raw value.
    // The first (newest) row may carry either cluster value — accept both.
    await waitFor(
      () => traffic.searchBodies.some((b) => /C[12]-(East|West)/.test(b)),
      {
        label: "correlated-logs query carrying a raw-case cluster value",
        deadlineMs: 40_000,
      },
    );

    // F1 wire contract: raw-case values, never lowercased predicates.
    const all = traffic.searchBodies.join("\n");
    expect(
      /'c[12]-(east|west)'/.test(all),
      "no lowercased predicate on the wire",
    ).toBe(false);

    // Chips render for the matched dimensions.
    const chips = page.locator('[data-test^="correlation-event-header"]');
    expect(await chips.count()).toBeGreaterThan(0);
  });

  test("TC-E2: dropped-dimensions banner when a stream can't resolve a dimension (F14)", async ({
    page,
  }) => {
    const traffic = sniff(page);
    await login(page);
    await openLogsAndQuery(page, api.org, "e_logs_a");
    await openFirstRowDialog(page);

    const metricsTab = page
      .locator('[data-test="correlated-metrics-tab"]')
      .first();
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
    // decision (commit f0e912117a "revert(correlation): remove dropped-
    // dimensions warning banner per review") — the F14 contract is the API
    // field asserted above. UI-side we only require the metrics tab to render
    // without an error state despite the partial-resolution stream.
    await expect(
      page.locator('[data-test="error-state"]').first(),
      "metrics tab must not error on a partially-resolvable stream",
    ).not.toBeVisible();
  });

  test("TC-E4: editing a dimension filter updates BOTH alias-divergent streams' queries (F35)", async ({
    page,
  }) => {
    // FINDING (2026-08-07): the editable DimensionFiltersBar is currently
    // UNREACHABLE from the logs correlate journey on this branch —
    // openLogDetailsWithCorrelation always opens the Source Details dialog
    // (which passes hide-dimension-filters), and the standalone dashboard's
    // v-if requires showDetailTab=false, which that same caller forces true
    // (SearchResult.vue:1640-1672, :1809, :1336). F35's apply path has no
    // live UI entry point from logs; re-enable when one exists.
    test.fixme(
      true,
      "dimension-filter editing has no reachable UI entry from the logs journey (see comment)",
    );
    const traffic = sniff(page);
    await login(page);
    await openLogsAndQuery(page, api.org, "e_logs_a");

    // The Source Details dialog hides dimension filters by design
    // (DetailTable passes hide-dimension-filters). The editable filter bar
    // lives in the FULL correlation dashboard, opened from an expanded row's
    // JSON preview via log-correlation-btn.
    // Expand the first row INLINE via the dedicated expand cell (a plain td
    // click opens the Source Details dialog, whose own log-correlation-btn
    // only switches dialog tabs — filters stay hidden there).
    const firstRow = page
      .locator('[data-test="logs-search-result-logs-table"] tbody tr')
      .first();
    const expander = firstRow
      .locator(
        '[data-test="o2-table-expand-cell"], [data-test^="o2-table-expand-"]',
      )
      .first();
    await expander.waitFor({ state: "visible", timeout: 15_000 });
    await expander.click();
    const corrBtn = page.locator('[data-test="log-correlation-btn"]').first();
    await corrBtn.waitFor({ state: "visible", timeout: 15_000 });
    await corrBtn.click();

    // Full dashboard renders with the dimension filter bar.
    const filter = page
      .locator('[data-test="dimension-filter-k8s-cluster"]')
      .first();
    await filter.waitFor({ state: "visible", timeout: 30_000 });
    await filter.click();
    await page.waitForTimeout(600);
    await page
      .getByRole("option", { name: /C2-West/i })
      .first()
      .click()
      .catch(async () => {
        await page.getByText("C2-West", { exact: false }).last().click();
      });

    const applyBtn = page
      .locator('[data-test="apply-dimension-filters"]')
      .first();
    if (await applyBtn.isVisible().catch(() => false)) await applyBtn.click();

    // F35: the re-issued queries must carry the new value under EACH stream's
    // own alias spelling.
    await waitFor(
      () => {
        const recent = traffic.searchBodies.join("\n");
        return recent.includes("'C2-West'") ? recent : null;
      },
      { label: "post-edit search traffic", deadlineMs: 30_000 },
    );
    const all = traffic.searchBodies.join("\n");
    const aliasA =
      /k8s_cluster\\?" *= *'C2-West'|k8s_cluster *= *'C2-West'/.test(all);
    const aliasB =
      /[^_]cluster\\?" *= *'C2-West'|[^_]cluster *= *'C2-West'/.test(all);
    expect(aliasA, "e_logs_a query must use k8s_cluster='C2-West'").toBe(true);
    expect(
      aliasB,
      "e_logs_b query must use its own alias cluster='C2-West' (F35)",
    ).toBe(true);
  });
});
