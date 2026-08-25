// Page object for the Interactive Dashboard Table — "explore cell in logs"
// drilldown drawer (feature/interactive-dashboard-table).
//
// Flow it covers: hover a drillable table cell -> click the search icon
// (`dashboard-table-cell-drilldown-<columnId>`) -> the cell-explorer ODrawer
// (`dashboard-cell-explorer-drawer`) opens hosting DashboardLogDrawer, which
// auto-runs a `field = value` query and syncs `cell_*` params into the URL.

const { expect } = require("@playwright/test");

export default class DashboardCellExplorerPage {
  constructor(page) {
    this.page = page;

    // Interactive table (TableRenderer)
    this.tablePanel = page.locator('[data-test="dashboard-panel-table"]').first();
    this.firstRow = this.tablePanel.locator('[data-test^="o2-table-row-"]').first();
    // The per-cell drilldown search icon — dynamic id, matched by prefix.
    this.drilldownButtons = this.tablePanel.locator(
      '[data-test^="dashboard-table-cell-drilldown-"]'
    );

    // Cell-explorer drawer (PanelSchemaRenderer -> ODrawer)
    this.cellDrawer = page.locator('[data-test="dashboard-cell-explorer-drawer"]');
    this.drawerCloseBtn = this.cellDrawer.locator('[data-test="o-drawer-close-btn"]').first();

    // DashboardLogDrawer contents
    this.resultsTable = page.locator('[data-test="log-explorer-results-table"]');
    this.sqlToggle = page.locator('[data-test="log-explorer-sql-toggle"]');
    // QueryEditor renders its data-test-prefix onto the CodeQueryEditor id
    // (`<prefix>-editor-<language>`); the prefix here is "log-explorer-editor".
    this.sqlEditor = page.locator('[id^="log-explorer-editor-editor"]');
    this.runButton = page.locator('[data-test="log-explorer-run"]');
    this.openInLogsButton = page.locator('[data-test="log-explorer-open-in-logs"]');
    // DateTime renders its `data-test-name` prop as the element's data-test.
    this.dateTime = page.locator('[data-test="dashboard-log-drawer-date-time"]');
    this.eventDetailDrawer = page.locator('[data-test="log-explorer-event-detail-drawer"]');

    // Per-event detail drawer contents (Workflow 5: row click -> event detail)
    this.resultsRows = this.resultsTable.locator('[data-test^="o2-table-row-"]');
    this.detailSearch = page.locator('[data-test="log-explorer-detail-search"]');
    this.detailWrap = page.locator('[data-test="log-explorer-detail-wrap"]');
    // JSON tab preview — assert the rendered key/value rows via JsonPreview's
    // stable data-test hooks (scoped to the event-detail drawer) rather than
    // the `.dld-json-preview` wrapper class. Only the active (JSON) tab panel
    // is mounted (OTabs keepAlive=false), so this matches the JSON tree's rows.
    this.jsonPreview = this.eventDetailDrawer
      .locator('[data-test^="json-preview-key-"]')
      .first();
    this.detailDrawerCloseBtn = this.eventDetailDrawer
      .locator('[data-test="o-drawer-close-btn"]')
      .first();
  }

  /**
   * After savePanel() the app lands on the dashboard VIEW page. Wait for the
   * table panel to render its rows before interacting.
   */
  async waitForTableOnViewPage() {
    await this.page.waitForURL(
      (url) => !url.toString().includes("/add_panel"),
      { timeout: 15000 }
    );
    await this.tablePanel.waitFor({ state: "attached", timeout: 20000 });
    await this.tablePanel.scrollIntoViewIfNeeded();
    await this.firstRow.waitFor({ state: "visible", timeout: 30000 });
  }

  /** True when at least one drillable cell (search icon) exists in the table. */
  async hasDrillableCell() {
    return (await this.drilldownButtons.count()) > 0;
  }

  async expectDrillableCellVisible() {
    await expect(this.drilldownButtons.first()).toBeAttached({ timeout: 15000 });
  }

