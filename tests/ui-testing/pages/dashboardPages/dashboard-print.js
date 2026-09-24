// Dashboard Print Layout page object — print mode entry/exit + layout state.
const { expect } = require("@playwright/test");

export default class DashboardPrintPage {
  constructor(page) {
    this.page = page;
    this.printBtn = page.locator('[data-test="dashboard-print-btn"]');
    this.printModeContainer = page.locator(".print-mode-container");
    this.backBtn = page.locator('[data-test="dashboard-back-btn"]');
    this.refreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
    this.gridStack = page.locator(".grid-stack");
    this.panelContainer = page.locator('[data-test="dashboard-panel-container"]');
    this.tablePanel = page.locator(
      '[data-test="dashboard-panel-container"][data-panel-type="table"]'
    );
    this.printPageStyle = page.locator("#o2-print-page");
    this.captureReadySpan = page.locator("#dashboardVariablesAndPanelsDataLoaded");
    this.emptyStateArt = page.locator('[data-test="empty-panel-art"]');
    this.emptyStateAddPanelBtn = page.locator(
      '[data-test="dashboard-if-no-panel-add-panel-btn"]'
    );
    // ONavbar root — removed (v-if) in print mode, so its absence is the primary app-shell signal.
    this.navbarMainNav = page.locator('[data-test="navbar-main-nav"]');
  }

  async navigateToDashboardView(dashboardId, folderId, print = false) {
    let url = `${process.env.ZO_BASE_URL}/web/dashboards/view?org_identifier=${process.env.ORGNAME}&dashboard=${dashboardId}&folder=${folderId}`;
    if (print) url += "&print=true";
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async clickPrintButton() {
    await this.printBtn.waitFor({ state: "visible", timeout: 30000 });
    await this.printBtn.click();
  }

  // Wait for the first panel to mount (grid is laid out with a real width).
  async waitForPanelMounted(timeout = 30000) {
    await this.panelContainer.first().waitFor({ state: "visible", timeout });
  }

  // Multi-panel print layout: injected @page style + non-empty grid height + every panel force-mounted.
  async waitForPrintLayout(timeout = 30000) {
    await expect
      .poll(
        () =>
          this.page.evaluate(() => {
            const style = document.getElementById("o2-print-page");
            const grid = document.querySelector(".grid-stack");
            const placeholders = document.querySelectorAll(
              '[data-test^="dashboard-panel-placeholder-"]'
            ).length;
            const height = grid ? (grid.style.height || "").trim() : "";
            return (
              !!style &&
              (style.textContent || "").includes("@page") &&
              height !== "" &&
              placeholders === 0
            );
          }),
        { timeout, intervals: [500, 1000, 2000] }
      )
      .toBe(true);
  }

  async enterPrintMode() {
    await this.clickPrintButton();
    await this.waitForPrintLayout();
  }

  // Single-table print branch: no grid, one full-width table panel, print chrome on.
  async waitForSingleTablePrintMode(timeout = 30000) {
    await expect
      .poll(
        () =>
          this.page.evaluate(() => {
            const gridCount = document.querySelectorAll(".grid-stack").length;
            const tableCount = document.querySelectorAll(
              '[data-test="dashboard-panel-container"][data-panel-type="table"]'
            ).length;
            const containerCount = document.querySelectorAll(
              ".print-mode-container"
            ).length;
            return gridCount === 0 && tableCount === 1 && containerCount === 1;
          }),
        { timeout, intervals: [500, 1000, 2000] }
      )
      .toBe(true);
  }

  // Print cleared = px top overrides restored to calc(); panel tops (not grid height) are measured because exit re-sets a natural height.
  async waitForPrintModeCleared(timeout = 30000) {
    await expect
      .poll(
        () =>
          this.page.evaluate(() => {
            const style = document.getElementById("o2-print-page");
            const containerCount = document.querySelectorAll(
              ".print-mode-container"
            ).length;
            const overrideCount = Array.from(
              document.querySelectorAll(".grid-stack-item")
            ).filter((el) => /px$/.test((el.style.top || "").trim())).length;
            return !style && containerCount === 0 && overrideCount === 0;
          }),
        { timeout, intervals: [500, 1000, 2000] }
      )
      .toBe(true);
  }

  async exitPrintMode() {
    await this.clickPrintButton();
    await this.waitForPrintModeCleared();
  }

  // The capture-readiness span is `display:none`, so it is asserted as attached.
  async waitForCaptureReady(timeout = 60000) {
    await expect(this.captureReadySpan).toBeAttached({ timeout });
  }

  async getGridStackInlineHeight() {
    return this.page.evaluate(() => {
      const grid = document.querySelector(".grid-stack");
      return grid ? (grid.style.height || "").trim() : "";
    });
  }

  // preparePrintLayout overrides panel tops with px (vs calc() before), so px count > 0 proves the reflow ran.
  async getPanelTopOverrideCount() {
    return this.page.evaluate(() => {
      return Array.from(document.querySelectorAll(".grid-stack-item")).filter((el) =>
        /px$/.test((el.style.top || "").trim())
      ).length;
    });
  }

  // ----- assertions -----

  async expectPrintChromeApplied() {
    await expect(this.printModeContainer).toHaveCount(1);
    await expect(this.backBtn).toBeHidden();
    await expect(this.refreshBtn).toBeHidden();
  }

  async expectPrintChromeCleared() {
    await expect(this.printModeContainer).toHaveCount(0);
    await expect(this.backBtn).toBeVisible();
    await expect(this.refreshBtn).toBeVisible();
  }

  // App shell navbar is v-if removed in print mode, so hidden means detached from the DOM (not just display:none).
  async expectAppShellHidden() {
    await expect(this.navbarMainNav).toBeHidden();
  }

  async expectAppShellRestored() {
    await expect(this.navbarMainNav).toBeVisible();
  }

  async expectPrintModeContainerVisible() {
    await expect(this.printModeContainer).toBeVisible();
  }

  async expectPrintPageStyleInjected() {
    await expect(this.printPageStyle).toHaveCount(1);
    const text = await this.printPageStyle.textContent();
    expect(text).toContain("@page");
  }

  async expectPrintPageStyleRemoved() {
    await expect(this.printPageStyle).toHaveCount(0);
  }

  async expectGridStackAbsent() {
    await expect(this.gridStack).toHaveCount(0);
  }

  async expectSingleTableFullWidth() {
    await expect(this.tablePanel).toHaveCount(1);
    await expect(this.tablePanel).toBeVisible();
  }

  async expectEmptyStateRendered() {
    await expect(this.emptyStateArt).toBeVisible();
  }

  async expectEmptyStateAddPanelBtnHidden() {
    await expect(this.emptyStateAddPanelBtn).toHaveCount(0);
  }
}
