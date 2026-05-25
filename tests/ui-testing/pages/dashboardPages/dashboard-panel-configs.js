//dashboard panel configs page object
//methods: All configs related to dashboard panels

import { expect } from "@playwright/test";

export default class DashboardPanelConfigs {
  constructor(page) {
    this.page = page;
    this.configBtn = page.locator('[data-test="panel-sidebar-header-collapsed"]');
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
      '[data-test="dashboard-config-no-value-replacement-field"]'
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

    // Pagination locators
    this.paginationToggle = page.locator('[data-test="dashboard-config-show-pagination"]');
    this.rowsPerPageWrapper = page.locator('[data-test="dashboard-config-rows-per-page"]');
    this.rowsPerPageField = page.locator('[data-test="dashboard-config-rows-per-page-field"]');
    this.rowsPerPageInfo = page.locator('[data-test="dashboard-config-rows-per-page-info"]');
    this.tablePagination = page.locator('[data-test="dashboard-table-pagination"]');
    this.tableRowsPerPageLabel = page.locator('[data-test="dashboard-table-rows-per-page-label"]');
    this.tableRowCount = page.locator('[data-test="dashboard-table-row-count"]');

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
    this.sidebarScrollContainer = page.locator('[data-test="panel-sidebar-content"]');
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
    this.columnOrderRows = page.locator('[data-test^="column-order-row-"]');
    this.columnOrderDraggableList = page.locator('[data-test="dashboard-column-order-drag"]');
    this.columnOrderDescription = page.locator('[data-test="dashboard-column-order-description"]');
    this.columnOrderEmptyState = page.locator('[data-test="dashboard-column-order-empty-state"]');
    this.columnOrderDragHandles = page.locator('[data-test^="column-order-drag-handle-"]');
    this.columnOrderDialogPrimaryBtn = page.locator(
      '[data-test="dashboard-column-order-popup"] [data-test="o-dialog-primary-btn"]'
    );
    this.columnOrderDialogSecondaryBtn = page.locator(
      '[data-test="dashboard-column-order-popup"] [data-test="o-dialog-secondary-btn"]'
    );
    this.columnOrderDialogCloseBtn = page.locator(
      '[data-test="dashboard-column-order-popup"] [data-test="o-dialog-close-btn"]'
    );

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
  async _clickVirtualOption(dataTestParent, label) {
    const option = this.page.locator(
      `[data-test="${dataTestParent}-option"][data-test-label="${label}"]`
    );
    await option.waitFor({ state: "visible", timeout: 15000 });
    await option.click();
  }

  /// Open the config panel
  async openConfigPanel() {
    await this.configBtn.waitFor({ state: "visible" });
    await this.configBtn.click();
  }
  // Select legend position
  async legendPosition(position) {
    const trigger = this.page.locator('[data-test="dashboard-config-legend-position-trigger"]');
    await trigger.waitFor({ state: "visible" });
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-legend-position", position);
  }

  // Select unit
  async selectUnit(unit) {
    const trigger = this.page.locator('[data-test="dashboard-config-unit-trigger"]');
    await trigger.waitFor({ state: "visible" });
    await trigger.click();
    // OSelect has 18+ items; use search to filter before clicking
    const searchInput = this.page.locator('[data-test="dashboard-config-unit-search"]');
    await searchInput.waitFor({ state: "visible" });
    await searchInput.fill(unit);
    await this._clickVirtualOption("dashboard-config-unit", unit);
  }

  //Decimals
  async selectDecimals(decimal) {
    await this.decimals.waitFor({ state: "visible" });
    await this.decimals.locator('[data-test$="-field"]').fill(decimal);
  }

  //Query limit
  async selectQueryLimit(limit) {
    await this.queryLimit.waitFor({ state: "visible" });
    await this.queryLimit.locator('[data-test$="-field"]').fill(limit);
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
    await this.axisWidth.locator('[data-test$="-field"]').fill(width);
  }
  //YAxis Min and Max
  async Y_AxisMin(min) {
    await this.yAxisMin.waitFor({ state: "visible" });
    await this.yAxisMin.locator('[data-test$="-field"]').fill(min);
  }
  // YAxis Max
  async Y_AxisMax(max) {
    await this.yAxisMax.waitFor({ state: "visible" });
    await this.yAxisMax.locator('[data-test$="-field"]').fill(max);
  }

  // Value position
  async selectValuePosition(position) {
    const trigger = this.page.locator('[data-test="dashboard-config-label-position-trigger"]');
    await this.scrollSidebarToElement(trigger);
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-label-position", position);
  }

  // Value rotate
  async selectValueRotate(rotate) {
    await this.valueRotate.waitFor({ state: "visible" });
    await this.valueRotate.locator('[data-test$="-field"]').fill(rotate);
  }

  //show symbols
  async selectSymbols(symbols) {
    const trigger = this.page.locator('[data-test="dashboard-config-show_symbol-trigger"]');
    await this.scrollSidebarToElement(trigger);
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-show_symbol", symbols);
  }
  // Line interpolation
  async selectLineInterpolation(interpolation) {
    const trigger = this.page.locator('[data-test="dashboard-config-line_interpolation-trigger"]');
    await this.scrollSidebarToElement(trigger);
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-line_interpolation", interpolation);
  }

  // Line thickness
  async selectLineThickness(thickness) {
    await this.lineThickness.waitFor({ state: "visible" });
    await this.lineThickness.locator('[data-test$="-field"]').fill(thickness);
  }
  //Trellis Layout
  async selectTrellisLayout(layout) {
    const trigger = this.page.locator('[data-test="dashboard-trellis-chart-trigger"]');
    await this.scrollSidebarToElement(trigger);
    // Trellis is disabled when breakdown field is empty; wait for it to be enabled
    await expect(trigger).toBeEnabled({ timeout: 15000 });
    await trigger.click();
    await this._clickVirtualOption("dashboard-trellis-chart", layout);
  }

  //GEO Map Configs

  //Base Map
  async selectBaseMap(map) {
    const trigger = this.page.locator('[data-test="dashboard-config-basemap-trigger"]');
    await trigger.waitFor({ state: "visible" });
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-basemap", map);
  }

  //Lattitude and longitude
  //Lattitude
  async selectLatitude(lat) {
    await this.latitude.waitFor({ state: "visible" });
    await this.latitude.locator('[data-test$="-field"]').fill(lat);
  }
  //Longitude
  async selectLongitude(long) {
    await this.longitude.waitFor({ state: "visible" });
    await this.longitude.locator('[data-test$="-field"]').fill(long);
  }

  //Zoom
  async selectZoom(zoom) {
    await this.zoom.waitFor({ state: "visible" });
    await this.zoom.locator('[data-test$="-field"]').fill(zoom);
  }

  //Symbol size
  async selectSymbolSize(size) {
    const trigger = this.page.locator('[data-test="dashboard-config-symbol-trigger"]');
    await this.scrollSidebarToElement(trigger);
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-symbol", size);
  }

  //Minimum and maximum size
  async selectMinimumMaximumSize(minimum) {
    await this.minimumSize.waitFor({ state: "visible" });
    await this.minimumSize.locator('[data-test$="-field"]').fill(minimum);
  }
  //Maximum size
  async selectMaximumSize(maximum) {
    await this.maximumSize.waitFor({ state: "visible" });
    await this.maximumSize.locator('[data-test$="-field"]').fill(maximum);
  }

  //layer type
  async selectLayerType(type) {
    const trigger = this.page.locator('[data-test="dashboard-config-layer-type-trigger"]');
    await this.scrollSidebarToElement(trigger);
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-layer-type", type);
  }

  //weight
  async selectWeight(Weight) {
    await this.weight.waitFor({ state: "visible" });
    await this.weight.locator('[data-test$="-field"]').fill(Weight);
  }

  //Map configs
  async selectMapType(type) {
    const trigger = this.page.locator('[data-test="dashboard-config-map-type-trigger"]');
    await trigger.waitFor({ state: "visible" });
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-map-type", type);
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

    // OSelect forwards parent data-test to ListboxItem (`*-option`).
    const columnOptions = this.page.locator('[data-test="dashboard-addpanel-config-unit-config-select-column-0-option"]');
    if (columnName) {
      const columnOption = this.page.locator(`[data-test="dashboard-addpanel-config-unit-config-select-column-0-option"][data-test-label="${columnName}"]`);
      await columnOption.waitFor({ state: "visible", timeout: 5000 });
      await columnOption.click();
    } else {
      // Pick first available column when column name is unknown
      await columnOptions.first().waitFor({ state: "visible", timeout: 5000 });
      await columnOptions.first().click();
    }

    const unitSelect = this.page.locator('[data-test="dashboard-addpanel-config-unit-config-select-unit-0"]');
    await unitSelect.waitFor({ state: "visible", timeout: 5000 });
    await unitSelect.click();
    const unitOption = this.page
      .locator(`[data-test="dashboard-addpanel-config-unit-config-select-unit-0-option"][data-test-label="${unitName}"]`)
      .first();
    await unitOption.click();

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
    await valueInput.locator('[data-test$="-field"]').fill(value);

    const textInput = popup.locator('[data-test="dashboard-addpanel-config-value-mapping-text-input-0"]');
    await textInput.locator('[data-test$="-field"]').fill(text);

    if (setColor) {
      const setColorBtn = popup.locator('[data-test="dashboard-addpanel-config-value-mapping-set-color-btn-0"]');
      await setColorBtn.click();
      await setColorBtn.waitFor({ state: "hidden", timeout: 5000 });
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
    const columnOption = this.page.locator(`[data-test="dashboard-addpanel-config-unit-config-select-column-0-option"][data-test-label="${columnName}"]`).first();
    await columnOption.waitFor({ state: "visible" });
    await columnOption.click();

    // Select type
    await this.overrideTypeSelect.waitFor({ state: "visible" });
    await this.overrideTypeSelect.click();
    const typeOption = this.page.locator(`[data-test="dashboard-addpanel-config-type-select-0-option"][data-test-label="${typeName}"]`).first();
    await typeOption.waitFor({ state: "visible" });
    await typeOption.click();

    // Optionally enable checkbox corresponding to the selected type
    if (enableTypeCheckbox) {
      const typeCheckbox = this.page.locator('[data-test="dashboard-addpanel-config-override-unique-value-checkbox-0"]');
      await typeCheckbox.waitFor({ state: "visible" });
      await typeCheckbox.click();
    }
      const saveBtn = this.page.locator('[data-test="override-config-popup-dialog"] [data-test="o-dialog-primary-btn"]');
      await saveBtn.waitFor({ state: "visible", timeout: 5000 });
      await saveBtn.click();
  } 
  // Click-hold on the sidebar and scroll down until the Override button is visible
  async scrollDownSidebarUntilOverrideVisible() {
    const sidebar = this.sidebarScrollContainer;
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
      }, '[data-test="panel-sidebar-content"]');
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
    }

