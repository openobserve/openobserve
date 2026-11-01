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

import { describe, expect, it } from "vitest";
import { resolveTooltipSort, sortTooltipParams } from "./tooltipSort";

const rows = () => [
  { name: "a", v: 5 },
  { name: "gap", v: null },
  { name: "b", v: -2 },
  { name: "c", v: 9 },
];
const order = (sort?: string) =>
  sortTooltipParams(rows(), sort ? { tooltip_sort: sort } : {}, (r) => r.v).map((r) => r.name);

describe("tooltipSort", () => {
  it("defaults to largest first when the key is absent or unknown", () => {
    expect(resolveTooltipSort({})).toBe("desc");
    expect(resolveTooltipSort({ tooltip_sort: "bogus" })).toBe("desc");
    expect(order()).toEqual(["c", "a", "b", "gap"]);
  });

  it("keeps rows without a value last in both directions", () => {
    expect(order("asc")).toEqual(["b", "a", "c", "gap"]);
    expect(order("desc")).toEqual(["c", "a", "b", "gap"]);
  });

  it("leaves the series order alone when unsorted", () => {
    expect(order("none")).toEqual(["a", "gap", "b", "c"]);
  });
});
