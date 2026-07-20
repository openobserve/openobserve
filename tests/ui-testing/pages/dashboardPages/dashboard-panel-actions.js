// Dashboard actions page
// Methods : AddPanelName, SavePanel, ApplyDashboardBtn, AddNextPanel, GetTableRowCount, VerifyChartRenders

export default class DashboardactionPage {
  constructor(page) {
    this.page = page;

    this.panelNameInput = page.locator('[data-test="dashboard-panel-name"] input');
    this.panelSaveBtn = page.locator('[data-test="dashboard-panel-save"]');
    this.applyDashboard = page.locator('[data-test="dashboard-apply"]');
    this.addPanelBtn = page.locator('[data-test="dashboard-panel-add"]');
    this.dashboardTable = page.locator('[data-test="dashboard-panel-table"]');
    this.chartRenderer = page.locator('[data-test="dashboard-panel-table"], [data-test="chart-renderer"]');
    this.chartRendererCanvas = page.locator('[data-test="chart-renderer"]');
    this.noDataElement = page.locator('[data-test="no-data"]');
    this.dashboardSearchInput = page.locator('[data-test="dashboard-search"]');
    this.discardPanelBtn = page.locator('[data-test="dashboard-panel-discard"]');
    // Error toast surfaced on validation/apply/save errors
    this.errorToast = page.locator('[data-test-variant="error"]');
    // Inline OForm field error under the panel name input (shown when the
    // panel name is empty on save — the form schema blocks submit before any
    // toast is produced).
    this.panelNameError = page.locator('[data-test="dashboard-panel-name-error"]');
    // TanStack table data rows / cells (source data-tests in TenstackTable.vue)
    this.tableDataRow = page.locator('[data-test="dashboard-panel-table"] [data-test="dashboard-data-row"]');
  }

  // Returns the error toast locator for assertions
  getErrorToast() {
    return this.errorToast;
  }

  // Returns the inline panel-name validation error locator for assertions
  getPanelNameError() {
    return this.panelNameError;
  }

  // Returns all dashboard panel table data rows
  getTableDataRows() {
    return this.tableDataRow;
  }

  // Returns the nth data cell (data-test="dashboard-data-row-cell") of the first data row
  firstRowNthCell(index) {
    return this.tableDataRow
      .first()
      .locator('[data-test="dashboard-data-row-cell"]')
      .nth(index);
  }

  //Click discard panel button
  async discardPanel() {
    await this.discardPanelBtn.click();
  }

  //Verify no-data element is visible
  async verifyNoDataVisible() {
    await this.noDataElement.waitFor({ state: "visible" });
  }

  //Get the no-data locator (for use with expect)
  getNoDataLocator() {
    return this.noDataElement;
  }

  // Get chart-renderer canvas locator
  getChartRendererCanvas() {
    return this.chartRendererCanvas;
  }

  // Get dashboard-error locator
  // DashboardErrors.vue has two nested elements with the same data-test attribute;
  // use .first() to avoid Playwright strict-mode throws on multi-element locators.
  getDashboardErrorLocator() {
    return this.page.locator('[data-test="dashboard-error"]').first();
  }

  // Generate a unique panel name
  generateUniquePanelName(prefix = "panel") {
    const randomStr = Math.random().toString(36).substring(2, 7);
    return `${prefix}_${Date.now()}_${randomStr}`;
  }

  // Add panel name
  async addPanelName(panelName) {
    await this.panelNameInput.click();
    await this.panelNameInput.fill(panelName);
  }

  // Save panel button
  async savePanel() {
    await this.panelSaveBtn.waitFor({ state: "visible" });
    await this.panelSaveBtn.click();
    // Wait for one of: successful navigation away from add_panel, a validation
    // error toast (deeper chart/query validation), or the inline panel-name
    // field error (empty name is blocked by the OForm schema before any toast
    // is produced). On success the URL changes; on failure one of the errors
    // surfaces and navigation never happens — without this race the whole call
    // would sit on the URL wait until it times out.
    await Promise.race([
      this.page.waitForURL(
        (url) => !url.pathname.includes("/add_panel"),
        { timeout: 20000 }
      ),
      this.errorToast.waitFor({ state: "visible", timeout: 20000 }),
      this.panelNameError.waitFor({ state: "visible", timeout: 20000 }),
    ]).catch(() => {});
  }

