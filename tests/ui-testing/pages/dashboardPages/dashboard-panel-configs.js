//dashboard panel configs page object
//methods: All configs related to dashboard panels

export default class DashboardPanelConfigs {
  constructor(page) {
    this.page = page;
    this.configBtn = page.locator('[data-test="dashboard-sidebar"]');
    this.legend = page.locator(
      '[data-test="dashboard-config-legend-position"]'
    );

    this.unit = page.locator('[data-test="dashboard-config-unit"]');
    this.decimals = page.locator('[data-test="dashboard-config-decimals"]');
    this.description = page.locator(
      '[data-test="dashboard-config-description"]'
    );
    this.axisWidth = page.locator('[data-test="dashboard-config-axis-width"]');
    this.showSymbols = page.locator(
      '[data-test="dashboard-config-show_symbol"]'
    );
    this.lineInterpolation = page.locator(
      '[data-test="dashboard-config-line_interpolation"]'
    );
    this.lineThickness = page.locator(
      '[data-test="dashboard-config-line_thickness"]'
    );
    this.axisBorder = page.locator(
      '[data-test="dashboard-config-axis-border"]'
    );
    this.yAxisMin = page.locator('[data-test="dashboard-config-y_axis_min"]');
    this.yAxisMax = page.locator('[data-test="dashboard-config-y_axis_max"]');
    this.valuePosition = page.locator(
      '[data-test="dashboard-config-label-position"]'
    );
    this.valueRotate = page.locator(
      '[data-test="dashboard-config-label-rotate"]'
    );
    this.noValueReplacement = page.locator(
      '[data-test="dashboard-config-no-value-replacement"]'
    );
    this.trellisLayout = page.locator('[data-test="dashboard-trellis-chart"]');
    this.queryLimit = page.locator('[data-test="dashboard-config-limit"]');

    //GeoMap locators
    this.baseMap = page.locator('[data-test="dashboard-config-basemap"]');
    this.latitude = page.locator('[data-test="dashboard-config-latitude"]');
    this.longitude = page.locator('[data-test="dashboard-config-longitude"]');
    this.zoom = page.locator('[data-test="dashboard-config-zoom"]');
    this.symbolSize = page.locator('[data-test="dashboard-config-symbol"]');
    this.minimumSize = page.locator(
      '[data-test="dashboard-config-map-symbol-min"]'
    );
    this.maximumSize = page.locator(
      '[data-test="dashboard-config-map-symbol-max"]'
    );
    this.layerType = page.locator('[data-test="dashboard-config-layer-type"]');
    this.weight = page.locator('[data-test="dashboard-config-weight"]');

    //Table chart locators
    this.wrapcell = page.locator(
      '[data-test="dashboard-config-wrap-table-cells"]'
    );
    this.transpose = page.locator(
      '[data-test="dashboard-config-table_transpose"]'
    );
    this.dynamicColumn = page.locator(
      '[data-test="dashboard-config-table_dynamic_columns"]'
    );
    this.valueMapping = page.locator(
      '[data-test="dashboard-addpanel-config-value-mapping-add-btn"]'
    );
    this.overrideConfig = page.locator(
      '[data-test="dashboard-addpanel-config-override-config-add-btn"]'
    );

    // Pivot table locators
    this.pivotRowTotals = page.locator(
      '[data-test="dashboard-config-pivot-row-totals"]'
    );
    this.pivotColTotals = page.locator(
      '[data-test="dashboard-config-pivot-col-totals"]'
    );
    this.pivotStickyColTotals = page.locator(
      '[data-test="dashboard-config-pivot-sticky-col-totals"]'
    );
    this.pivotStickyRowTotals = page.locator(
      '[data-test="dashboard-config-pivot-sticky-row-totals"]'
    );

    //Metric Text
    this.bgColor = page.locator('[data-test="dashboard-config-color-mode"]');

    //Guage chart locators
    this.gaugeMin = page.locator('[data-test="dashboard-config-gauge-min"]');
    this.gaugeMax = page.locator('[data-test="dashboard-config-gauge-max"]');

    //Map locators
    this.mapType = page.locator('[data-test="dashboard-config-map-type"]');

    // Override config locators
    this.overrideColumnSelect = page.locator(
      '[data-test="dashboard-addpanel-config-unit-config-select-column-0"]'
    );
    this.overrideTypeSelect = page.locator(
      '[data-test="dashboard-addpanel-config-type-select-0"]'
    );
    this.sidebarScrollContainer = page.locator('.sidebar-content.scroll');
    this.connectNullValuesToggle = page.locator(
      '[data-test="dashboard-config-connect-null-values"]'
    );

    // Time Shift (Compare Against / Multi-Window) locators
    this.timeShiftAddBtn = page.locator(
      '[data-test="dashboard-addpanel-config-time-shift-add-btn"]'
    );

    // Column Order Popup locators (PromQL Aggregate mode)
    // ColumnOrderPopUp is now an ODialog with parent slug `dashboard-column-order-popup`;
    // primary/secondary buttons live inside as `o-dialog-{primary,secondary}-btn`.
    this.columnOrderBtn = page.locator('[data-test="dashboard-config-column-order-button"]');
    this.columnOrderDialog = page.locator('[data-test="dashboard-column-order-popup"]');

    // Color By Series locators
    // ColorBySeriesPopUp is now an ODialog with parent slug `color-by-series-popup-dialog`;
    // save/cancel are the ODialog footer buttons.
    this.colorBySeriesBtn = page.locator(
      '[data-test="dashboard-addpanel-config-colorBySeries-add-btn"]'
    );
    // Inner content div (still rendered inside the ODialog body). The test asserts
    // visibility/hidden on this selector explicitly, so keep it as-is.
    this.colorBySeriesPopup = page.locator(
      '[data-test="dashboard-color-by-series-popup"]'
    );
    this.colorBySeriesAddColorBtn = page.locator(
      '[data-test="color-by-series-popup-dialog"] [data-test="o-dialog-neutral-btn"]'
    );
    this.colorBySeriesSaveBtn = page.locator(
      '[data-test="color-by-series-popup-dialog"] [data-test="o-dialog-primary-btn"]'
    );
    // ColorBySeriesPopUp doesn't declare a secondary button (only neutral + primary);
    // closing without saving uses the ODialog × button.
    this.colorBySeriesCancelBtn = page.locator(
      '[data-test="color-by-series-popup-dialog"] [data-test="o-dialog-close-btn"]'
    );
  }
  /// Open the config panel
  async openConfigPanel() {
    await this.configBtn.waitFor({ state: "visible" });
    await this.configBtn.click();
  }
  // Select legend position
  async legendPosition(position) {
    await this.legend.waitFor({ state: "visible" });
    await this.legend.click();
    await this.page.getByRole("option", { name: position }).click();
  }

