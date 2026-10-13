// Backs dashboard-variables-auto-run.spec.js (openobserve#15216).
import { expect } from "@playwright/test";

const AUTO_RUN_STORAGE_KEY = "oo_toggle_auto_run";

export default class DashboardAutoRun {
  constructor(page) {
    this.page = page;
    this.refreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
    this.refreshOptionsBtn = page.locator('[data-test="dashboard-refresh-options-btn"]');
    this.refreshWithoutCacheItem = page.locator('[data-test="dashboard-refresh-without-cache-btn"]');
    this.autoRunToggle = page.locator('[data-test="dashboard-auto-run-toggle-btn"]');
    this.tooltip = page.locator('[data-test="o-tooltip-content"]');
    this.panelContainers = page.locator('[data-test="dashboard-panel-container"]');
    this.viewPanel = page.locator('[data-test="view-panel-screen"]');
    this.viewRefreshBtn = page.locator('[data-test="dashboard-viewpanel-refresh-data-btn"]');
    this.viewCloseBtn = page.locator('[data-test="dashboard-viewpanel-close-btn"]');
    this.viewTable = this.viewPanel.locator('[data-test="dashboard-panel-table"]');
  }

  panel(panelId) {
    return this.page.locator(`[data-test="dashboard-panel-container"][data-test-panel-id="${panelId}"]`);
  }

  panelTable(panelId) {
    return this.panel(panelId).locator('[data-test="dashboard-panel-table"]');
  }

  // The dashboard's own variable bar stays mounted under the full-screen view, so view-side lookups are scoped.
  variableTrigger(name, { inView = false } = {}) {
    const scope = inView ? this.viewPanel : this.page;
    return scope.locator(`[data-test="variable-selector-${name}-inner-trigger"]`);
  }

  variablePopover(name) {
    return this.page.locator(`[data-test="variable-selector-${name}-inner-popover"]`);
  }

  variableOption(name, value) {
    return this.variablePopover(name).locator(`[data-test-value="${value}"]`);
  }

  async openDashboard(org, dashboardId, panelIds, period = "1h") {
    await this.page.goto(
      `/web/dashboards/view?org_identifier=${org}&dashboard=${dashboardId}&folder=default&tab=default&period=${period}`,
      { waitUntil: "domcontentloaded" }
    );
    for (const panelId of panelIds) {
      await this.panel(panelId).waitFor({ state: "visible", timeout: 30000 });
    }
  }

  async reloadDashboard(panelId) {
    await this.page.reload();
    await this.panel(panelId).waitFor({ state: "visible", timeout: 30000 });
  }

  async setStoredAutoRun(value) {
    await this.page.evaluate(([key, v]) => {
      if (v === null) localStorage.removeItem(key);
      else localStorage.setItem(key, v);
    }, [AUTO_RUN_STORAGE_KEY, value]);
  }

  async getStoredAutoRun() {
    return this.page.evaluate((key) => localStorage.getItem(key), AUTO_RUN_STORAGE_KEY);
  }

  async openRefreshOptions() {
    await this.refreshOptionsBtn.click();
    await this.refreshWithoutCacheItem.waitFor({ state: "visible", timeout: 5000 });
  }

  async closeMenu() {
    await this.page.keyboard.press("Escape");
    await expect(this.refreshWithoutCacheItem).toBeHidden({ timeout: 5000 });
  }

  async toggleAutoRun() {
    await this.openRefreshOptions();
    await this.autoRunToggle.click();
    await expect(this.refreshWithoutCacheItem).toBeHidden({ timeout: 5000 });
  }

  async clickRefresh() {
    await this.refreshBtn.click();
  }

  async clickViewRefresh() {
    await this.viewRefreshBtn.click();
  }

  async selectVariableValue(name, value, { inView = false } = {}) {
    await this.variableTrigger(name, { inView }).click();
    await this.variablePopover(name).waitFor({ state: "visible", timeout: 10000 });
    await this.variableOption(name, value).click();
    await expect(this.variablePopover(name)).toBeHidden({ timeout: 5000 });
  }