  /**
   * Hover the first data row so the (opacity-0) cell icons reveal, then click
   * the first drilldown search icon to open the cell-explorer drawer.
   */
  async openDrawerFromFirstDrillableCell() {
    await this.firstRow.hover();
    const button = this.drilldownButtons.first();
    await button.waitFor({ state: "attached", timeout: 15000 });
    await button.click();
    await this.expectDrawerOpen();
  }

  async expectDrawerOpen() {
    await expect(this.cellDrawer).toBeVisible({ timeout: 15000 });
    await expect(this.resultsTable).toBeVisible({ timeout: 30000 });
  }

  async expectDrawerClosed() {
    await expect(this.cellDrawer).toBeHidden({ timeout: 15000 });
  }

  async closeDrawer() {
    await this.drawerCloseBtn.click();
    await this.expectDrawerClosed();
  }

  async toggleSql() {
    await this.sqlToggle.click();
    await expect(this.sqlEditor).toBeVisible({ timeout: 10000 });
  }

  async runQuery() {
    // "Run re-executes the query" must be proven by observing a fresh search
    // POST — re-asserting the already-visible results table would pass even if
    // the button did nothing. Register the response waiter BEFORE clicking so
    // it only catches the run-triggered request (the drawer's mount query and
    // the dashboard panel query both complete before this point).
    const searchResponse = this.page.waitForResponse(
      (resp) =>
        resp.request().method() === "POST" &&
        resp.url().includes("/_search?") &&
        resp.url().includes("type=logs"),
      { timeout: 30000 }
    );
    await this.runButton.click();
    const response = await searchResponse;
    expect(response.ok()).toBe(true);
  }

  /** Assert the drilled-in cell state was pushed to the URL as cell_* params. */
  async expectCellParamsInUrl() {
    await expect
      .poll(() => new URL(this.page.url()).searchParams.has("cell_field"), {
        timeout: 10000,
      })
      .toBe(true);
    const params = new URL(this.page.url()).searchParams;
    expect(params.has("cell_value")).toBe(true);
    expect(params.has("cell_stream")).toBe(true);
  }

  /** Assert all cell_* params were removed (drawer closed / cleaned up). */
  async expectNoCellParamsInUrl() {
    await expect
      .poll(
        () =>
          [...new URL(this.page.url()).searchParams.keys()].some((k) =>
            k.startsWith("cell_")
          ),
        { timeout: 10000 }
      )
      .toBe(false);
  }

  /**
   * The dimension column is drillable but the measure (aggregate) column is
   * not — so a data row carries exactly ONE drilldown search icon.
   */
  async expectOneDrillableColumnPerRow() {
    await expect(
      this.firstRow.locator('[data-test^="dashboard-table-cell-drilldown-"]')
    ).toHaveCount(1);
  }

  /**
   * Click the first result row in the log-explorer results table. OTable's
   * @row-click fires openEventDetail, opening the per-event detail drawer.
   */
  async openEventDetailFromFirstResult() {
    await this.resultsRows.first().waitFor({ state: "visible", timeout: 15000 });
    await this.resultsRows.first().click();
    await expect(this.eventDetailDrawer).toBeVisible({ timeout: 15000 });
  }

  /** Click a tab (insights/details/json) in the event-detail drawer. */
  async clickDetailTab(name) {
    await this.eventDetailDrawer
      .locator(`[data-otab-name="${name}"]`)
      .click();
  }

  /** The Insights tab is default-active: its "Field Anomaly Profile" header is shown. */
  async expectInsightsTabActive() {
    await expect(
      this.eventDetailDrawer.getByText("Field Anomaly Profile")
    ).toBeVisible({ timeout: 15000 });
  }

  /** The Details tab shows the field search input and the wrap-value switch. */
  async expectDetailsTabContent() {
    await expect(this.detailSearch).toBeVisible({ timeout: 15000 });
    await expect(this.detailWrap).toBeVisible({ timeout: 15000 });
  }

  /** The JSON tab shows the JSON preview block. */
  async expectJsonTabContent() {
    await expect(this.jsonPreview).toBeVisible({ timeout: 15000 });
  }

  async closeEventDetailDrawer() {
    await this.detailDrawerCloseBtn.click();
    await expect(this.eventDetailDrawer).toBeHidden({ timeout: 15000 });
  }
}
