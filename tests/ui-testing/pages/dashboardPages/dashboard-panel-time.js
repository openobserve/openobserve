import { expect } from "@playwright/test";

/**
 * Page Object for Panel Time Range operations
 * Handles panel-level time configuration and interactions
 */
export default class DashboardPanelTime {
  constructor(page) {
    this.page = page;
  }

  /**
   * Enable panel level time in AddPanel config
   */
  async enablePanelTime() {
    const toggleLocator = this.page.locator('[data-test="panel-time-enable-toggle"]');
    await toggleLocator.waitFor({ state: "visible", timeout: 10000 });

    // Check if already enabled
    const isChecked = await toggleLocator.getAttribute('aria-checked');
    if (isChecked !== 'true') {
      await toggleLocator.click();
      await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    }
  }

  /**
   * Disable panel level time in AddPanel config
   */
  async disablePanelTime() {
    const toggleLocator = this.page.locator('[data-test="panel-time-enable-toggle"]');
    await toggleLocator.waitFor({ state: "visible", timeout: 10000 });

    // Check if already disabled
    const isChecked = await toggleLocator.getAttribute('aria-checked');
    if (isChecked === 'true') {
      await toggleLocator.click();
      await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    }
  }

  /**
   * Check if panel time toggle is enabled
   */
  async isPanelTimeEnabled() {
    const toggleLocator = this.page.locator('[data-test="panel-time-enable-toggle"]');
    const isChecked = await toggleLocator.getAttribute('aria-checked');
    return isChecked === 'true';
  }

