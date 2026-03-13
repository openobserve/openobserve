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

import { describe, expect, it, vi } from "vitest";
import { buildDataLookupMap } from "@/utils/dashboard/sql/shared/seriesBuilder";

// Mock heavy dependencies
vi.mock("@/utils/dashboard/aliasUtils", () => ({
  getDataValue: vi.fn((obj: any, key: any) => obj?.[key]),
}));

vi.mock("@/utils/dashboard/colorPalette", () => ({
  getSeriesColor: vi.fn(() => "#FF5733"),
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
      const result = buildDataLookupMap(
        [first, second],
        ["category"],
        ["time"],
      );
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
      const data = [
        { category: "A", time: "2024-01", month: "Jan", value: 10 },
      ];
      const result = buildDataLookupMap(data, ["category"], ["time", "month"]);
      // Only first x-axis key "time" is used
      expect(result.has("A||2024-01")).toBe(true);
      expect(result.has("A||Jan")).toBe(false);
    });
  });
});
