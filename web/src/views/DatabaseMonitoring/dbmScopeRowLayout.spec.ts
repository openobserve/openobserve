// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

/**
 * Search and the scope filters share ONE row, on every list tab.
 *
 * Overview already did this — `DbmScopeFilters` inside `DbmTableToolbar`'s
 * default slot, in the table's `#toolbar` — while five sibling tabs stacked a
 * filter strip above a table whose toolbar held the search box. Two bands of
 * chrome doing one band's work, on a budget that allows ~5rem of discretionary
 * space above the first data row in total (see
 * skills/ui-architect/references/layout-proportions.md).
 *
 * There are TWO correct shapes here, and which one a page gets is decided by a
 * single property: whether its table can unmount.
 *
 *  • Four tabs (Activity, Deadlocks, Blocked queries, Table health) render one
 *    table that is always mounted. They adopt Overview's shape exactly — the
 *    filter goes into the toolbar beside search.
 *
 *  • Top queries and Slowest calls render TWO tables and `v-if` the client one
 *    away in fallback mode. A control inside that table's toolbar unmounts with
 *    it while the load keeps applying the scope — the shipped defect
 *    `dbmFallbackScopeVisible.spec.ts` pins, where a database-reported list was
 *    silently narrowed to an instance with no chip saying so and no way to
 *    clear it. So on those two the row stays ABOVE both tables, and the search
 *    box moves UP into it instead.
 *
 * Both shapes give the reader one row. Neither puts a filter somewhere it can
 * disappear from.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/**
 * The template half of an SFC. The script holds component names in imports and
 * strings in computeds, which would satisfy a naive `toContain` and let the
 * real regression through — the same reason `dbmFallbackScopeVisible` does this.
 */
const templateOf = (source: string): string => {
  const end = source.indexOf("<script setup");
  expect(end, "SFC must have a <script setup> block").toBeGreaterThan(-1);
  return source.slice(0, end);
};

/** The slice of template inside the FIRST `#toolbar` slot. */
const firstToolbar = (template: string): string => {
  const start = template.indexOf("<template #toolbar>");
  if (start === -1) return "";
  return template.slice(start, template.indexOf("</template>", start));
};

/** Tabs whose single table is always mounted: filter belongs in the toolbar. */
const TOOLBAR_PAGES = [
  "DatabasesPage.vue",
  "ActivityPage.vue",
  "DeadlocksPage.vue",
  "BlockedQueriesPage.vue",
  "TableHealthPage.vue",
] as const;

/** Tabs with a table that unmounts: the row must stay above it. */
const FALLBACK_PAGES = ["QueriesPage.vue", "SamplesPage.vue"] as const;

describe("a tab with one always-mounted table filters from its toolbar", () => {
  it.each(TOOLBAR_PAGES)("%s puts the scope filter beside search in the toolbar", (page) => {
    const toolbar = firstToolbar(templateOf(read(page)));
    expect(toolbar, `${page} must render a toolbar`).not.toBe("");
    expect(toolbar, `${page} must filter from the toolbar row`).toContain("<DbmScopeFilters");
  });

  it.each(TOOLBAR_PAGES)("%s keeps no separate filter strip above the table", (page) => {
    const template = templateOf(read(page));
    const occurrences = template.match(/<DbmScopeFilters\b/g) ?? [];
    // Exactly one, and it is the one inside the toolbar asserted above — so
    // there is no second strip left stacked above the table.
    expect(occurrences, `${page} must render exactly one scope control`).toHaveLength(1);
  });
});

describe("a tab whose table unmounts keeps the row above it", () => {
  it.each(FALLBACK_PAGES)("%s renders the scope control outside both tables", (page) => {
    const template = templateOf(read(page));
    const filterAt = template.indexOf("<DbmScopeFilters");
    const tableAt = template.indexOf('<OTable\n        v-if="!serverListShown"');
    expect(tableAt, `${page} must still gate its client table`).toBeGreaterThan(-1);
    expect(filterAt).toBeGreaterThan(-1);
    expect(filterAt, "the scope control must precede the v-if-ed table").toBeLessThan(tableAt);
  });

  it.each(FALLBACK_PAGES)("%s carries its search box on that same row", (page) => {
    const template = templateOf(read(page));
    const rowStart = template.indexOf("<DbmScopeFilters");
    const tableAt = template.indexOf('<OTable\n        v-if="!serverListShown"');
    const row = template.slice(0, tableAt);
    expect(rowStart).toBeGreaterThan(-1);
    // The search input lives above the table, on the scope row — not down in a
    // toolbar slot that the fallback can unmount.
    expect(row, `${page} must lift its search onto the scope row`).toContain("<OSearchInput");
  });

  it.each(FALLBACK_PAGES)("%s no longer duplicates search in a table toolbar", (page) => {
    const template = templateOf(read(page));
    expect(
      template,
      `${page} still has a DbmTableToolbar — search moved onto the scope row`,
    ).not.toContain("<DbmTableToolbar");
  });
});
