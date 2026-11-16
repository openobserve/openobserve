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
import { filterKeysToQuery, matchesAnyKey, readFilterKeys, toggleFilterKey } from "./filterKeys";

const KEYS = ["a", "b", "c"] as const;
const isKey = (k: string): k is (typeof KEYS)[number] => (KEYS as readonly string[]).includes(k);

describe("filterKeys", () => {
  it("reads a comma list, a repeated param and a legacy single key, dropping unknowns", () => {
    expect(readFilterKeys("a,c", isKey)).toEqual(["a", "c"]);
    expect(readFilterKeys(["b", "a,x"], isKey)).toEqual(["b", "a"]);
    expect(readFilterKeys("b", isKey)).toEqual(["b"]);
    expect(readFilterKeys(null, isKey)).toEqual([]);
    expect(readFilterKeys(["a", "a"], isKey)).toEqual(["a"]);
  });

  it("writes nothing to the URL while unfiltered", () => {
    expect(filterKeysToQuery([])).toBeUndefined();
    expect(filterKeysToQuery(["a", "b"])).toBe("a,b");
  });

  it("toggles a key and empties the selection from the reset key", () => {
    expect(toggleFilterKey(["a"], "b", "all")).toEqual(["a", "b"]);
    expect(toggleFilterKey(["a", "b"], "a", "all")).toEqual(["b"]);
    expect(toggleFilterKey(["a", "b"], "all", "all")).toEqual([]);
  });

  it("passes every row while nothing is picked, and ORs the picked keys", () => {
    const even = (n: number, k: string) => (k === "even" ? n % 2 === 0 : n > 2);
    expect([1, 2, 3].filter((n) => matchesAnyKey([], n, even))).toEqual([1, 2, 3]);
    expect([1, 2, 3].filter((n) => matchesAnyKey(["even", "big"], n, even))).toEqual([2, 3]);
  });
});
