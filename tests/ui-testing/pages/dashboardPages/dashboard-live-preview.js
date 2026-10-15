// Backs dashboard-panel-live-preview.spec.js (openobserve#15214).
import { expect } from "@playwright/test";
import {
  ORG,
  createDashboard,
  pinAutoQuery,
  trackPanelRuns,
} from "../../playwright-tests/utils/dashboard-auto-run-fixtures.js";

const AUTO_RUN_STORAGE_KEY = "oo_toggle_auto_run";
// Longer than the 600ms live-preview debounce plus a panel request round trip.
const QUIET_MS = 3000;

export default class DashboardLivePreview {
  constructor(page) {
    this.page = page;
    this.applyBtn = page.locator('[data-test="dashboard-apply"]');
    this.cancelBtn = page.locator('[data-test="dashboard-cancel"]');
    this.applyOptionsBtn = page.locator('[data-test="dashboard-apply-options-btn"]');
    this.autoRunToggle = page.locator('[data-test="dashboard-panel-auto-run-toggle-btn"]');
    this.menuItems = page.getByRole("menuitem");
    this.tooltip = page.locator('[data-test="o-tooltip-content"]');
    this.streamSelect = page.locator('[data-test="index-dropdown-stream"]');
    this.chartRenderer = page.locator('[data-test="chart-renderer"]');
    this.dateTimeBtn = page.locator('[data-test="date-time-btn"]');
    this.relativeTab = page.locator('[data-test="date-time-relative-tab"]');
    this.pickerApplyBtn = page.locator('[data-test="date-time-apply-btn"]');
    this.panelRuns = null;
  }

  relativeOption(value, unit) {
    return this.page.locator(`[data-test="date-time-relative-${value}-${unit}-btn"]`);
  }

  async pinAutoQuery(enabled) {
    await pinAutoQuery(this.page, enabled);
  }

  async setStoredAutoRun(value) {
    await this.page.evaluate(([key, v]) => localStorage.setItem(key, v), [AUTO_RUN_STORAGE_KEY, value]);
  }

  async getStoredAutoRun() {
    return this.page.evaluate((key) => localStorage.getItem(key), AUTO_RUN_STORAGE_KEY);
  }

  async rememberPanelStream(stream, streamType = "logs") {
    await this.page.evaluate(
      ([org, type, name]) => {
        localStorage.setItem(`oo_dashboard_panel_stream_type_${org}`, type);
        localStorage.setItem(`oo_dashboard_panel_stream_${type}_${org}`, name);
      },
      [ORG(), streamType, stream]
    );
  }

  async getRememberedPanelStream(streamType = "logs") {
    return this.page.evaluate(
      ([org, type]) => localStorage.getItem(`oo_dashboard_panel_stream_${type}_${org}`),
      [ORG(), streamType]
    );
  }

  async createEmptyDashboard(name) {
    return createDashboard(`${name}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`, { panels: [] });
  }

  // Run tracking starts before the editor mounts so the new panel's first run is counted.
  async openNewPanel(dashboardId) {
    this.panelRuns ??= trackPanelRuns(this.page);
    await this.page.goto(
      `/web/dashboards/add_panel?org_identifier=${ORG()}&dashboard=${dashboardId}&folder=default&tab=default`,
      { waitUntil: "domcontentloaded" }
    );
    await this.applyBtn.or(this.cancelBtn).first().waitFor({ state: "visible", timeout: 30000 });
  }

  // Auto Run and the remembered stream are seeded before the editor mounts, so the new panel opens on `stream`.
  async openNewPanelOn(stream, { autoQueryEnabled = true, autoRun = "true" } = {}) {
    await this.pinAutoQuery(autoQueryEnabled);
    await this.setStoredAutoRun(autoRun);
    await this.rememberPanelStream(stream);
    const dashboardId = await this.createEmptyDashboard("live_preview");
    await this.openNewPanel(dashboardId);
    await this.expectSelectedStream(stream);
    return dashboardId;
  }

  runsFrom(stream) {
    return this.panelRuns.from(stream);
  }

