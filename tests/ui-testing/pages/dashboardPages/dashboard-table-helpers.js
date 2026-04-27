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
 * Wait for table headers to be rendered before querying them.
 * @param {import('@playwright/test').Page} page
 * @param {number} [minCount=1] - Minimum number of headers expected
 */
export async function waitForTableHeaders(page, minCount = 1) {
  await page.waitForFunction(
    ({ selector, min }) => {
      const headers = document.querySelectorAll(selector);
      return headers.length >= min;
    },
    { selector: TABLE_HEADER_SELECTOR, min: minCount },
    { timeout: 15000 }
  );
}

/**
 * Extract header texts from the TanStack table thead via $$eval.
 * Strips sort icons (arrow_upward/arrow_downward) and copy button text.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string[]>}
 */
export async function getTableHeaders(page) {
  await waitForTableHeaders(page);
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