  //Apply dashboard button
  async applyDashboardBtn() {
    // Wait for the apply button to exist and be visible. If a stale picker
    // overlay (e.g. still-closing date-time portal) intercepts the click,
    // press Escape and retry — and fall back to a programmatic click that
    // ignores overlay interception entirely.
    await this.applyDashboard.waitFor({ state: "visible", timeout: 15000 });
    try {
      await this.applyDashboard.click({ timeout: 5000 });
    } catch {
      // Try to dismiss any lingering portal that's blocking the click.
      await this.page.keyboard.press("Escape").catch(() => {});
      await this.page.waitForTimeout(300);
      try {
        await this.applyDashboard.click({ timeout: 5000 });
      } catch {
        // Last resort — fire the click via the DOM. The handler is bound on
        // the button itself, so dispatching the event directly is safe.
        await this.applyDashboard.evaluate((el) => el.click());
      }
    }
  }

  // Wait for the apply button to be visible
  async waitForApplyVisible() {
    await this.applyDashboard.waitFor({ state: "visible" });
  }

  // Wait for the chart renderer element to be visible
  async waitForChartRendererVisible() {
    await this.chartRendererCanvas.waitFor({ state: "visible" });
  }

  // Take a screenshot of the chart renderer element
  async takeChartRendererScreenshot(filePath) {
    await this.chartRendererCanvas.screenshot({ path: filePath });
  }

  // Wait for chart to render
  async waitForChartToRender() {
    // On enterprise: while query runs the button switches to data-test="dashboard-cancel",
    // reverting to data-test="dashboard-apply" when done.
    // On non-enterprise: data-test="dashboard-apply" stays but the button is disabled while loading.
    // Either way, wait for the apply button to exist and not be disabled.
    await this.page.waitForFunction(() => {
      const applyBtn = document.querySelector('[data-test="dashboard-apply"]');
      if (!applyBtn) return false;
      return !applyBtn.disabled;
    }, { timeout: 30000 });
  }

  //Dashboard panel actions(Edit, Layout, Duplicate, Inspector, Move, Delete)

  async selectPanelAction(panelName, action) {
    const actionDataTestIds = {
      Edit: "dashboard-edit-panel",
      Layout: "dashboard-edit-layout",
      Duplicate: "dashboard-duplicate-panel",
      Inspector: "dashboard-query-inspector-panel",
      Move: "dashboard-move-to-another-panel",
      Delete: "dashboard-delete-panel",
    };

    const actionTestId = actionDataTestIds[action];
    if (!actionTestId) throw new Error(`Unknown action: ${action}`);

    await this.page
      .locator(`[data-test="dashboard-edit-panel-${panelName}-dropdown"]`)
      .click();
    await this.page.locator(`[data-test="${actionTestId}"]`).click();
  }

  /**
   * Click the add panel button to add a new panel after saving the previous one
   * Waits for UI to stabilize before clicking
   */
  async addNextPanel() {
    await this.page.waitForTimeout(2000);
    await this.addPanelBtn.waitFor({ state: "visible", timeout: 30000 });
    await this.addPanelBtn.click();
  }

  /**
   * Get the count of data rows in the dashboard panel table
   * Excludes empty header/footer rows within tbody
   * @returns {Promise<number>} Number of data rows
   */
  async getTableRowCount() {
    await this.page.waitForTimeout(2000);
    const rows = this.dashboardTable.locator('tbody tr');
    const totalRows = await rows.count();

    let dataRowCount = 0;
    for (let i = 0; i < totalRows; i++) {
      const firstCell = rows.nth(i).locator('td').first();
      const cellText = await firstCell.textContent().catch((err) => {
        // Cell may be detached or empty - return empty string to skip counting
        return '';
      });
      if (cellText && cellText.trim() !== '') {
        dataRowCount++;
      }
    }
    return dataRowCount;
  }

  /**
   * Verify that the chart or table renders successfully
   * @param {Function} expect - Playwright expect function
   */
  async verifyChartRenders(expect) {
    await expect(this.chartRenderer.first()).toBeVisible({ timeout: 15000 });
  }