  // Select unit
  async selectUnit(unit) {
    await this.unit.waitFor({ state: "visible" });
    await this.unit.click();
    await this.page.getByRole("option", { name: unit, exact: true }).click();
  }

  //Decimals
  async selectDecimals(decimal) {
    await this.decimals.waitFor({ state: "visible" });
    await this.decimals.click();
    await this.decimals.fill(decimal);
  }

  //Query limit
  async selectQueryLimit(limit) {
    await this.queryLimit.waitFor({ state: "visible" });
    await this.queryLimit.click();
    await this.queryLimit.fill(limit);
  }

  //No value replacement
  async selectNoValueReplace(replacement) {
    await this.noValueReplacement.waitFor({ state: "visible" });
    await this.noValueReplacement.click();
    await this.noValueReplacement.fill(replacement);
  }

  //Axis width
  async selectAxisWidth(width) {
    await this.axisWidth.waitFor({ state: "visible" });
    await this.axisWidth.click();
    await this.axisWidth.fill(width);
  }
  //YAxis Min and Max
  async Y_AxisMin(min) {
    await this.yAxisMin.waitFor({ state: "visible" });
    await this.yAxisMin.click();
    await this.yAxisMin.fill(min);
  }
  // YAxis Max
  async Y_AxisMax(max) {
    await this.yAxisMax.waitFor({ state: "visible" });
    await this.yAxisMax.click();
    await this.yAxisMax.fill(max);
  }

