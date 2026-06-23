import { expect } from "@playwright/test";

/**
 * Page Object for Panel Time Range operations
 * Handles panel-level time configuration and interactions
 */
export default class DashboardPanelTime {
  constructor(page) {
    this.page = page;

    // Static locators — hoisted per POM strict rule
    this.panelTimeToggle = page.locator('[data-test="dashboard-config-allow-panel-time"]');
    this.globalTimeModeRadio = page.locator('[data-test="dashboard-config-panel-time-mode-global"]');
    this.individualTimeModeRadio = page.locator('[data-test="dashboard-config-panel-time-mode-individual"]');
    this.configPanelTimePickerBtn = page.locator('[data-test="dashboard-config-panel-time-picker"] [data-test="date-time-btn"]');
    this.dateTimeMenu = page.locator('#date-time-menu').first();
    this.globalDateTimePickerBtn = page.locator('[data-test="dashboard-global-date-time-picker"] [data-test="date-time-btn"]');
    this.globalDateTimePicker = page.locator('[data-test="dashboard-global-date-time-picker"]');
    this.dashboardNameLocator = page.locator('[data-test="dashboard-name"]');
    this.oDropdownContent = page.locator('[data-test="o-dropdown-content"]');
    this.panelBar = page.locator('[data-test="dashboard-panel-bar"]');
    this.panelFullscreenBtn = page.locator('[data-test="dashboard-panel-fullscreen-btn"]');
    this.viewPanelScreen = page.locator('[data-test="view-panel-screen"]');
    this.viewPanelCloseBtn = page.locator('[data-test="dashboard-viewpanel-close-btn"]');
    this.viewPanelDateTimePicker = page.locator('[data-test="dashboard-viewpanel-date-time-picker"]');
    this.viewPanelDateTimePickerBtn = page.locator('[data-test="dashboard-viewpanel-date-time-picker"] [data-test="date-time-btn"]');
    this.panelDiscardBtn = page.locator('[data-test="dashboard-panel-discard"]');
    this.dashboardFullscreenBtn = page.locator('[data-test="dashboard-fullscreen-btn"]');
    this.globalRefreshBtn = page.locator('[data-test="dashboard-refresh-btn"]');
    this.calendarRoot = page.locator('[data-test="daterangecalendar-root"]');
  }

  // =========================================
  // FACTORY HELPERS — runtime-dynamic locators
  // =========================================

  /** Returns the time picker wrapper for a panel in view mode */
  panelTimePicker(panelId) {
    return this.page.locator(`[data-test="panel-time-picker-${panelId}"]`);
  }

  /** Returns the date-time-btn inside a panel time picker in view mode */
  panelTimePickerBtn(panelId) {
    return this.page.locator(`[data-test="panel-time-picker-${panelId}"] [data-test="date-time-btn"]`);
  }

  /** Returns the display button showing current time text for a panel */
  panelTimePickerDisplayBtn(panelId) {
    return this.page.locator(`[data-test="panel-time-picker-${panelId}-btn"]`);
  }

  /** Returns the panel loading indicator */
  panelLoadingIndicator(panelId) {
    return this.page.locator(`[data-test="panel-${panelId}-loading"]`);
  }

  /** Returns the panel refresh button */
  panelRefreshBtn(panelId) {
    return this.page.locator(`[data-test="panel-${panelId}-refresh-btn"]`);
  }

  /** Returns a relative time range button scoped inside the open date-time menu */
  timeRangeBtn(timeRange) {
    return this.dateTimeMenu.locator(`[data-test="date-time-relative-${timeRange}-btn"]`);
  }

  // =========================================
  // CONFIG PANEL TOGGLE METHODS
  // =========================================