  async openVariableDropdown(name, { inView = false } = {}) {
    await this.variableTrigger(name, { inView }).click();
    await this.variablePopover(name).waitFor({ state: "visible", timeout: 10000 });
  }

  async toggleVariableOptions(name, values) {
    for (const value of values) {
      await this.variableOption(name, value).click();
    }
  }

  async clickSelectAll(name) {
    // The query values selector renders its own Select All row, which carries no data-test.
    await this.variablePopover(name).getByText("Select All", { exact: true }).click();
  }

  async closeVariableDropdownWithTrigger(name) {
    await this.variableTrigger(name).click();
    await expect(this.variablePopover(name)).toBeHidden({ timeout: 5000 });
  }

  async closeVariableDropdownWithEscape(name) {
    await this.page.keyboard.press("Escape");
    await expect(this.variablePopover(name)).toBeHidden({ timeout: 5000 });
  }

  async getSelectedVariableValues(name) {
    const trigger = this.variableTrigger(name);
    await expect(trigger).not.toHaveAttribute("data-test-selected-value", "", { timeout: 30000 });
    return (await trigger.getAttribute("data-test-selected-value")).split(",");
  }

  async openPanelFullscreen(panelId) {
    await this.panel(panelId).hover();
    await this.panel(panelId).locator('[data-test="dashboard-panel-fullscreen-btn"]').click();
    await this.viewPanel.waitFor({ state: "visible", timeout: 15000 });
  }

  async closeViewPanel() {
    await this.viewCloseBtn.click();
    await expect(this.viewPanel).toBeHidden({ timeout: 10000 });
  }

  async expectSelectedVariableValue(name, value) {
    await expect(this.variableTrigger(name)).toHaveAttribute("data-test-selected-value", value, { timeout: 30000 });
  }

  async expectAutoRunToggleLabel(label) {
    await expect(this.autoRunToggle).toContainText(label);
  }

  async expectNoAutoRunToggle() {
    await expect(this.refreshWithoutCacheItem).toBeVisible();
    await expect(this.autoRunToggle).toHaveCount(0);
  }

  async expectRefreshVariant(variant) {
    await expect(this.refreshBtn).toHaveAttribute("data-o2-variant", variant);
  }

  async expectRefreshNotPending() {
    await expect(this.refreshBtn).not.toHaveAttribute("data-o2-variant", "warning");
  }

  async expectViewRefreshVariant(variant) {
    await expect(this.viewRefreshBtn).toHaveAttribute("data-o2-variant", variant);
  }

  async expectViewRefreshNotPending() {
    await expect(this.viewRefreshBtn).not.toHaveAttribute("data-o2-variant", "warning");
  }

  async expectRefreshTooltip(text) {
    await this.refreshBtn.hover();
    await expect(this.tooltip.filter({ hasText: text })).toBeVisible({ timeout: 5000 });
  }

  async expectVariablePopoverOpen(name) {
    await expect(this.variablePopover(name)).toBeVisible();
  }

  async expectViewPanelOpen() {
    await expect(this.viewPanel).toBeVisible();
  }

  async expectUrlVariable(name, value) {
    await expect(this.page).toHaveURL(new RegExp(`var-${name}=${encodeURIComponent(value)}(&|$)`));
  }

  async expectPanelRows(panelId, { shows = [], hides = [] }) {
    const table = this.panelTable(panelId);
    for (const value of shows) {
      await expect(table).toContainText(value, { timeout: 30000 });
    }
    for (const value of hides) {
      await expect(table).not.toContainText(value);
    }
  }

  async expectViewPanelRows({ shows = [], hides = [] }) {
    for (const value of shows) {
      await expect(this.viewTable).toContainText(value, { timeout: 30000 });
    }
    for (const value of hides) {
      await expect(this.viewTable).not.toContainText(value);
    }
  }
}