  // Value position
  async selectValuePosition(position) {
    await this.valuePosition.waitFor({ state: "visible" });
    await this.valuePosition.click();
    await this.page.getByRole("option", { name: position, exact: true }).click();
  }

  // Value rotate
  async selectValueRotate(rotate) {
    await this.valueRotate.waitFor({ state: "visible" });
    await this.valueRotate.click();
    await this.valueRotate.fill(rotate);
  }

  //show symbols
  async selectSymbols(symbols) {
    await this.showSymbols.waitFor({ state: "visible" });
    await this.showSymbols.click();
    await this.page.getByRole("option", { name: symbols }).click();
  }
  // Line interpolation
  async selectLineInterpolation(interpolation) {
    await this.lineInterpolation.waitFor({ state: "visible" });
    await this.lineInterpolation.click();
    await this.page.getByRole("option", { name: interpolation }).click();
  }

  // Line thickness
  async selectLineThickness(thickness) {
    await this.lineThickness.waitFor({ state: "visible" });
    await this.lineThickness.click();
    await this.lineThickness.fill(thickness);
  }
  //Trellis Layout
  async selectTrellisLayout(layout) {
    await this.trellisLayout.waitFor({ state: "visible" });
    await this.trellisLayout.click();
    await this.page.getByRole("option", { name: layout }).click();
  }

  //GEO Map Configs

  //Base Map
  async selectBaseMap() {
    await this.baseMap.waitFor({ state: "visible" });
    await this.baseMap.click();
    await this.page.getByRole("option", { name: map }).click();
  }

  //Lattitude and longitude
  //Lattitude
  async selectLatitude(lat) {
    await this.latitude.waitFor({ state: "visible" });
    await this.latitude.click();
    await this.latitude.fill(lat);
  }
  //Longitude
  async selectLongitude(long) {
    await this.longitude.waitFor({ state: "visible" });

    await this.longitude.click();
    await this.longitude.fill(long);
  }

  //Zoom
  async selectZoom(zoom) {
    await this.zoom.waitFor({ state: "visible" });
    await this.zoom.click();
    await this.zoom.fill(zoom);
  }

  //Symbol size
  async selectSymbolSize(size) {
    await this.symbolSize.waitFor({ state: "visible" });
    await this.symbolSize.click();
    await this.page.getByRole("option", { name: size }).click();
  }

  //Minimum and maximum size
  async selectMinimumMaximumSize(minimum) {
    await this.minimumSize.waitFor({ state: "visible" });
    await this.minimumSize.click();
    await this.minimumSize.fill(minimum);
  }
  //Maximum size
  async selectMaximumSize(maximum) {
    await this.maximumSize.waitFor({ state: "visible" });
    await this.maximumSize.click();
    await this.maximumSize.fill(maximum);
  }

  //layer type
  async selectLayerType(type) {
    await this.layerType.waitFor({ state: "visible" });
    await this.layerType.click();
    await this.page.getByRole("option", { name: type }).click();
  }

  //weight
  async selectWeight(Weight) {
    await this.weight.waitFor({ state: "visible" });
    await this.weight.click();
    await this.weight.fill(Weight);
  }

  //Map configs
  async selectMapType(type) {
    await this.mapType.waitFor({ state: "visible" });
    await this.mapType.click();
    await this.page.getByRole("option", { name: type }).click();
  }

  //table chast configs

  //wrap cell
  async selectWrapCell() {
    await this.wrapcell.waitFor({ state: "visible" });
    await this.wrapcell.click();
  }
  //Transpose
  async selectTranspose() {
    await this.transpose.waitFor({ state: "visible" });
    await this.transpose.click();
  }

  //allow dynamic columns
  async selectDynamicColumns() {
    await this.dynamicColumn.waitFor({ state: "visible" });
    await this.dynamicColumn.click();
  }

