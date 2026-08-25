/**
 * Shared helper functions for dashboard table chart E2E tests.
 * Works with TanStack table (TenstackTable.vue) in dashboard mode.
 */

// Selectors for TanStack table in dashboard mode
export const TABLE_SELECTOR = '[data-test="dashboard-panel-table"]';
export const TABLE_HEADER_SELECTOR = `${TABLE_SELECTOR} thead tr th`;
// TanStack table renders dashboard data rows directly in tbody with class dashboard-data-row
export const TABLE_DATA_ROW_SELECTOR = `${TABLE_SELECTOR} tbody tr.dashboard-data-row`;

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
      // TanStack dashboard mode: rows are directly in tbody with class dashboard-data-row
      const rows = Array.from(table.querySelectorAll("tbody tr.dashboard-data-row"));
      // Fall back to any tbody tr if dashboard-data-row class is not present
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

// ===== Dashboard virtual-scroll row windowing helpers =====
// Dashboard table panels render through TenstackTable with use-virtual-scroll=false,
// which enables "dashboard virtual scroll": only the rows visible in the scroll
// viewport (plus overscan) are in the DOM, with top/bottom spacer rows
// (<tr aria-hidden="true">) reserving the full scroll height. Each data row carries
// data-index = its index in the FULL dataset (not the window position).

// Scroll container is class-based (no dedicated data-test) — reuse the
// dashboard-legends-copy.js pattern (.table-container with .container fallback).
export const TABLE_SCROLL_CONTAINER_SELECTOR = `${TABLE_SELECTOR} .table-container`;
export const TABLE_SCROLL_CONTAINER_FALLBACK_SELECTOR = `${TABLE_SELECTOR} .container`;

// Dashboard data rows carrying a full-dataset index.
export const TABLE_DATA_ROW_INDEX_SELECTOR = `${TABLE_SELECTOR} tbody tr.dashboard-data-row[data-index]`;

// Spacer rows are only identifiable via aria-hidden (no class/data-test).
export const TABLE_SPACER_ROW_SELECTOR = `${TABLE_SELECTOR} tbody tr[aria-hidden="true"]`;

// Row-count footer ("1-N of TOTAL") rendered by TablePaginationControls.
export const TABLE_ROW_COUNT_SELECTOR = `${TABLE_SELECTOR} [data-test="dashboard-table-row-count"]`;

// "Records per page" label — only rendered when showPagination=true.
export const TABLE_ROWS_PER_PAGE_LABEL_SELECTOR = `${TABLE_SELECTOR} [data-test="dashboard-table-rows-per-page-label"]`;

/**
 * Read the full-dataset index (data-index) of every currently-rendered dashboard
 * data row. Under virtual scroll this is a contiguous ascending window
 * [start, start+n); under wrap/pagination it is the full (or paged) row set.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number[]>}
 */
export async function getRenderedRowIndexes(page) {
  return page.$$eval(TABLE_DATA_ROW_INDEX_SELECTOR, (rows) =>
    rows
      .map((r) => parseInt(r.getAttribute("data-index"), 10))
      .filter((n) => !Number.isNaN(n))
  );
}

/**
 * Count spacer rows (tbody tr[aria-hidden="true"]) that reserve scroll height.
 * Under dashboard virtual scroll there is at least one spacer for a large dataset;
 * wrap/pagination/small-dataset render zero spacers.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function getSpacerRowCount(page) {
  return page.locator(TABLE_SPACER_ROW_SELECTOR).count();
}

/**
 * Programmatically scroll the table's internal scroll container to the top or
 * bottom, matching the dashboard-legends-copy.js pattern. Setting scrollTop
 * triggers the row virtualizer's scroll listener, which slides the render window.
 *
 * @param {import('@playwright/test').Page} page
 * @param {'top'|'bottom'} position
 * @returns {Promise<number>} The resulting scrollTop value (0 when no container found)
 */
export async function scrollTableTo(page, position = "bottom") {
  const toBottom = position === "bottom";
  return page.evaluate(
    ({ selector, fallback, toBottom }) => {
      const el =
        document.querySelector(selector) || document.querySelector(fallback);
      if (!el) return 0;
      el.scrollTop = toBottom ? el.scrollHeight : 0;
      return el.scrollTop;
    },
    {
      selector: TABLE_SCROLL_CONTAINER_SELECTOR,
      fallback: TABLE_SCROLL_CONTAINER_FALLBACK_SELECTOR,
      toBottom,
    }
  );
}

/**
 * Read the total dataset row count from the "1-N of TOTAL" footer.
 * Used to bound window assertions without hard-coding the fixture size.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>}
 */
export async function readTotalRowCount(page) {
  const handle = await page.waitForFunction(
    (selector) => {
      const el = document.querySelector(selector);
      if (!el) return 0;
      const match = el.textContent.match(/of\s+([\d,]+)/i);
      return match ? parseInt(match[1].replace(/,/g, ""), 10) : 0;
    },
    TABLE_ROW_COUNT_SELECTOR,
    { timeout: 15000 }
  );
  const value = await handle.jsonValue();
  return typeof value === "number" ? value : 0;
}

/**
 * Wait until the minimum rendered data-index exceeds the given value (the render
 * window has slid down past the previous top). The window re-renders asynchronously
 * via the row virtualizer + ResizeObserver, so poll instead of asserting immediately
 * after scrolling.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} minIndex - Previous minimum data-index to exceed
 * @param {number} [timeout=15000]
 * @returns {Promise<void>}
 */
export async function waitForWindowMinIndexToExceed(page, minIndex, timeout = 15000) {
  await page.waitForFunction(
    ({ selector, min }) => {
      const rows = Array.from(document.querySelectorAll(selector));
      const indexes = rows
        .map((r) => parseInt(r.getAttribute("data-index"), 10))
        .filter((n) => !Number.isNaN(n));
      return indexes.length > 0 && Math.min(...indexes) > min;
    },
    { selector: TABLE_DATA_ROW_INDEX_SELECTOR, min: minIndex },
    { timeout }
  );
}

/**
 * Whether the "Records per page" label is visible in the rendered table footer.
 * Only present when pagination is enabled — a reliable "pagination active" signal.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<boolean>}
 */
export async function isRowsPerPageLabelVisible(page) {
  return page
    .locator(TABLE_ROWS_PER_PAGE_LABEL_SELECTOR)
    .isVisible()
    .catch(() => false);
}
