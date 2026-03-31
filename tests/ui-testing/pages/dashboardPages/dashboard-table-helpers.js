/**
 * Shared helper functions for dashboard table chart E2E tests.
 * Works with Quasar q-table using virtual scroll.
 */

// Selectors for Quasar q-table with virtual scroll
export const TABLE_SELECTOR = '[data-test="dashboard-panel-table"]';
export const TABLE_HEADER_SELECTOR = `${TABLE_SELECTOR} thead tr th`;
// Quasar virtual scroll renders data rows inside .q-virtual-scroll__content, NOT in tbody
export const TABLE_DATA_ROW_SELECTOR = `${TABLE_SELECTOR} .q-virtual-scroll__content tr`;

/**
 * Extract header texts from the Quasar q-table via $$eval.
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
        .replace(/content_copy/g, "")
        .trim()
    )
  );
}

/**
 * Get the text content of a specific table cell.
 * Quasar virtual-scroll q-table renders data in .q-virtual-scroll__content.
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
      const virtualContent = table.querySelector(".q-virtual-scroll__content");
      if (!virtualContent) return "";
      const rows = virtualContent.querySelectorAll("tr");
      const row = rows[ri];
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
