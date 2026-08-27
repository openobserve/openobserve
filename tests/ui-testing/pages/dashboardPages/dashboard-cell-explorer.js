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
    await this.runButton.click();
    await expect(this.resultsTable).toBeVisible({ timeout: 30000 });
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
}