    // Finally wait for it to be visible
    await this.overrideConfig.waitFor({ state: "visible", timeout: 10000 });
  }
  //Metric Text
  //BG color
  async selectBGColor(color) {
    const trigger = this.page.locator('[data-test="dashboard-config-color-mode-trigger"]');
    await trigger.waitFor({ state: "visible" });
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-color-mode", color);
  }

  //Guage chart configs
  async selectGuageMin(min) {
    await this.gaugeMin.waitFor({ state: "visible" });
    await this.gaugeMin.locator('[data-test$="-field"]').fill(min);
  }
  //Guage Max
  async selectGuageMax(max) {
    await this.gaugeMax.waitFor({ state: "visible" });
    await this.gaugeMax.locator('[data-test$="-field"]').fill(max);
  }

  // Get connect null values toggle state
  async getConnectNullValuesState() {
    await this.connectNullValuesToggle.waitFor({ state: "visible", timeout: 10000 });
    // OSwitch inner <button> carries data-test="{parentDataTest}-btn" and aria-checked
    const ariaChecked = await this.connectNullValuesToggle
      .locator('[data-test$="-btn"]')
      .getAttribute("aria-checked");
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
   * Scroll sidebar until target element is visible and centered in the sidebar viewport.
   * Centering ensures OSelect popups have enough space to open without being clipped.
   * @param {import('@playwright/test').Locator} targetLocator - Element to scroll to
   */
  async scrollSidebarToElement(targetLocator) {
    const sidebar = this.sidebarScrollContainer;
    await sidebar.waitFor({ state: "visible" });

    // Always use scrollIntoView with block:'center' so the element is in the middle
    // of the sidebar viewport, not at the edge — critical for OSelect popups.
    await targetLocator.evaluate(el => {
      el.scrollIntoView({ behavior: 'instant', block: 'center' });
    }).catch(() => {
      // If scrollIntoView fails (element detached), fall back to wheel scroll
    });

    // Wheel-scroll fallback if element is still not visible
    const sidebar2 = this.sidebarScrollContainer;
    await sidebar2.hover();
    for (let i = 0; i < 15; i++) {
      if (await targetLocator.isVisible().catch(() => false)) break;
      await this.page.mouse.wheel(0, 300);
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
    // OCombobox input — `dashboard-addpanel-config-color-by-series-series-select-${rowIndex}-input`
    const comboboxInput = this.colorBySeriesPopup.locator(
      `[data-test="dashboard-addpanel-config-color-by-series-series-select-${rowIndex}-input"]`
    );
    await comboboxInput.waitFor({ state: "visible", timeout: 10000 });
    await comboboxInput.click();

    // OCombobox uses ComboboxPortal — options are rendered at document root, outside the popup.
    // Must use page-level locator, not colorBySeriesPopup-scoped locator.
    const optionLocators = this.page.locator(
      `[data-test="dashboard-addpanel-config-color-by-series-series-select-${rowIndex}-option"]`
    );
    await optionLocators.first().waitFor({ state: "visible", timeout: 10000 });

    let targetOption;

    if (matchText) {
      const count = await optionLocators.count();
      for (let i = 0; i < count; i++) {
        const text = await optionLocators.nth(i).textContent();
        if (text && text.includes(matchText)) {
          targetOption = optionLocators.nth(i);
          break;
        }
      }
      if (!targetOption && count > 1) {
        targetOption = optionLocators.nth(count - 1);
      } else if (!targetOption) {
        targetOption = optionLocators.first();
      }
    } else {
      targetOption = optionLocators.nth(optionIndex ?? 0);
    }

    const seriesName = await targetOption.getAttribute("data-test-label");
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
    const setColorBtn = this.colorBySeriesPopup.locator(`[data-test="dashboard-addpanel-config-color-by-series-set-color-btn-${rowIndex}"]`);
    if (await setColorBtn.isVisible().catch(() => false)) {
      await setColorBtn.click();
      await setColorBtn.waitFor({ state: "hidden", timeout: 5000 });
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
        // Find the color input scoped to the specific row's color section
        const colorSection = popup.querySelector(`[data-test="dashboard-addpanel-config-color-by-series-color-section-${rowIndex}"]`);
        const input = colorSection ? colorSection.querySelector('input') : null;
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

  /** Returns the locator for the move-up button for the column at the given index. */
  columnOrderMoveUpBtn(index) {
    return this.page.locator(`[data-test="column-order-move-up-${index}"]`);
  }

  /** Returns the locator for the move-down button for the column at the given index. */
  columnOrderMoveDownBtn(index) {
    return this.page.locator(`[data-test="column-order-move-down-${index}"]`);
  }

  /** Returns the locator for the drag handle at the given index. */
  columnOrderDragHandle(index) {
    return this.page.locator(`[data-test="column-order-drag-handle-${index}"]`);
  }

  /** Returns the locator for the column-name element inside the row at the given index. */
  columnOrderColumnNameEl(index) {
    return this.columnOrderRow(index).locator('[data-test="dashboard-column-order-column-name"]');
  }

  /** Returns the locator for the column-number element inside the row at the given index. */
  columnOrderColumnNumberEl(index) {
    return this.columnOrderRow(index).locator('[data-test="dashboard-column-order-column-number"]');
  }

  /** Opens the column order dialog via the "Configure Column Order" button in the config sidebar. */
  async openColumnOrderDialog() {
    await this.scrollSidebarToElement(this.columnOrderBtn);
    await this.columnOrderBtn.click();
    await this.columnOrderDialog.waitFor({ state: 'visible', timeout: 5000 });
  }

  /**
   * Returns the column NAME text (not row number or icons) of the row at the given index.
   * Targets the `dashboard-column-order-column-name` data-test div inside the row.
   */
  async getColumnName(index) {
    const nameEl = this.columnOrderColumnNameEl(index);
    await nameEl.waitFor({ state: 'visible', timeout: 5000 });
    return (await nameEl.textContent() || '').trim();
  }

  /** Returns the column number text (e.g. "1.") for the row at the given index. */
  async getColumnNumber(index) {
    const numEl = this.columnOrderColumnNumberEl(index);
    await numEl.waitFor({ state: 'visible', timeout: 5000 });
    return (await numEl.textContent() || '').trim();
  }

  /** Returns the number of column-order rows currently in the popup. */
  async getColumnOrderRowCount() {
    return await this.columnOrderRows.count();
  }

  /**
   * Dispatch a click via native DOM event so the OTooltip's hover-on-trigger
   * subtree (which intercepts pointer events after a prior click) cannot block
   * the action. Works because OButton listens to @click, not pointerdown.
   */
  async _dispatchClickOnLocator(locator) {
    await locator.evaluate((el) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
  }

  /** Clicks the move-down button for the column at the given index. */
  async moveColumnDown(index) {
    const btn = this.columnOrderMoveDownBtn(index);
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await this._dispatchClickOnLocator(btn);
  }

  /** Clicks the move-up button for the column at the given index. */
  async moveColumnUp(index) {
    const btn = this.columnOrderMoveUpBtn(index);
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await this._dispatchClickOnLocator(btn);
  }

  /** Saves the column order and waits for the dialog to close. */
  async saveColumnOrder() {
    await this.columnOrderDialogPrimaryBtn.click();
    await this.columnOrderDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /** Cancels the column order dialog without saving. */
  async cancelColumnOrder() {
    await this.columnOrderDialogSecondaryBtn.click();
    await this.columnOrderDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  /** Closes the column order dialog via the × close button (treated as cancel). */
  async closeColumnOrderViaCloseIcon() {
    await this.columnOrderDialogCloseBtn.click();
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
    // Click the inner toggle button directly — the label slot contains an OButton
    // with @click.stop that would block propagation if the wrapper center lands on it.
    const innerBtn = this.pivotRowTotals.locator('[data-test$="-btn"]');
    await innerBtn.waitFor({ state: "visible" });
    await innerBtn.click();
  }

  /**
   * Toggle show column totals for pivot table
   */
  async togglePivotColTotals() {
    // Click the inner toggle button directly — same @click.stop concern as row totals.
    const innerBtn = this.pivotColTotals.locator('[data-test$="-btn"]');
    await innerBtn.waitFor({ state: "visible" });
    await innerBtn.click();
  }

  /**
   * Toggle sticky column totals for pivot table
   * (only visible when row totals is enabled)
   */
  async togglePivotStickyColTotals() {
    const innerBtn = this.pivotStickyColTotals.locator('[data-test$="-btn"]');
    await innerBtn.waitFor({ state: "visible" });
    await innerBtn.click();
  }

  /**
   * Toggle sticky row totals for pivot table
   * (only visible when column totals is enabled)
   */
  async togglePivotStickyRowTotals() {
    const innerBtn = this.pivotStickyRowTotals.locator('[data-test$="-btn"]');
    await innerBtn.waitFor({ state: "visible" });
    await innerBtn.click();
  }

  /**
   * Get the checked state of an OSwitch toggle.
   * OSwitch renders aria-checked on the inner <button role="switch">, NOT on the
   * wrapper div that carries the data-test attribute. Query the inner [data-state]
   * button to determine the current state.
   * @param {import('@playwright/test').Locator} toggleLocator - locator for the OSwitch wrapper
   * @returns {Promise<boolean>}
   */
  async getToggleState(toggleLocator) {
    await toggleLocator.waitFor({ state: "visible", timeout: 10000 });
    // OSwitch inner <button> carries data-test="{parentDataTest}-btn" and data-state="checked|unchecked"
    const innerBtn = toggleLocator.locator('[data-test$="-btn"]');
    const dataState = await innerBtn.getAttribute('data-state');
    return dataState === 'checked';
  }

  // ========== Pagination Configs ==========

  /**
   * Toggle the pagination switch in the config panel.
   */
  async togglePagination() {
    await this.paginationToggle.waitFor({ state: "visible" });
    await this.paginationToggle.click();
  }

  /**
   * Returns true if pagination is currently enabled.
   * @returns {Promise<boolean>}
   */
  async isPaginationEnabled() {
    return this.getToggleState(this.paginationToggle);
  }

  /**
   * Set the rows-per-page value.
   * Targets the inner OInput field (not the wrapper div).
   * @param {string|number} value
   */
  async setRowsPerPage(value) {
    await this.rowsPerPageWrapper.waitFor({ state: "visible" });
    await this.rowsPerPageField.click();
    await this.rowsPerPageField.fill(String(value));
  }

  /**
   * Returns the current value in the rows-per-page input.
   * @returns {Promise<string>}
   */
  async getRowsPerPageValue() {
    return await this.rowsPerPageField.inputValue();
  }

  /**
   * Returns true if the transpose toggle inner button is disabled.
   * @returns {Promise<boolean>}
   */
  async isTransposeDisabled() {
    const innerBtn = this.transpose.locator('[data-test$="-btn"]');
    return await innerBtn.isDisabled();
  }

  /**
   * Returns true if the dynamic columns toggle inner button is disabled.
   * @returns {Promise<boolean>}
   */
  async isDynamicColumnsDisabled() {
    const innerBtn = this.dynamicColumn.locator('[data-test$="-btn"]');
    return await innerBtn.isDisabled();
  }

  /**
   * Returns true if pivot row totals is currently enabled.
   * @returns {Promise<boolean>}
   */
  async isPivotRowTotalsEnabled() {
    return this.getToggleState(this.pivotRowTotals);
  }

  /**
   * Returns true if pivot column totals is currently enabled.
   * @returns {Promise<boolean>}
   */
  async isPivotColTotalsEnabled() {
    return this.getToggleState(this.pivotColTotals);
  }

}
