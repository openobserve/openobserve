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
import {
  emptySeriesOverrideDraft,
  getLegendSeriesNames,
  getSeriesOverrideEntries,
  isSeriesOverrideEntry,
  parseDecimals,
  serializeSeriesOverride,
  serializeSeriesOverrides,
  seriesPatternError,
  toSeriesOverrideDraft,
  withoutHiddenQueries,
  withSeriesOverrideEntries,
} from "./useSeriesFormatting";

const steps = { mode: "absolute", steps: [{ value: 500, color: "#f59e0b" }] } as const;

const entry = (value: string, config: any[], matchBy = "series") => ({
  field: { matchBy, value },
  config,
});

describe("toSeriesOverrideDraft / serializeSeriesOverride", () => {
  it("round-trips a full stored entry in the override_config shape", () => {
    const stored = entry(
      "^api-",
      [
        { type: "unit", value: { unit: "custom", customUnit: "req" } },
        { type: "decimals", value: 0 },
        { type: "display_name", value: "API" },
        { type: "series_color", value: "#ef4444" },
        { type: "thresholds", value: steps },
      ],
      "series_regex",
    );
    expect(serializeSeriesOverride(toSeriesOverrideDraft(stored))).toEqual(stored);
  });

  it("copies thresholds so editing the draft leaves the stored entry alone", () => {
    const stored = entry("a", [
      { type: "thresholds", value: { steps: [{ value: 1, color: "#000" }] } },
    ]);
    const draft = toSeriesOverrideDraft(stored);
    draft.thresholds!.steps![0].value = 99;
    expect((stored.config[0].value as any).steps[0].value).toBe(1);
  });

  it("writes only the settings that are set", () => {
    const draft = {
      ...emptySeriesOverrideDraft("name", "cart"),
      displayName: "   ",
      unit: "bytes",
      unitCustom: "ignored unless custom",
      decimals: "",
      thresholds: { mode: "absolute" as const, steps: [] },
    };
    expect(serializeSeriesOverride(draft)).toEqual(
      entry("cart", [{ type: "unit", value: { unit: "bytes", customUnit: "" } }]),
    );
  });

  it("drops an override that matches nothing or sets nothing", () => {
    expect(serializeSeriesOverride(emptySeriesOverrideDraft("regex"))).toBeNull();
    expect(serializeSeriesOverride(emptySeriesOverrideDraft("name", "a"))).toBeNull();
    expect(
      serializeSeriesOverrides([
        emptySeriesOverrideDraft("regex", "  "),
        emptySeriesOverrideDraft("name", "a"),
        { ...emptySeriesOverrideDraft("name", "b"), color: "#000000" },
      ]),
    ).toEqual([entry("b", [{ type: "series_color", value: "#000000" }])]);
  });

  it("reads an unknown or missing matchBy as an exact series match", () => {
    expect(toSeriesOverrideDraft({ field: { value: "x" }, config: [] }).matchBy).toBe("name");
  });
});

describe("series entries inside override_config", () => {
  const table = { field: { matchBy: "name", value: "latency" }, config: [] };
  const legacy = { field: { value: "service" }, config: [] };
  const a = entry("a", [{ type: "series_color", value: "#111111" }]);
  const b = entry("^b", [{ type: "decimals", value: 1 }], "series_regex");

  it("tells series entries from table entries, old table entries included", () => {
    expect([table, legacy, a, b].map(isSeriesOverrideEntry)).toEqual([false, false, true, true]);
    expect(getSeriesOverrideEntries([table, a, legacy, b])).toEqual([a, b]);
    expect(getSeriesOverrideEntries(undefined)).toEqual([]);
  });

  it("replaces only the series entries and keeps the table entries in their order", () => {
    expect(withSeriesOverrideEntries([table, a, legacy, b], [b])).toEqual([table, legacy, b]);
    expect(withSeriesOverrideEntries([table, a], [])).toEqual([table]);
    expect(withSeriesOverrideEntries(undefined, [a])).toEqual([a]);
  });
});

describe("parseDecimals", () => {
  it.each([
    ["", null],
    [null, null],
    ["abc", null],
    ["-1", null],
    ["2", 2],
    ["2.7", 2],
    [0, 0],
  ])("parses %j as %j", (input, expected) => {
    expect(parseDecimals(input as any)).toBe(expected);
  });
});

