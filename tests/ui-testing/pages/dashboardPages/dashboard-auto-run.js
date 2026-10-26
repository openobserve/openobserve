// Backs dashboard-variables-auto-run.spec.js (openobserve#15216).
import { expect } from "@playwright/test";
import testLogger from "../../playwright-tests/utils/test-logger.js";
import DashboardSetting from "./dashboard-settings";
import DashboardVariablesScoped from "./dashboard-variables-scoped.js";
import {
  ORG,
  STREAM,
  NAMESPACES,
  NAMESPACE_FIELD,
  createDashboard,
  pinAutoQuery,
  trackPanelRuns,
} from "../../playwright-tests/utils/dashboard-auto-run-fixtures.js";

const AUTO_RUN_STORAGE_KEY = "oo_toggle_auto_run";
// Longer than the 300ms Auto Run debounce plus a panel request round trip.
const QUIET_MS = 2500;

export default class DashboardAutoRun {
  constructor(page) {
    this.page = page;
    this.refreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
    this.refreshOptionsBtn = page.locator('[data-test="dashboard-refresh-options-btn"]');
    this.refreshWithoutCacheItem = page.locator('[data-test="dashboard-refresh-without-cache-btn"]');
    this.autoRunToggle = page.locator('[data-test="dashboard-auto-run-toggle-btn"]');
    this.cancelBtn = page.locator('[data-test="dashboard-cancel-btn"]');
    this.tooltip = page.locator('[data-test="o-tooltip-content"]');
    this.panelContainers = page.locator('[data-test="dashboard-panel-container"]');
    this.viewPanel = page.locator('[data-test="view-panel-screen"]');
    this.viewRefreshBtn = page.locator('[data-test="dashboard-viewpanel-refresh-data-btn"]');
    this.viewCancelBtn = page.locator('[data-test="dashboard-viewpanel-cancel-btn"]');
    this.viewCloseBtn = page.locator('[data-test="dashboard-viewpanel-close-btn"]');
    this.viewTable = this.viewPanel.locator('[data-test="dashboard-panel-table"]');
    this.dashboardSetting = new DashboardSetting(page);
    this.scopedVariables = new DashboardVariablesScoped(page);
    this.panelRuns = null;
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

  async pinAutoQuery(enabled) {
    await pinAutoQuery(this.page, enabled);
  }

  // Dashboard and panels come from the API; the variables under test are created through the Settings UI.
  async setupDashboard({ name, panels, variable, multiSelect = false, variableOptions = {}, dependents = [], reloadAfterCreate = false }) {
    const id = await createDashboard(`${name}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, { panels });
    this.panelRuns = trackPanelRuns(this.page);
    await this.openDashboard(ORG(), id, panels.map((p) => p.id));
    await this.addVariablesFromSettings([
      { name: variable, options: { showMultipleValues: multiSelect, ...variableOptions } },
      ...dependents,
    ]);
    if (reloadAfterCreate) await this.reloadDashboard(panels[0].id);
    // A query values variable defaults to the stream's first value, so the change targets are the other namespaces.
    const [initial] = await this.getSelectedVariableValues(variable);
    const [first, second] = NAMESPACES.filter((ns) => ns !== initial);
    testLogger.info("Variable created from the UI", { variable, initial, first, second });
    return { initial, first, second };
  }

  // Dashboard + panels from the API with no variables — for the time-range apply spec.
  async setupTimeRangeDashboard({ name, panels, period = '1h' }) {
    const id = await createDashboard(`${name}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, { panels });
    this.panelRuns = trackPanelRuns(this.page);
    await this.openDashboard(ORG(), id, panels.map((p) => p.id), period);
    return id;
  }

  async addVariablesFromSettings(variables) {
    await this.dashboardSetting.openSetting();
    for (const { name, field = NAMESPACE_FIELD, options = {} } of variables) {
      await this.scopedVariables.addScopedVariable(name, "logs", STREAM, field, { scope: "global", ...options });
    }
    await this.dashboardSetting.closeSettingWindow();
    for (const { name } of variables) {
      await this.scopedVariables.waitForVariableIdle(name);
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

  async openFirstPanelFullscreen() {
    const container = this.panelContainers.first();
    await container.hover();
    await container.locator('[data-test="dashboard-panel-fullscreen-btn"]').click();
    await this.viewPanel.waitFor({ state: "visible", timeout: 15000 });
  }

  async closeViewPanel() {
    await this.viewCloseBtn.click();
    await expect(this.viewPanel).toBeHidden({ timeout: 10000 });
  }

  runsOf(key) {
    return this.panelRuns.of(key);
  }

  async waitForRuns(key, count) {
    await expect.poll(() => this.runsOf(key).length, { timeout: 30000 }).toBe(count);
  }

  // Saving a variable re-runs the panels, so counts are measured from the point the dashboard stops querying.
  async settledRunCount(key) {
    let last = -1;
    await expect
      .poll(
        () => {
          const now = this.runsOf(key).length;
          const stable = now === last && now > 0;
          last = now;
          return stable;
        },
        { timeout: 30000, intervals: [1500] }
      )
      .toBe(true);
    return last;
  }

  async expectNoNewRun(key, count) {
    // Absence has no event to wait on: a run, if any, starts after the debounce.
    await this.page.waitForTimeout(QUIET_MS);
    expect(this.runsOf(key)).toHaveLength(count);
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

  async expectRefreshLabel(text) {
    await expect(this.refreshBtn).toContainText(text);
  }

  async expectRefreshOptionsVariant(variant) {
    await expect(this.refreshOptionsBtn).toHaveAttribute("data-o2-variant", variant);
  }

  async waitForRefreshIdle() {
    // The Refresh button is :disabled="arePanelsLoading", so enabled means the dashboard settled.
    await expect(this.refreshBtn).toBeEnabled({ timeout: 30000 });
  }

  async expectRefreshNotPending() {
    await expect(this.refreshBtn).not.toHaveAttribute("data-o2-variant", "pending");
  }

  async expectViewRefreshVariant(variant) {
    await expect(this.viewRefreshBtn).toHaveAttribute("data-o2-variant", variant);
  }

  async expectViewRefreshNotPending() {
    await expect(this.viewRefreshBtn).not.toHaveAttribute("data-o2-variant", "pending");
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

  async expectViewPanelRefreshLabel() {
    await expect(this.viewRefreshBtn).toBeVisible();
    await expect(this.viewRefreshBtn).toContainText("Refresh");
  }

  async expectDashboardCancelLabel() {
    await expect(this.cancelBtn).toBeVisible();
    await expect(this.cancelBtn).toContainText("Cancel");
  }

  async expectViewPanelCancelLabel() {
    await expect(this.viewCancelBtn).toBeVisible();
    await expect(this.viewCancelBtn).toContainText("Cancel");
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
