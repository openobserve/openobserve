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
import {
  EXPLORER_FILTER_PARAM_KEYS,
  explorerFiltersToQuery,
  queryToExplorerFilters,
  type ExplorerFilterState,
} from "./explorerUrlState";
import { METRICS_EDITOR_PARAM_KEYS } from "./metricsEditorParams";

const defaults = (): ExplorerFilterState => ({
  searchTerm: "",
  selectedPrefixes: new Set(),
  selectedSuffixes: new Set(),
  selectedTypes: new Set(),
  labelFilters: [],
  showFavoritesOnly: false,
  hideEmptyPanels: true,
  sortBy: "a-z",
  viewMode: "grid",
  mode: "explore",
});

describe("explorerUrlState", () => {
  it("never uses a key that redirects /metrics to the editor", () => {
    for (const key of EXPLORER_FILTER_PARAM_KEYS) {
      expect(METRICS_EDITOR_PARAM_KEYS).not.toContain(key);
    }
  });

  it("serializes defaults to an empty query", () => {
    expect(explorerFiltersToQuery(defaults())).toEqual({});
  });

  it("round-trips a fully filtered state", () => {
    const state: ExplorerFilterState = {
      searchTerm: "rq_time",
      selectedPrefixes: new Set(["envoy_cluster", "node_memory"]),
      selectedSuffixes: new Set(["total"]),
      selectedTypes: new Set(["counter", "gauge"]),
      labelFilters: [
        { label: "code", operator: "=~", value: "5.." },
        { label: "pod", value: "api-1,canary" },
      ],
      showFavoritesOnly: true,
      hideEmptyPanels: false,
      sortBy: "z-a",
      viewMode: "rows",
      mode: "visualize",
    };

    const query = explorerFiltersToQuery(state);
    // PromQL matcher form: readable in the URL, one param per filter.
    expect(query.labels).toEqual(["code=~5..", "pod=api-1,canary"]);

    const restored = queryToExplorerFilters(query);

    expect(restored.searchTerm).toBe("rq_time");
    expect(restored.selectedPrefixes).toEqual(state.selectedPrefixes);
    expect(restored.selectedSuffixes).toEqual(state.selectedSuffixes);
    expect(restored.selectedTypes).toEqual(state.selectedTypes);
    // Missing operator normalizes to "=", and a comma inside a matcher value survives.
    expect(restored.labelFilters).toEqual([
      { label: "code", operator: "=~", value: "5.." },
      { label: "pod", operator: "=", value: "api-1,canary" },
    ]);
    // showFavoritesOnly is no longer URL-serialized — the mode drives it — so it
    // does not round-trip (stays undefined on restore).
    expect(restored.showFavoritesOnly).toBeUndefined();
    expect(restored.hideEmptyPanels).toBe(false);
    expect(restored.sortBy).toBe("z-a");
    expect(restored.viewMode).toBe("rows");
    expect(restored.mode).toBe("visualize");
  });

  it("omits mode from the URL in the default Explore mode, restores Visualize", () => {
    // Explore is the landing default, so it serializes to nothing (bare URL);
    // only Visualize writes `?mode=visualize`.
    expect(explorerFiltersToQuery(defaults()).mode).toBeUndefined();
    expect(explorerFiltersToQuery({ ...defaults(), mode: "visualize" }).mode).toBe("visualize");
    expect(queryToExplorerFilters({ mode: "visualize" }).mode).toBe("visualize");
    // An unknown/absent mode leaves it undefined (caller keeps the default).
    expect(queryToExplorerFilters({}).mode).toBeUndefined();
    expect(queryToExplorerFilters({ mode: "bogus" }).mode).toBeUndefined();
  });

  it("serializes set params sorted for a stable URL", () => {
    const a = explorerFiltersToQuery({
      ...defaults(),
      selectedPrefixes: new Set(["b", "a"]),
    });
    const b = explorerFiltersToQuery({
      ...defaults(),
      selectedPrefixes: new Set(["a", "b"]),
    });
    expect(a.prefix).toBe("a,b");
    expect(a).toEqual(b);
  });

  it("parses only what is present, leaving the rest undefined", () => {
    const out = queryToExplorerFilters({ search: "up", org_identifier: "x" });
    expect(out).toEqual({ searchTerm: "up" });
  });

  it("drops unknown type ids", () => {
    const out = queryToExplorerFilters({ type: "counter,bogus" });
    expect(out.selectedTypes).toEqual(new Set(["counter"]));
  });

  it("parses a single labels param the router did not wrap in an array", () => {
    const out = queryToExplorerFilters({ labels: "code!=503" });
    expect(out.labelFilters).toEqual([{ label: "code", operator: "!=", value: "503" }]);
  });

  it("takes the FIRST operator, so a value containing one survives", () => {
    const out = queryToExplorerFilters({ labels: "query=a=b" });
    expect(out.labelFilters).toEqual([{ label: "query", operator: "=", value: "a=b" }]);
  });

  it("drops malformed matchers, keeping the valid ones", () => {
    const out = queryToExplorerFilters({
      labels: ["no operator", "1starts_with_digit=x", "pod=api"],
    });
    expect(out.labelFilters).toEqual([{ label: "pod", operator: "=", value: "api" }]);
  });

  it("ignores non-literal boolean and enum values", () => {
    const out = queryToExplorerFilters({
      favorites: "1",
      show_empty: "yes",
      sort: "recent",
      view: "cards",
    });
    expect(out).toEqual({});
  });
});
