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

import { describe, expect, it, vi } from "vitest";
import {
  buildDataLookupMap,
  createSeriesBuilders,
  type SeriesDeps,
} from "@/utils/dashboard/sql/shared/seriesBuilder";

// Mock heavy dependencies
vi.mock("@/utils/dashboard/aliasUtils", () => ({
  getDataValue: vi.fn((obj: any, key: any) => obj?.[key]),
}));

vi.mock("@/utils/dashboard/colorPalette", () => ({
  getSeriesColor: vi.fn(() => "#FF5733"),
  getAreaStyleOverride: vi.fn(() => ({})),
}));

vi.mock("@/utils/dashboard/getAnnotationsData", () => ({
  getAnnotationsData: vi.fn(() => []),
}));

vi.mock("@/ts/interfaces/dashboard", () => ({}));

describe("seriesBuilder", () => {
  describe("buildDataLookupMap", () => {
    it("returns empty map when no breakdown keys", () => {
      const data = [{ category: "A", time: "2024-01", value: 10 }];
      const result = buildDataLookupMap(data, [], ["time"]);
      expect(result.size).toBe(0);
    });

    it("returns empty map when no x-axis keys", () => {
      const data = [{ category: "A", time: "2024-01", value: 10 }];
      const result = buildDataLookupMap(data, ["category"], []);
      expect(result.size).toBe(0);
    });

    it("builds map with breakdown||xAxis key format", () => {
      const data = [{ category: "A", time: "2024-01", value: 10 }];
      const result = buildDataLookupMap(data, ["category"], ["time"]);
      expect(result.has("A||2024-01")).toBe(true);
    });

    it("maps to correct data row", () => {
      const row = { category: "A", time: "2024-01", value: 10 };
      const result = buildDataLookupMap([row], ["category"], ["time"]);
      expect(result.get("A||2024-01")).toBe(row);
    });

    it("handles multiple rows", () => {
      const data = [
        { category: "A", time: "2024-01", value: 10 },
        { category: "B", time: "2024-01", value: 20 },
        { category: "A", time: "2024-02", value: 30 },
      ];
      const result = buildDataLookupMap(data, ["category"], ["time"]);
      expect(result.size).toBe(3);
      expect(result.has("A||2024-01")).toBe(true);
      expect(result.has("B||2024-01")).toBe(true);
      expect(result.has("A||2024-02")).toBe(true);
    });

    it("keeps FIRST occurrence when duplicate keys exist", () => {
      const first = { category: "A", time: "2024-01", value: 10 };
      const second = { category: "A", time: "2024-01", value: 99 };
      const result = buildDataLookupMap([first, second], ["category"], ["time"]);
      expect(result.get("A||2024-01")).toBe(first);
      expect(result.get("A||2024-01")).not.toBe(second);
    });

    it("handles empty data array", () => {
      const result = buildDataLookupMap([], ["category"], ["time"]);
      expect(result.size).toBe(0);
    });

    it("handles undefined breakdown values", () => {
      const data = [{ time: "2024-01", value: 10 }]; // no category key
      const result = buildDataLookupMap(data, ["category"], ["time"]);
      expect(result.has("undefined||2024-01")).toBe(true);
    });

    it("handles null breakdown values", () => {
      const data = [{ category: null, time: "2024-01", value: 10 }];
      const result = buildDataLookupMap(data, ["category"], ["time"]);
      expect(result.has("null||2024-01")).toBe(true);
    });

    it("uses only first breakdown key", () => {
      const data = [{ cat: "A", sub: "X", time: "2024-01", value: 10 }];
      const result = buildDataLookupMap(data, ["cat", "sub"], ["time"]);
      // Only first breakdown key "cat" is used
      expect(result.has("A||2024-01")).toBe(true);
      expect(result.has("X||2024-01")).toBe(false);
    });

    it("uses only first x-axis key", () => {
      const data = [{ category: "A", time: "2024-01", month: "Jan", value: 10 }];
      const result = buildDataLookupMap(data, ["category"], ["time", "month"]);
      // Only first x-axis key "time" is used
      expect(result.has("A||2024-01")).toBe(true);
      expect(result.has("A||Jan")).toBe(false);
    });
  });

  describe("large mode and value labels", () => {
    const deps = (
      type: string,
      config: Record<string, unknown>,
      extra: Partial<SeriesDeps> = {},
    ): SeriesDeps => ({
      options: { xAxis: [{ data: [] }] },
      panelSchema: { type, config, queries: [{ fields: { y: [], breakdown: [] } }] },
      store: { state: { theme: "light", timezone: "UTC" } },
      missingValueData: [],
      xAxisKeys: [],
      yAxisKeys: [],
      breakDownKeys: [],
      defaultSeriesProps: { type: "bar" },
      chartMin: 0,
      chartMax: 1,
      dataLookupMap: new Map(),
      annotations: [],
      getMarkLineData: () => [],
      getAxisDataFromKey: () => [],
      ...extra,
    });
    const build = (config: Record<string, unknown>) =>
      createSeriesBuilders(deps("bar", config)).getSeriesObj("count", [1, 2], {}, "");

    it("keeps large mode when value labels are hidden", () => {
      expect(build({}).large).toBe(true);
      expect(build({ label_option: { position: null, rotate: 0 } }).large).toBe(true);
      expect(build({}).labelLayout).toBeUndefined();
    });

    it("turns large mode off and hides overlapping labels when value labels are shown", () => {
      const series = build({ label_option: { position: "top" } });
      expect(series.label.show).toBe(true);
      expect(series.large).toBe(false);
      expect(series.labelLayout).toEqual({ hideOverlap: true });
    });

    it("h-bar with a breakdown: every breakdown series follows the label setting", () => {
      const rows = [
        { x: "/a", service: "api", y: 1 },
        { x: "/a", service: "web", y: 2 },
      ];
      const build = (config: Record<string, unknown>) =>
        createSeriesBuilders(
          deps("h-bar", config, {
            options: { xAxis: [{ data: ["/a"] }] },
            missingValueData: rows,
            xAxisKeys: ["x"],
            yAxisKeys: ["y"],
            breakDownKeys: ["service"],
            dataLookupMap: buildDataLookupMap(rows, ["service"], ["x"]),
          }),
        ).getSeries();

      const labelled = build({ label_option: { position: "right" } });
      expect(labelled.map((series) => series.originalSeriesName)).toEqual(["api", "web"]);
      expect(labelled.every((series) => series.large === false)).toBe(true);
      expect(build({}).every((series) => series.large === true)).toBe(true);
    });
  });
});
