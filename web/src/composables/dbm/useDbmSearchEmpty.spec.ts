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
import { ref } from "vue";

import { useDbmSearchEmpty } from "./useDbmSearchEmpty";

const setup = (query: string, all: number, shown: number) => {
  const search = ref(query);
  const allRows = ref(Array.from({ length: all }, (_, i) => i));
  const rows = ref(Array.from({ length: shown }, (_, i) => i));
  return { search, allRows, rows, hidden: useDbmSearchEmpty(search, allRows, rows) };
};

describe("useDbmSearchEmpty", () => {
  /** The situation it exists to name: rows were fetched, the query hid all of them. */
  it("is true when a query hid every fetched row", () => {
    expect(setup("orders", 12, 0).hidden.value).toBe(true);
  });

  it("is false while any row survives the query", () => {
    expect(setup("orders", 12, 3).hidden.value).toBe(false);
  });

  /**
   * The guard table health was missing. With an empty box, an empty table means
   * the DATA is absent — and this returning true there swallows the
   * not-collecting checklist, telling a reader with no collector to clear a
   * search they never typed.
   */
  it("is false when the box is empty, so the real empty state can speak", () => {
    expect(setup("", 0, 0).hidden.value).toBe(false);
  });

  /** Whitespace is not a query. A box holding two spaces has hidden nothing. */
  it("treats a whitespace-only box as no query at all", () => {
    expect(setup("   ", 12, 0).hidden.value).toBe(false);
  });

  /** Nothing was fetched, so nothing could have been hidden. */
  it("is false when the fetch itself came back empty", () => {
    expect(setup("orders", 0, 0).hidden.value).toBe(false);
  });

  it("re-answers as the box and the rows move", () => {
    const { search, rows, hidden } = setup("orders", 12, 0);
    expect(hidden.value).toBe(true);

    search.value = "";
    expect(hidden.value).toBe(false);

    search.value = "orders";
    rows.value = [1];
    expect(hidden.value).toBe(false);
  });
});
