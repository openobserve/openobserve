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

// [page, the Failed Only checkbox test id]
const PAGES: [string, string][] = [
  ["DatabasesPage.vue", "dbm-databases-failed-only"],
  ["QueriesPage.vue", "dbm-queries-failed-only"],
];

describe("the Failed Only checkbox filters the list", () => {
  it.each(PAGES)("%s keeps the strip display-only and filters from the row", (file, testId) => {
    const source = read(file);
    const strip = source.slice(
      source.indexOf("<OStatStrip"),
      source.indexOf("/>", source.indexOf("<OStatStrip")),
    );
    expect(strip).not.toContain("selectable");
    expect(strip).not.toContain("@select");
    expect(source).toContain(`data-test="${testId}"`);
    expect(source).toContain("statFilter = on === true ? 'failed' : null");
  });

  it.each(PAGES)("%s narrows to rows that failed, and clears with the scope", (file) => {
    const source = read(file);
    expect(source).toContain("(row.errors ?? 0) > 0");
    const clear = source.slice(source.indexOf("const clearScope = () => {"));
    expect(clear.slice(0, clear.indexOf("};"))).toContain("statFilter.value = null");
  });
});
