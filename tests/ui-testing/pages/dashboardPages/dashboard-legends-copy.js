// Dashboard Legends & Table Cell Copy - Page Object
// Methods for Show Legends popup and table cell copy functionality
// PR #9677: feat: dashboard copy legends and table cells

const testLogger = require("../../playwright-tests/utils/test-logger.js");

export default class DashboardLegendsCopy {
  constructor(page) {
    this.page = page;

    // ShowLegendsPopup selectors (VERIFIED from ShowLegendsPopup.vue)
    this.legendsPopup = page.locator('[data-test="dashboard-show-legends-popup"]');
    this.copyAllBtn = page.locator('[data-test="dashboard-show-legends-copy-all"]');
    this.closeBtn = page.locator('[data-test="dashboard-show-legends-close"]');

    // Chart renderer selector (VERIFIED from ChartRenderer.vue - data-test="chart-renderer")
    this.chartRenderer = page.locator('[data-test="chart-renderer"]');

    // Table selectors (VERIFIED from TableRenderer.vue)
    this.dashboardTable = page.locator('[data-test="dashboard-panel-table"]');
  }

  // ===== SHOW LEGENDS POPUP METHODS =====

  /**
   * Get the "Show Legends" button on a panel.
   * Note: The button has no data-test attribute, so we locate it by its icon
   * and the tooltip text within the panel hover toolbar.
   * @param {import('@playwright/test').Page} page - optional page override
   * @returns {import('@playwright/test').Locator}
   */
  getShowLegendsButton() {
    // The button renders icon "format_list_bulleted" as text content via Quasar's q-icon
    return this.page.getByRole('button').filter({ hasText: 'format_list_bulleted' }).first();
  }

  /**
   * Hover over a panel to reveal the toolbar, then click Show Legends.
   * Works both in dashboard view (PanelContainer) and edit panel (AddPanel).
   * @param {string} [panelSelector] - optional panel container selector to hover
   */
  async clickShowLegends(panelSelector) {
    // If a specific panel selector is given, hover over it; otherwise hover over the chart area
    if (panelSelector) {
      await this.page.locator(panelSelector).hover();
    } else {
      // Hover over the chart renderer (data-test="chart-renderer" from ChartRenderer.vue)
      // or the table (data-test="dashboard-panel-table" from TableRenderer.vue)
      const chartArea = this.chartRenderer.or(this.dashboardTable).first();
      await chartArea.hover();
    }

    // Wait for the Show Legends button to appear in hover toolbar
    const legendsBtn = this.getShowLegendsButton();
    await legendsBtn.waitFor({ state: 'visible', timeout: 10000 });
    await legendsBtn.click();

    testLogger.info('Clicked Show Legends button');
  }

  /**
   * Wait for the legends popup to be visible
   */
  async waitForPopupVisible() {
    await this.legendsPopup.waitFor({ state: 'visible', timeout: 10000 });
    testLogger.info('Legends popup is visible');
  }

  /**
   * Get the count of legend items in the popup
   * @returns {Promise<number>}
   */
  async getLegendCount() {
    await this.waitForPopupVisible();
    const items = this.page.locator('[data-test^="dashboard-legend-item-"]');
    const count = await items.count();
    testLogger.info(`Found ${count} legend items`);
    return count;
  }

  /**
   * Get a specific legend item by index
   * @param {number} index - 0-based index
   * @returns {import('@playwright/test').Locator}
   */
  getLegendItem(index) {
    return this.page.locator(`[data-test="dashboard-legend-item-${index}"]`);
  }

  /**
   * Get the text of a legend item
   * @param {number} index - 0-based index
   * @returns {Promise<string>}
   */
  async getLegendText(index) {
    const item = this.getLegendItem(index);
    const text = await item.locator('.legend-text').textContent();
    return text.trim();
  }

  /**
   * Click copy on a specific legend item
   * @param {number} index - 0-based index
   */
  async copyLegend(index) {
    const item = this.getLegendItem(index);
    await item.hover(); // Hover to reveal copy button
    const copyBtn = item.locator('.copy-btn');
    await copyBtn.waitFor({ state: 'visible', timeout: 5000 });
    await copyBtn.click();
    testLogger.info(`Copied legend at index ${index}`);
  }

  /**
   * Click the "Copy all" button
   */
  async clickCopyAll() {
    await this.copyAllBtn.click();
    testLogger.info('Clicked Copy All legends');
  }

  /**
   * Check if the Copy All button shows "Copied" state
   * @returns {Promise<boolean>}
   */
  async isCopyAllInCopiedState() {
    const label = await this.copyAllBtn.textContent();
    return label.includes('Copied');
  }

  /**
   * Close the legends popup
   */
  async closePopup() {
    await this.closeBtn.click();
    await this.legendsPopup.waitFor({ state: 'hidden', timeout: 5000 });
    testLogger.info('Legends popup closed');
  }