  /**
   * Enable panel level time in AddPanel config
   * Note: Config panel sidebar must be open before calling this method
   * Use pm.dashboardPanelConfigs.openConfigPanel() first
   */
  async enablePanelTime() {
    await this.panelTimeToggle.waitFor({ state: "visible", timeout: 10000 });

    // OSwitch inner <button> carries data-test="{parentDataTest}-btn" and aria-checked
    const isChecked = await this.panelTimeToggle.locator('[data-test$="-btn"]').getAttribute('aria-checked');
    if (isChecked !== 'true') {
      await this.panelTimeToggle.click();
      await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    }
  }

  /**
   * Disable panel level time in AddPanel config
   * Note: Config panel sidebar must be open before calling this method
   * Use pm.dashboardPanelConfigs.openConfigPanel() first
   */
  async disablePanelTime() {
    await this.panelTimeToggle.waitFor({ state: "visible", timeout: 10000 });

    // OSwitch inner <button> carries data-test="{parentDataTest}-btn" and aria-checked
    const isChecked = await this.panelTimeToggle.locator('[data-test$="-btn"]').getAttribute('aria-checked');
    if (isChecked === 'true') {
      await this.panelTimeToggle.click();
      await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
    }
  }

  /**
   * Check if panel time toggle is enabled
   */
  async isPanelTimeEnabled() {
    // OSwitch inner <button> carries data-test="{parentDataTest}-btn" and aria-checked
    const isChecked = await this.panelTimeToggle.locator('[data-test$="-btn"]').getAttribute('aria-checked');
    return isChecked === 'true';
  }