  //Override config
  async selectOverrideConfig() {
    await this.overrideConfig.waitFor({ state: "visible" });
    await this.overrideConfig.click();
  }

  /**
   * Open override config popup, select a column (by name or first available) and a unit,
   * then save. Popup auto-adds one row on open (onMounted).
   * @param {Object} options
   * @param {string|null} [options.columnName] - Column label to select; null = pick first option
   * @param {string} [options.unitName] - Unit label to select (e.g. "Bytes", "Milliseconds")
   */
  async configureOverrideWithUnit({ columnName = null, unitName = "Bytes" } = {}) {
    await this.scrollSidebarToElement(this.overrideConfig);
    await this.overrideConfig.click();

    const fieldSelect = this.page.locator('[data-test="dashboard-addpanel-config-unit-config-select-column-0"]');
    await fieldSelect.waitFor({ state: "visible", timeout: 10000 });
    await fieldSelect.click();

    if (columnName) {
      await this.page.getByRole("option", { name: columnName }).first().waitFor({ state: "visible", timeout: 5000 });
      await this.page.getByRole("option", { name: columnName }).first().click();
    } else {
      // Pick first available column when column name is unknown
      await this.page.locator('.q-menu [role="option"]').first().waitFor({ state: "visible", timeout: 5000 });
      await this.page.locator('.q-menu [role="option"]').first().click();
    }

    const unitSelect = this.page.locator('[data-test="dashboard-addpanel-config-unit-config-select-unit-0"]');
    await unitSelect.waitFor({ state: "visible", timeout: 5000 });
    await unitSelect.click();
    await this.page.getByRole("option", { name: unitName, exact: true }).click();

    // OverrideConfigPopup is now an ODialog — Save is the primary button inside the scoped panel
    await this.page
      .locator('[data-test="override-config-popup-dialog"] [data-test="o-dialog-primary-btn"]')
      .click();
    await fieldSelect.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  /**
   * Open value mapping popup, fill one mapping row, then click Apply.
   * Popup auto-adds one row on open (onMounted).
   * @param {Object} options
   * @param {string} [options.value] - Value to match (type=value row)
   * @param {string} [options.text] - Display text to show
   * @param {boolean} [options.setColor] - Whether to initialize the color (clicks "Set color")
   */
  async configureValueMapping({ value = "test_value", text = "Mapped!", setColor = true } = {}) {
    const valueMappingBtn = this.page.locator('[data-test="dashboard-addpanel-config-value-mapping-add-btn"]');
    await this.scrollSidebarToElement(valueMappingBtn);
    await valueMappingBtn.click();

    const popup = this.page.locator('[data-test="dashboard-value-mapping-popup"]');
    await popup.waitFor({ state: "visible", timeout: 10000 });

    const valueInput = popup.locator('[data-test="dashboard-addpanel-config-value-mapping-value-input-0"]');
    await valueInput.waitFor({ state: "visible", timeout: 5000 });
    await valueInput.fill(value);

    const textInput = popup.locator('[data-test="dashboard-addpanel-config-value-mapping-text-input-0"]');
    await textInput.fill(text);

    if (setColor) {
      await popup.getByText("Set color").click();
      await popup.locator('.color-section input').first().waitFor({ state: "visible", timeout: 5000 });
    }

    // ValueMappingPopUp is now an ODialog — Apply is the primary footer button
    await popup.locator('[data-test="o-dialog-primary-btn"]').click();
    await popup.waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Open value mapping popup and return the popup locator (for external assertions).
   */
  async openValueMappingPopup() {
    const valueMappingBtn = this.page.locator('[data-test="dashboard-addpanel-config-value-mapping-add-btn"]');
    await this.scrollSidebarToElement(valueMappingBtn);
    await valueMappingBtn.click();
    const popup = this.page.locator('[data-test="dashboard-value-mapping-popup"]');
    await popup.waitFor({ state: "visible", timeout: 10000 });
    return popup;
  }

  /**
   * Close value mapping popup via the X button without saving.
   */
  async closeValueMappingPopup() {
    const popup = this.page.locator('[data-test="dashboard-value-mapping-popup"]');
    await popup.locator('[data-test="o-dialog-close-btn"]').click();
    await popup.waitFor({ state: "hidden", timeout: 5000 });
  }

  // Add and configure override with dynamic column and type
  async configureOverride({ columnName, typeName, enableTypeCheckbox = true }) {
    // Ensure the override button is visible by scrolling the sidebar
    await this.scrollDownSidebarUntilOverrideVisible();
    await this.overrideConfig.click();

    // Select column
    await this.overrideColumnSelect.waitFor({ state: "visible" });
    await this.overrideColumnSelect.click();
    const columnOption = this.page.getByRole("option", { name: columnName }).first();
    await columnOption.waitFor({ state: "visible" });
    await columnOption.click();

    // Select type
    await this.overrideTypeSelect.waitFor({ state: "visible" });
    await this.overrideTypeSelect.click();
    const typeOption = this.page.getByRole("option", { name: typeName }).first();
    await typeOption.waitFor({ state: "visible" });
    await typeOption.click();

    // Optionally enable checkbox corresponding to the selected type
    if (enableTypeCheckbox) {
      const typeCheckbox = this.page.getByRole("checkbox", { name: typeName });
      await typeCheckbox.waitFor({ state: "visible" });
      await typeCheckbox.click();
    }
      const saveBtn = this.page.getByRole('button', { name: 'Save' });
      await saveBtn.waitFor({ state: "visible", timeout: 5000 });
      await saveBtn.click();
  } 
  // Click-hold on the sidebar and scroll down until the Override button is visible
  async scrollDownSidebarUntilOverrideVisible() {
    const sidebar = this.page.locator('.sidebar-content');
    await sidebar.waitFor({ state: "visible" });

    // Bring sidebar into view and hover so wheel events target it
    await sidebar.scrollIntoViewIfNeeded();
    await sidebar.hover();

    // Press and hold mouse, then wheel scroll in chunks while checking visibility
    await this.page.mouse.down();
    for (let i = 0; i < 12; i++) {
      if (await this.overrideConfig.isVisible().catch(() => false)) break;
      await this.page.mouse.wheel(0, 900);
    }
    await this.page.mouse.up();

    // If still not visible, do a final programmatic scroll as a safe fallback
    if (!(await this.overrideConfig.isVisible().catch(() => false))) {
      await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) el.scrollTop = el.scrollHeight;
      }, ".sidebar-content");

      // Wait a bit for scroll to complete
      await this.page.waitForTimeout(500);
    }