  /**
   * Check if the "No legends available" message is shown
   * @returns {Promise<boolean>}
   */
  async isNoLegendsMessageVisible() {
    const noLegendsEl = this.legendsPopup.locator('.no-legends');
    return await noLegendsEl.isVisible();
  }

  /**
   * Get the total legends count text from the popup header
   * @returns {Promise<string>}
   */
  async getTotalLegendsText() {
    const countEl = this.legendsPopup.locator('.legend-count');
    return await countEl.textContent();
  }

  // ===== TABLE CELL COPY METHODS =====

  /**
   * Ensure the table's internal scroll container has data rows visible.
   * q-table with virtual scroll uses position:absolute and overflow:auto,
   * so Playwright's scrollIntoViewIfNeeded may not work for internal scrolling.
   */
  async ensureTableDataVisible() {
    await this.page.evaluate(() => {
      // Scroll the q-table's internal scroll container to top to show first rows
      const scrollContainer = document.querySelector(
        '[data-test="dashboard-panel-table"] .q-table__middle.scroll'
      ) || document.querySelector(
        '[data-test="dashboard-panel-table"] .q-virtual-scroll'
      ) || document.querySelector(
        '.my-sticky-virtscroll-table .q-table__middle'
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = 0;
      }
    });
    // Wait for data cells to be attached after scroll reset
    await this.dashboardTable.locator('td.copy-cell-td').first()
      .waitFor({ state: 'attached', timeout: 10000 });
  }

  /**
   * Get a table cell by row and column index.
   * Filters out virtual scroll spacer rows (which have <td colspan="N">)
   * by only targeting rows that contain .copy-cell-td cells.
   * @param {number} rowIndex - 0-based row index
   * @param {number} colIndex - 0-based column index
   * @returns {import('@playwright/test').Locator}
   */
  getTableCell(rowIndex, colIndex) {
    // q-table virtual scroll adds spacer <tr> with a single <td colspan="N">.
    // Real data rows contain <td class="copy-cell-td" data-col-index="...">
    const dataRows = this.dashboardTable
      .locator('tbody tr')
      .filter({ has: this.page.locator('td.copy-cell-td') });
    return dataRows.nth(rowIndex).locator('td.copy-cell-td').nth(colIndex);
  }

  /**
   * Hover over a table cell to reveal the copy button, then click it
   * @param {number} rowIndex - 0-based row index
   * @param {number} colIndex - 0-based column index
   */
  async copyTableCell(rowIndex, colIndex) {
    await this.ensureTableDataVisible();
    const cell = this.getTableCell(rowIndex, colIndex);

    // Use bounding box to move mouse to exact position (works with absolute-positioned tables)
    const box = await cell.boundingBox();
    if (box) {
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      // Fallback: scroll and hover
      await cell.scrollIntoViewIfNeeded();
      await cell.hover({ force: true });
    }
    // Wait for copy button to become visible (opacity transition from 0 to 1 on hover)
    const copyBtn = cell.locator('.copy-btn');
    await copyBtn.waitFor({ state: 'visible', timeout: 5000 });
    await copyBtn.click({ force: true });

    testLogger.info(`Copied table cell at row ${rowIndex}, col ${colIndex}`);
  }

  /**
   * Check if a table cell copy button shows the "check" (copied) icon
   * @param {number} rowIndex - 0-based row index
   * @param {number} colIndex - 0-based column index
   * @returns {Promise<boolean>}
   */
  async isTableCellCopied(rowIndex, colIndex) {
    const cell = this.getTableCell(rowIndex, colIndex);
    const copyBtn = cell.locator('.copy-btn');
    const icon = await copyBtn.locator('.q-icon').textContent();
    return icon.includes('check');
  }

  /**
   * Get the text content of a table cell (excluding copy button text)
   * @param {number} rowIndex - 0-based row index
   * @param {number} colIndex - 0-based column index
   * @returns {Promise<string>}
   */
  async getTableCellText(rowIndex, colIndex) {
    const cell = this.getTableCell(rowIndex, colIndex);
    // Get the span with the actual text, excluding the copy button
    const textSpan = cell.locator('span.q-mr-xs').or(cell.locator('span').first());
    const text = await textSpan.textContent();
    return text.trim();
  }

  /**
   * Check if a copy button is visible on a hovered table cell
   * @param {number} rowIndex - 0-based row index
   * @param {number} colIndex - 0-based column index
   * @returns {Promise<boolean>}
   */
  async isTableCellCopyButtonVisible(rowIndex, colIndex) {
    await this.ensureTableDataVisible();
    const cell = this.getTableCell(rowIndex, colIndex);
    await cell.waitFor({ state: 'attached', timeout: 15000 });

    // Use bounding box to move mouse to exact position
    const box = await cell.boundingBox();
    if (box) {
      await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    } else {
      await cell.scrollIntoViewIfNeeded();
      await cell.hover({ force: true });
    }
    // Wait briefly for opacity transition, then check visibility
    const copyBtn = cell.locator('.copy-btn');
    try {
      await copyBtn.waitFor({ state: 'visible', timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}
