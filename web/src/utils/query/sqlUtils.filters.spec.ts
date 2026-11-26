// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { describe, expect, it } from "vitest";
import { getFieldsFromQuery } from "./sqlUtils";

// The real SQL parser: logs hands its WHERE clause to dashboards through this path.
const filtersOf = async (where: string) =>
  (await getFieldsFromQuery(`SELECT * FROM "s" WHERE ${where}`)).filters.conditions.map(
    (c: any) => [c.operator, c.column?.field, c.value],
  );

describe("getFieldsFromQuery reading regex and NOT LIKE filters", () => {
  it("reads regexp_like and NOT regexp_like as the regex filters", async () => {
    expect(await filtersOf("regexp_like(level, '^x') AND NOT regexp_like(svc, 'y')")).toEqual([
      ["re_match", "level", "^x"],
      ["re_not_match", "svc", "y"],
    ]);
  });

  it("still reads re_match and re_not_match", async () => {
    expect(await filtersOf("re_match(level, '^x') AND re_not_match(svc, 'y')")).toEqual([
      ["re_match", "level", "^x"],
      ["re_not_match", "svc", "y"],
    ]);
  });

  it("tells NOT LIKE prefix and suffix patterns from not contains", async () => {
    expect(await filtersOf("a NOT LIKE 'v%' AND b NOT LIKE '%v' AND c NOT LIKE '%v%'")).toEqual([
      ["Not Starts With", "a", "v"],
      ["Not Ends With", "b", "v"],
      ["Not Contains", "c", "v"],
    ]);
  });
});