  /**
   * Wait for a custom (ECharts) chart panel to actually render. ECharts stamps
   * the `_echarts_instance_` attribute on its host element only after init()
   * runs and the chart options are applied, so a visible host carrying that
   * attribute is proof the custom chart engine mounted and drew the option —
   * without depending on canvas pixel reads (the custom-chart canvas reports a
   * 0-width drawing buffer under headless layout, so a pixel scan can't work).
   * Polls because the custom chart applies its option asynchronously after Apply.
   * @param {Function} expect - Playwright expect function
   * @param {number} timeout
   */
  async expectCustomChartRendered(expect, timeout = 20000) {
    await expect(this.chartRendererCanvas.first()).toBeVisible({ timeout });
    await expect
      .poll(
        async () =>
          await this.page.evaluate(() =>
            Array.from(
              document.querySelectorAll('[data-test="chart-renderer"]')
            ).some(
              (h) => h.hasAttribute("_echarts_instance_") && h.offsetParent !== null
            )
          ),
        { timeout, intervals: [500, 1000, 1000, 2000, 2000] }
      )
      .toBe(true);
  }

  /**
   * Wait for the dashboard table panel to render AND contain at least one
   * populated data cell. Encapsulates a `page.waitForFunction` scoped to the
   * `data-test="dashboard-panel-table"` host (approved evaluate pattern) so
   * the spec doesn't inline `document.querySelector` / `td` element scans.
   * @param {number} timeout
   */
  async waitForTablePanelWithData(timeout = 15000) {
    await this.dashboardTable.waitFor({ state: "visible", timeout });
    await this.page.waitForFunction(
      () => {
        const table = document.querySelector(
          '[data-test="dashboard-panel-table"]',
        );
        if (!table) return false;
        const cells = table.querySelectorAll("td");
        return Array.from(cells).some(
          (cell) =>
            cell.offsetParent !== null && cell.textContent.trim().length > 0,
        );
      },
      { timeout },
    );
  }

  /**
   * Verify that actual data is plotted on the chart canvas.
   * Checks two things:
   *   1. No "no-data" placeholder is visible
   *   2. At least one canvas has colored (non-background, non-transparent) pixels
   *
   * Uses the same canvas pixel-scan approach as the multiwindow color spec.
   * @param {Function} expect - Playwright expect function
   */
  async verifyChartHasData(expect) {
    // 1. No "no data" placeholder
    const noDataVisible = await this.noDataElement.isVisible().catch(() => false);
    expect(noDataVisible).toBe(false);

    // 2. Canvas has non-background pixels
    const hasData = await this.page.evaluate(() => {
      const canvases = document.querySelectorAll("canvas");
      for (const canvas of canvases) {
        if (canvas.width < 10 || canvas.height < 10) continue;
        try {
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
          let coloredPixels = 0;
          // Sample every 4th pixel for performance
          for (let i = 0; i < data.length; i += 16) {
            const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
            // Skip transparent and near-white (background) pixels
            if (a > 200 && !(r > 240 && g > 240 && b > 240)) {
              coloredPixels++;
            }
          }
          if (coloredPixels > 10) return true;
        } catch (_) {
          // Cross-origin canvas — skip
        }
      }
      return false;
    });
    expect(hasData).toBe(true);
  }

  /**
   * Verify no data element is hidden (data is present)
   * @param {Function} expect - Playwright expect function
   */
  async verifyNoErrors(expect) {
    const noErrors = await this.noDataElement.isHidden();
    expect(noErrors).toBeTruthy();
  }

  /**
   * Wait for the dashboard search input to be visible
   */
  async waitForDashboardSearchVisible() {
    await this.dashboardSearchInput.waitFor({ state: 'visible', timeout: 30000 });
    // Wait for the dashboard data to finish loading before returning so that
    // any subsequent search/filter operates on already-loaded data.
    await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    await this.page.waitForTimeout(1000);
  }

  /**
   * Get a dashboard row by name for clicking
   * @param {string} dashboardName - Name of the dashboard
   * @returns {Locator} The dashboard row locator
   */
  getDashboardRow(dashboardName) {
    return this.page.locator(`[data-test="dashboard-name-cell-${dashboardName}"]`);
  }
}
