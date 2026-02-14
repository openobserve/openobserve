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
   * Note: Config panel sidebar must be open before calling this method
   * Use pm.dashboardPanelConfigs.openConfigPanel() first
   */
  async enablePanelTime() {
    const toggleLocator = this.page.locator('[data-test="dashboard-config-allow-panel-time"]');
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
   * Note: Config panel sidebar must be open before calling this method
   * Use pm.dashboardPanelConfigs.openConfigPanel() first
   */
  async disablePanelTime() {
    const toggleLocator = this.page.locator('[data-test="dashboard-config-allow-panel-time"]');
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
    const toggleLocator = this.page.locator('[data-test="dashboard-config-allow-panel-time"]');
    const isChecked = await toggleLocator.getAttribute('aria-checked');
    return isChecked === 'true';
  }

  /**
   * Select "Use Global Time" mode
   */
  async selectGlobalTimeMode() {
    const radioLocator = this.page.locator('[data-test="dashboard-config-panel-time-mode-global"]');
    await radioLocator.waitFor({ state: "visible", timeout: 10000 });
    await radioLocator.click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Select "Use Individual Time" mode
   */
  async selectIndividualTimeMode() {
    const radioLocator = this.page.locator('[data-test="dashboard-config-panel-time-mode-individual"]');
    await radioLocator.waitFor({ state: "visible", timeout: 10000 });
    await radioLocator.click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Get the current panel time mode
   * @returns {Promise<string>} "global" or "individual"
   */
  async getPanelTimeMode() {
    const globalChecked = await this.page.locator('[data-test="dashboard-config-panel-time-mode-global"]').getAttribute('aria-checked');
    return globalChecked === 'true' ? 'global' : 'individual';
  }

  /**
   * Set panel time in AddPanel edit mode (relative time)
   * @param {string} timeRange - e.g., "15-m", "1-h", "7-d"
   */
  async setPanelTimeRelative(timeRange) {
    // Click the panel time picker in AddPanel (edit mode)
    const pickerBtn = this.page.locator('[data-test="dashboard-config-panel-time-picker"]');
    await pickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await pickerBtn.click();

    // Wait for the dropdown menu to open (use .first() to avoid strict mode violations)
    await this.page.locator('.q-menu').first().waitFor({ state: "visible", timeout: 5000 });

    // Select the time range within the open menu to avoid strict mode violations
    const timeOptionLocator = this.page.locator(`.q-menu [data-test="date-time-relative-${timeRange}-btn"]`).first();
    await timeOptionLocator.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionLocator.click();

    // Click apply
    await this.page.locator('[data-test="dashboard-apply"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Ensure the time picker dropdown is fully closed before proceeding
    await this.page.locator('.q-menu').first().waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  /**
   * Set panel time in AddPanel edit mode (absolute time)
    * @param {number} startDay - Start day number (1-31)
    * @param {number} endDay - End day number (1-31)
   */
  async setPanelTimeAbsolute(startDay, endDay) {

    // Click the panel time picker in AddPanel config (edit mode)
    const pickerBtn = this.page.locator('[data-test="dashboard-config-panel-time-picker"]');
    await pickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await pickerBtn.click();

    // Wait for the date picker dropdown to open
    const dateTimeDialog = this.page.locator('.date-time-dialog');
    await dateTimeDialog.waitFor({ state: "visible", timeout: 5000 });

    // Switch to absolute tab
    await dateTimeDialog.locator('[data-test="date-time-absolute-tab"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Click the left chevron button (if needed)
    await this.page
      .locator("button")
      .filter({ hasText: "chevron_left" })
      .first()
      .click();

    // Select the start and end days dynamically
    await this.page
      .getByRole("button", { name: String(startDay) })
      .last()
      .click();
    await this.page
      .getByRole("button", { name: String(endDay) })
      .last()
      .click();

    // Press Escape to close the date picker dropdown
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);

    // Wait for the date picker dropdown to close
    await dateTimeDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    // Now click the dashboard apply button to save the panel
    await this.page.locator('[data-test="dashboard-apply"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Set panel time in AddPanel edit mode using calendar picker (absolute time)
   * This method uses the calendar UI to select dates by clicking on day numbers

   */
  async setPanelTimeAbsoluteByCalendar(startDay, endDay) {

    // Click the panel time picker in AddPanel config (edit mode)
    const pickerBtn = this.page.locator('[data-test="dashboard-config-panel-time-picker"]');
    await pickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await pickerBtn.click();

    // Wait for the date picker dropdown to open
    const dateTimeDialog = this.page.locator('.date-time-dialog');
    await dateTimeDialog.waitFor({ state: "visible", timeout: 5000 });

    // Switch to absolute tab
    await dateTimeDialog.locator('[data-test="date-time-absolute-tab"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Click the left chevron button (if needed)
    await this.page
      .locator("button")
      .filter({ hasText: "chevron_left" })
      .first()
      .click();

    // Select the start and end days dynamically
    await this.page
      .getByRole("button", { name: String(startDay) })
      .last()
      .click();
    await this.page
      .getByRole("button", { name: String(endDay) })
      .last()
      .click();

    // Press Escape to close the date picker dropdown
    await this.page.keyboard.press('Escape');
    await this.page.waitForTimeout(300);

    // Wait for the date picker dropdown to close
    await dateTimeDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});

    // Now click the dashboard apply button to save the panel
    await this.page.locator('[data-test="dashboard-apply"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
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
    // Close any open menus first by clicking elsewhere
    await this.page.locator('body').click({ position: { x: 10, y: 10 } }).catch(() => {});
    await this.page.waitForTimeout(300);

    const pickerBtn = this.page.locator(`[data-test="panel-time-picker-${panelId}"] [data-test="date-time-btn"]`);
    await pickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await pickerBtn.scrollIntoViewIfNeeded();
    await pickerBtn.click();
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

    // Wait for the DateTime dialog to open
    const dateTimeDialog = this.page.locator('.date-time-dialog');
    await dateTimeDialog.waitFor({ state: "visible", timeout: 5000 });

    // Select the time range within the dialog
    const timeOptionLocator = dateTimeDialog.locator(`[data-test="date-time-relative-${timeRange}-btn"]`);
    await timeOptionLocator.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionLocator.scrollIntoViewIfNeeded();
    await timeOptionLocator.click();

    if (clickApply) {
      // Click apply button within the dialog
      const applyBtn = dateTimeDialog.locator('[data-test="date-time-apply-btn"]');
      await applyBtn.scrollIntoViewIfNeeded();
      await applyBtn.click();

      // Wait for dialog to close and network to settle
      await dateTimeDialog.waitFor({ state: "hidden", timeout: 5000 });
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
    // Close any open menus/tooltips by pressing Escape
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(300);

    // Wait for any existing dropdowns to close
    await this.page.locator('.date-time-dialog').waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    await this.page.locator('.q-menu').first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Wait for network to settle before clicking
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for dashboard to be fully loaded - check for dashboard header
    await this.page.locator('[data-test="dashboard-name"]').waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

    // Find the global time picker button using the date-time-btn directly
    // The button should be visible even if parent container has complex visibility rules
    const globalPickerBtn = this.page.locator('[data-test="dashboard-global-date-time-picker"] [data-test="date-time-btn"]');

    // First check if element exists
    const count = await globalPickerBtn.count();
    if (count === 0) {
      // Try alternative selector - the date-time button in dashboard header area
      const altBtn = this.page.locator('.date-time-container [data-test="date-time-btn"]').first();
      await altBtn.waitFor({ state: "visible", timeout: 10000 });
      await altBtn.scrollIntoViewIfNeeded();
      await altBtn.click();
      return;
    }

    await globalPickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await globalPickerBtn.scrollIntoViewIfNeeded();
    await globalPickerBtn.click();
  }

  /**
   * Change global time using relative time selection
   * @param {string} timeRange - e.g., "15-m", "1-h", "24-h"
   */
  async changeGlobalTime(timeRange) {
    await this.clickGlobalTimePicker();

    // Wait for the DateTime dialog to open
    const dateTimeDialog = this.page.locator('.date-time-dialog');
    await dateTimeDialog.waitFor({ state: "visible", timeout: 5000 });

    // Click the time option within the dialog
    const timeOptionBtn = dateTimeDialog.locator(`[data-test="date-time-relative-${timeRange}-btn"]`);
    await timeOptionBtn.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionBtn.scrollIntoViewIfNeeded();
    await timeOptionBtn.click();

    // Click apply button within the dialog
    const applyBtn = dateTimeDialog.locator('[data-test="date-time-apply-btn"]');
    await applyBtn.scrollIntoViewIfNeeded();
    await applyBtn.click();

    // Wait for dialog to close and network to settle
    await dateTimeDialog.waitFor({ state: "hidden", timeout: 5000 });
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
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
    // Hover over the panel to reveal the view panel button
    const panel = this.page.locator(`[data-test="dashboard-panel-bar"]`);
    await panel.waitFor({ state: "visible", timeout: 10000 });
    await panel.hover();

    // Wait for and click the view panel screen button
    const viewBtn = this.page.locator('[data-test="dashboard-panel-fullscreen-btn"]');
    await viewBtn.waitFor({ state: "visible", timeout: 5000 });
    await viewBtn.click();

    // Wait for view panel mode
    await this.page.locator('[data-test="view-panel-screen"]').waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Close View Panel modal
   */
  async closeViewPanelModal() {
    const closeBtn = this.page.locator('[data-test="dashboard-viewpanel-close-btn"]');
    await closeBtn.click();
    await this.page.locator('[data-test="view-panel-screen"]').waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Open panel in full screen mode (which navigates to dashboard view)
   * @param {string} panelId - Panel ID
   */
  async openPanelFullScreen(panelId) {
    // Click the panel actions menu
    const actionsBtn = this.page.locator(`[data-test="dashboard-fullscreen-btn"]`);
    await actionsBtn.waitFor({ state: "visible", timeout: 10000 });
    await actionsBtn.click();

    // // Click Full Screen option
    // const fullScreenBtn = this.page.locator('[data-test="panel-action-fullscreen"]');
    // await fullScreenBtn.waitFor({ state: "visible", timeout: 5000 });
    // await fullScreenBtn.click();

    // Wait for dashboard view to load
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Wait for the panel time picker to be visible in the dashboard
    const picker = this.page.locator(`[data-test="panel-time-picker-${panelId}"]`);
    await picker.waitFor({ state: "visible", timeout: 10000 });
  }

  /**
   * Exit full screen mode (go back to previous page)
   */
  async exitFullScreen() {
    await this.page.locator('[data-test="dashboard-fullscreen-btn"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  /**
   * Change panel time in full screen mode (which is same as dashboard view)
   * @param {string} panelId - Panel ID
   * @param {string} timeRange - e.g., "15-m", "1-h", "24-h"
   */
  async changePanelTimeInFullScreen(panelId, timeRange, clickApply = true) {
    // Full screen is just the dashboard view, so use regular panel time picker
    await this.changePanelTimeInView(panelId, timeRange, clickApply);
  }
}
