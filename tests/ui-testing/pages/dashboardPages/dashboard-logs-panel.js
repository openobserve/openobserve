// Logs panel page object: the log list a "logs" dashboard panel renders (LogsPanelRenderer.vue).
// Reads rows, columns, the severity rail, expanded JSON and the list's scroll position.

import { expect } from "@playwright/test";

export default class DashboardLogsPanel {
  constructor(page) {
    this.page = page;
    this.panel = page.locator('[data-test="dashboard-logs-panel"]');
    this.table = page.locator('[data-test="dashboard-logs-panel-table"]');
    this.headerCells = this.table.locator("thead th");
    this.rows = this.table.locator('tbody tr[data-test^="o2-table-row-"]');
    this.jsonPreviews = page.locator('[data-test="dashboard-logs-panel-json"]');
    this.jsonCopyButton = page.locator('[data-test="logs-json-preview-copy-btn"]');
    this.noData = page.locator('[data-test="no-data"]');
    // Selectors used inside evaluate() calls, kept here with the locators.
    this.cellTestIdPrefix = "dashboard-logs-panel-cell-";
    this.rowTestIdPrefix = "o2-table-row-";
    // Elements an XSS payload in a log line would create if it were rendered as HTML.
    this.injectedElementsSelector = [
      '[data-test="dashboard-logs-panel"] img[src="x"]',
      '[data-test="dashboard-logs-panel"] svg[onload]',
      '[data-test="dashboard-logs-panel"] script',
    ].join(", ");
  }

  /** op "read" returns {scrollTop, maxScrollTop} of the list's scroller; "top" first scrolls it to the first row. */
  async _scroller(op) {
    return this.table.evaluate((table, op) => {
      const scroller = [...table.querySelectorAll("*")].find(
        (el) => el.scrollHeight > el.clientHeight + 5 && /auto|scroll/.test(getComputedStyle(el).overflowY)
      );
      if (scroller && op === "top") scroller.scrollTop = 0;
      return scroller
        ? { scrollTop: Math.round(scroller.scrollTop), maxScrollTop: scroller.scrollHeight - scroller.clientHeight }
        : { scrollTop: 0, maxScrollTop: 0 };
    }, op);
  }

  /** Cells of one column, e.g. "message" or "_timestamp". */
  cells(columnId) {
    return this.table.locator(`[data-test="${this.cellTestIdPrefix}${columnId}"]`);
  }

  /** A rendered row whose text contains `text`. */
  rowWithText(text) {
    return this.rows.filter({ hasText: text }).first();
  }

  /** Wait until the list shows at least `minRows` rows. */
  async waitForRows(minRows = 1, timeout = 30000) {
    await this.table.waitFor({ state: "visible", timeout });
    await expect
      .poll(async () => this.rows.count(), { timeout, message: `logs panel never showed ${minRows} row(s)` })
      .toBeGreaterThanOrEqual(minRows);
  }

  /** Visible header labels, without the empty expand-button column. */
  async getHeaderLabels() {
    const labels = await this.headerCells.allInnerTexts();
    return labels.map((label) => label.trim()).filter(Boolean);
  }

  // Rendered rows in data order, each with its index, cell texts by column id and rail colour.
  // The table is virtual, so only rows near the viewport exist.
  async getRenderedRows() {
    return this.rows.evaluateAll(
      (trs, { cellPrefix, rowPrefix }) =>
        trs
          .map((tr) => {
            const cells = {};
            tr.querySelectorAll(`[data-test^="${cellPrefix}"]`).forEach((cell) => {
              cells[cell.getAttribute("data-test").replace(cellPrefix, "")] = cell.textContent.trim();
            });
            return {
              index: Number(tr.getAttribute("data-test").replace(rowPrefix, "")),
              cells,
              rail: tr.style.getPropertyValue("--row-status-color") || null,
            };
          })
          .sort((a, b) => a.index - b.index),
      { cellPrefix: this.cellTestIdPrefix, rowPrefix: this.rowTestIdPrefix }
    );
  }

  /** Message-column texts of the rendered rows, in data order. */
  async getMessages(columnId = "message") {
    return (await this.getRenderedRows()).map((row) => row.cells[columnId]);
  }

  /** Severity rail of the row whose message contains `text`: the level name, or "none" for no rail. */
  async getRailLevel(text) {
    const rail = await this.rowWithText(text).evaluate((tr) => tr.style.getPropertyValue("--row-status-color"));
    if (!rail || rail === "transparent") return "none";
    return rail.replace("var(--color-log-severity-", "").replace("-indicator)", "");
  }

  /** Height in px of the row whose message contains `text`. */
  async getRowHeight(text) {
    return this.rowWithText(text).evaluate((tr) => tr.getBoundingClientRect().height);
  }

  // Open the row's JSON preview. The panel closes open rows whenever its result reloads,
  // so the click is retried until the preview stays open.
  async openRow(text) {
    await expect(async () => {
      if ((await this.jsonPreviews.count()) === 0) await this.rowWithText(text).click();
      await expect(this.jsonPreviews).toHaveCount(1, { timeout: 2000 });
    }).toPass({ timeout: 20000, intervals: [300, 700, 1500] });
  }

  /** Click the open row whose message contains `text` again and wait until no JSON preview is left. */
  async closeRow(text) {
    await expect(async () => {
      if ((await this.jsonPreviews.count()) > 0) await this.rowWithText(text).click();
      await expect(this.jsonPreviews).toHaveCount(0, { timeout: 2000 });
    }).toPass({ timeout: 20000, intervals: [300, 700, 1500] });
  }

  /** Text of every open JSON preview. */
  async getExpandedJsonTexts() {
    return this.jsonPreviews.allInnerTexts();
  }

  /** Scroll position of the list: {scrollTop, maxScrollTop}. */
  async getScrollState() {
    return this._scroller("read");
  }

  /** Scroll the list back to its first row, so reads start from the top. */
  async scrollToTop() {
    await expect.poll(async () => (await this._scroller("top")).scrollTop).toBe(0);
  }

  /** Elements an XSS payload in a log line would have created inside the list or its JSON previews. */
  async countInjectedElements() {
    return this.page.evaluate((selector) => document.querySelectorAll(selector).length, this.injectedElementsSelector);
  }
}