  /**
   * Select "Use Global Time" mode
   */
  async selectGlobalTimeMode() {
    await this.globalTimeModeRadio.waitFor({ state: "visible", timeout: 10000 });
    await this.globalTimeModeRadio.click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Select "Use Individual Time" mode
   */
  async selectIndividualTimeMode() {
    await this.individualTimeModeRadio.waitFor({ state: "visible", timeout: 10000 });
    await this.individualTimeModeRadio.click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Get the current panel time mode
   * @returns {Promise<string>} "global" or "individual"
   */
  async getPanelTimeMode() {
    const globalChecked = await this.globalTimeModeRadio.getAttribute('aria-checked');
    return globalChecked === 'true' ? 'global' : 'individual';
  }

  // =========================================
  // CONFIG PANEL TIME PICKER METHODS
  // =========================================

  /**
   * Set panel time in AddPanel edit mode (relative time)
   * @param {string} timeRange - e.g., "15-m", "1-h", "7-d"
   */
  async setPanelTimeRelative(timeRange) {
    // Click the date-time button inside the panel time picker wrapper
    await this.configPanelTimePickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.configPanelTimePickerBtn.click();

    // Wait for the date time dialog to open
    await this.dateTimeMenu.waitFor({ state: "visible", timeout: 5000 });

    // Select the time range within the dialog
    // Config panel picker has auto-apply enabled, so selecting auto-saves and closes
    const timeOptionLocator = this.timeRangeBtn(timeRange);
    await timeOptionLocator.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionLocator.click();

    // No apply button needed — config panel picker has auto-apply enabled
    // Wait for the date time dialog to close after auto-apply
    await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Set panel time in AddPanel edit mode (absolute time)
   * @param {number} startDay - Start day number (1-31)
   * @param {number} endDay - End day number (1-31)
   */
  async setPanelTimeAbsolute(startDay, endDay) {

    // Click the date-time button inside the panel time picker wrapper
    await this.configPanelTimePickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.configPanelTimePickerBtn.click();

    // Wait for the date picker dropdown to open
    await this.dateTimeMenu.waitFor({ state: "visible", timeout: 5000 });

    // Switch to absolute tab
    await this.dateTimeMenu.locator('[data-test="date-time-absolute-tab"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Select the start and end days using Reka UI calendar — scope to non-disabled, non-outside-view cells
    const visibleCell = (day) =>
      this.calendarRoot.locator('[data-reka-calendar-cell-trigger]:not([data-outside-view]):not([data-disabled])')
        .filter({ hasText: new RegExp(`^${String(day)}$`) })
        .first();
    await visibleCell(startDay).click();
    await visibleCell(endDay).click();

    // Config panel picker has auto-apply enabled — no Apply button; menu closes automatically
    // Wait for the date picker dropdown to close after auto-apply
    await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Set panel time in AddPanel edit mode using calendar picker (absolute time)
   * This method uses the calendar UI to select dates by clicking on day numbers
   */
  async setPanelTimeAbsoluteByCalendar(startDay, endDay) {

    // Click the date-time button inside the panel time picker wrapper
    await this.configPanelTimePickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.configPanelTimePickerBtn.click();

    // Wait for the date picker dropdown to open
    await this.dateTimeMenu.waitFor({ state: "visible", timeout: 5000 });

    // Switch to absolute tab
    await this.dateTimeMenu.locator('[data-test="date-time-absolute-tab"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});

    // Select the start and end days using Reka UI calendar — scope to non-disabled, non-outside-view cells
    const visibleCell = (day) =>
      this.calendarRoot.locator('[data-reka-calendar-cell-trigger]:not([data-outside-view]):not([data-disabled])')
        .filter({ hasText: new RegExp(`^${String(day)}$`) })
        .first();
    await visibleCell(startDay).click();
    await visibleCell(endDay).click();

    // Config panel picker has auto-apply enabled — no Apply button; menu closes automatically
    // Wait for the date picker dropdown to close after auto-apply
    await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  // =========================================
  // VIEW MODE PANEL TIME METHODS
  // =========================================

  /**
   * Get panel time picker in view mode for a specific panel
   * @param {string} panelId - Panel ID
   */
  getPanelTimePickerInView(panelId) {
    return this.panelTimePicker(panelId);
  }

  /**
   * Check if panel time picker is visible in view mode
   * @param {string} panelId - Panel ID
   */
  async isPanelTimePickerVisible(panelId) {
    const picker = this.panelTimePicker(panelId);
    return await picker.isVisible().catch(() => false);
  }

  /**
   * Click panel time picker in view mode
   * @param {string} panelId - Panel ID
   */
  async clickPanelTimePicker(panelId) {
    // Drain any in-flight requests before opening the picker
    // so assertPanelDataNotRefreshed can accurately detect new requests
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Dismiss any open overlays before clicking picker
    await this.page.keyboard.press('Escape').catch(() => {});

    const pickerBtn = this.panelTimePickerBtn(panelId);
    await pickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await pickerBtn.scrollIntoViewIfNeeded();
    await pickerBtn.click();
  }

  /**
   * Change panel time in view mode (relative)
   * @param {string} panelId - Panel ID
   * @param {string} timeRange - e.g., "15-m", "1-h", "7-d"
   * @param {boolean} clickApply - Whether to click Apply button (default: true)
   * @param {number} [_attempt=1] - Internal recursion counter. Do NOT pass from call sites.
   */
  async changePanelTimeInView(panelId, timeRange, clickApply = true, _attempt = 1) {
    // Click the panel time picker button
    await this.clickPanelTimePicker(panelId);

    // Wait for the DateTime dialog to open
    await this.dateTimeMenu.waitFor({ state: "visible", timeout: 5000 });

    // Wait for all panel data API responses to complete BEFORE clicking the time
    // option. This lets the panelsInitializing guard (500 ms timer) expire and
    // reduces re-render churn around the Reka UI portal.
    await this._waitForAllPanelsIdle();

    // Page-level locators survive portal re-mounts; only one datetime menu can be
    // open at a time (Reka UI unmounts when closed), so these are unambiguous.
    const timeOptionLocator = this.page.locator(`[data-test="date-time-relative-${timeRange}-btn"]`).first();
    // force: true is required here. Reka UI's data-reka-popper-content-wrapper can
    // transiently intercept pointer events mid-re-render even after the idle wait,
    // and the element can briefly detach while Vue re-mounts the portal. force
    // fires the pointer event as soon as the locator resolves without waiting for
    // the wrapper to clear — the button itself IS the intended target.
    await timeOptionLocator.click({ force: true, timeout: 15000 });

    if (clickApply) {
      // The time option selection itself may trigger a live-preview re-render or a
      // new panel data request. Wait for those to settle so the Apply button is
      // stable and the panelsInitializing guard (500 ms timer in
      // RenderDashboardCharts) has had time to expire before we commit the change.
      await this._waitForAllPanelsIdle();

      // If the menu closed unexpectedly during the wait (a background re-render
      // unmounted the portal), retry rather than hanging waiting for Apply.
      const menuVisible = await this.dateTimeMenu.isVisible().catch(() => false);
      if (!menuVisible) {
        if (_attempt < 4) {
          await this._waitForAllPanelsIdle();
          return this.changePanelTimeInView(panelId, timeRange, clickApply, _attempt + 1);
        }
        throw new Error(
          `changePanelTimeInView: date-time menu did not stay open for panel "${panelId}" after ${_attempt} attempts`
        );
      }

      const applyBtn = this.page.locator('[data-test="date-time-apply-btn"]').first();
      await applyBtn.waitFor({ state: "visible", timeout: 10000 });

      const urlBefore = this.page.url();

      try {
        // No force:true — panels are idle so the button is stable and actionable.
        // Explicit 10 s timeout: fail fast if the button detaches mid-click (another
        // re-render) rather than hanging until the 45 s CI action-timeout.
        await applyBtn.click({ timeout: 10000 });

        // Wait for the dialog to close, then for the resulting panel data request
        // (triggered by the new time range) to complete.
        await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 5000 });
        await this._waitForAllPanelsIdle();

        // Detect whether onPanelTimeApply was blocked by the panelsInitializing guard.
        // The guard is a 500 ms timer that re-arms whenever initializePanelTimes()
        // runs. If the URL hasn't changed the apply was a no-op — retry.
        const urlAfter = this.page.url();
        if (urlAfter === urlBefore && _attempt < 4) {
          await this._waitForAllPanelsIdle();
          return this.changePanelTimeInView(panelId, timeRange, clickApply, _attempt + 1);
        }
      } catch (_err) {
        // Apply click or menu-close timed out. Retry if attempts remain.
        if (_attempt < 4) {
          await this._waitForAllPanelsIdle();
          return this.changePanelTimeInView(panelId, timeRange, clickApply, _attempt + 1);
        }
        throw _err;
      }
    }
  }

  /**
   * Wait for all panel data API requests to complete and all loading indicators to
   * clear. This is the correct signal that the panelsInitializing guard in
   * RenderDashboardCharts (a 500 ms timer that re-arms on every panel refresh) has
   * had time to expire, making the UI stable for clicks without force:true.
   *
   * Both waits intentionally swallow timeouts (.catch(() => {})):
   * - networkidle may never fire under continuous background refreshes in CI;
   *   timing out and continuing is correct — the loading-indicator check below
   *   provides the authoritative signal.
   * - Individual loading indicators may never appear (panel already loaded) or
   *   may time out on a very slow server; either way we proceed and let the
   *   caller's retry logic handle persistent instability.
   */
  async _waitForAllPanelsIdle() {
    // Network idle = no pending /_search or /query responses
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});
    // Wait for all visible loading indicators in parallel — avoids the O(n) sequential
    // worst case (N panels × 8 s timeout) that blocking await inside a loop creates.
    const loadingIndicators = this.page.locator('[data-test$="-loading"]');
    const count = await loadingIndicators.count();
    const waits = [];
    for (let i = 0; i < count; i++) {
      waits.push(
        loadingIndicators.nth(i).waitFor({ state: "hidden", timeout: 8000 }).catch(() => {})
      );
    }
    await Promise.allSettled(waits);
  }

  /**
   * Get the displayed time text from panel time picker in view mode
   * @param {string} panelId - Panel ID
   */
  async getPanelTimeDisplayText(panelId) {
    return await this.panelTimePickerBtn(panelId).textContent();
  }

  /**
   * Wait for panel time picker to show specific time text
   * @param {string} panelId - Panel ID
   * @param {string} expectedText - Expected display text (e.g., "Last 1 hour")
   */
  async waitForPanelTimeDisplay(panelId, expectedText) {
    await expect(this.panelTimePickerDisplayBtn(panelId)).toContainText(expectedText, { timeout: 10000 });
  }

  /**
   * Wait for panel loading indicator to appear (API call started)
   * @param {string} panelId - Panel ID
   */
  async waitForPanelLoading(panelId) {
    await this.panelLoadingIndicator(panelId).waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  }

  /**
   * Wait for panel loading to complete
   * @param {string} panelId - Panel ID
   */
  async waitForPanelLoadComplete(panelId) {
    await this.panelLoadingIndicator(panelId).waitFor({ state: "hidden", timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  }

  // =========================================
  // GLOBAL TIME PICKER METHODS
  // =========================================

  /**
   * Click the global date time picker
   */
  async clickGlobalTimePicker() {
    // Dismiss any open overlays
    await this.page.keyboard.press('Escape').catch(() => {});

    // Wait for any existing dropdowns to close
    await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
    await this.oDropdownContent.first().waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});

    // Wait for network to settle before clicking
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

    // Wait for dashboard to be fully loaded - check for dashboard header
    await this.dashboardNameLocator.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

    await this.globalDateTimePickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.globalDateTimePickerBtn.scrollIntoViewIfNeeded();
    await this.globalDateTimePickerBtn.click();
  }

  /**
   * Change global time using relative time selection
   * @param {string} timeRange - e.g., "15-m", "1-h", "24-h"
   */
  async changeGlobalTime(timeRange) {
    await this.clickGlobalTimePicker();

    // Wait for the DateTime dialog to open
    await this.dateTimeMenu.waitFor({ state: "visible", timeout: 5000 });

    // Click the time option within the dialog
    const timeOptionBtn = this.timeRangeBtn(timeRange);
    await timeOptionBtn.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionBtn.click();

    // Click apply button within the dialog
    const applyBtn = this.dateTimeMenu.locator('[data-test="date-time-apply-btn"]');
    await applyBtn.click();

    // Wait for dialog to close and network to settle
    await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 5000 });
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  /**
   * Click panel refresh button
   * @param {string} panelId - Panel ID
   */
  async clickPanelRefresh(panelId) {
    await this.panelRefreshBtn(panelId).waitFor({ state: "visible", timeout: 10000 });
    await this.panelRefreshBtn(panelId).click();
  }

  /**
   * Click global refresh button
   */
  async clickGlobalRefresh() {
    await this.globalRefreshBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.globalRefreshBtn.click();
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  // =========================================
  // VIEW PANEL MODAL METHODS
  // =========================================

  /**
   * Open panel in View Panel modal
   * @param {string} panelId - Panel ID
   */
  async openViewPanelModal(panelId) {
    // Hover over the panel to reveal the view panel button
    await this.panelBar.waitFor({ state: "visible", timeout: 10000 });
    await this.panelBar.hover();

    // Wait for and click the view panel screen button
    await this.panelFullscreenBtn.waitFor({ state: "visible", timeout: 5000 });
    await this.panelFullscreenBtn.click();

    // Wait for view panel mode
    await this.viewPanelScreen.waitFor({ state: "visible", timeout: 5000 });
  }

  /**
   * Close View Panel modal
   */
  async closeViewPanelModal() {
    await this.viewPanelCloseBtn.click();
    await this.viewPanelScreen.waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Open panel in full screen mode (which navigates to dashboard view)
   * @param {string} panelId - Panel ID
   */
  async openPanelFullScreen(panelId) {
    // Click the panel actions menu
    await this.dashboardFullscreenBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.dashboardFullscreenBtn.click();

    // Wait for dashboard view to load
    await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Wait for the panel time picker to be visible in the dashboard
    await this.panelTimePicker(panelId).waitFor({ state: "visible", timeout: 10000 });
  }

  /**
   * Exit full screen mode (go back to previous page)
   */
  async exitFullScreen() {
    await this.dashboardFullscreenBtn.click();
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

  /**
   * Get text content from global date time picker
   * @returns {Promise<string>} - Picker text content
   */
  async getGlobalTimePickerText() {
    return await this.globalDateTimePicker.textContent();
  }

  /**
   * Open global time picker and select a relative time WITHOUT clicking Apply
   * Useful for testing that changes aren't applied without clicking Apply
   * @param {string} timeRange - e.g., "6-d", "1-w", "15-m"
   */
  async selectGlobalTimeWithoutApply(timeRange) {
    await this.clickGlobalTimePicker();
    await this.dateTimeMenu.waitFor({ state: "visible", timeout: 5000 });
    const timeOptionBtn = this.timeRangeBtn(timeRange);
    await timeOptionBtn.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionBtn.click();
  }

  /**
   * Dismiss the currently open date time picker by pressing Escape
   */
  async dismissDateTimePicker() {
    await this.page.keyboard.press('Escape');
    await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 3000 }).catch(() => {});
  }

  /**
   * Click the Apply button in an open date time picker
   */
  async clickDateTimeApply() {
    const applyBtn = this.dateTimeMenu.locator('[data-test="date-time-apply-btn"]');
    await applyBtn.scrollIntoViewIfNeeded();
    await applyBtn.click();
    await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 5000 });
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }

  /**
   * Open global time picker and switch to Absolute tab
   */
  async openGlobalPickerAbsoluteTab() {
    await this.clickGlobalTimePicker();
    await this.dateTimeMenu.waitFor({ state: "visible", timeout: 5000 });
    await this.dateTimeMenu.locator('[data-test="date-time-absolute-tab"]').click();
    await this.page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
  }

  /**
   * Discard panel changes (click discard button and accept confirmation dialog)
   */
  async discardPanelChanges() {
    this.page.once("dialog", async (dialog) => {
      await dialog.accept();
    });
    await this.panelDiscardBtn.click().catch(() => {});
    await this.page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  }

  // =========================================
  // VIEW PANEL DATE TIME PICKER METHODS
  // =========================================

  /**
   * Assert view panel date time picker is visible
   */
  async expectViewPanelDateTimePickerVisible() {
    await expect(this.viewPanelDateTimePicker).toBeVisible({ timeout: 5000 });
  }

  /**
   * Get text content from view panel date time picker
   * @returns {Promise<string>} - Picker text content
   */
  async getViewPanelDateTimePickerText() {
    return await this.viewPanelDateTimePicker.textContent();
  }

  /**
   * Click the view panel date time picker to open it
   */
  async clickViewPanelDateTimePicker() {
    await this.viewPanelDateTimePickerBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.viewPanelDateTimePickerBtn.scrollIntoViewIfNeeded();
    await this.viewPanelDateTimePickerBtn.click();
  }

  /**
   * Change time in view panel mode (click picker, select relative time, click apply)
   * @param {string} timeRange - e.g., "6-d", "1-w"
   */
  async changeViewPanelDateTime(timeRange) {
    await this.clickViewPanelDateTimePicker();
    await this.dateTimeMenu.waitFor({ state: "visible", timeout: 5000 });
    const timeOptionBtn = this.timeRangeBtn(timeRange);
    await timeOptionBtn.waitFor({ state: "visible", timeout: 5000 });
    await timeOptionBtn.click();
    const applyBtn = this.dateTimeMenu.locator('[data-test="date-time-apply-btn"]');

    // Set up the response waiter BEFORE clicking Apply, so we don't miss the triggered query
    const queryDone = this.page.waitForResponse(
      r => r.url().includes('/_search') || r.url().includes('/query'),
      { timeout: 15000 }
    ).catch(() => {});

    await applyBtn.click();
    await this.dateTimeMenu.waitFor({ state: "hidden", timeout: 5000 });
    // Wait for the re-query response triggered by the time change
    await queryDone;
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  }
}
