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
 * Waits until the panel editor has finished (re-)running its query AND the table has
 * stopped re-rendering.
 *
 * `applyDashboardBtn()` only clicks Apply — it returns while the new query is still in
 * flight, so what is on screen is still the PREVIOUS table. Reading it then reads the
 * pre-Apply DOM (cells whose new formatting has not been applied yet); clicking it races
 * the re-render, and that race is silent rather than loud: the panel's time range is
 * relative, so every run buckets `histogram(_timestamp)` afresh and the rows — and the
 * filter dropdown's value list built from them — are rebuilt under the cursor. A click
 * whose mousedown and mouseup land on different elements is delivered to their common
 * ancestor instead, so it hits the <ul> rather than the <li>, no handler runs, and the
 * test simply sees an unchecked box.
 */
export async function waitForPanelTableSettled(
  page,
  { quietMs = 600, timeout = 30000 } = {},
) {
  const applyIsBusy = () => {
    const btn = document.querySelector('[data-test="dashboard-apply"]');
    return !!btn && btn.disabled;
  };

  // Apply is disabled for exactly as long as a search request is in flight
  // (AddPanel.vue: :disabled="searchRequestTraceIds.length > 0"). Catch the query while
  // it is running if we can — but do not insist: a cached panel can answer without
  // issuing a request, and then the button never goes disabled at all.
  await page
    .waitForFunction(applyIsBusy, undefined, { timeout: 3000 })
    .catch(() => {});

  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-test="dashboard-apply"]');
      return !!btn && !btn.disabled;
    },
    undefined,
    { timeout },
  );

  // The rows are painted a tick after the response lands, so "not loading" is not yet
  // "done moving". Wait for the table's shape to hold still.
  const signature = () =>
    page.evaluate((sel) => {
      const rows = document.querySelectorAll(
        `${sel} [data-test="dashboard-data-row"]`,
      );
      const first = rows[0]?.textContent ?? "";
      const last = rows[rows.length - 1]?.textContent ?? "";
      return `${rows.length}|${first}|${last}`;
    }, TABLE_SELECTOR);

  const deadline = Date.now() + timeout;
  let previous = await signature();
  let quietSince = Date.now();

  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const current = await signature();
    if (current !== previous) {
      previous = current;
      quietSince = Date.now();
      continue;
    }
    // "0 rows" is a table that has not rendered yet, not a settled one.
    if (!current.startsWith("0|") && Date.now() - quietSince >= quietMs) return;
  }

  throw new Error(
    `Table did not settle within ${timeout}ms (last signature: ${previous})`,
  );
}

/**
 * Reads one column's text and computed background colour from every data row IN A SINGLE
 * PASS, so a re-render cannot land midway through and hand back a mix of the old table's
 * values and the new table's colours.
 *
 * @param {import('@playwright/test').Page} page
 * @param {number} colIndex - Zero-based column index
 * @param {number} limit    - Maximum number of rows to read
 * @returns {Promise<Array<{text: string, bgColor: string}>>}
 */
export async function readColumnCells(page, colIndex = 0, limit = 10) {
  return page.evaluate(
    ({ sel, ci, max }) => {
      const rows = Array.from(
        document.querySelectorAll(`${sel} [data-test="dashboard-data-row"]`),
      ).slice(0, max);

      return rows
        .map((row) => {
          const cell = row.querySelectorAll("td")[ci];
          if (!cell) return null;
          const valueEl = cell.querySelector(
            '[data-test="dashboard-table-cell-value"]',
          );
          return {
            text: (valueEl?.textContent ?? cell.textContent ?? "").trim(),
            bgColor: getComputedStyle(cell).backgroundColor,
          };
        })
        .filter(Boolean);
    },
    { sel: TABLE_SELECTOR, ci: colIndex, max: limit },
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

/**
 * Panel-scoped column filter actions — take the `panel` locator returned by
 * openColumnFilter() rather than `page`. (getColumnFilterBtn/openColumnFilter are
 * exported standalone above since they're page-scoped, not part of this namespace.)
 */
export const columnFilter = {
  valueItems: getFilterValueItems,
  selectValueByIndex: selectFilterValueByIndex,
  search: searchInFilterPanel,
  clear: clearColumnFilter,
};
