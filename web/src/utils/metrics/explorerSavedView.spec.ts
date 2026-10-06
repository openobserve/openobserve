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
import { buildExplorerViewData, explorerViewToQuery } from "./explorerSavedView";
import { explorerFiltersToQuery, queryToExplorerFilters } from "./explorerUrlState";

describe("explorer saved views", () => {
  const gridQuery = explorerFiltersToQuery({
    searchTerm: "http",
    selectedPrefixes: new Set(["node"]),
    selectedSuffixes: new Set(),
    selectedTypes: new Set(["counter"]),
    labelFilters: [
      { label: "job", operator: "=", value: "api" },
      { label: "code", operator: "=~", value: "5.." },
    ],
    showFavoritesOnly: false,
    hideEmptyPanels: false,
    sortBy: "z-a",
    viewMode: "rows",
    mode: "workspace",
    metric: "http_requests_total",
    tab: "breakdown",
    breakdownLabel: "job",
  });

  it("round-trips the grid state and time range through the saved payload", () => {
    const data = buildExplorerViewData({ ...gridQuery, period: "1h" });
    const restored = explorerViewToQuery(JSON.parse(JSON.stringify(data)));

    expect(data.version).toBe(1);
    const f = queryToExplorerFilters(restored ?? {});
    expect(f.searchTerm).toBe("http");
    expect([...(f.selectedPrefixes ?? [])]).toEqual(["node"]);
    expect([...(f.selectedTypes ?? [])]).toEqual(["counter"]);
    expect(f.labelFilters).toEqual([
      { label: "job", operator: "=", value: "api" },
      { label: "code", operator: "=~", value: "5.." },
    ]);
    expect(f.sortBy).toBe("z-a");
    expect(f.hideEmptyPanels).toBe(false);
    expect(f.viewMode).toBe("rows");
    expect(f.mode).toBe("workspace");
    expect(restored?.period).toBe("1h");
  });

  it("never saves the detail view keys, the refresh interval or anything unknown", () => {
    const data = buildExplorerViewData({
      ...gridQuery,
      refresh: "30s",
      metrics_data: "blob",
      fn_overrides: "x",
      org_identifier: "o1",
    });

    expect(Object.keys(data.state).sort()).toEqual(
      ["labels", "mode", "prefix", "search", "show_empty", "sort", "type", "view"].sort(),
    );
  });

  it("keeps an absolute range as strings", () => {
    const data = buildExplorerViewData({ from: 1700000000000000, to: 1700000360000000 });
    expect(data.state).toEqual({ from: "1700000000000000", to: "1700000360000000" });
  });

  it("does not save the Visualize mode", () => {
    expect(buildExplorerViewData({ mode: "visualize" }).state).toEqual({});
  });

  it("applies only allow-listed keys, even from a hand-edited payload", () => {
    const query = explorerViewToQuery({
      version: 1,
      state: {
        sort: "z-a",
        metric: "up",
        tab: "related",
        breakdown_label: "job",
        compare: "1d",
        stream: "x",
      },
    });
    expect(query).toEqual({ sort: "z-a" });
  });

  it("rejects a payload of another version or shape", () => {
    expect(explorerViewToQuery({ version: 2, state: { sort: "z-a" } })).toBeNull();
    expect(explorerViewToQuery(null)).toBeNull();
    expect(explorerViewToQuery({ version: 1 })).toBeNull();
  });
});
