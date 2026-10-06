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

  describe("metric detail view keys", () => {
    it("owns metric, tab and breakdown_label — and never stream", () => {
      // `stream` is an editor key that redirects /metrics to the editor.
      expect(EXPLORER_FILTER_PARAM_KEYS).toEqual(
        expect.arrayContaining(["metric", "tab", "breakdown_label"]),
      );
      expect(EXPLORER_FILTER_PARAM_KEYS).not.toContain("stream");
    });

    it("round-trips metric, tab and breakdown_label", () => {
      const query = explorerFiltersToQuery({
        ...defaults(),
        metric: "http_requests_total",
        tab: "breakdown",
        breakdownLabel: "route",
      });
      expect(query).toEqual({
        metric: "http_requests_total",
        tab: "breakdown",
        breakdown_label: "route",
      });
      expect(queryToExplorerFilters(query)).toEqual({
        metric: "http_requests_total",
        tab: "breakdown",
        breakdownLabel: "route",
      });
    });

    it("round-trips the used_in tab", () => {
      const query = explorerFiltersToQuery({ ...defaults(), metric: "up", tab: "used_in" });
      expect(query).toEqual({ metric: "up", tab: "used_in" });
      expect(queryToExplorerFilters(query)).toEqual({ metric: "up", tab: "used_in" });
    });

    it("never emits stream, whatever the detail state", () => {
      const query = explorerFiltersToQuery({
        ...defaults(),
        mode: "workspace",
        metric: "node_load1",
        tab: "related",
      });
      expect(query).not.toHaveProperty("stream");
      expect(Object.keys(query).sort()).toEqual(["metric", "mode", "tab"]);
    });

    it("writes tab and breakdown_label only alongside a metric", () => {
      // Without a metric there is no detail view for them to describe.
      expect(
        explorerFiltersToQuery({ ...defaults(), tab: "related", breakdownLabel: "route" }),
      ).toEqual({});
      expect(queryToExplorerFilters({ tab: "related", breakdown_label: "route" })).toEqual({});
    });

    it("round-trips compare, and owns its key", () => {
      expect(EXPLORER_FILTER_PARAM_KEYS).toContain("compare");
      for (const compare of ["1h", "1d", "1w"] as const) {
        const query = explorerFiltersToQuery({ ...defaults(), metric: "up", compare });
        expect(query).toEqual({ metric: "up", compare });
        expect(queryToExplorerFilters(query)).toEqual({ metric: "up", compare });
      }
    });

    it("round-trips forecast and forecast_h, and owns both keys", () => {
      expect(EXPLORER_FILTER_PARAM_KEYS).toEqual(
        expect.arrayContaining(["forecast", "forecast_h"]),
      );
      const query = explorerFiltersToQuery({
        ...defaults(),
        metric: "up",
        forecast: "smoothed",
        forecastHorizon: "6h",
      });
      expect(query).toEqual({ metric: "up", forecast: "smoothed", forecast_h: "6h" });
      expect(queryToExplorerFilters(query)).toEqual({
        metric: "up",
        forecast: "smoothed",
        forecastHorizon: "6h",
      });
    });

    it("rejects other forecast methods and horizons, and both without a metric", () => {
      expect(queryToExplorerFilters({ metric: "up", forecast: "arima", forecast_h: "2h" })).toEqual(
        { metric: "up" },
      );
      expect(
        queryToExplorerFilters({ metric: "up", forecast: "linear", forecast_h: "1mo" }),
      ).toEqual({ metric: "up", forecast: "linear" });
      expect(queryToExplorerFilters({ forecast: "linear", forecast_h: "1h" })).toEqual({});
    });

    it("rejects any compare value outside the three presets, and compare without a metric", () => {
      for (const compare of ["2h", "1mo", "1D", "", "1d,1w"]) {
        expect(queryToExplorerFilters({ metric: "up", compare })).toEqual({ metric: "up" });
      }
      expect(queryToExplorerFilters({ compare: "1d" })).toEqual({});
      expect(explorerFiltersToQuery({ ...defaults(), compare: "1d" })).toEqual({});
    });

    it("drops an unknown tab and a malformed label name", () => {
      expect(
        queryToExplorerFilters({ metric: "up", tab: "bogus", breakdown_label: "1bad" }),
      ).toEqual({ metric: "up" });
    });
  });
});