    // Ensure the button is actually visible before proceeding
    // First wait for it to be attached
    await this.overrideConfig.waitFor({ state: "attached", timeout: 20000 });

    // Try to scroll it into view with timeout handling
    try {
      await this.overrideConfig.scrollIntoViewIfNeeded({ timeout: 10000 });
    } catch (e) {
      // If scrollIntoView fails, try programmatic scroll one more time
      await this.page.evaluate(() => {
        const button = document.querySelector('[data-test="dashboard-addpanel-config-override-config-add-btn"]');
        if (button) {
          button.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      });
      await this.page.waitForTimeout(1000);
    }

    // Finally wait for it to be visible
    await this.overrideConfig.waitFor({ state: "visible", timeout: 10000 });
  }
  //Metric Text
  //BG color
  async selectBGColor(color) {
    await this.bgColor.waitFor({ state: "visible" });
    await this.bgColor.click();
    await this.page.getByRole("option", { name: color }).click();
  }

  //Guage chart configs
  async selectGuageMin(min) {
    await this.gaugeMin.waitFor({ state: "visible" });
    await this.gaugeMin.click();
    await this.gaugeMin.fill(min);
  }
  //Guage Max
  async selectGuageMax(max) {
    await this.gaugeMax.waitFor({ state: "visible" });
    await this.gaugeMax.click();
    await this.gaugeMax.fill(max);
  }

