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

import { describe, it, expect } from "vitest";
import { sortSavedViews } from "./savedViewsSort";

const v = (id: string, name: string) => ({ view_id: id, view_name: name });

describe("sortSavedViews (saved-views quick dropdown ordering)", () => {
  it("sorts alphabetically, case-insensitively, when nothing is favorited", () => {
    const out = sortSavedViews(
      [v("1", "zebra"), v("2", "Apple"), v("3", "mango")],
      [],
    );
    expect(out.map((x) => x.view_name)).toEqual(["Apple", "mango", "zebra"]);
  });

  it("floats favorited views to the top, each group alphabetical", () => {
    const out = sortSavedViews(
      [v("1", "zebra"), v("2", "apple"), v("3", "mango"), v("4", "kiwi")],
      ["3", "1"],
    );
    expect(out.map((x) => x.view_id)).toEqual(["3", "1", "2", "4"]);
    // Favorites: mango < zebra; rest: apple < kiwi.
    expect(out.map((x) => x.view_name)).toEqual([
      "mango",
      "zebra",
      "apple",
      "kiwi",
    ]);
  });

  it("does not mutate the input array", () => {
    const input = [v("1", "b"), v("2", "a")];
    const snapshot = [...input];
    sortSavedViews(input, []);
    expect(input).toEqual(snapshot);
  });

  it("tolerates null/undefined input", () => {
    expect(sortSavedViews(null, ["1"])).toEqual([]);
    expect(sortSavedViews(undefined, [])).toEqual([]);
  });

  it("ignores favorite ids that no longer exist in the list", () => {
    const out = sortSavedViews([v("1", "b"), v("2", "a")], ["gone"]);
    expect(out.map((x) => x.view_id)).toEqual(["2", "1"]);
  });
});
