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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  calculateWidthText,
  calculateOptimalFontSize,
  calculateDynamicNameGap,
  calculateRotatedLabelBottomSpace,
} from "@/utils/dashboard/chartDimensionUtils";

// Mock objects for OffscreenCanvas ΓÇö populated per-test
const mockMeasureText = vi.fn((text: string) => ({ width: text.length * 7 }));
const mockCtx = { font: "", measureText: mockMeasureText };

describe("chartDimensionUtils", () => {
  beforeEach(() => {
    mockCtx.font = "";
    mockMeasureText.mockReset();
    mockMeasureText.mockImplementation((text: string) => ({
      width: text.length * 7,
    }));

    // Stub OffscreenCanvas with a proper class constructor so `new OffscreenCanvas()
    // .getContext('2d')` returns our mockCtx in jsdom (which lacks OffscreenCanvas).
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return mockCtx;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("calculateWidthText", () => {
    it("returns 0 for empty string", () => {
      expect(calculateWidthText("")).toBe(0);
    });

    it("returns 0 for null/falsy text", () => {
      expect(calculateWidthText(null as any)).toBe(0);
    });

    it("returns a positive number for non-empty text", () => {
      const result = calculateWidthText("Hello");
      expect(result).toBeGreaterThan(0);
    });

    it("returns Math.ceil of measureText width", () => {
      // mockMeasureText returns text.length * 7; "Hello" = 5 chars ΓåÆ 35
      mockMeasureText.mockReturnValueOnce({ width: 49.3 });
      const result = calculateWidthText("Hello");
      expect(result).toBe(50);
    });

    it("sets font with default fontSize 12px", () => {
      calculateWidthText("Hello");
      expect(mockCtx.font).toBe("12px sans-serif");
    });

    it("sets font with provided fontSize", () => {
      calculateWidthText("Hello", "16px");
      expect(mockCtx.font).toBe("16px sans-serif");
    });

    it("calls measureText with the provided text", () => {
      calculateWidthText("TestText");
      expect(mockMeasureText).toHaveBeenCalledWith("TestText");
    });
  });

  describe("calculateOptimalFontSize", () => {
    it("finds the largest font size that fits canvas width", () => {
      // Mock: width = fontSize * 5 (via measureText returning fontSize * 5)
      mockMeasureText.mockImplementation(() => {
        const fontSize = parseInt(mockCtx.font) || 12;
        return { width: fontSize * 5 };
      });
      const result = calculateOptimalFontSize("Hello", 200);
      expect(result).toBeGreaterThan(0);
      expect(result).toBeLessThanOrEqual(90);
    });

    it("returns a value between 1 and 90", () => {
      mockMeasureText.mockReturnValue({ width: 0 }); // Text always fits
      const result = calculateOptimalFontSize("Hi", 1000);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(90);
    });

    it("returns 1 when text never fits", () => {
      mockMeasureText.mockReturnValue({ width: 9999 }); // Always too wide
      const result = calculateOptimalFontSize("VeryLongText", 10);
      expect(result).toBe(1);
    });
  });

  describe("calculateDynamicNameGap", () => {
    it("returns defaultNameGap when rotation is 0", () => {
      expect(calculateDynamicNameGap(0)).toBe(25);
    });

    it("returns custom defaultNameGap when rotation is 0", () => {
      expect(calculateDynamicNameGap(0, 120, 12, 30, 10)).toBe(30);
    });

    it("returns at least the defaultNameGap for any rotation", () => {
      const result = calculateDynamicNameGap(45);
      expect(result).toBeGreaterThanOrEqual(25);
    });

    it("returns larger gap for 90 degree rotation", () => {
      const at0 = calculateDynamicNameGap(0);
      const at90 = calculateDynamicNameGap(90);
      expect(at90).toBeGreaterThan(at0);
    });

    it("calculates correctly for 45 degree rotation with default params", () => {
      // verticalHeight = 120 * sin(45°) + 12 * cos(45°)
      // = 120 * 0.7071 + 12 * 0.7071 ≈ 84.85 + 8.49 ≈ 93.34
      // calculatedNameGap = ceil(93.34 + 10 + 8) = ceil(111.34) = 112
      // max(112, 25) = 112
      const result = calculateDynamicNameGap(45);
      expect(result).toBeCloseTo(112, 0);
    });

    it("uses absolute value of negative rotation", () => {
      const positive = calculateDynamicNameGap(45);
      const negative = calculateDynamicNameGap(-45);
      expect(positive).toBe(negative);
    });

    it("calculates correctly for 90 degree rotation", () => {
      // verticalHeight = 120 * sin(90°) + 12 * cos(90°) = 120 * 1 + 12 * 0 = 120
      // calculatedNameGap = ceil(120 + 10 + 8) = 138
      // max(138, 25) = 138
      const result = calculateDynamicNameGap(90);
      expect(result).toBe(138);
    });

    it("respects custom label width and font size", () => {
      // rotate=90, labelWidth=50, fontSize=10
      // verticalHeight = 50 * sin(90°) + 10 * cos(90°) = 50 + 0 = 50
      // calculatedNameGap = ceil(50 + 10 + 8) = 68
      const result = calculateDynamicNameGap(90, 50, 10, 25, 10);
      expect(result).toBe(68);
    });

    it("respects custom axisLabelMargin", () => {
      // rotate=90, labelWidth=120, fontSize=12, defaultNameGap=25, axisLabelMargin=20
      // verticalHeight = 120 + 0 = 120
      // calculatedNameGap = ceil(120 + 20 + 8) = 148
      const result = calculateDynamicNameGap(90, 120, 12, 25, 20);
      expect(result).toBe(148);
    });
  });

  describe("calculateRotatedLabelBottomSpace", () => {
    it("returns 0 when rotation is 0", () => {
      expect(calculateRotatedLabelBottomSpace(0)).toBe(0);
    });

    it("returns 10 for rotated labels without axis name", () => {
      expect(calculateRotatedLabelBottomSpace(45, 120, 12, false)).toBe(10);
    });

    it("returns 10 for any non-zero rotation without axis name", () => {
      expect(calculateRotatedLabelBottomSpace(90, 120, 12, false)).toBe(10);
    });

    it("calculates extra space when hasAxisName is true", () => {
      // rotate=90, labelWidth=120, fontSize=12, hasAxisName=true, nameGap=0
      // verticalHeight = 120 + 0 = 120
      // If nameGap is 0 (falsy), uses verticalHeight + 10 = 130
      // totalNeededSpace = 130 + 20 = 150
      // result = max(0, ceil(150 - 40)) = 110
      const result = calculateRotatedLabelBottomSpace(90, 120, 12, true, 0);
      expect(result).toBe(110);
    });

    it("uses nameGap when provided and hasAxisName is true", () => {
      // rotate=45, labelWidth=120, fontSize=12, hasAxisName=true, nameGap=100
      // totalNeededSpace = 100 + 20 = 120
      // result = max(0, ceil(120 - 40)) = 80
      const result = calculateRotatedLabelBottomSpace(45, 120, 12, true, 100);
      expect(result).toBe(80);
    });

    it("returns 0 when calculated space is less than base (40px)", () => {
      // rotate=45, small nameGap
      // totalNeededSpace = 5 + 20 = 25
      // result = max(0, ceil(25 - 40)) = max(0, -15) = 0
      const result = calculateRotatedLabelBottomSpace(45, 120, 12, true, 5);
      expect(result).toBe(0);
    });

    it("uses absolute value of negative rotation", () => {
      const positive = calculateRotatedLabelBottomSpace(45);
      const negative = calculateRotatedLabelBottomSpace(-45);
      expect(positive).toBe(negative);
    });
  });
});
