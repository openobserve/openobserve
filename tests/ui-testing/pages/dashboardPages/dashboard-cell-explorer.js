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
    this.firstRowCells = this.firstRow.locator(
      '[data-test^="o2-table-cell-"]:not([data-test^="o2-table-cell-copy-"]):not([data-test^="o2-table-cell-hover-actions-"])'
    );
    this.drilldownButtons = page.locator(
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

    // In-place log-detail surface (replaces the results list when detailOpen)
    this.rowOpen = page.locator('[data-test="log-explorer-row-open"]');
    this.detailBackBtn = page.locator('[data-test="log-explorer-detail-back"]');
    this.detailPrevBtn = page.locator('[data-test="log-explorer-detail-prev"]');
    this.detailNextBtn = page.locator('[data-test="log-explorer-detail-next"]');
    // Push-nav header counter ("n / m"); the span sits between the prev and
    // next buttons and only renders while detail is open.
    this.positionCounter = page
      .locator('[data-test="log-explorer-detail-prev"] ~ span')
      .first();
    this.insightsTab = page.locator('[data-test="log-detail-insights-tab"]');
    this.jsonTab = page.locator('[data-test="log-detail-json-tab"]');
    this.tableTab = page.locator('[data-test="log-detail-table-tab"]');
    this.jsonContent = page.locator('[data-test="log-detail-json-content"]');
    this.tableContent = page.locator('[data-test="log-detail-table-content"]');
    this.kvTable = page.locator('[data-test="log-detail-table"]');
    this.kvSearchInput = page.locator('[data-test="log-detail-table-search-input"]');
    // v-show gated on the table tab; present in the DOM on every tab.
    this.wrapToggle = page.locator('[data-test="log-detail-wrap-values-toggle-btn"]');
    this.surroundWindowBtn = page.locator('[data-test="log-explorer-surround-window"]');
    // Copy-link OButton has no data-test; located by its i18n label.
    this.copyLinkBtn = page.getByRole("button", { name: "Copy link" });
    this.anomalyProfileHeader = page.getByText("Field Anomaly Profile").first();
    this.surroundingHeader = page.getByText("Surrounding Events").first();
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

  async revealFirstDrilldownButton() {
    const count = await this.firstRowCells.count();
    for (let i = 0; i < count; i++) {
      const box = await this.firstRowCells.nth(i).boundingBox();
      if (!box) continue;
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      const button = this.drilldownButtons.first();
      try {
        await button.waitFor({ state: "visible", timeout: 1500 });
        return button;
      } catch {
        continue;
      }
    }
    return null;
  }

  /** True when at least one drillable cell (search icon) exists in the table. */
  async hasDrillableCell() {
    return (await this.revealFirstDrilldownButton()) !== null;
  }

  async expectDrillableCellVisible() {
    const button = await this.revealFirstDrilldownButton();
    expect(button, "expected a drillable cell with a search icon").not.toBeNull();
    await expect(button).toBeVisible({ timeout: 15000 });
  }

  async openDrawerFromFirstDrillableCell() {
    const button = await this.revealFirstDrilldownButton();
    expect(button, "expected a drillable cell with a search icon").not.toBeNull();
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

  // ── In-place log-detail surface (DashboardLogDrawer detailOpen mode) ──────

  /** Click the first result row's chevron and wait for the detail view. */
  async openDetailFromFirstRow() {
    await expect(this.resultsTable).toBeVisible({ timeout: 30000 });
    await this.rowOpen.first().waitFor({ state: "visible", timeout: 15000 });
    await this.rowOpen.first().click();
    await expect(this.detailBackBtn).toBeVisible({ timeout: 30000 });
  }

  /** Detail is open: back button visible, results list hidden. */
  async expectDetailOpen() {
    await expect(this.detailBackBtn).toBeVisible({ timeout: 15000 });
    await expect(this.resultsTable).toBeHidden({ timeout: 15000 });
  }

  /** Detail closed back to the list, but the cell-explorer drawer stays open. */
  async expectDetailClosedDrawerOpen() {
    await expect(this.resultsTable).toBeVisible({ timeout: 15000 });
    await expect(this.detailBackBtn).toBeHidden({ timeout: 15000 });
    await expect(this.cellDrawer).toBeVisible({ timeout: 15000 });
  }

  async clickBack() {
    await this.detailBackBtn.click();
    await expect(this.resultsTable).toBeVisible({ timeout: 30000 });
  }

  async pressEscape() {
    await this.page.keyboard.press("Escape");
    await expect(this.resultsTable).toBeVisible({ timeout: 15000 });
  }

  /** Field-anomaly profile renders synchronously on detail open. */
  async expectAnomalyProfileVisible() {
    await expect(this.anomalyProfileHeader).toBeVisible({ timeout: 15000 });
  }

  async expectDetailTabsVisible() {
    await expect(this.insightsTab).toBeVisible({ timeout: 15000 });
    await expect(this.jsonTab).toBeVisible({ timeout: 15000 });
    await expect(this.tableTab).toBeVisible({ timeout: 15000 });
  }

  async clickJsonTab() {
    await this.jsonTab.click();
    await expect(this.jsonContent).toBeVisible({ timeout: 15000 });
  }

  async clickTableTab() {
    await this.tableTab.click();
    await expect(this.tableContent).toBeVisible({ timeout: 15000 });
    await expect(this.kvTable).toBeVisible({ timeout: 15000 });
  }

  async expectWrapToggleVisible() {
    await expect(this.wrapToggle).toBeVisible({ timeout: 15000 });
  }

  async expectWrapToggleHidden() {
    await expect(this.wrapToggle).toBeHidden({ timeout: 15000 });
  }

  // ── Push-nav (prev/next) ─────────────────────────────────────────────────

  async getPositionCurrent() {
    const text = (await this.positionCounter.textContent()).trim();
    return parseInt(text.split("/")[0].trim(), 10);
  }

  async getPositionTotal() {
    const text = (await this.positionCounter.textContent()).trim();
    return parseInt(text.split("/")[1].trim(), 10);
  }

  async expectNextEnabled() {
    await expect(this.detailNextBtn).toBeEnabled({ timeout: 10000 });
  }

  async expectPrevEnabled() {
    await expect(this.detailPrevBtn).toBeEnabled({ timeout: 10000 });
  }

  async expectPrevDisabled() {
    await expect(this.detailPrevBtn).toBeDisabled({ timeout: 10000 });
  }

  async clickNext() {
    await this.detailNextBtn.click();
  }

  async clickPrev() {
    await this.detailPrevBtn.click();
  }

  // ── Shareable URL / copy-link ────────────────────────────────────────────

  async expectCellEventTsInUrl() {
    await expect
      .poll(() => new URL(this.page.url()).searchParams.has("cell_event_ts"), {
        timeout: 10000,
      })
      .toBe(true);
  }

  async expectCopyLinkVisible() {
    await expect(this.copyLinkBtn).toBeVisible({ timeout: 15000 });
  }

  async clickCopyLink() {
    await this.copyLinkBtn.click();
  }

  async getClipboardText() {
    return this.page.evaluate(() => navigator.clipboard.readText());
  }

  // ── Surrounding events ───────────────────────────────────────────────────

  async expectSurroundingSectionVisible() {
    await expect(this.surroundingHeader).toBeVisible({ timeout: 30000 });
    await expect(this.surroundWindowBtn).toBeVisible({ timeout: 15000 });
  }

  async changeSurroundWindow(value = "5") {
    await this.surroundWindowBtn.click();
    await this.page
      .locator(`[data-test="log-explorer-surround-window-${value}"]`)
      .click();
  }

  /** Surrounding section settled into rows or the (valid) empty state. */
  async expectSurroundingResolved() {
    const rows = this.page.locator(".dld-ctx-row");
    const empty = this.page.getByText("No surrounding events found");
    await expect
      .poll(
        async () =>
          (await rows.count()) > 0 || (await empty.isVisible().catch(() => false)),
        { timeout: 30000 }
      )
      .toBe(true);
  }

  // ── Deep-link restore ────────────────────────────────────────────────────

  async reloadAndWaitForDetail() {
    await this.page.reload();
    await expect(this.detailBackBtn).toBeVisible({ timeout: 60000 });
  }

  // ── KV table search ──────────────────────────────────────────────────────

  async fillKvSearch(text) {
    await this.kvSearchInput.fill(text);
  }

  async expectKvKeyVisible(field) {
    await expect(
      this.page.locator(`[data-test="log-detail-${field}-key"]`)
    ).toBeVisible({ timeout: 15000 });
  }

  async expectKvKeyHidden(field) {
    await expect(
      this.page.locator(`[data-test="log-detail-${field}-key"]`)
    ).toBeHidden({ timeout: 15000 });
  }
}
