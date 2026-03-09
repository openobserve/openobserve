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
import { largestLabel } from "@/utils/dashboard/sql/shared/contextBuilder";

// Mock all heavy dependencies of contextBuilder
vi.mock("@/utils/dashboard/convertDataIntoUnitValue", () => ({
  formatUnitValue: vi.fn((v) => String(v)),
  getUnitValue: vi.fn((v) => v),
}));

vi.mock("@/utils/dashboard/chartDimensionUtils", () => ({
  calculateWidthText: vi.fn(() => 50),
  calculateDynamicNameGap: vi.fn(() => 25),
  calculateRotatedLabelBottomSpace: vi.fn(() => 0),
}));

vi.mock("@/utils/dashboard/colorPalette", () => ({
  ColorModeWithoutMinMax: [],
  getSQLMinMaxValue: vi.fn(() => ({ min: 0, max: 100 })),
  getColorPalette: vi.fn(() => ["#FF5733"]),
}));

vi.mock("@/utils/dashboard/aliasUtils", () => ({
  getDataValue: vi.fn((obj, key) => obj?.[key]),
}));

vi.mock("@/utils/dashboard/legendConfiguration", () => ({
  createBaseLegendConfig: vi.fn(() => ({})),
  getChartDimensions: vi.fn(() => ({ width: 800, height: 400 })),
  calculateChartDimensions: vi.fn(() => ({})),
  calculatePieChartRadius: vi.fn(() => "50%"),
}));

vi.mock("@/utils/dashboard/sqlChartSeriesProps", () => ({
  getPropsByChartTypeForSeries: vi.fn(() => ({ type: "bar" })),
}));

vi.mock("@/utils/dashboard/sqlProcessData", () => ({
  processData: vi.fn((data) => data[0] || []),
}));

vi.mock("@/utils/dashboard/sqlMissingValueFiller", () => ({
  fillMissingValues: vi.fn((data) => data),
}));

vi.mock("@/utils/dashboard/sql/shared/seriesBuilder", () => ({
  buildDataLookupMap: vi.fn(() => new Map()),
  createSeriesBuilders: vi.fn(() => ({
    getAxisDataFromKey: vi.fn(() => []),
    getSeries: vi.fn(() => []),
    getAnnotationMarkLine: vi.fn(() => null),
    getSeriesMarkArea: vi.fn(() => null),
    getPieChartRadius: vi.fn(() => "50%"),
  })),
}));

vi.mock("@/utils/dashboard/sql/shared/trellisConfig", () => ({
  createTrellisHelpers: vi.fn(() => ({
    updateTrellisConfig: vi.fn(),
  })),
}));

describe("contextBuilder", () => {
  describe("largestLabel", () => {
    it("returns the label with the longest string representation", () => {
      const data = ["short", "medium text", "a"];
      expect(largestLabel(data)).toBe("medium text");
    });

    it("returns empty string for empty array", () => {
      expect(largestLabel([])).toBe("");
    });

    it("handles single element array", () => {
      expect(largestLabel(["hello"])).toBe("hello");
    });

    it("handles numbers by converting to string for length comparison", () => {
      const data = [1, 100, 10];
      // 100 has 3 chars, others have 1 and 2
      expect(largestLabel(data)).toBe(100);
    });

    it("handles mix of strings and numbers", () => {
      const data = ["abc", 12345, "de"];
      // 12345 as string is 5 chars, "abc" is 3, "de" is 2
      expect(largestLabel(data)).toBe(12345);
    });

    it("returns last of equal-length items (uses > not >=)", () => {
      // both have length 3
      const data = ["abc", "xyz"];
      // "abc" is first, "xyz" is NOT greater (lengths are equal), so "abc" stays
      expect(largestLabel(data)).toBe("abc");
    });

    it("handles null/undefined values gracefully (toString may throw)", () => {
      // If items can be converted to string, it should work
      const data = ["", "hello", "hi"];
      expect(largestLabel(data)).toBe("hello");
    });

    it("handles all same length items", () => {
      const data = ["aaa", "bbb", "ccc"];
      // All length 3, first one wins (> not >=)
      expect(largestLabel(data)).toBe("aaa");
    });

    it("handles large array", () => {
      const data = Array.from({ length: 100 }, (_, i) => "a".repeat(i + 1));
      expect(largestLabel(data)).toBe("a".repeat(100));
    });

    it("handles timestamp-like strings", () => {
      const data = ["2024-01-01T00:00:00", "2024-01-15", "hi"];
      // "2024-01-01T00:00:00" is 19 chars
      expect(largestLabel(data)).toBe("2024-01-01T00:00:00");
    });
  });
});
