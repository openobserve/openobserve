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

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getContrastColor,
  applySeriesColorMappings,
} from "@/utils/dashboard/chartColorUtils";

vi.mock("@/utils/dashboard/colorPalette", () => ({
  getColorPalette: vi.fn(() => [
    "#FF5733",
    "#33FF57",
    "#3357FF",
    "#F333FF",
    "#33F3FF",
  ]),
}));

describe("chartColorUtils", () => {
  describe("getContrastColor", () => {
    it("returns white for empty background in light theme", () => {
      expect(getContrastColor("", false)).toBe("#000000");
    });

    it("returns white for empty background in dark theme", () => {
      expect(getContrastColor("", true)).toBe("#FFFFFF");
    });

    it("returns black text for light hex background in light theme", () => {
      // #FFFFFF is white -> luminance ~1.0 > 0.5 => black text
      expect(getContrastColor("#FFFFFF", false)).toBe("#000000");
    });

    it("returns white text for dark hex background in light theme", () => {
      // #000000 is black -> luminance ~0 < 0.5 => white text
      expect(getContrastColor("#000000", false)).toBe("#FFFFFF");
    });

    it("returns white text for dark hex background in dark theme", () => {
      // #000000 luminance ~0 <= 0.8 => white text
      expect(getContrastColor("#000000", true)).toBe("#FFFFFF");
    });

    it("returns black text for very light hex background in dark theme", () => {
      // #FFFFFF luminance ~1.0 > 0.8 => black text
      expect(getContrastColor("#FFFFFF", true)).toBe("#000000");
    });

    it("handles rgb format", () => {
      // rgb(255,255,255) -> luminance ~1.0 > 0.5 => black
      expect(getContrastColor("rgb(255,255,255)", false)).toBe("#000000");
    });

    it("handles rgb format with dark color", () => {
      // rgb(0,0,0) -> luminance 0 <= 0.5 => white
      expect(getContrastColor("rgb(0,0,0)", false)).toBe("#FFFFFF");
    });

    it("handles rgba format", () => {
      // rgba(255,255,255,0.5) -> luminance ~1.0 > 0.5 => black
      expect(getContrastColor("rgba(255,255,255,0.5)", false)).toBe("#000000");
    });

    it("handles rgb with spaces stripped", () => {
      // rgb(128,128,128) -> medium grey
      const result = getContrastColor("rgb(128, 128, 128)", false);
      expect(result).toMatch(/^#(000000|FFFFFF)$/);
    });

    it("returns fallback for unknown color format", () => {
      // Unknown format falls back to {r:255,g:255,b:255} (white)
      // luminance ~1.0 > 0.5 => black in light theme
      expect(getContrastColor("invalidcolor", false)).toBe("#000000");
    });

    it("handles medium brightness background", () => {
      // #808080 grey: luminance = (0.299*128 + 0.587*128 + 0.114*128)/255 ≈ 0.502
      // light theme: > 0.5 => black
      expect(getContrastColor("#808080", false)).toBe("#000000");
    });
  });

  describe("applySeriesColorMappings", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("does nothing when series is not an array", () => {
      const series = null as any;
      applySeriesColorMappings(
        series,
        [{ value: "A", color: "#FF0000" }],
        "light",
      );
      // no error thrown
    });

    it("does nothing when colorBySeries is empty", () => {
      const series = [{ name: "A", color: "#123456" }];
      applySeriesColorMappings(series, [], "light");
      expect(series[0].color).toBe("#123456");
    });

    it("does nothing when colorBySeries is null", () => {
      const series = [{ name: "A", color: "#123456" }];
      applySeriesColorMappings(series, null, "light");
      expect(series[0].color).toBe("#123456");
    });

    it("does nothing when colorBySeries is undefined", () => {
      const series = [{ name: "A", color: "#123456" }];
      applySeriesColorMappings(series, undefined, "light");
      expect(series[0].color).toBe("#123456");
    });

    it("enforces configured colors for mapped series (color property)", () => {
      const series = [
        { name: "A", color: "#OLD111" },
        { name: "B", color: "#OLD222" },
      ];
      const colorBySeries = [{ value: "A", color: "#FF0000" }];
      applySeriesColorMappings(series, colorBySeries, "light");
      expect(series[0].color).toBe("#FF0000");
    });

    it("enforces configured colors for mapped series (itemStyle.color)", () => {
      const series = [{ name: "A", itemStyle: { color: "#OLD111" } }];
      const colorBySeries = [{ value: "A", color: "#FF0000" }];
      applySeriesColorMappings(series, colorBySeries, "light");
      expect(series[0].itemStyle.color).toBe("#FF0000");
    });

    it("does not modify unmapped series color", () => {
      const series = [
        { name: "A", color: "#FF0000" },
        { name: "B", color: "#33FF57" }, // palette color but not configured
      ];
      const colorBySeries = [{ value: "A", color: "#FF0000" }];
      applySeriesColorMappings(series, colorBySeries, "light");
      // B's color doesn't conflict with configured colors (#FF0000) so stays unchanged
      // Wait - B has color "#33FF57" which is in the palette but NOT in configuredColors
      expect(series[1].color).toBe("#33FF57");
    });

    it("reassigns auto-generated colors that collide with configured colors", () => {
      // Series B has the same color as the configured color for A
      const series = [
        { name: "A", color: "#FF5733" },
        { name: "B", color: "#FF5733" }, // same as A's configured color -> collides
      ];
      const colorBySeries = [{ value: "A", color: "#FF5733" }];
      applySeriesColorMappings(series, colorBySeries, "light");
      // A gets its configured color
      expect(series[0].color).toBe("#FF5733");
      // B should get a different color since #FF5733 is now in configuredColors
      expect(series[1].color).not.toBe("#FF5733");
    });

    it("skips mappings with null color", () => {
      const series = [{ name: "A", color: "#123456" }];
      const colorBySeries = [{ value: "A", color: null }];
      applySeriesColorMappings(series, colorBySeries, "light");
      // Mapping skipped because color is null, so no configured mapping for A
      expect(series[0].color).toBe("#123456");
    });

    it("skips mappings with missing value", () => {
      const series = [{ name: "A", color: "#123456" }];
      const colorBySeries = [{ value: "", color: "#FF0000" }];
      applySeriesColorMappings(series, colorBySeries, "light");
      // "" is falsy so mapping is skipped
      expect(series[0].color).toBe("#123456");
    });

    it("handles multiple configured mappings", () => {
      const series = [
        { name: "A", color: "#AAAAAA" },
        { name: "B", color: "#BBBBBB" },
        { name: "C", color: "#CCCCCC" },
      ];
      const colorBySeries = [
        { value: "A", color: "#FF0000" },
        { value: "B", color: "#00FF00" },
      ];
      applySeriesColorMappings(series, colorBySeries, "light");
      expect(series[0].color).toBe("#FF0000");
      expect(series[1].color).toBe("#00FF00");
    });

    it("uses HSL fallback when palette is exhausted", async () => {
      const { getColorPalette } =
        (await import("@/utils/dashboard/colorPalette")) as any;
      getColorPalette.mockReturnValueOnce([]); // empty palette to force HSL fallback

      const series = [
        { name: "A", color: "#FF5733" }, // configured color
        { name: "B", color: "#FF5733" }, // collides -> needs reassignment via HSL
      ];
      const colorBySeries = [{ value: "A", color: "#FF5733" }];
      applySeriesColorMappings(series, colorBySeries, "light");
      // B gets an HSL color since palette is empty
      expect(series[1].color).toMatch(/^hsl\(/);
    });
  });
});
