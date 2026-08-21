//dashboard panel configs page object
//methods: All configs related to dashboard panels

import { expect } from "@playwright/test";

export default class DashboardPanelConfigs {
  constructor(page) {
    this.page = page;
    this.configBtn = page.locator('[data-test="panel-sidebar-header-collapsed"]');
    this.toggleAllSectionsBtn = page.locator(
      '[data-test="dashboard-config-toggle-all-sections-btn"]'
    );
    // Same button, narrowed to the all-sections-expanded state — used as a
    // deterministic wait target after clicking expand-all.
    this.toggleAllSectionsBtnExpanded = page.locator(
      '[data-test="dashboard-config-toggle-all-sections-btn"][data-test-all-expanded="true"]'
    );
    this.legend = page.locator(
      '[data-test="dashboard-config-legend-position"]'
    );

    this.unit = page.locator('[data-test="dashboard-config-unit"]');
    this.decimals = page.locator('[data-test="dashboard-config-decimals"]');
    this.description = page.locator(
      '[data-test="dashboard-config-description"]'
    );
    this.descriptionField = page.locator(
      '[data-test="dashboard-config-description-field"]'
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
    // The underlying toggle button (carries aria-checked), distinct from the
    // wrapcell label/container above used by selectWrapCell().
    this.wrapCellBtn = page.locator(
      '[data-test="dashboard-config-wrap-table-cells-btn"]'
    );
    this.transpose = page.locator(
      '[data-test="dashboard-config-table_transpose"]'
    );
    this.transposeBtn = page.locator(
      '[data-test="dashboard-config-table_transpose-btn"]'
    );
    this.dynamicColumn = page.locator(
      '[data-test="dashboard-config-table_dynamic_columns"]'
    );
    // The inner toggle button (carries aria-checked) for dynamic columns config
    this.dynamicColumnBtn = page.locator(
      '[data-test="dashboard-config-table_dynamic_columns-btn"]'
    );
    this.valueMapping = page.locator(
      '[data-test="dashboard-addpanel-config-value-mapping-add-btn"]'
    );
    this.overrideConfig = page.locator(
      '[data-test="dashboard-addpanel-config-override-config-add-btn"]'
    );
    this.tableFiltering = page.locator(
      '[data-test="dashboard-config-table-filtering"]'
    );

    // Column Formatting dialog (override config)
    this.overrideDialog = page.locator(
      '[data-test="override-config-popup-dialog"]'
    );
    this.overrideAddFieldBtn = page
      .locator('[data-test="dashboard-addpanel-config-add-column"]')
      .first();
    this.overrideSaveBtn = page.locator(
      '[data-test="override-config-popup-save"]'
    );
    this.overrideCancelBtn = page.locator(
      '[data-test="override-config-popup-cancel"]'
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
    // Pagination container scoped inside the rendered panel table (distinct from the
    // unscoped tablePagination, which can also match a PromQL legend bottom slot).
    this.tablePaginationInTable = page.locator('[data-test="dashboard-panel-table"] [data-test="dashboard-table-pagination"]');
    this.tableRowsPerPageLabel = page.locator('[data-test="dashboard-table-rows-per-page-label"]');
    this.tableRowCount = page.locator('[data-test="dashboard-table-row-count"]');
    // Generic role=tooltip (e.g. rows-per-page info icon hover tooltip)
    this.infoTooltip = page.locator('[role="tooltip"]');

    //Metric Text
    this.bgColor = page.locator('[data-test="dashboard-config-color-mode"]');

    //Guage chart locators
    this.gaugeMin = page.locator('[data-test="dashboard-config-gauge-min"]');
    this.gaugeMax = page.locator('[data-test="dashboard-config-gauge-max"]');

    //Map locators
    this.mapType = page.locator('[data-test="dashboard-config-map-type"]');

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

    // ===== Config-panel elements referenced directly by the config-* spec suite =====
    // (relocated from the specs so no raw page.locator lives in the tests)

    // Line style
    this.showSymbolTrigger = page.locator('[data-test="dashboard-config-show_symbol-trigger"]');
    this.lineInterpolationTrigger = page.locator('[data-test="dashboard-config-line_interpolation-trigger"]');

    // Trellis
    this.trellisTrigger = page.locator('[data-test="dashboard-trellis-chart-trigger"]');
    this.trellisNumColumns = page.locator('[data-test="trellis-chart-num-of-columns"]');
    this.trellisGroupByYAxis = page.locator('[data-test="dashboard-config-trellis-group-by-y-axis"]');

    // General settings
    this.customUnit = page.locator('[data-test="dashboard-config-custom-unit"]');
    this.noValueReplacementWrapper = page.locator('[data-test="dashboard-config-no-value-replacement"]');

    // Axis settings
    this.showGridlines = page.locator('[data-test="dashboard-config-show-gridlines"]');
    this.labelPositionTrigger = page.locator('[data-test="dashboard-config-label-position-trigger"]');
    this.axisLabelRotate = page.locator('[data-test="dashboard-config-axis-label-rotate"]');
    this.axisLabelTruncate = page.locator('[data-test="dashboard-config-axis-label-truncate"]');

    // Legends
    this.showLegend = page.locator('[data-test="dashboard-config-show-legend"]');
    this.legendsScrollable = page.locator('[data-test="dashboard-config-legends-scrollable"]');
    this.legendWidth = page.locator('[data-test="dashboard-config-legend-width"]');
    this.legendHeight = page.locator('[data-test="dashboard-config-legend-height"]');
    this.legendWidthUnitActive = page.locator('[data-test="dashboard-config-legend-width-unit-active"]');
    this.legendWidthUnitInactive = page.locator('[data-test="dashboard-config-legend-width-unit-inactive"]');
    this.legendHeightUnitActive = page.locator('[data-test="dashboard-config-legend-height-unit-active"]');
    this.legendHeightUnitInactive = page.locator('[data-test="dashboard-config-legend-height-unit-inactive"]');

    // Gauge & Maps
    this.geomapRenderer = page.locator('[data-test="dashboard-geomap-renderer"]');
    this.mapSymbolFixed = page.locator('[data-test="dashboard-config-map-symbol-fixed"]');
    this.symbolTrigger = page.locator('[data-test="dashboard-config-symbol-trigger"]');
    this.layerTypeTrigger = page.locator('[data-test="dashboard-config-layer-type-trigger"]');
    this.mapTypeTrigger = page.locator('[data-test="dashboard-config-map-type-trigger"]');

    // Advanced settings
    this.timeShiftRemoveButtons = page.locator('[data-test^="dashboard-addpanel-config-time-shift-remove-"]');
    this.topResults = page.locator('[data-test="dashboard-config-top_results"]');
    this.topResultsOthers = page.locator('[data-test="dashboard-config-top_results_others"]');
    this.chartAlign = page.locator('[data-test="dashboard-config-chart-align"]');
    this.chartAlignOptions = page.locator('[data-test="dashboard-config-chart-align-option"]');
    this.sparklineType = page.locator('[data-test="dashboard-config-sparkline-type"]');
    this.sparklineLayout = page.locator('[data-test="dashboard-config-sparkline-layout"]');
    this.sparklineLineWidthInput = page.locator('[data-test="dashboard-config-sparkline-line-width"]');
    this.sparklineFillOpacity = page.locator('[data-test="dashboard-config-sparkline-fill-opacity"]');
    this.panelSchemaRendererError = page.locator('[data-test="panel-schema-renderer-error-message"]');

    // Mark line
    this.marklineAddBtn = page.locator('[data-test="dashboard-addpanel-config-markline-add-btn"]');

    // PromQL settings
    this.stepValue = page.locator('[data-test="dashboard-config-step-value"]');
    this.promqlLegendInfo = page.locator('[data-test="dashboard-config-promql-legend-info"]');
    this.aggregation = page.locator('[data-test="dashboard-config-aggregation"]');
    this.promqlTableMode = page.locator('[data-test="dashboard-config-promql-table-mode"]');
    this.promqlTableModeTrigger = page.locator('[data-test="dashboard-config-promql-table-mode-trigger"]');
    this.stickyFirstColumn = page.locator('[data-test="dashboard-config-sticky-first-column"]');
    this.tableAggregations = page.locator('[data-test="dashboard-config-table-aggregations"]');
    this.tableAggregationsTrigger = page.locator('[data-test="dashboard-config-table-aggregations-trigger"]');
    this.visibleColumns = page.locator('[data-test="dashboard-config-visible-columns"]');
    this.visibleColumnsTrigger = page.locator('[data-test="dashboard-config-visible-columns-trigger"]');
    this.visibleColumnsSearch = page.locator('[data-test="dashboard-config-visible-columns-search"]');
    this.hiddenColumns = page.locator('[data-test="dashboard-config-hidden-columns"]');
    this.hiddenColumnsTrigger = page.locator('[data-test="dashboard-config-hidden-columns-trigger"]');
    this.hiddenColumnsSearch = page.locator('[data-test="dashboard-config-hidden-columns-search"]');
    this.stickyColumns = page.locator('[data-test="dashboard-config-sticky-columns"]');
    this.stickyColumnsTrigger = page.locator('[data-test="dashboard-config-sticky-columns-trigger"]');
    this.stickyColumnsSearch = page.locator('[data-test="dashboard-config-sticky-columns-search"]');
    this.geoLatLabel = page.locator('[data-test="dashboard-config-geo-lat-label"]');
    this.geoLonLabel = page.locator('[data-test="dashboard-config-geo-lon-label"]');
    this.geoWeightLabel = page.locator('[data-test="dashboard-config-geo-weight-label"]');
    this.mapsNameLabel = page.locator('[data-test="dashboard-config-maps-name-label"]');
    this.promqlLegend = page.locator('[data-test="dashboard-config-promql-legend"]');
    this.addQueryBtn = page.locator('[data-test*="query-tab-add"]');
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
    await this.expandAllConfigSections();
  }

  /**
   * Config sections start collapsed after the config-panel redesign. Expand them
   * all (via the unfold-all button) so section options — legend, axis, pivot,
   * table, etc. — render and are interactable. Idempotent: skips the click when
   * every section is already expanded (the button reflects the state via
   * data-test-all-expanded), and waits for the state flip so section-open
   * animations have started before callers query section content.
   */
  async expandAllConfigSections() {
    await this.toggleAllSectionsBtn.waitFor({ state: "visible" });
    const expanded = await this.toggleAllSectionsBtn.getAttribute(
      "data-test-all-expanded"
    );
    if (expanded === "true") return;
    await this.toggleAllSectionsBtn.click();
    await this.toggleAllSectionsBtnExpanded.waitFor({
      state: "visible",
      timeout: 5000,
    });
    // Wait for the sections' open (height) animations to finish. Clicking an
    // OSelect while sections are still animating moves the trigger mid-open,
    // which dismisses the just-opened dropdown (close-on-scroll/anchor-move) —
    // the source of flaky option-click timeouts.
    await this.page
      .waitForFunction(() =>
        Array.from(
          document.querySelectorAll('[data-test="o-collapsible-content"]')
        ).every((el) => el.getAnimations().length === 0)
      )
      .catch(() => {});
  }
  // Select legend position. This is now a segmented toggle (OToggleGroup): the
  // option items are always visible, so click the matching item directly — no
  // dropdown trigger to open.
  async legendPosition(position) {
    await this._clickVirtualOption("dashboard-config-legend-position", position);
  }

  // Select chart alignment ("Auto" | "Left" | "Center"). Same OToggleGroup shape as
  // legend position — the items are always rendered, so click the label directly.
  async selectChartAlign(align) {
    await this._clickVirtualOption("dashboard-config-chart-align", align);
  }

  // Return the panel description input field locator
  getDescriptionField() {
    return this.descriptionField;
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

  /** Toggle the "Filtering" switch (config.table_filtering) in the Table config section. */
  async toggleTableFiltering() {
    await this.scrollSidebarToElement(this.tableFiltering);
    const innerBtn = this.tableFiltering.locator('[data-test$="-btn"]');
    await innerBtn.click();
  }

  /** Returns true if column filtering is currently enabled. */
  async isTableFilteringEnabled() {
    return this.getToggleState(this.tableFiltering);
  }

  /**
   * Open the Column Formatting dialog, add the first field, force it numeric so the
   * unit applies, select a unit, then save. Strictly data-test driven.
   * @param {Object} options
   * @param {string} [options.unitName] - Unit label to select (e.g. "Bytes", "Milliseconds")
   */
  async configureOverrideWithUnit({ unitName = "Bytes" } = {}) {
    await this.openOverrideConfig();
    await this.addFirstOverrideField();

    const unitSelect = this.getOverrideUnitSelect();
    if (!(await unitSelect.isVisible().catch(() => false))) {
      await this.selectFieldType("num");
    }
    await this.selectFormatUnit(unitName);

    await this.overrideSaveBtn.click();
    await this.overrideDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
  }

  /**
   * Click "Add field" and select the first available field in the dropdown.
   * The dropdown lists columns in panel order (x-axis/_timestamp first, then y-axis
   * fields), so this targets the x-axis column — useful when a genuinely text/date
   * column is wanted (e.g. auto/unique-color tests).
   */
  async addFirstOverrideField() {
    await this.overrideAddFieldBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.overrideAddFieldBtn.click();
    const firstField = this.page
      .locator('[data-test^="dashboard-addpanel-config-add-field-"]')
      .first();
    await firstField.waitFor({ state: "visible", timeout: 5000 });
    await firstField.click();
  }

  /**
   * Click "Add field" and select the LAST available field in the dropdown — the
   * y-axis value column in a single-y-field table panel (x-axis/_timestamp is always
   * listed first). Use this when the column under test must be the numeric y-value.
   */
  async addLastOverrideField() {
    await this.overrideAddFieldBtn.waitFor({ state: "visible", timeout: 10000 });
    await this.overrideAddFieldBtn.click();
    const fieldOptions = this.page.locator(
      '[data-test^="dashboard-addpanel-config-add-field-"]'
    );
    await fieldOptions.first().waitFor({ state: "visible", timeout: 5000 });
    await fieldOptions.last().click();
  }

  /** Select a unit from the Value Formatting OSelect for the currently configured column. */
  async selectFormatUnit(unitName) {
    const unitSelect = this.getOverrideUnitSelect();
    await unitSelect.waitFor({ state: "visible", timeout: 5000 });
    // OSelect's listbox virtualizes options regardless of list size (~19 unit
    // options) — off-screen entries like "Custom" (the last one) aren't real DOM
    // nodes until scrolled to. Type into the built-in search box instead, which
    // narrows filteredOptions so the match renders immediately.
    const parentDataTest = await unitSelect.getAttribute("data-test");
    await unitSelect.click();

    const searchInput = this.page.locator(`[data-test="${parentDataTest}-search"]`);
    await searchInput.waitFor({ state: "visible", timeout: 5000 });
    await searchInput.fill(unitName);

    const unitOption = this.page.locator(
      `[data-test="${parentDataTest}-option"][data-test-label="${unitName}"]`
    );
    await unitOption.waitFor({ state: "visible", timeout: 5000 });
    await unitOption.click();
  }

  /** Open the Column Formatting dialog and wait for it to be visible. */
  async openOverrideConfig() {
    await this.scrollSidebarToElement(this.overrideConfig);
    await this.overrideConfig.click();
    await this.overrideDialog.waitFor({ state: "visible", timeout: 10000 });
  }

  /** Row locator for an added field in the Column Formatting dialog. */
  getOverrideFieldRow(index = 0) {
    return this.overrideDialog.locator(
      `[data-test="override-config-row-${index}"]`,
    );
  }

  /** "Add Rule" button for the currently configured column (Conditional Styling section). */
  getAddConditionRuleBtn() {
    return this.overrideDialog.locator('[data-test^="o2-format-add-rule-"]').first();
  }

  /** Custom unit input for the currently configured column (visible when unit = Custom). */
  getCustomUnitInput() {
    return this.overrideDialog.locator('[data-test^="o2-format-custom-unit-"]').first();
  }

  /** Value-Formatting unit select of the selected field in the dialog. */
  getOverrideUnitSelect() {
    return this.overrideDialog.locator('[data-test^="o2-format-unit-"]').first();
  }

  /** Close the Column Formatting dialog via Cancel. */
  async closeOverrideConfig() {
    await this.overrideCancelBtn.click();
    await this.overrideDialog.waitFor({ state: "hidden", timeout: 5000 });
  }

  // ========== Column Formatting — field type / alignment / colors / conditional rules ==========
  // All target the single field row added via configureOverrideWithUnit/openOverrideConfig
  // + overrideAddFieldBtn, using attribute-prefix matches since the field alias is dynamic.

  /** Select the field-type toggle (auto|num|text) for the currently configured column. */
  async selectFieldType(type) {
    const btn = this.overrideDialog
      .locator(`[data-test^="o2-format-field-type-${type}-"]`)
      .first();
    await btn.waitFor({ state: "visible", timeout: 5000 });
    await btn.click();
  }

  /** Fill the custom unit input (visible only when unit = Custom). */
  async fillCustomUnit(value) {
    const input = this.overrideDialog
      .locator('[data-test^="o2-format-custom-unit-"]')
      .first();
    await input.waitFor({ state: "visible", timeout: 5000 });
    await input.locator('[data-test$="-field"]').fill(value);
  }

  /**
   * Set a color via the ColorSwatchPicker's native color input (the "custom" swatch),
   * which accepts any hex value regardless of the curated swatch list.
   * @param {"text"|"bg"} kind
   * @param {string} hex
   */
  async setFormatColor(kind, hex) {
    const wrapper = this.overrideDialog
      .locator(`[data-test^="o2-format-${kind}-color-"]`)
      .first();
    await wrapper.waitFor({ state: "visible", timeout: 5000 });
    const colorInput = wrapper.locator('input[type="color"]');
    await colorInput.evaluate((el, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, hex);
  }

  /** Toggle the auto/unique-value color checkbox for the currently configured column. */
  async toggleAutoColor() {
    const btn = this.overrideDialog
      .locator('[data-test^="o2-format-unique-color-"]')
      .first();
    await btn.waitFor({ state: "visible", timeout: 5000 });
    await btn.click();
  }

  /**
   * Select alignment (auto|left|center|right). Alignment buttons have no data-test
   * (verified against source); the second `.cf-seg` toggle group in the popup is
   * Alignment (the first is Field Type).
   */
  async selectAlignment(label) {
    const group = this.overrideDialog.locator(".cf-seg").nth(1);
    await group.getByText(label, { exact: true }).click();
  }

  /** Click "Add Rule" to append a conditional styling rule for the current column. */
  async addConditionalRule() {
    const addBtn = this.overrideDialog
      .locator('[data-test^="o2-format-add-rule-"]')
      .first();
    await addBtn.waitFor({ state: "visible", timeout: 5000 });
    await addBtn.click();
  }

  /**
   * Fill the threshold for the conditional rule at ruleIdx (default operator "<").
   * The threshold OInput carries `o2-format-cond-threshold-<field>-<ruleIdx>`, which
   * OInput forwards to its inner <input> as `...-field`.
   */
  async fillConditionThreshold(ruleIdx, threshold) {
    const thresholdInput = this.overrideDialog
      .locator(
        `[data-test^="o2-format-cond-threshold-"][data-test$="-${ruleIdx}-field"]`
      )
      .first();
    await thresholdInput.waitFor({ state: "visible", timeout: 5000 });
    await thresholdInput.fill(String(threshold));
  }

  /** Set the text/bg color for the conditional rule at ruleIdx (data-test driven). */
  async setConditionRuleColor(ruleIdx, kind, hex) {
    // Exclude the swatch buttons (…-swatch-N) so a rule-N swatch can't be mistaken
    // for the ColorSwatchPicker root, whose data-test ends in the same "-N".
    const wrapper = this.overrideDialog
      .locator(
        `[data-test^="o2-format-cond-${kind}-"][data-test$="-${ruleIdx}"]:not([data-test*="-swatch-"])`
      )
      .first();
    await wrapper.waitFor({ state: "visible", timeout: 5000 });
    const colorInput = wrapper.locator('input[type="color"]');
    await colorInput.evaluate((el, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, value);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, hex);
  }

  /**
   * Open value mapping popup, fill one mapping row, then click Apply.
   * Popup auto-adds one row on open (onMounted).
   * @param {Object} options
   * @param {string} [options.value] - Value to match (type=value row)
   * @param {string} [options.text] - Display text to show
   * @param {boolean} [options.setColor] - Whether to set a background colour (clicks a swatch in the picker)
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
      const bgSwatch = popup.locator(
        '[data-test="dashboard-addpanel-config-value-mapping-bg-color-0-swatch-0"]'
      );
      await bgSwatch.waitFor({ state: "visible", timeout: 5000 });
      await bgSwatch.click();
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

  /**
   * Fill a value-mapping row's value and/or display-text inputs (type=value rows).
   * @param {import('@playwright/test').Locator} popup
   * @param {number} index
   * @param {{value?: string, text?: string}} fields
   */
  async fillValueMappingRow(popup, index, { value, text } = {}) {
    if (value !== undefined) {
      await popup
        .locator(`[data-test="dashboard-addpanel-config-value-mapping-value-input-${index}"]`)
        .locator('[data-test$="-field"]')
        .fill(value);
    }
    if (text !== undefined) {
      await popup
        .locator(`[data-test="dashboard-addpanel-config-value-mapping-text-input-${index}"]`)
        .locator('[data-test$="-field"]')
        .fill(text);
    }
  }

  /** Append a new mapping row via the dialog's "Add New Mapping" (neutral) button. */
  async addValueMappingRow(popup) {
    await popup.locator('[data-test="o-dialog-neutral-btn"]').click();
  }

  /** Remove a mapping row via its per-row delete button (sits outside the row border). */
  async deleteValueMappingRow(popup, index) {
    await popup
      .locator(`[data-test="dashboard-addpanel-config-value-mapping-delete-btn-${index}"]`)
      .click();
  }

  valueMappingRows(popup) {
    return popup.locator(
      '[data-test^="dashboard-addpanel-config-value-mapping-type-select-"]:not([data-test$="-trigger"])'
    );
  }

  /**
   * The inner input for a value-mapping row field, for reading back persisted values.
   * @param {import('@playwright/test').Locator} popup
   * @param {number} index - mapping row index
   * @param {"value"|"text"|"from"|"to"} kind - which field of the row
   */
  valueMappingRowField(popup, index, kind) {
    return popup
      .locator(`[data-test="dashboard-addpanel-config-value-mapping-${kind}-input-${index}"]`)
      .locator('[data-test$="-field"]');
  }

  /** Apply the value-mapping dialog (primary button) and wait for it to close. */
  async applyValueMappingPopup(popup) {
    await popup.locator('[data-test="o-dialog-primary-btn"]').click();
    await popup.waitFor({ state: "hidden", timeout: 5000 });
  }

  /**
   * Select a value-mapping row's type via its OSelect ("Equals"/"Between"/"Matches regex").
   * Options are portaled, so match by label on the page (not scoped to the popup).
   */
  async selectValueMappingType(popup, index, label) {
    const parent = `dashboard-addpanel-config-value-mapping-type-select-${index}`;
    await popup.locator(`[data-test="${parent}-trigger"]`).click();
    await this._clickVirtualOption(parent, label);
  }

  /**
   * Fill a "Between" (range) mapping row: from/to bounds + display text.
   * The row's type must already be set to range (see selectValueMappingType).
   */
  async fillValueMappingRange(popup, index, { from, to, text } = {}) {
    const field = (kind) =>
      popup
        .locator(`[data-test="dashboard-addpanel-config-value-mapping-${kind}-input-${index}"]`)
        .locator('[data-test$="-field"]');
    if (from !== undefined) await field("from").fill(String(from));
    if (to !== undefined) await field("to").fill(String(to));
    if (text !== undefined) await field("text").fill(String(text));
  }

  /**
   * A swatch button inside a mapping row's ColorSwatchPicker.
   * @param {import('@playwright/test').Locator} popup
   * @param {number} index - mapping row index
   * @param {"text-color"|"bg-color"} kind
   * @param {number|"none"} swatch - palette index, or "none" for the clear button
   */
  valueMappingColorSwatch(popup, index, kind, swatch) {
    const suffix = swatch === "none" ? "none" : `swatch-${swatch}`;
    return popup.locator(
      `[data-test="dashboard-addpanel-config-value-mapping-${kind}-${index}-${suffix}"]`
    );
  }

  /** Click a mapping row's text/background colour swatch. Returns the swatch locator. */
  async pickValueMappingColorSwatch(popup, index, kind, swatch) {
    const target = this.valueMappingColorSwatch(popup, index, kind, swatch);
    await target.waitFor({ state: "visible", timeout: 5000 });
    await target.click();
    return target;
  }

  /** Toggle the sparkline enable switch. */
  async enableSparkline() {
    const enableSwitch = this.page.locator('[data-test="dashboard-config-sparkline-enable"]');
    await this.scrollSidebarToElement(enableSwitch);
    await enableSwitch.locator('[data-test$="-btn"]').click();
  }

  /** Read the sparkline enable switch state (aria-checked on the inner button). */
  async isSparklineEnabled() {
    const btn = this.page.locator(
      '[data-test="dashboard-config-sparkline-enable"] [data-test$="-btn"]'
    );
    await btn.waitFor({ state: "visible", timeout: 10000 });
    return (await btn.getAttribute("aria-checked")) === "true";
  }

  /** Select a sparkline chart type by its option label ("Auto (Area)"/"Line"/"Area"/"Bar"). */
  async selectSparklineType(label) {
    const trigger = this.page.locator('[data-test="dashboard-config-sparkline-type-trigger"]');
    await this.scrollSidebarToElement(trigger);
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-sparkline-type", label);
  }

  /** Select a sparkline layout by its option label ("Auto"/"Bottom"/"Background"). */
  async selectSparklineLayout(label) {
    const trigger = this.page.locator('[data-test="dashboard-config-sparkline-layout-trigger"]');
    await this.scrollSidebarToElement(trigger);
    await trigger.click();
    await this._clickVirtualOption("dashboard-config-sparkline-layout", label);
  }

  /** Pick a sparkline colour swatch by index (0..7 are the series palette). Returns the swatch. */
  async pickSparklineColorSwatch(index = 0) {
    const swatch = this.page.locator(
      `[data-test="dashboard-config-sparkline-color-swatch-${index}"]`
    );
    await this.scrollSidebarToElement(swatch);
    await swatch.click();
    return swatch;
  }

  /** Set the sparkline line width (numeric OInput; hidden for Bar type). */
  async setSparklineLineWidth(width) {
    const input = this.page.locator('[data-test="dashboard-config-sparkline-line-width"]');
    await this.scrollSidebarToElement(input);
    await input.locator('[data-test$="-field"]').fill(String(width));
  }

  /** Read the sparkline line width input's current value. */
  async getSparklineLineWidth() {
    const field = this.page.locator(
      '[data-test="dashboard-config-sparkline-line-width"] [data-test$="-field"]'
    );
    await field.waitFor({ state: "visible", timeout: 10000 });
    return field.inputValue();
  }


  // Add and configure override with dynamic column and type
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
   * Returns the option locators for a color-by-series row's combobox.
   * OCombobox uses ComboboxPortal — options render at document root, outside the
   * popup — so this must be a page-level locator, not a colorBySeriesPopup-scoped one.
   * @param {number} rowIndex - Row index in the color-by-series popup (0-based)
   */
  colorBySeriesOptions(rowIndex = 0) {
    return this.page.locator(
      `[data-test="dashboard-addpanel-config-color-by-series-series-select-${rowIndex}-option"]`
    );
  }

  /** Returns the combobox input locator for a color-by-series row. */
  colorBySeriesSeriesInput(rowIndex = 0) {
    return this.colorBySeriesPopup.locator(
      `[data-test="dashboard-addpanel-config-color-by-series-series-select-${rowIndex}-input"]`
    );
  }

  /**
   * Open a row's series dropdown and return every option label, then close it again.
   * Lets a test assert on which series the chart is actually offering (e.g. that a
   * time-shift comparison series exists) without reaching for raw locators.
   * @param {number} rowIndex - Row index (0-based)
   * @returns {Promise<string[]>} The option labels
   */
  async getColorBySeriesOptionLabels(rowIndex = 0) {
    const comboboxInput = this.colorBySeriesSeriesInput(rowIndex);
    await comboboxInput.waitFor({ state: "visible", timeout: 10000 });
    await comboboxInput.click();

    const optionLocators = this.colorBySeriesOptions(rowIndex);
    await optionLocators
      .first()
      .waitFor({ state: "visible", timeout: 10000 })
      .catch(() => {});

    const labels = await optionLocators.evaluateAll((els) =>
      els.map((el) => (el.getAttribute("data-test-label") || el.textContent || "").trim())
    );
    // Close the portal without picking anything, so the caller can re-open it.
    await this.page.keyboard.press("Escape");
    return labels;
  }

  /** Returns the currently committed series name for a color-by-series row. */
  async getColorBySeriesRowValue(rowIndex = 0) {
    return this.colorBySeriesSeriesInput(rowIndex).inputValue();
  }

  /** Returns the currently committed colour (hex string) for a color-by-series row. */
  async getColorBySeriesRowColor(rowIndex = 0) {
    const colorSection = this.colorBySeriesPopup.locator(
      `[data-test="dashboard-addpanel-config-color-by-series-color-section-${rowIndex}"]`
    );
    await colorSection.waitFor({ state: "visible", timeout: 5000 });
    return colorSection.locator("input").first().inputValue();
  }

  /**
   * Select a series from the autocomplete dropdown at the given row index.
   * Can select by index or by matching text (e.g., "ago" to find comparison series).
   *
   * `matchText` is strict: if no option contains it, this throws and lists what was
   * on offer. It used to fall back to the first/last option, which silently turned
   * "colour the comparison series" into "colour whatever series happened to exist"
   * — a test that passed without exercising the behaviour it named.
   *
   * @param {number} rowIndex - Row index in the color-by-series popup (0-based)
   * @param {Object} options - Selection options
   * @param {number} [options.optionIndex] - Which option to select by index (0-based)
   * @param {string} [options.matchText] - Text the option must contain (e.g. "15 Minutes ago")
   * @returns {string} The selected series name
   */
  async selectColorBySeriesOption(rowIndex = 0, { optionIndex, matchText } = {}) {
    const comboboxInput = this.colorBySeriesSeriesInput(rowIndex);
    await comboboxInput.waitFor({ state: "visible", timeout: 10000 });
    await comboboxInput.click();

    const optionLocators = this.colorBySeriesOptions(rowIndex);
    await optionLocators.first().waitFor({ state: "visible", timeout: 10000 });

    let targetOption;

    if (matchText) {
      const labels = await optionLocators.evaluateAll((els) =>
        els.map((el) => (el.getAttribute("data-test-label") || el.textContent || "").trim())
      );
      const index = labels.findIndex((label) => label.includes(matchText));
      if (index === -1) {
        throw new Error(
          `No color-by-series option matching "${matchText}" in row ${rowIndex}. ` +
            `Available options: ${JSON.stringify(labels)}`
        );
      }
      targetOption = optionLocators.nth(index);
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
    await this.paginationToggle.waitFor({ state: "visible", timeout: 30000 });
    // The toggle lives near the bottom of the collapsible "Table" config section,
    // so on a short viewport it can sit outside the scrolled config pane right
    // after the panel opens. Bring it into view before clicking — a bare click on
    // an off-screen target burns the whole action timeout waiting for stability.
    await this.paginationToggle.scrollIntoViewIfNeeded().catch(() => {});
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

  // ========== Parameterized locator getters for the config-* spec suite ==========

  /** Legend type (Scroll/Plain) OSelect option by label. */
  getLegendsScrollableOption(label) {
    return this.page.locator(
      `[data-test="dashboard-config-legends-scrollable-option"][data-test-label="${label}"]`
    );
  }

  /** Map type OSelect option by label (shared: geomap-maps + PromQL maps). */
  getMapTypeOption(label) {
    return this.page.locator(
      `[data-test="dashboard-config-map-type-option"][data-test-label="${label}"]`
    );
  }

  /** PromQL aggregation OSelect option by full label (e.g. "Max (maximum value)"). */
  getAggregationOption(label) {
    return this.page.locator(
      `[data-test="dashboard-config-aggregation-option"][data-test-label="${label}"]`
    );
  }

  /** PromQL table-mode OSelect option by label (e.g. "Aggregate"). */
  getPromqlTableModeOption(label) {
    return this.page.locator(
      `[data-test="dashboard-config-promql-table-mode-option"][data-test-label="${label}"]`
    );
  }

  /** PromQL table-aggregations OSelect option by label. */
  getTableAggregationsOption(label) {
    return this.page.locator(
      `[data-test="dashboard-config-table-aggregations-option"][data-test-label="${label}"]`
    );
  }

  /** Config-panel per-query tab by index (multi-query PromQL). */
  getConfigQueryTab(index) {
    return this.page.locator(`[data-test="dashboard-config-query-tab-${index}"]`);
  }

  // ---- Mark line rows (index-based) ----

  /** Mark line type OSelect wrapper for row `index`. */
  getMarklineTypeSelect(index) {
    return this.page.locator(`[data-test="dashboard-config-markline-type-${index}"]`);
  }

  /** Mark line type OSelect trigger for row `index` (carries data-test-selected-value). */
  getMarklineTypeTrigger(index) {
    return this.page.locator(`[data-test="dashboard-config-markline-type-${index}-trigger"]`);
  }

  /** Mark line type OSelect option by label for row `index`. */
  getMarklineTypeOption(index, label) {
    return this.page.locator(
      `[data-test="dashboard-config-markline-type-${index}-option"][data-test-label="${label}"]`
    );
  }

  /** Mark line value input wrapper for row `index`. */
  getMarklineValue(index) {
    return this.page.locator(`[data-test="dashboard-config-markline-value-${index}"]`);
  }

  /** Mark line name input wrapper for row `index`. */
  getMarklineName(index) {
    return this.page.locator(`[data-test="dashboard-config-markline-name-${index}"]`);
  }

  /** Mark line per-row remove button for row `index`. */
  getMarklineRemoveBtn(index) {
    return this.page.locator(`[data-test="dashboard-addpanel-config-markline-remove-${index}"]`);
  }

}
