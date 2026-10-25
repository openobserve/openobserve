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
import { getAreaFillOpacity, getAreaGradientColor, getAreaStyleOverride } from "./colorPalette";

const COLOR = "#5b8ef0";
const stops = (style: any) => style.areaStyle.color.colorStops.map((s: any) => s.color);

describe("getAreaFillOpacity", () => {
  it("is null when unset or not a number, so the theme alphas apply", () => {
    [undefined, null, "", "abc", Number.NaN].forEach((fill_opacity) =>
      expect(getAreaFillOpacity("area", { fill_opacity })).toBeNull(),
    );
    expect(getAreaFillOpacity("area", undefined)).toBeNull();
  });

  it("turns the percent into an alpha, clamped to 0-1", () => {
    expect(getAreaFillOpacity("area", { fill_opacity: 40 })).toBe(0.4);
    expect(getAreaFillOpacity("area", { fill_opacity: 0 })).toBe(0);
    expect(getAreaFillOpacity("area", { fill_opacity: 250 })).toBe(1);
    expect(getAreaFillOpacity("area", { fill_opacity: -5 })).toBe(0);
  });

  it("applies to area only", () => {
    ["area-stacked", "line", "bar"].forEach((type) =>
      expect(getAreaFillOpacity(type, { fill_opacity: 40 })).toBeNull(),
    );
  });
});

describe("getAreaStyleOverride", () => {
  it("unset keys keep the theme gradient and the default opacity", () => {
    const style: any = getAreaStyleOverride("area", {}, COLOR, "s", "light", {});
    expect(style.areaStyle.color).toEqual(getAreaGradientColor(COLOR));
    expect(style.areaStyle).not.toHaveProperty("opacity");
    expect(getAreaStyleOverride("area", {}, COLOR, "s", "light")).toEqual(style);
  });

  it("a set opacity fades the gradient from that opacity to transparent", () => {
    const style: any = getAreaStyleOverride("area", {}, COLOR, "s", "dark", { fill_opacity: 30 });
    expect(style.areaStyle.opacity).toBe(0.3);
    expect(stops(style)).toEqual(["rgba(91, 142, 240, 1)", "rgba(91, 142, 240, 0)"]);
  });

  it("gradient off with a set opacity is a flat fill at that opacity", () => {
    const style: any = getAreaStyleOverride("area", {}, COLOR, "s", "dark", {
      fill_opacity: 25,
      fill_gradient: false,
    });
    expect(style.areaStyle).toEqual({ opacity: 0.25, color: COLOR });
  });

  it("gradient off without an opacity is a flat fill at the theme's top alpha", () => {
    const style: any = getAreaStyleOverride("area", {}, COLOR, "s", "light", {
      fill_gradient: false,
    });
    const topAlpha = getAreaGradientColor(COLOR).colorStops[0].color;
    expect(style.areaStyle).toEqual({ color: topAlpha });
  });

  it("area-stacked ignores the keys", () => {
    const config = { fill_opacity: 25, fill_gradient: false };
    expect(getAreaStyleOverride("area-stacked", {}, COLOR, "s", "light", config)).toEqual(
      getAreaStyleOverride("area-stacked", {}, COLOR, "s", "light"),
    );
  });

  it("returns nothing for other charts or without a base area style", () => {
    expect(getAreaStyleOverride("line", {}, COLOR, "s", "light", { fill_opacity: 25 })).toEqual({});
    expect(getAreaStyleOverride("area", null, COLOR, "s", "light", { fill_opacity: 25 })).toEqual(
      {},
    );
  });
});