  /**
   * Select "Use Global Time" mode
   */
  async selectGlobalTimeMode() {
    const radioLocator = this.page.locator('[data-test="panel-time-mode-global"]');
    await radioLocator.waitFor({ state: "visible", timeout: 10000 });
    await radioLocator.click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Select "Use Individual Time" mode
   */
  async selectIndividualTimeMode() {
    const radioLocator = this.page.locator('[data-test="panel-time-mode-individual"]');
    await radioLocator.waitFor({ state: "visible", timeout: 10000 });
    await radioLocator.click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Get the current panel time mode
   * @returns {Promise<string>} "global" or "individual"
   */
  async getPanelTimeMode() {
    const globalChecked = await this.page.locator('[data-test="panel-time-mode-global"]').getAttribute('aria-checked');
    return globalChecked === 'true' ? 'global' : 'individual';
  }

  /**
   * Set panel time in AddPanel edit mode (relative time)
   * @param {string} timeRange - e.g., "15-m", "1-h", "7-d"
   */
  async setPanelTimeRelative(timeRange) {
    // Click the panel time picker in AddPanel
    const pickerBtn = this.page.locator('[data-test="panel-config-time-picker-btn"]');
    await pickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await pickerBtn.click();

    // Select the time range
    const timeOptionLocator = this.page.locator(`[data-test="date-time-relative-${timeRange}-btn"]`);
    await timeOptionLocator.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionLocator.click();

    // Click apply
    await this.page.locator('[data-test="date-time-apply-btn"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Set panel time in AddPanel edit mode (absolute time)
   * Note: This is simplified - full absolute time selection would need date picker interaction
   */
  async setPanelTimeAbsolute() {
    const pickerBtn = this.page.locator('[data-test="panel-config-time-picker-btn"]');
    await pickerBtn.click();

    // Switch to absolute tab
    await this.page.locator('[data-test="date-time-absolute-tab"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Verify date time picker label in AddPanel
   * @param {string} expectedLabel - "Panel Time Range" or "Time Range"
   */
  async verifyDateTimePickerLabel(expectedLabel) {
    const labelLocator = this.page.locator('[data-test="panel-config-time-picker-label"]');
    await expect(labelLocator).toContainText(expectedLabel);
  }

  /**
   * Get panel time picker in view mode for a specific panel
   * @param {string} panelId - Panel ID
   */
  getPanelTimePickerInView(panelId) {
    return this.page.locator(`[data-test="panel-time-picker-${panelId}"]`);
  }

  /**
   * Check if panel time picker is visible in view mode
   * @param {string} panelId - Panel ID
   */
  async isPanelTimePickerVisible(panelId) {
    const picker = this.getPanelTimePickerInView(panelId);
    return await picker.isVisible().catch(() => false);
  }

  /**
   * Click panel time picker in view mode
   * @param {string} panelId - Panel ID
   */
  async clickPanelTimePicker(panelId) {
    const pickerBtn = this.page.locator(`[data-test="panel-time-picker-${panelId}-btn"]`);
    await pickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await pickerBtn.click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Change panel time in view mode (relative)
   * @param {string} panelId - Panel ID
   * @param {string} timeRange - e.g., "15-m", "1-h", "7-d"
   * @param {boolean} clickApply - Whether to click Apply button (default: true)
   */
  async changePanelTimeInView(panelId, timeRange, clickApply = true) {
    // Click the panel time picker button
    await this.clickPanelTimePicker(panelId);

    // Wait for dropdown to open
    await this.page.locator('.q-menu').waitFor({ state: "visible", timeout: 5000 });

    // Select the time range
    const timeOptionLocator = this.page.locator(`[data-test="date-time-relative-${timeRange}-btn"]`);
    await timeOptionLocator.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionLocator.click();

    if (clickApply) {
      // Click apply button
      await this.page.locator('[data-test="date-time-apply-btn"]').click();
      // Wait for API call and URL update
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
  }

  /**
   * Get the displayed time text from panel time picker in view mode
   * @param {string} panelId - Panel ID
   */
  async getPanelTimeDisplayText(panelId) {
    const pickerBtn = this.page.locator(`[data-test="panel-time-picker-${panelId}-btn"]`);
    return await pickerBtn.textContent();
  }

  /**
   * Wait for panel time picker to show specific time text
   * @param {string} panelId - Panel ID
   * @param {string} expectedText - Expected display text (e.g., "Last 1 hour")
   */
  async waitForPanelTimeDisplay(panelId, expectedText) {
    const pickerBtn = this.page.locator(`[data-test="panel-time-picker-${panelId}-btn"]`);
    await expect(pickerBtn).toContainText(expectedText, { timeout: 10000 });
  }

  /**
   * Verify URL contains panel time parameter
   * @param {string} panelId - Panel ID
   * @param {string} expectedValue - Expected time value (e.g., "1h", "7d")
   */
  async verifyPanelTimeInURL(panelId, expectedValue) {
    const url = this.page.url();
    const expectedParam = `panel-time-${panelId}=${expectedValue}`;
    expect(url).toContain(expectedParam);
  }

  /**
   * Verify URL does NOT contain panel time parameter
   * @param {string} panelId - Panel ID
   */
  async verifyPanelTimeNotInURL(panelId) {
    const url = this.page.url();
    const paramPrefix = `panel-time-${panelId}`;
    expect(url).not.toContain(paramPrefix);
  }

  /**
   * Verify panel time parameter with from/to (absolute time)
   * @param {string} panelId - Panel ID
   */
  async verifyPanelTimeAbsoluteInURL(panelId) {
    const url = this.page.url();
    expect(url).toContain(`panel-time-${panelId}-from=`);
    expect(url).toContain(`panel-time-${panelId}-to=`);
  }

  /**
   * Wait for panel loading indicator to appear (API call started)
   * @param {string} panelId - Panel ID
   */
  async waitForPanelLoading(panelId) {
    const loadingIndicator = this.page.locator(`[data-test="panel-${panelId}-loading"]`);
    await loadingIndicator.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  }

  /**
   * Wait for panel loading to complete
   * @param {string} panelId - Panel ID
   */
  async waitForPanelLoadComplete(panelId) {
    const loadingIndicator = this.page.locator(`[data-test="panel-${panelId}-loading"]`);
    await loadingIndicator.waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  }

  /**
   * Click the global date time picker
   */
  async clickGlobalTimePicker() {
    const globalPicker = this.page.locator('[data-test="date-time-btn"]');
    await globalPicker.waitFor({ state: "visible", timeout: 10000 });
    await globalPicker.click();
  }

  /**
   * Change global time
   * @param {string} timeRange - e.g., "15-m", "1-h", "24-h"
   */
  async changeGlobalTime(timeRange) {
    await this.clickGlobalTimePicker();
    await this.page.locator(`[data-test="date-time-relative-${timeRange}-btn"]`).click();
    await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  }

  /**
   * Click panel refresh button
   * @param {string} panelId - Panel ID
   */
  async clickPanelRefresh(panelId) {
    const refreshBtn = this.page.locator(`[data-test="panel-${panelId}-refresh-btn"]`);
    await refreshBtn.waitFor({ state: "visible", timeout: 10000 });
    await refreshBtn.click();
  }

  /**
   * Click global refresh button
   */
  async clickGlobalRefresh() {
    const refreshBtn = this.page.locator('[data-test="dashboard-refresh-btn"]');
    await refreshBtn.waitFor({ state: "visible", timeout: 10000 });
    await refreshBtn.click();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  /**
   * Open panel in View Panel modal
   * @param {string} panelId - Panel ID
   */
  async openViewPanelModal(panelId) {
    // Click the panel actions menu
    const actionsBtn = this.page.locator(`[data-test="panel-${panelId}-actions-btn"]`);
    await actionsBtn.waitFor({ state: "visible", timeout: 10000 });
    await actionsBtn.click();

    // Click View option
    const viewBtn = this.page.locator('[data-test="panel-action-view"]');
    await viewBtn.waitFor({ state: "visible", timeout: 5000 });
    await viewBtn.click();

    // Wait for modal to open
    await this.page.locator('[data-test="view-panel-modal"]').waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Close View Panel modal
   */
  async closeViewPanelModal() {
    const closeBtn = this.page.locator('[data-test="view-panel-modal-close"]');
    await closeBtn.click();
    await this.page.locator('[data-test="view-panel-modal"]').waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Open panel in full screen mode
   * @param {string} panelId - Panel ID
   */
  async openPanelFullScreen(panelId) {
    // Click the panel actions menu
    const actionsBtn = this.page.locator(`[data-test="panel-${panelId}-actions-btn"]`);
    await actionsBtn.waitFor({ state: "visible", timeout: 10000 });
    await actionsBtn.click();

    // Click Full Screen option
    const fullScreenBtn = this.page.locator('[data-test="panel-action-fullscreen"]');
    await fullScreenBtn.waitFor({ state: "visible", timeout: 5000 });
    await fullScreenBtn.click();

    // Wait for full screen mode
    await this.page.locator('[data-test="panel-fullscreen"]').waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Exit full screen mode
   */
  async exitFullScreen() {
    const exitBtn = this.page.locator('[data-test="panel-fullscreen-exit"]');
    await exitBtn.click();
    await this.page.locator('[data-test="panel-fullscreen"]').waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Verify panel time picker is visible in full screen
   */
  async verifyPanelTimePickerInFullScreen() {
    const picker = this.page.locator('[data-test="panel-fullscreen-time-picker"]');
    await expect(picker).toBeVisible();
  }

  /**
   * Change panel time in full screen mode
   * @param {string} timeRange - e.g., "15-m", "1-h", "24-h"
   */
  async changePanelTimeInFullScreen(timeRange, clickApply = true) {
    // Click time picker in full screen
    const pickerBtn = this.page.locator('[data-test="panel-fullscreen-time-picker-btn"]');
    await pickerBtn.click();

    // Select time range
    await this.page.locator(`[data-test="date-time-relative-${timeRange}-btn"]`).click();

    if (clickApply) {
      // Click apply
      await this.page.locator('[data-test="date-time-apply-btn"]').click();
      await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    }
  }
}
