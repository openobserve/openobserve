// Copyright 2023 OpenObserve Inc.
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
import { processData } from "@/utils/dashboard/sqlProcessData";

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
      expect(categories).toContain("others");
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
      const othersEntry = result.find((r: any) => r.category === "others" && r.time === "2024-01");
      expect(othersEntry).toBeDefined();
      expect(othersEntry?.value).toBe(10); // C's value at 2024-01
    });

    it("handles null breakdown values by treating them as empty string", () => {
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

    it("handles undefined breakdown values by treating them as empty string", () => {
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
});
