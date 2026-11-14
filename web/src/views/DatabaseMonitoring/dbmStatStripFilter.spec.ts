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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const read = (file: string) => readFileSync(join(here, file), "utf8");

// [page, the count tile that means "all rows"]
const PAGES: [string, string][] = [
  ["DatabasesPage.vue", "databases"],
  ["QueriesPage.vue", "queries"],
];

/** The object literal of one summary tile, by its key. */
const tile = (source: string, key: string): string => {
  const at = source.indexOf(`key: "${key}",`);
  expect(at, `summary tile ${key} must exist`).toBeGreaterThan(-1);
  // Each tile ends with its dataTest; a closing brace can come earlier, inside a spread.
  return source.slice(at, source.indexOf("dataTest:", at));
};

describe("the Failed tile filters the list", () => {
  it.each(PAGES)("%s makes its first strip a filter over the rows", (file, allKey) => {
    const source = read(file);
    const strip = source.slice(
      source.indexOf("<OStatStrip"),
      source.indexOf("/>", source.indexOf("<OStatStrip")),
    );
    expect(strip).toContain("selectable");
    expect(strip).toContain(':selected-key="statFilter"');
    expect(strip).toContain(`default-key="${allKey}"`);
    expect(strip).toContain('@select="onStatSelect"');
  });

  it.each(PAGES)("%s keeps the totals out of the filter", (file) => {
    const source = read(file);
    expect(tile(source, "calls")).toContain("selectable: false");
    expect(tile(source, "time")).toContain("selectable: false");
  });

  it.each(PAGES)("%s narrows to rows that failed, and clears with the scope", (file) => {
    const source = read(file);
    expect(source).toContain("(row.errors ?? 0) > 0");
    const clear = source.slice(source.indexOf("const clearScope = () => {"));
    expect(clear.slice(0, clear.indexOf("};"))).toContain("statFilter.value = null");
  });
});
