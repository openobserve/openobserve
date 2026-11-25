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
  NULL_BREAKDOWN_VALUE,
  OTHERS_BREAKDOWN_VALUE,
  breakdownValueLabel,
  processData,
} from "@/utils/dashboard/sqlProcessData";
import type { SeriesLimitInfo } from "@/utils/dashboard/panelDiagnostics";
import { fillMissingValues } from "@/utils/dashboard/sqlMissingValueFiller";
import {
  buildDataLookupMap,
  createSeriesBuilders,
} from "@/utils/dashboard/sql/shared/seriesBuilder";

type Row = Record<string, unknown>;
type Extras = { seriesLimit?: SeriesLimitInfo; limitNumberOfSeriesWarningMessage?: string };

const makeStore = (maxDashboardSeries = 100) => ({
  state: {
    zoConfig: {
      max_dashboard_series: maxDashboardSeries,
    },
  },
});

const makeSchema = (topResults: number | null = null, topResultsOthers = false) => ({
  config: {
    top_results: topResults,
    top_results_others: topResultsOthers,
  },
});

describe("sqlProcessData - processData", () => {
  describe("empty/invalid input", () => {
    it("returns empty array for empty data", () => {
      const result = processData([], makeSchema(), makeStore(), [], [], [], {});
      expect(result).toEqual([]);
    });

    it("returns empty array when data[0] is not an array", () => {
      const result = processData([{}], makeSchema(), makeStore(), [], [], [], {});
      expect(result).toEqual([]);
    });

    it("returns empty array for null/undefined inner array", () => {
      const result = processData([null as any], makeSchema(), makeStore(), [], [], [], {});
      expect(result).toEqual([]);
    });
  });

  describe("no breakdown keys", () => {
    it("returns inner array as-is when no breakdown keys", () => {
      const innerData = [
        { x: "a", y: 10 },
        { x: "b", y: 20 },
      ];
      const result = processData([innerData], makeSchema(), makeStore(), ["y"], [], ["x"], {});
      expect(result).toEqual(innerData);
    });

    it("returns inner array regardless of top_results when no breakdown", () => {
      const innerData = [{ x: "a", y: 10 }];
      const result = processData([innerData], makeSchema(5), makeStore(), ["y"], [], ["x"], {});
      expect(result).toEqual(innerData);
    });
  });

  describe("with breakdown keys", () => {
    const innerData = [
      { category: "A", time: "2024-01", value: 100 },
      { category: "A", time: "2024-02", value: 200 },
      { category: "B", time: "2024-01", value: 50 },
      { category: "B", time: "2024-02", value: 150 },
      { category: "C", time: "2024-01", value: 10 },
    ];

    it("returns all items when no top_results limit", () => {
      const result = processData(
        [innerData],
        makeSchema(null, false),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      // All items should be in result since no top_results constraint (limited by max_dashboard_series=100)
      expect(result.length).toBe(5);
    });

    it("filters to top N breakdown values based on sum", () => {
      // A has total 300, B has total 200, C has total 10
      // top_results=2 -> only A and B
      const result = processData(
        [innerData],
        makeSchema(2, false),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      const categories = new Set(result.map((r: any) => r.category));
      expect(categories.has("A")).toBe(true);
      expect(categories.has("B")).toBe(true);
      expect(categories.has("C")).toBe(false);
    });

    it("includes others when top_results_others is true", () => {
      const result = processData(
        [innerData],
        makeSchema(2, true),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      const categories = result.map((r: any) => r.category);
      expect(categories).toContain(OTHERS_BREAKDOWN_VALUE);
    });

    it("keeps a real value named others apart from the others bucket", () => {
      const rows = [
        { category: "others", time: "2024-01", value: 100 },
        { category: "B", time: "2024-01", value: 50 },
        { category: "C", time: "2024-01", value: 10 },
      ];
      const result = processData(
        [rows],
        makeSchema(2, true),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      expect(result.map((row: Row) => [row.category, row.value])).toEqual([
        ["others", 100],
        ["B", 50],
        [OTHERS_BREAKDOWN_VALUE, 10],
      ]);
    });

    it("aggregates others by x-axis key", () => {
      const result = processData(
        [innerData],
        makeSchema(2, true),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      const othersEntry = result.find(
        (r: any) => r.category === OTHERS_BREAKDOWN_VALUE && r.time === "2024-01",
      );
      expect(othersEntry).toBeDefined();
      expect(othersEntry?.value).toBe(10); // C's value at 2024-01
    });

    it("keeps rows whose breakdown value is null", () => {
      const dataWithNull = [
        { category: null, time: "2024-01", value: 50 },
        { category: "A", time: "2024-01", value: 100 },
      ];
      const result = processData(
        [dataWithNull],
        makeSchema(null, false),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      expect(result.length).toBe(2);
    });

    it("keeps rows that have no breakdown value", () => {
      const dataWithUndefined = [
        { time: "2024-01", value: 50 }, // no category key
        { category: "A", time: "2024-01", value: 100 },
      ];
      const result = processData(
        [dataWithUndefined],
        makeSchema(null, false),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      expect(result.length).toBe(2);
    });

    it("respects max_dashboard_series as upper bound", () => {
      const bigData = Array.from({ length: 20 }, (_, i) => ({
        category: `cat${i}`,
        time: "2024-01",
        value: 100 - i,
      }));
      const result = processData(
        [bigData],
        makeSchema(null, false),
        makeStore(5), // max 5 series
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      const categories = new Set(result.map((r: any) => r.category));
      expect(categories.size).toBeLessThanOrEqual(5);
    });

    it("divides limit by number of y-axes when multiple y-axes and breakdown", () => {
      const bigData = Array.from({ length: 20 }, (_, i) => ({
        category: `cat${i}`,
        time: "2024-01",
        value1: 100 - i,
        value2: i,
      }));
      const result = processData(
        [bigData],
        makeSchema(null, false),
        makeStore(10), // 10/2 = 5 per axis
        ["value1", "value2"], // 2 y-axes
        ["category"],
        ["time"],
        {},
      );
      const categories = new Set(result.map((r: any) => r.category));
      expect(categories.size).toBeLessThanOrEqual(5);
    });

    it("sets warning message when series count exceeds limit", () => {
      const bigData = Array.from({ length: 10 }, (_, i) => ({
        category: `cat${i}`,
        time: "2024-01",
        value: 100 - i,
      }));
      const extras: any = {};
      processData(
        [bigData],
        makeSchema(null, false),
        makeStore(5), // max 5, but 10 available
        ["value"],
        ["category"],
        ["time"],
        extras,
      );
      expect(extras.limitNumberOfSeriesWarningMessage).toBeDefined();
    });

    it("reports the real shown and total series counts in extras and the message", () => {
      const bigData = Array.from({ length: 12 }, (_, i) => ({
        category: `cat${i}`,
        time: "2024-01",
        value: 100 - i,
      }));
      const extras: any = {};
      processData(
        [bigData],
        makeSchema(null, false),
        makeStore(5),
        ["value"],
        ["category"],
        ["time"],
        extras,
      );
      expect(extras.seriesLimit).toEqual({ shown: 5, total: 12, cap: 5 });
      expect(extras.limitNumberOfSeriesWarningMessage).toBe(
        "Showing 5 of 12 series to keep the chart fast",
      );
    });

    it("formats large counts in the message with thousands separators", () => {
      const bigData = Array.from({ length: 1200 }, (_, i) => ({
        category: `cat${i}`,
        time: "2024-01",
        value: 2000 - i,
      }));
      const extras: any = {};
      processData(
        [bigData],
        makeSchema(null, false),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        extras,
      );
      expect(extras.limitNumberOfSeriesWarningMessage).toBe(
        "Showing 100 of 1,200 series to keep the chart fast",
      );
    });

    it("counts every y-axis copy of a series on multi y-axis charts", () => {
      const bigData = Array.from({ length: 9 }, (_, i) => ({
        category: `cat${i}`,
        time: "2024-01",
        value1: 100 - i,
        value2: i,
      }));
      const extras: any = {};
      processData(
        [bigData],
        makeSchema(null, false),
        makeStore(8),
        ["value1", "value2"],
        ["category"],
        ["time"],
        extras,
      );
      expect(extras.seriesLimit).toEqual({ shown: 8, total: 18, cap: 8 });
    });

    it("leaves seriesLimit unset when nothing was dropped", () => {
      const extras: any = {};
      processData(
        [[{ category: "A", time: "2024-01", value: 1 }]],
        makeSchema(null, false),
        makeStore(5),
        ["value"],
        ["category"],
        ["time"],
        extras,
      );
      expect(extras.seriesLimit).toBeUndefined();
    });

    it("does not set warning when within limits", () => {
      const smallData = [
        { category: "A", time: "2024-01", value: 10 },
        { category: "B", time: "2024-01", value: 20 },
      ];
      const extras: any = {};
      processData(
        [smallData],
        makeSchema(null, false),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        extras,
      );
      expect(extras.limitNumberOfSeriesWarningMessage).toBeUndefined();
    });

    it("uses min of top_results and max_dashboard_series", () => {
      const bigData = Array.from({ length: 20 }, (_, i) => ({
        category: `cat${i}`,
        time: "2024-01",
        value: 100 - i,
      }));
      const result = processData(
        [bigData],
        makeSchema(3, false), // top_results=3, but max_dashboard_series=10
        makeStore(10),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      const categories = new Set(result.map((r: any) => r.category));
      expect(categories.size).toBeLessThanOrEqual(3);
    });
  });

  describe("sorting", () => {
    it("selects top series by highest total y-axis value", () => {
      const innerData = [
        { category: "Low", time: "2024-01", value: 5 },
        { category: "High", time: "2024-01", value: 1000 },
        { category: "Medium", time: "2024-01", value: 50 },
      ];
      const result = processData(
        [innerData],
        makeSchema(1, false),
        makeStore(100),
        ["value"],
        ["category"],
        ["time"],
        {},
      );
      const categories = result.map((r: any) => r.category);
      expect(categories).toContain("High");
      expect(categories).not.toContain("Low");
      expect(categories).not.toContain("Medium");
    });
  });

  describe("NULL and empty breakdown values", () => {
    const times = ["2024-01-15T10:00:00", "2024-01-15T10:01:00"];
    const nullRows = times.map((time) => ({ time, svc: null, cnt: 8 }));
    const emptyRows = times.map((time) => ({ time, svc: "", cnt: 4 }));
    const panelSchema = {
      type: "line",
      config: {},
      queries: [{ fields: { y: [{ alias: "cnt" }], breakdown: [{ alias: "svc" }] } }],
    };

    const seriesFor = (rows: Record<string, unknown>[]) => {
      const processed = processData(
        [rows],
        panelSchema,
        makeStore(),
        ["cnt"],
        ["svc"],
        ["time"],
        {},
      );
      const filled = fillMissingValues(
        processed,
        panelSchema,
        [{ histogram_interval: 60 }],
        {
          queries: [
            {
              startTime: Date.UTC(2024, 0, 15, 10, 0) * 1000,
              endTime: Date.UTC(2024, 0, 15, 10, 1) * 1000,
            },
          ],
        },
        ["time"],
        ["cnt"],
        [],
        ["svc"],
        null,
      );
      const { getSeries } = createSeriesBuilders({
        options: { xAxis: [{ data: times }] },
        panelSchema,
        store: { state: { timezone: "UTC", theme: "light" } },
        missingValueData: filled,
        xAxisKeys: ["time"],
        yAxisKeys: ["cnt"],
        breakDownKeys: ["svc"],
        defaultSeriesProps: {},
        chartMin: 0,
        chartMax: 10,
        dataLookupMap: buildDataLookupMap(filled, ["svc"], ["time"]),
        annotations: { value: [] },
        getMarkLineData: () => [],
        getAxisDataFromKey: () => [],
      });
      return getSeries().map((series) => [series.name, series.data]);
    };

    it.each([
      ["NULL rows first", [...nullRows, ...emptyRows]],
      ["empty rows first", [...emptyRows, ...nullRows]],
    ])("draws NULL and empty as two series of 8 and 4 with %s", (_order, rows) => {
      expect(Object.fromEntries(seriesFor(rows))).toEqual({
        "(null)": [8, 8],
        "(empty)": [4, 4],
      });
    });

    it("keeps the NULL stand-in as the row's breakdown value", () => {
      const result = processData(
        [[...nullRows, ...emptyRows]],
        makeSchema(),
        makeStore(),
        ["cnt"],
        ["svc"],
        ["time"],
        {},
      );
      expect(result.map((row: Row) => row.svc)).toEqual([
        NULL_BREAKDOWN_VALUE,
        NULL_BREAKDOWN_VALUE,
        "",
        "",
      ]);
    });

    it("labels the NULL and empty series apart from real values", () => {
      expect(breakdownValueLabel(NULL_BREAKDOWN_VALUE)).toBe("(null)");
      expect(breakdownValueLabel("")).toBe("(empty)");
      expect(breakdownValueLabel("null")).toBe("null");
      expect(breakdownValueLabel(OTHERS_BREAKDOWN_VALUE)).toBe("others");
    });
  });

  describe("multi y-axis series cap", () => {
    const hosts = Array.from({ length: 80 }, (_, i) => ({
      host: `h${i}`,
      time: "2024-01",
      a: 100 - i,
      b: i,
    }));
    const keptHosts = (result: Row[]) => new Set(result.map((row) => row.host)).size;

    it("warns when two y-axes halve the cap below the breakdown count", () => {
      const extras: Extras = {};
      const result = processData(
        [hosts],
        makeSchema(),
        makeStore(100),
        ["a", "b"],
        ["host"],
        ["time"],
        extras,
      );
      expect(keptHosts(result)).toBe(50);
      expect(extras.seriesLimit).toEqual({ shown: 100, total: 160, cap: 100 });
      expect(extras.limitNumberOfSeriesWarningMessage).toBe(
        "Showing 100 of 160 series to keep the chart fast",
      );
    });

    it("keeps a user's Top N per y-axis without warning", () => {
      const extras: Extras = {};
      const result = processData(
        [hosts],
        makeSchema(10),
        makeStore(100),
        ["a", "b"],
        ["host"],
        ["time"],
        extras,
      );
      expect(keptHosts(result)).toBe(10);
      expect(extras.seriesLimit).toBeUndefined();
    });

    it("warns when the cap, not a larger Top N, cut the series", () => {
      const extras: Extras = {};
      const result = processData(
        [hosts],
        makeSchema(70),
        makeStore(100),
        ["a", "b"],
        ["host"],
        ["time"],
        extras,
      );
      expect(keptHosts(result)).toBe(50);
      expect(extras.seriesLimit).toEqual({ shown: 100, total: 160, cap: 100 });
    });
  });
});
