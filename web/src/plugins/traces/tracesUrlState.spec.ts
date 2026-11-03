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
  scope: "all" as const,
  groupBy: "",
  groupsSort: { by: "errors" as const, order: "desc" as const },
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

  it("writes the scope only when it is not All spans", () => {
    expect(encodeTracesListState({ ...defaults(), scope: "root" })).toEqual({ scope: "root" });
    expect(encodeTracesListState({ ...defaults(), scope: "all" })).toEqual({});
  });

  it("writes the Groups view, its key and a non-default sort", () => {
    expect(encodeTracesListState({ ...defaults(), groupBy: "service_name" })).toEqual({
      view: "groups",
      group_by: "service_name",
    });
    expect(
      encodeTracesListState({
        ...defaults(),
        groupBy: "service_name",
        groupsSort: { by: "p95", order: "asc" },
      }),
    ).toEqual({ view: "groups", group_by: "service_name", group_sort: "p95:asc" });
  });

  it("writes no Groups sort while no key is grouped", () => {
    expect(
      encodeTracesListState({ ...defaults(), groupsSort: { by: "p95", order: "asc" } }),
    ).toEqual({});
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
      scope: "entrypoint" as const,
      groupBy: "http.method",
      groupsSort: { by: "error_pct" as const, order: "asc" as const },
    };
    const query = encodeTracesListState(state);
    // Router query values arrive as strings.
    const fromUrl = Object.fromEntries(Object.entries(query).map(([k, v]) => [k, String(v)]));
    expect(decodeTracesListState(fromUrl)).toEqual({
      columns: ["service_name", "http.method", "span_status"],
      rowsPerPage: 100,
      currentPage: 4,
      showHistogram: false,
      scope: "entrypoint",
      groupBy: "http.method",
      groupsSort: { by: "error_pct", order: "asc" },
    });
  });

  it("returns nothing to restore for an old link that carries none of the keys", () => {
    const oldLink = { stream: "default", period: "15m", query: "", tab: "traces" };
    expect(decodeTracesListState(oldLink)).toEqual({
      columns: null,
      rowsPerPage: null,
      currentPage: null,
      showHistogram: null,
      scope: null,
      groupBy: null,
      groupsSort: null,
    });
  });

  it("reads group_by only from a Groups view link", () => {
    expect(decodeTracesListState({ group_by: "service_name" }).groupBy).toBeNull();
    expect(decodeTracesListState({ view: "groups", group_by: "" }).groupBy).toBeNull();
  });

  it("reads group_sort only from a Groups view link, so a later Group by starts on Errors", () => {
    expect(decodeTracesListState({ tab: "spans", group_sort: "p95:asc" }).groupsSort).toBeNull();
    expect(
      decodeTracesListState({ view: "groups", group_by: "service_name", group_sort: "p95:asc" })
        .groupsSort,
    ).toEqual({ by: "p95", order: "asc" });
  });

  it("reads a link without scope as All spans", () => {
    expect(decodeTracesListState({ tab: "spans" }).scope).toBeNull();
  });

  it("reads show_histogram=true written by older links", () => {
    expect(decodeTracesListState({ show_histogram: "true" }).showHistogram).toBe(true);
  });

  it("ignores values a hand-edited link cannot mean", () => {
    expect(
      decodeTracesListState({
        rows: "7",
        page: "0",
        columns: "not-base64!",
        show_histogram: "x",
        scope: "children",
        view: "groups",
        group_by: "service_name",
        group_sort: "duration:asc",
      }),
    ).toEqual({
      columns: null,
      rowsPerPage: null,
      currentPage: null,
      showHistogram: null,
      scope: null,
      groupBy: "service_name",
      groupsSort: null,
    });
  });
});
