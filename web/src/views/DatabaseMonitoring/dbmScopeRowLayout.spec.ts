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
 * Search and the scope selects share ONE `DbmFilterBar` above the table, on every
 * list tab.
 *
 * The bar sits above the table rather than inside its toolbar so it survives the
 * two tabs (Top queries, Slowest calls) whose client table is `v-if`-ed away in
 * fallback mode: a control that unmounts while the load keeps applying the scope
 * is the defect `dbmFallbackScopeVisible.spec.ts` pins.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

/** The template half of an SFC, so imports and computeds cannot satisfy a `toContain`. */
const templateOf = (source: string): string => {
  const end = source.indexOf("<script setup");
  expect(end, "SFC must have a <script setup> block").toBeGreaterThan(-1);
  return source.slice(0, end);
};

const PAGES = [
  "DatabasesPage.vue",
  "ActivityPage.vue",
  "DeadlocksPage.vue",
  "BlockedQueriesPage.vue",
  "TableHealthPage.vue",
  "QueriesPage.vue",
  "SamplesPage.vue",
] as const;

describe("every list tab filters from one bar above its table", () => {
  it.each(PAGES)("%s renders exactly one filter bar", (page) => {
    const template = templateOf(read(page));
    expect(template.match(/<DbmFilterBar\b/g) ?? []).toHaveLength(1);
    expect(template).not.toContain("<DbmScopeFilters");
  });

  it.each(PAGES)("%s puts the bar before its first table", (page) => {
    const template = templateOf(read(page));
    const barAt = template.indexOf("<DbmFilterBar");
    const tableAt = template.indexOf("<OTable");
    expect(barAt).toBeGreaterThan(-1);
    expect(barAt, "the bar must precede the table that can unmount").toBeLessThan(tableAt);
  });

  it.each(PAGES)("%s carries its search box in the bar, not a table toolbar", (page) => {
    const template = templateOf(read(page));
    expect(template).toMatch(/search-data-test="dbm-[a-z-]+-search"/);
    expect(template).not.toContain("<DbmTableToolbar");
    expect(template).not.toContain("<OSearchInput");
  });
});
