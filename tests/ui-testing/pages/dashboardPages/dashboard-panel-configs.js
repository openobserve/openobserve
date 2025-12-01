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
      '[data-test="dashboard-addpanel-config-drilldown-add-btn"]'
    );
    this.overrideConfig = page.locator(
      '[data-test="dashboard-addpanel-config-override-config-add-btn"]'
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
    await this.page.getByRole("option", { name: unit }).click();
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
    await this.page.getByRole("option", { name: position }).click();
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

}