  // Get connect null values toggle state
  async getConnectNullValuesState() {
    await this.connectNullValuesToggle.waitFor({ state: "visible", timeout: 10000 });

    // Check aria-checked attribute - this is the most reliable indicator
    let ariaChecked = await this.connectNullValuesToggle.getAttribute("aria-checked");
    if (ariaChecked === null) {
      ariaChecked = await this.connectNullValuesToggle.getAttribute("aria-pressed");
    }

    return ariaChecked === "true";
  }

  // Verify connect null values toggle state
  async verifyConnectNullValuesToggle(expectedState = true) {
    const isChecked = await this.getConnectNullValuesState();

    if (expectedState !== isChecked) {
      throw new Error(
        `Expected connect null values to be ${expectedState} but actual state is ${isChecked}`
      );
    }

    return isChecked;
  }

  // ========== Time Shift (Compare Against / Multi-Window) ==========

  /**
   * Scroll sidebar until target element is visible
   * @param {import('@playwright/test').Locator} targetLocator - Element to scroll to
   */
  async scrollSidebarToElement(targetLocator) {
    const sidebar = this.page.locator('.sidebar-content');
    await sidebar.waitFor({ state: "visible" });
    await sidebar.hover();

    for (let i = 0; i < 15; i++) {
      if (await targetLocator.isVisible().catch(() => false)) break;
      await this.page.mouse.wheel(0, 300);
      await this.page.waitForTimeout(200);
    }

    if (!(await targetLocator.isVisible().catch(() => false))) {
      await this.page.evaluate((selector) => {
        const el = document.querySelector(selector);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, await targetLocator.evaluate(el => {
        return el.getAttribute('data-test')
          ? `[data-test="${el.getAttribute('data-test')}"]`
          : null;
      }).catch(() => null) || '.sidebar-content');

      // Fallback: scroll sidebar to bottom
      await this.page.evaluate(() => {
        const el = document.querySelector('.sidebar-content');
        if (el) el.scrollTop = el.scrollHeight;
      });
      await this.page.waitForTimeout(500);
    }

    await targetLocator.waitFor({ state: "visible", timeout: 15000 });
  }

  /**
   * Add a time shift entry (Compare Against) with default 15m offset
   * Opens config sidebar first if needed
   */
  async addTimeShift() {
    await this.scrollSidebarToElement(this.timeShiftAddBtn);
    await this.timeShiftAddBtn.click();
  }

  /**
   * Remove a time shift entry at the given index
   * @param {number} index - Index of the time shift to remove (0-based)
   */
  async removeTimeShift(index = 0) {
    const removeBtn = this.page.locator(
      `[data-test="dashboard-addpanel-config-time-shift-remove-${index}"]`
    );
    await removeBtn.waitFor({ state: "visible" });
    await removeBtn.click();
  }

  // ========== Color By Series ==========

  /**
   * Open the Color By Series popup dialog
   */
  async openColorBySeries() {
    await this.scrollSidebarToElement(this.colorBySeriesBtn);
    await this.colorBySeriesBtn.click();
    await this.colorBySeriesPopup.waitFor({ state: "visible", timeout: 10000 });
  }

  /**
   * Select a series from the autocomplete dropdown at the given row index.
   * Can select by index or by matching text (e.g., "ago" to find comparison series).
   * @param {number} rowIndex - Row index in the color-by-series popup (0-based)
   * @param {Object} options - Selection options
   * @param {number} [options.optionIndex] - Which option to select by index (0-based)
   * @param {string} [options.matchText] - Text to match in the option (e.g., "ago", "Minutes")
   * @returns {string} The selected series name
   */
  async selectColorBySeriesOption(rowIndex = 0, { optionIndex, matchText } = {}) {
    const autoComplete = this.colorBySeriesPopup
      .locator('[data-test="common-auto-complete"]')
      .nth(rowIndex);
    await autoComplete.waitFor({ state: "visible" });
    await autoComplete.click();

    const optionLocators = this.colorBySeriesPopup.locator(
      '[data-test="common-auto-complete-option"]'
    );
    await optionLocators.first().waitFor({ state: "visible", timeout: 10000 });

    let targetOption;

    if (matchText) {
      // Find option containing the match text (e.g., "ago" for comparison series)
      const count = await optionLocators.count();
      for (let i = 0; i < count; i++) {
        const text = await optionLocators.nth(i).textContent();
        if (text && text.includes(matchText)) {
          targetOption = optionLocators.nth(i);
          break;
        }
      }
      // Fallback to last option if no match (comparison series is usually last)
      if (!targetOption && count > 1) {
        targetOption = optionLocators.nth(count - 1);
      } else if (!targetOption) {
        targetOption = optionLocators.first();
      }
    } else {
      targetOption = optionLocators.nth(optionIndex ?? 0);
    }

    const seriesName = await targetOption.textContent();
    await targetOption.click();

    return seriesName?.trim() || "";
  }

  /**
   * Set a color for a series row in the Color By Series popup
   * @param {number} rowIndex - Row index (0-based)
   * @param {string} color - Hex color value (e.g., "#FF0000")
   */
  async setColorForSeriesRow(rowIndex = 0, color = "#5960b2") {
    // Click "Set color" button if the color picker is not yet initialized
    const setColorBtn = this.colorBySeriesPopup.getByText("Set color");
    if (await setColorBtn.first().isVisible().catch(() => false)) {
      await setColorBtn.first().click();
      await this.page.waitForTimeout(500);
    }

    // Strategy 1: Set color via Vue's reactive data (setupState).
    // __vueParentComponent is only available in Vue dev builds; in production builds
    // this property is stripped. We try this first and fall back to native input events.
    const result = await this.page.evaluate(
      ({ color, rowIndex }) => {
        const popup = document.querySelector(
          '[data-test="dashboard-color-by-series-popup"]'
        );
        if (!popup) return { success: false, reason: "popup not found" };

        // Strategy 1: Vue setupState (dev builds only)
        if (popup.__vueParentComponent) {
          console.warn("[test] setColorForSeriesRow: using __vueParentComponent (dev build detected)");
          const vpc = popup.__vueParentComponent;
          const series = vpc.setupState?.editColorBySeries;
          if (Array.isArray(series) && series.length > rowIndex) {
            series[rowIndex].color = color;
            return { success: true, method: "vue-setupState", color: series[rowIndex].color };
          }
        } else {
          console.warn("[test] setColorForSeriesRow: __vueParentComponent not found (prod build), using native input fallback");
        }

        // Strategy 2: Native input events fallback (works in prod builds)
        // Find the color input for the given row and set value via native setter + events
        const colorInputs = popup.querySelectorAll(".color-section input");
        const input = colorInputs[rowIndex];
        if (input) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype, "value"
          ).set;
          nativeInputValueSetter.call(input, color);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          return { success: true, method: "native-input", color };
        }

        return { success: false, reason: "no vue component or input found" };
      },
      { color, rowIndex }
    );