  async waitForRuns(stream, count) {
    await expect.poll(() => this.runsFrom(stream).length, { timeout: 30000 }).toBe(count);
  }

  // The run count is read once the editor stops querying, so in-flight runs are not missed.
  async settledRunCount(stream, { atLeast = 0 } = {}) {
    await expect.poll(() => this.runsFrom(stream).length, { timeout: 30000 }).toBeGreaterThanOrEqual(atLeast);
    await this.expectApplyIdle();
    let last = -1;
    await expect
      .poll(
        () => {
          const now = this.runsFrom(stream).length;
          const stable = now === last;
          last = now;
          return stable;
        },
        { timeout: 30000, intervals: [1500] }
      )
      .toBe(true);
    return last;
  }

  async expectNoNewRun(stream, count) {
    // Absence has no event to wait on: a run, if any, starts after the debounce.
    await this.page.waitForTimeout(QUIET_MS);
    expect(this.runsFrom(stream)).toHaveLength(count);
  }

  async expectLastRunContains(stream, text) {
    const runs = this.runsFrom(stream);
    expect(runs[runs.length - 1]).toContain(text);
  }

  async expectApplyIdle() {
    await expect(this.applyBtn).toBeVisible({ timeout: 30000 });
    await expect(this.applyBtn).toBeEnabled({ timeout: 30000 });
  }

  async expectApplyVariant(variant) {
    await expect(this.applyBtn).toHaveAttribute("data-o2-variant", variant, { timeout: 15000 });
  }

  // While a run is in flight enterprise swaps Apply for Cancel, so either button is checked.
  async expectApplyNotPending() {
    await expect(this.applyBtn.or(this.cancelBtn).first()).not.toHaveAttribute("data-o2-variant", "warning");
  }

  // A hover that lands while the query editor still holds focus can miss the tooltip, so it is re-hovered.
  async expectApplyTooltip(text) {
    await expect(async () => {
      await this.page.mouse.move(0, 0);
      await this.applyBtn.hover();
      await expect(this.tooltip.filter({ hasText: text })).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 15000 });
    await this.page.mouse.move(0, 0);
  }

  async clickApply() {
    await this.applyBtn.click();
  }

  async openApplyOptions() {
    await this.applyOptionsBtn.click();
    await this.menuItems.first().waitFor({ state: "visible", timeout: 5000 });
  }

  async closeMenu() {
    await this.page.keyboard.press("Escape");
    await expect(this.menuItems).toHaveCount(0, { timeout: 5000 });
  }

  async toggleAutoRun() {
    await this.openApplyOptions();
    await this.autoRunToggle.click();
    await expect(this.autoRunToggle).toBeHidden({ timeout: 5000 });
  }

  async expectAutoRunToggleLabel(label) {
    await this.openApplyOptions();
    await expect(this.autoRunToggle).toContainText(label);
    await this.closeMenu();
  }

  // OSS hides the caret without Auto Run; enterprise keeps it for "refresh cache" only.
  async expectNoAutoRunToggle() {
    if ((await this.applyOptionsBtn.count()) === 0) return;
    await this.openApplyOptions();
    await expect(this.autoRunToggle).toHaveCount(0);
    await this.closeMenu();
  }

  async expectSelectedStream(stream) {
    await expect(this.streamSelect).toContainText(stream, { timeout: 30000 });
  }

  async expectChartRendered() {
    await expect(this.chartRenderer.first()).toBeVisible({ timeout: 30000 });
  }

  async pickRelativeTime(value, unit) {
    await this.dateTimeBtn.click();
    await this.relativeTab.waitFor({ state: "visible", timeout: 10000 });
    await this.relativeTab.click();
    await this.relativeOption(value, unit).click();
  }

  async expectNoPickerApply() {
    await expect(this.pickerApplyBtn).toHaveCount(0);
  }

  async closeTimePicker() {
    await this.page.keyboard.press("Escape");
    await expect(this.relativeTab).toBeHidden({ timeout: 5000 });
  }

  async expectTimePickerLabel(text) {
    await expect(this.dateTimeBtn).toContainText(text, { timeout: 10000 });
  }
}
