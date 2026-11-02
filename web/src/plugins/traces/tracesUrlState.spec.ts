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
import { decodeTracesListState, encodeTracesListState } from "./tracesUrlState";

const DEFAULT_COLUMNS = ["service_name", "operation_name", "duration"];

const defaults = () => ({
  columns: [...DEFAULT_COLUMNS],
  defaultColumns: DEFAULT_COLUMNS,
  rowsPerPage: 25,
  currentPage: 0,
  showHistogram: true,
});

describe("encodeTracesListState", () => {
  it("writes no key while every value is the default", () => {
    expect(encodeTracesListState(defaults())).toEqual({});
  });

  it("writes no columns before any column list is loaded", () => {
    expect(encodeTracesListState({ ...defaults(), columns: [] })).toEqual({});
  });

  it("writes only the keys that differ from the default", () => {
    const query = encodeTracesListState({ ...defaults(), rowsPerPage: 50, showHistogram: false });
    expect(query).toEqual({ rows: 50, show_histogram: false });
  });

  it("writes the 1-based page only past the first page", () => {
    expect(encodeTracesListState({ ...defaults(), currentPage: 2 })).toEqual({ page: 3 });
  });

  it("treats a reordered column list as a change", () => {
    const query = encodeTracesListState({
      ...defaults(),
      columns: ["duration", "service_name", "operation_name"],
    });
    expect(Object.keys(query)).toEqual(["columns"]);
  });
});

describe("decodeTracesListState", () => {
  it("round-trips every non-default value", () => {
    const state = {
      ...defaults(),
      columns: ["service_name", "http.method", "span_status"],
      rowsPerPage: 100,
      currentPage: 4,
      showHistogram: false,
    };
    const query = encodeTracesListState(state);
    // Router query values arrive as strings.
    const fromUrl = Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)]));
    expect(decodeTracesListState(fromUrl)).toEqual({
      columns: ["service_name", "http.method", "span_status"],
      rowsPerPage: 100,
      currentPage: 4,
      showHistogram: false,
    });
  });

  it("returns nothing to restore for an old link that carries none of the keys", () => {
    const oldLink = { stream: "default", period: "15m", query: "", tab: "traces" };
    expect(decodeTracesListState(oldLink)).toEqual({
      columns: null,
      rowsPerPage: null,
      currentPage: null,
      showHistogram: null,
    });
  });

  it("reads show_histogram=true written by older links", () => {
    expect(decodeTracesListState({ show_histogram: "true" }).showHistogram).toBe(true);
  });

  it("ignores values a hand-edited link cannot mean", () => {
    expect(
      decodeTracesListState({ rows: "7", page: "0", columns: "not-base64!", show_histogram: "x" }),
    ).toEqual({ columns: null, rowsPerPage: null, currentPage: null, showHistogram: null });
  });
});
