/**
 * Shared helper functions for dashboard table chart E2E tests.
 * Works with TanStack table (TenstackTable.vue) in dashboard mode.
 */

// Selectors for TanStack table in dashboard mode
export const TABLE_SELECTOR = '[data-test="dashboard-panel-table"]';
export const TABLE_HEADER_SELECTOR = `${TABLE_SELECTOR} thead tr th`;
// TanStack table renders dashboard data rows directly in tbody with data-test="dashboard-data-row"
export const TABLE_DATA_ROW_SELECTOR = `${TABLE_SELECTOR} [data-test="dashboard-data-row"]`;

/**
 * Extract header texts from the TanStack table thead via $$eval.
 * Strips sort icons (arrow_upward/arrow_downward) and copy button text.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export async function getTableHeaders(page) {
  return page.$$eval(TABLE_HEADER_SELECTOR, (cells) =>
    cells.map((c) =>
      c.textContent
        .trim()
        .replace(/arrow_upward/g, "")
        .replace(/arrow_downward/g, "")
        .replace(/unfold_more/g, "")
        .replace(/content_copy/g, "")
        .trim()
    )
  );
}

/**
 * Get the text content of a specific table cell.
 * TanStack table (dashboard mode) renders data rows directly in tbody with class dashboard-data-row.
 * Each cell: <td class="copy-cell-td"><div>text<button class="copy-btn">...</button></div></td>
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} rowIndex - Zero-based row index
 * @param {number} colIndex - Zero-based column index
 * @returns {Promise<string>}
 */
export async function getTableCellText(page, rowIndex, colIndex) {
  return page.$eval(
    TABLE_SELECTOR,
    (table, { ri, ci }) => {
      // TanStack dashboard mode: rows use data-test="dashboard-data-row"
      const rows = Array.from(table.querySelectorAll('[data-test="dashboard-data-row"]'));
      // Fall back to any tbody tr if data-test is not present
      const allRows = rows.length > 0 ? rows : Array.from(table.querySelectorAll("tbody tr")).filter((r) => r.querySelectorAll("td").length >= 1);
      const row = allRows[ri];
      if (!row) return "";
      const cell = row.querySelectorAll("td")[ci];
      if (!cell) return "";
      // Clone and strip copy buttons
      const clone = cell.cloneNode(true);
      clone.querySelectorAll("button, .copy-btn").forEach((b) => b.remove());
      return clone.textContent.trim().replace(/content_copy/g, "").trim();
    },
    { ri: rowIndex, ci: colIndex }
  );
}

/**
 * Column filtering helpers (TenstackTable.vue, gated by enableColumnFilter prop
 * <- config.table_filtering). Filter button/panel data-test attrs are keyed by
 * `header.column.id`, which is dynamic per stream, so these target by column
 * index (nth) rather than by name.
 */

/** Locator for the filter icon button of the nth column header (0-based). */
export function getColumnFilterBtn(page, nth = 0) {
  return page.locator('[data-test^="o2-table-column-filter-btn-"]').nth(nth);
}

/** Opens the filter dropdown for the nth column header and waits for the panel. */
export async function openColumnFilter(page, nth = 0) {
  const btn = getColumnFilterBtn(page, nth);
  await btn.waitFor({ state: "visible", timeout: 10000 });
  await btn.click();
  const panel = page.locator('[data-test^="o2-table-column-filter-panel-"]').first();
  await panel.waitFor({ state: "visible", timeout: 5000 });
  return panel;
}

/** Returns the value <li> items (including the "no matches" placeholder, if shown) in an open filter panel. */
function getFilterValueItems(panel) {
  return panel.locator('ul[role="listbox"] li');
}

/** Checks the value at itemIdx (0-based) in an open filter panel. */
async function selectFilterValueByIndex(panel, itemIdx = 0) {
  const item = getFilterValueItems(panel).nth(itemIdx);
  await item.waitFor({ state: "visible", timeout: 5000 });
  await item.click();
}

/** Types into the filter panel's search box to narrow the value list. */
async function searchInFilterPanel(panel, text) {
  const searchInput = panel.locator("input").first();
  await searchInput.fill(text);
}

/** Clicks "Clear filter" in an open filter panel. */
async function clearColumnFilter(panel) {
  await panel.getByText("Clear filter", { exact: false }).click();
}

export const columnFilter = {
  getBtn: getColumnFilterBtn,
  open: openColumnFilter,
  valueItems: getFilterValueItems,
  selectValueByIndex: selectFilterValueByIndex,
  search: searchInFilterPanel,
  clear: clearColumnFilter,
};
