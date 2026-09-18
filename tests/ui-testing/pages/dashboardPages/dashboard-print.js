// Dashboard print-mode page object
// Methods: enterPrintMode, exitPrintMode, assertPrintModeActive/Inactive,
//          print-page style helpers, grid reflow assertions, print-media CSS checks.

import { expect } from "@playwright/test";

export default class DashboardPrint {
  constructor(page) {
    this.page = page;

    // Toggle + print-mode chrome
    this.printBtn = page.locator('[data-test="dashboard-print-btn"]');
    this.printModeContainer = page.locator(".print-mode-container");
    this.printPageStyle = page.locator("#o2-print-page");

    // Grid / panel structure
    this.gridStack = page.locator(".grid-stack");
    this.gridStackItem = page.locator(".grid-stack-item");
    this.gridStackItemContent = page.locator(".grid-stack-item-content");
    this.panelContainer = page.locator('[data-test="dashboard-panel-container"]');

    // Header chrome hidden in print mode
    this.backBtn = page.locator('[data-test="dashboard-back-btn"]');
    this.addPanelBtn = page.locator('[data-test="dashboard-panel-add"]');
    this.refreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
    this.shareBtn = page.locator('[data-test="dashboard-share-btn"]');
    this.settingBtn = page.locator('[data-test="dashboard-setting-btn"]');
    this.fullscreenBtn = page.locator('[data-test="dashboard-fullscreen-btn"]');
    this.jsonEditBtn = page.locator('[data-test="dashboard-json-edit-btn"]');
  }

  // -------------------------------------------------------------------------
  // Toggle state machine
  // -------------------------------------------------------------------------

  async enterPrintMode() {
    await this.printBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.printBtn.click();
    await this.printModeContainer.waitFor({ state: "visible", timeout: 10000 });
  }

  async exitPrintMode() {
    await this.printBtn.waitFor({ state: "visible", timeout: 15000 });
    await this.printBtn.click();
    await this.printModeContainer.waitFor({ state: "detached", timeout: 10000 });
  }

  async isPrintModeActive() {
    return await this.printModeContainer
      .isVisible()
      .catch(() => false);
  }

  // -------------------------------------------------------------------------
  // Injected print-page style (#o2-print-page)
  // -------------------------------------------------------------------------

  async waitForPrintPageStyle() {
    await this.printPageStyle.waitFor({ state: "attached", timeout: 10000 });
  }

  async assertPrintPageStylePresent(expect) {
    await expect(this.printPageStyle).toBeAttached();
  }

  async assertPrintPageStyleAbsent(expect) {
    await expect(this.printPageStyle).not.toBeAttached();
  }

  async getPrintPageStyleText() {
    return await this.printPageStyle.textContent();
  }

  // -------------------------------------------------------------------------
  // Print-mode chrome visibility
  // -------------------------------------------------------------------------

  async assertPrintModeActive(expect) {
    await expect(this.printModeContainer).toBeVisible();
    await expect(this.backBtn).toBeHidden();
    await expect(this.addPanelBtn).toBeHidden();
  }

  async assertPrintModeInactive(expect) {
    await expect(this.printModeContainer).not.toBeVisible();
    await expect(this.backBtn).toBeVisible();
  }

  async assertChromeHidden(expect) {
    await expect(this.backBtn).toBeHidden();
    await expect(this.addPanelBtn).toBeHidden();
    await expect(this.refreshBtn).toBeHidden();
    await expect(this.shareBtn).toBeHidden();
    await expect(this.settingBtn).toBeHidden();
    await expect(this.fullscreenBtn).toBeHidden();
    await expect(this.jsonEditBtn).toBeHidden();
  }

  // -------------------------------------------------------------------------
  // URL print param sync
  // -------------------------------------------------------------------------

  async expectPrintParamInUrl(expect, value) {
    await expect(this.page).toHaveURL(new RegExp(`print=${value}`), {
      timeout: 10000,
    });
  }

  // -------------------------------------------------------------------------
  // Panel render readiness
  // -------------------------------------------------------------------------

  async waitForPanelsToRender() {
    await this.panelContainer.first().waitFor({ state: "visible", timeout: 30000 });
  }

  async waitForGridItemCount(count) {
    await this.gridStackItem
      .nth(count - 1)
      .waitFor({ state: "attached", timeout: 30000 });
  }

  // -------------------------------------------------------------------------
  // Grid presence (single-table full-width branch vs normal grid)
  // -------------------------------------------------------------------------

  async assertGridStackPresent(expect) {
    await expect(this.gridStack).toBeAttached();
  }

  async assertGridStackAbsent(expect) {
    await expect(this.gridStack).not.toBeAttached();
  }

  async expectSinglePanelContainer(expect) {
    await expect(this.panelContainer).toHaveCount(1);
  }

  // -------------------------------------------------------------------------
  // Empty dashboard (NoPanel)
  // -------------------------------------------------------------------------

  async expectNoPanel(expect) {
    await expect(
      this.page.getByText("Start by adding your first dashboard panel")
    ).toBeVisible();
  }

  // -------------------------------------------------------------------------
  // Print reflow geometry (multi-panel grid)
  // -------------------------------------------------------------------------

  async getGridStackInlineHeight() {
    return await this.gridStack.evaluate((el) => el.style.height);
  }

  // Count grid-stack items whose inline `top` is a pixel value (print reflow
  // override). In screen mode GridStack positions items with a `calc(...)`
  // formula, so a px `top` is the print layout's explicit override.
  async getOverriddenTopCount() {
    return await this.page.evaluate(() => {
      const items = Array.from(document.querySelectorAll(".grid-stack-item"));
      return items.filter(
        (el) => el.style.top && el.style.top.trim().endsWith("px")
      ).length;
    });
  }

  // -------------------------------------------------------------------------
  // @media print CSS (grid-stack-item-content overflow)
  // -------------------------------------------------------------------------

  async expectPanelContentOverflow(expect, expected) {
    await expect(this.gridStackItemContent.first()).toHaveCSS(
      "overflow",
      expected
    );
  }
}
