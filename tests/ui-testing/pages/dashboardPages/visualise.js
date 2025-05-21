export default class LogsVisualise {
  constructor(page) {
    this.page = page;
    this.timeTab = page.locator('[data-test="date-time-btn"]');
    this.relativeTime = page.locator('[data-test="date-time-relative-tab"]');
    this.indexListDropdown = page.locator('[data-test="log-search-index-list-select-stream"]')
  }
  async openLogs() {
    // Open Logs Page
    await this.page.locator('[data-test="menu-link-\\/logs-item"]').click();
  }

  async openVisualiseTab() {
    // Open Visualise Tab
    await this.page.locator('[data-test="logs-visualize-toggle"]').click();
  }

  //Apply: Logs
  async logsApplyQueryButton() {
    await this.page
      .locator('[data-test="logs-search-bar-refresh-btn"]')
      .click();
  }

  //apply: Visualise
  async applyQueryButtonVisualise() {
    await this.page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .waitFor({ state: "visible" });
    await this.page
      .locator('[data-test="logs-search-bar-visualize-refresh-btn"]')
      .click();
  }
  async setRelative(date, time) {
    await this.timeTab.waitFor({ state: "visible" });
    await this.timeTab.click();
    await this.relativeTime.click();
    await this.page
      .locator(`[data-test="date-time-relative-${date}-${time}-btn"]`)
      .click();
  }

  async searchAndAddField(fieldName, target) {
    console.log(`Adding field: ${fieldName} to: ${target}`);
    const searchInput = this.page.locator(
      '[data-test="index-field-search-input"]'
    );
    await searchInput.waitFor({ state: "visible", timeout: 5000 });
    await searchInput.click();
    await searchInput.fill(fieldName);

    const buttonSelectors = {
      x: "dashboard-add-x-data",
      y: "dashboard-add-y-data",
      b: "dashboard-add-b-data",
      filter: "dashboard-add-filter-data",
      latitude: "dashboard-add-latitude-data",
      longitude: "dashboard-add-longitude-data",
      weight: "dashboard-add-weight-data",
      z: "dashboard-add-z-data",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
    };

    const buttonTestId = buttonSelectors[target];
    if (!buttonTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    const button = this.page.locator(`[data-test="${buttonTestId}"]`);

    // Ensure the button is visible before clicking
    await button.waitFor({ state: "visible", timeout: 5000 });
    console.log(`Clicking button: ${buttonTestId}`);
    await button.click();
    console.log("after click");
  }

  //show query toggle
  async showQueryToggle() {
    await this.page
      .locator('[data-test="logs-search-bar-show-query-toggle-btn"] img')
      .click();
  }

  async enableSQLMode(){
    await this.page.getByRole('switch', { name: 'SQL Mode' }).locator('div').nth(2).click();
  }

  //stram index list
  async streamIndexList() {
    await this.page
      .locator('[data-test="logs-search-index-list"]')
      .getByText("arrow_drop_down")
      .click();
  }
  //logs: Select stream
  async logsSelectStream(stream) {
    await this.page
      .locator('[data-test="log-search-index-list-select-stream"]')
      .click({ force: true });
    await this.page
      .locator("div.q-item")
      .getByText(`${stream}`)
      .first()
      .click();
  }

  //logs toggle
  async logsToggle() {
    await this.page.locator('[data-test="logs-logs-toggle"]').click();
  }

  //select chart type
  async selectChartType(chartType) {
    const chartOption = this.page.locator(
      `[data-test="selected-chart-${chartType}-item"]`
    );
    await chartOption.waitFor({ state: "visible"});
    await chartOption.click();
  }

  //remove field
  async removeField(fieldName, target) {
    console.log(`Removing field: ${fieldName} from: ${target}`);

    const removeSelectors = {
      x: "dashboard-x-item",
      y: "dashboard-y-item",
      b: "dashboard-b-item",
      filter: "dashboard-filter-item",
      latitude: "dashboard-latitude-item",
      longitude: "dashboard-longitude-item",
      weight: "dashboard-weight-item",
      z: "dashboard-z-item",
      name: "dashboard-name-layout",
      value: "dashboard-value_for_maps-layout",
      firstcolumn: "dashboard-x-layout",
      othercolumn: "dashboard-y-layout",
    };

    const baseTestId = removeSelectors[target];
    if (!baseTestId) {
      throw new Error(`Invalid target type: ${target}`);
    }

    const removeButton = this.page.locator(
      `[data-test="${baseTestId}-${fieldName}-remove"]`
    );

    await removeButton.waitFor({ state: "visible", timeout: 5000 });
    await removeButton.click();
    console.log(`Removed field: ${fieldName} from ${target}`);
  }
  //chart render
  async chartRender(x,y) {
    await this.page
      .locator('[data-test="chart-renderer"] canvas')
      .last()
      .click({
        position: {
          x: x,
          y: y,
        },
      });
  }

  //back to logs
  async backToLogs() {
    await this.page.locator('[data-test="logs-logs-toggle"]').click();
    await this.page.locator('[data-test="confirm-button"]').waitFor({ state: "visible" });
    await this.page.locator('[data-test="confirm-button"]').click();
  }
  async openQueryEditior() {
    await this.page.locator('.view-lines').first().click();
  }
  async fillQueryEditor(sqlQuery) {
    const queryEditor = this.page.locator('.view-lines').first();
    await queryEditor.waitFor({ state: "visible", timeout: 5000 });
    await queryEditor.click();
    await queryEditor.type(sqlQuery);
    // await queryEditor.fill(sqlQuery);
}
}