    if (!result.success) {
      throw new Error(`Failed to set color: ${result.reason}`);
    }

    await this.page.waitForTimeout(500);
  }

  /**
   * Add a new color row in the Color By Series popup
   */
  async addColorBySeriesRow() {
    await this.colorBySeriesAddColorBtn.click();
  }

  /**
   * Save the Color By Series configuration
   */
  async saveColorBySeries() {
    await this.colorBySeriesSaveBtn.click();
    await this.colorBySeriesPopup.waitFor({ state: "hidden", timeout: 10000 });
  }

  /**
   * Close the Color By Series popup without saving
   */
  async cancelColorBySeries() {
    await this.colorBySeriesCancelBtn.click();
    await this.colorBySeriesPopup.waitFor({ state: "hidden", timeout: 10000 });
  }

  // ========== Column Order Popup (PromQL Aggregate / Expanded Time series mode) ==========

  /** Returns the locator for the column row at the given index in the column order popup. */
  columnOrderRow(index) {
    return this.page.locator(`[data-test="column-order-row-${index}"]`);
  }

  /** Opens the column order dialog via the "Configure Column Order" button in the config sidebar. */
  async openColumnOrderDialog() {
    await this.scrollSidebarToElement(this.columnOrderBtn);
    await this.columnOrderBtn.click();
    await this.columnOrderDialog.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Returns the column NAME text (not row number or icons) of the row at the given index.
   * Targets the `.column-name` div inside the row.
   */
  async getColumnName(index) {
    const nameEl = this.columnOrderRow(index).locator('.column-name');
    await nameEl.waitFor({ state: 'visible', timeout: 5000 });
    return (await nameEl.textContent() || '').trim();
  }

  /** Clicks the move-down button for the column at the given index. */
  async moveColumnDown(index) {
    const btn = this.page.locator(`[data-test="column-order-move-down-${index}"]`);
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
  }

  /** Clicks the move-up button for the column at the given index. */
  async moveColumnUp(index) {
    const btn = this.page.locator(`[data-test="column-order-move-up-${index}"]`);
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
  }

  /** Saves the column order and waits for the dialog to close. */
  async saveColumnOrder() {
    await this.page
      .locator('[data-test="dashboard-column-order-popup"] [data-test="o-dialog-primary-btn"]')
      .click();
    await this.columnOrderDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /** Cancels the column order dialog without saving. */
  async cancelColumnOrder() {
    await this.page
      .locator('[data-test="dashboard-column-order-popup"] [data-test="o-dialog-secondary-btn"]')
      .click();
    await this.columnOrderDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /**
   * Delete a color-by-series row at the given index
   * @param {number} index - Row index (0-based)
   */
  async deleteColorBySeriesRow(index = 0) {
    const deleteBtn = this.page.locator(
      `[data-test="dashboard-addpanel-config-color-by-series-delete-btn-${index}"]`
    );
    await deleteBtn.waitFor({ state: "visible" });
    await deleteBtn.click();
  }

  /**
   * Configure a complete color-by-series entry: select series and set color.
   * Can select by index or by matching text.
   * @param {Object} options - Configuration options
   * @param {number} [options.rowIndex=0] - Row index (0-based)
   * @param {number} [options.optionIndex] - Which series option to select by index (0-based)
   * @param {string} [options.matchText] - Text to match in the series option (e.g., "ago")
   * @param {string} [options.color="#FF0000"] - Hex color value
   * @returns {string} The selected series name
   */
  async configureColorBySeries({ rowIndex = 0, optionIndex, matchText, color = "#FF0000" } = {}) {
    const seriesName = await this.selectColorBySeriesOption(rowIndex, { optionIndex, matchText });
    await this.setColorForSeriesRow(rowIndex, color);
    return seriesName;
  }

  // ========== Pivot Table Configs ==========

  /**
   * Toggle show row totals for pivot table
   */
  async togglePivotRowTotals() {
    await this.pivotRowTotals.waitFor({ state: "visible" });
    await this.pivotRowTotals.click();
  }

  /**
   * Toggle show column totals for pivot table
   */
  async togglePivotColTotals() {
    await this.pivotColTotals.waitFor({ state: "visible" });
    await this.pivotColTotals.click();
  }

  /**
   * Toggle sticky column totals for pivot table
   * (only visible when row totals is enabled)
   */
  async togglePivotStickyColTotals() {
    await this.pivotStickyColTotals.waitFor({ state: "visible" });
    await this.pivotStickyColTotals.click();
  }

  /**
   * Toggle sticky row totals for pivot table
   * (only visible when column totals is enabled)
   */
  async togglePivotStickyRowTotals() {
    await this.pivotStickyRowTotals.waitFor({ state: "visible" });
    await this.pivotStickyRowTotals.click();
  }

  /**
   * Get the checked state of a toggle by data-test selector
   * @param {import('@playwright/test').Locator} toggleLocator
   * @returns {Promise<boolean>}
   */
  async getToggleState(toggleLocator) {
    await toggleLocator.waitFor({ state: "visible", timeout: 10000 });
    const ariaChecked = await toggleLocator.getAttribute("aria-checked");
    return ariaChecked === "true";
  }

}