describe("seriesPatternError", () => {
  it("flags a pattern the linear-time engine rejects", () => {
    expect(seriesPatternError(emptySeriesOverrideDraft("regex", "(?=a)b"))).toBe("unsupported");
    expect(seriesPatternError(emptySeriesOverrideDraft("regex", "x".repeat(300)))).toBe("tooLong");
  });

  it("passes valid patterns, empty patterns and exact names", () => {
    expect(seriesPatternError(emptySeriesOverrideDraft("regex", "/^c/i"))).toBeNull();
    expect(seriesPatternError(emptySeriesOverrideDraft("regex", ""))).toBeNull();
    expect(seriesPatternError(emptySeriesOverrideDraft("name", "(?=a)b"))).toBeNull();
  });
});

describe("getLegendSeriesNames", () => {
  it("reads series names on axis charts, once each", () => {
    const options = { series: [{ name: "a" }, { name: "b" }, { name: "a" }, { markArea: {} }] };
    expect(getLegendSeriesNames(options, "line")).toEqual(["a", "b"]);
  });

  it("reads slice names on pie and donut", () => {
    const options = { series: [{ data: [{ name: "x" }, { name: "y" }] }] };
    expect(getLegendSeriesNames(options, "donut")).toEqual(["x", "y"]);
  });

  it("reads each gauge's data name", () => {
    const options = { series: [{ data: [{ name: "p95" }] }, { data: [{ name: "p99" }] }] };
    expect(getLegendSeriesNames(options, "gauge")).toEqual(["p95", "p99"]);
  });

  it("reads the metric label", () => {
    const options = { series: [{ _metricLabel: "Requests" }, { type: "line" }] };
    expect(getLegendSeriesNames(options, "metric")).toEqual(["Requests"]);
  });

  it("reads the categories of a plain bar whose one series has no name", () => {
    const options = {
      series: [{ type: "bar", data: [{ value: 1 }, { value: 2 }] }],
      xAxis: { type: "value" },
      yAxis: { type: "category", data: ["api", "web"] },
    };
    expect(getLegendSeriesNames(options, "h-bar")).toEqual(["api", "web"]);
    expect(getLegendSeriesNames({ ...options, series: [{ name: "count" }] }, "h-bar")).toEqual([
      "count",
    ]);
  });

  it("returns an empty list without options", () => {
    expect(getLegendSeriesNames(undefined, "line")).toEqual([]);
  });
});

describe("withoutHiddenQueries", () => {
  it("returns the source untouched when nothing is hidden", () => {
    const source = { panelSchema: { queries: [{}, {}] }, data: [[1], [2]], hiddenQueries: [] };
    expect(withoutHiddenQueries(source)).toBe(source);
  });

  it("drops a hidden SQL query from the data and the schema, like the panel does", () => {
    const metadata = { queries: [{ a: 0 }, { a: 1 }, { a: 2 }] };
    const source = {
      panelSchema: { queryType: "sql", queries: [{ q: "A" }, { q: "B" }, { q: "C" }] },
      data: [["a"], ["b"], ["c"]],
      metadata,
      resultMetaData: [["ma"], ["mb"], ["mc"]],
      hiddenQueries: [1],
    };
    const visible = withoutHiddenQueries(source);
    expect(visible.data).toEqual([["a"], ["c"]]);
    expect(visible.panelSchema.queries).toEqual([{ q: "A" }, { q: "C" }]);
    expect(visible.metadata).toBe(metadata);
    expect(visible.resultMetaData).toEqual([["ma"], ["mb"], ["mc"]]);
  });

  it("drops a hidden PromQL query with its shifted twin, by panel query index", () => {
    const source = {
      panelSchema: { queryType: "promql", queries: [{ q: "A" }, { q: "B" }] },
      data: ["A", "B", "A 1d ago", "B 1d ago"],
      metadata: {
        queries: [
          { panelQueryIndex: 0 },
          { panelQueryIndex: 1 },
          { panelQueryIndex: 0 },
          { panelQueryIndex: 1 },
        ],
      },
      resultMetaData: ["mA", "mB", "mA2", "mB2"],
      hiddenQueries: [1],
    };
    const visible = withoutHiddenQueries(source);
    expect(visible.data).toEqual(["A", "A 1d ago"]);
    expect(visible.metadata.queries).toEqual([{ panelQueryIndex: 0 }, { panelQueryIndex: 0 }]);
    expect(visible.resultMetaData).toEqual(["mA", "mA2"]);
    expect(visible.panelSchema.queries).toHaveLength(2);
  });
});
