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

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  colorToRgba,
  createDistinctSeriesColor,
  getAreaFillOpacity,
  getAreaGradientColor,
  getAreaStyleOverride,
  getDistinctSeriesColors,
  getSeriesHash,
} from "./colorPalette";

const COLOR = "#5b8ef0";
const stops = (style: any) => style.areaStyle.color.colorStops.map((s: any) => s.color);

describe("colorToRgba", () => {
  it.each([
    ["#5b8ef0", "rgba(91, 142, 240, 0.4)"],
    ["#f00", "rgba(255, 0, 0, 0.4)"],
    ["#ff000080", "rgba(255, 0, 0, 0.4)"],
    ["rgb(1, 2, 3)", "rgba(1, 2, 3, 0.4)"],
    ["rgba(1, 2, 3, 0.9)", "rgba(1, 2, 3, 0.4)"],
    ["red", "rgba(255, 0, 0, 0.4)"],
    ["hsl(120, 100%, 50%)", "rgba(0, 255, 0, 0.4)"],
  ])("sets the alpha of %s", (color, expected) => {
    expect(colorToRgba(color, 0.4)).toBe(expected);
  });

  it.each(["", "not-a-color"])("returns %o unchanged when it cannot be parsed", (color) => {
    expect(colorToRgba(color, 0.4)).toBe(color);
  });

  it("gives a named colour's gradient two different stops", () => {
    const style = getAreaStyleOverride("area", {}, "orange", "s", "light", { fill_opacity: 50 });
    const [top, bottom] = stops(style);
    expect(top).not.toBe(bottom);
  });
});

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

describe("area fill tokens", () => {
  const tokens = ["top", "bottom"].flatMap((edge) => [
    `--chart-area-fill-${edge}-opacity`,
    `--chart-area-stacked-fill-${edge}-opacity`,
  ]);
  // Vitest stubs CSS imports (even ?raw) to empty strings, so the token files are read from disk.
  const read = (file: string) =>
    readFileSync(resolve(process.cwd(), "src/lib/styles/tokens", file), "utf8");
  const value = (css: string, token: string) =>
    css.match(new RegExp(`${token}:\\s*([^;]+);`))?.[1].trim();

  afterEach(() => tokens.forEach((t) => document.documentElement.style.removeProperty(t)));

  it("area reads the area tokens and area-stacked its own", () => {
    const root = document.documentElement.style;
    root.setProperty("--chart-area-fill-top-opacity", "0.9");
    root.setProperty("--chart-area-fill-bottom-opacity", "0.4");
    root.setProperty("--chart-area-stacked-fill-top-opacity", "1");
    root.setProperty("--chart-area-stacked-fill-bottom-opacity", "1");
    expect(stops(getAreaStyleOverride("area", {}, COLOR, "s", "dark"))).toEqual([
      "rgba(91, 142, 240, 0.9)",
      "rgba(91, 142, 240, 0.4)",
    ]);
    expect(stops(getAreaStyleOverride("area-stacked", {}, COLOR, "s", "dark"))).toEqual([
      "rgba(91, 142, 240, 1)",
      "rgba(91, 142, 240, 1)",
    ]);
  });

  it("dark keeps unstacked areas at the light alphas and stacked areas opaque", () => {
    const baseCss = read("base.css");
    const darkCss = read("dark.css");
    tokens.forEach((t) => expect(value(baseCss, t)).toBeDefined());
    expect(value(baseCss, "--chart-area-stacked-fill-top-opacity")).toBe(
      value(baseCss, "--chart-area-fill-top-opacity"),
    );
    expect(value(baseCss, "--chart-area-stacked-fill-bottom-opacity")).toBe(
      value(baseCss, "--chart-area-fill-bottom-opacity"),
    );
    expect(value(darkCss, "--chart-area-fill-top-opacity")).toBeUndefined();
    expect(value(darkCss, "--chart-area-fill-bottom-opacity")).toBeUndefined();
    expect(value(darkCss, "--chart-area-stacked-fill-top-opacity")).toBe("1");
    expect(value(darkCss, "--chart-area-stacked-fill-bottom-opacity")).toBe("1");
  });
});

describe("getDistinctSeriesColors", () => {
  // Vitest stubs CSS imports, so the shipped light/dark series palettes are read from disk.
  const palette = (file: string) => {
    const css = readFileSync(resolve(process.cwd(), "src/lib/styles/tokens", file), "utf8");
    return Array.from(
      { length: 12 },
      (_, i) => css.match(new RegExp(`--color-chart-series-${i + 1}:\\s*(#[0-9a-f]{6})`, "i"))![1],
    );
  };
  const phases = ["Failed", "Pending", "Running", "Succeeded", "Unknown"];

  it.each(["base.css", "dark.css"])("gives pod phases five different colours in %s", (file) => {
    const colors = palette(file);
    // The bare name hash sends Pending and Succeeded to one slot and Failed to its near-twin amber.
    expect(getSeriesHash("Pending", colors)).toBe(getSeriesHash("Succeeded", colors));
    const assigned = getDistinctSeriesColors(phases, colors);
    expect(new Set(assigned.values()).size).toBe(5);
    const amberTwins = [colors[5], colors[11]];
    expect(phases.filter((p) => amberTwins.includes(assigned.get(p)!))).toHaveLength(1);
  });

  it("keeps a name that does not collide on its hash colour", () => {
    const colors = palette("base.css");
    expect(getDistinctSeriesColors(phases, colors).get("Running")).toBe(
      colors[getSeriesHash("Running", colors)],
    );
  });

  it("does not depend on the order the names arrive in", () => {
    const colors = palette("base.css");
    const forward = getDistinctSeriesColors(phases, colors);
    const backward = getDistinctSeriesColors([...phases].reverse(), colors);
    phases.forEach((p) => expect(backward.get(p)).toBe(forward.get(p)));
  });

  it("keeps every uncontested name on its colour in any subset of the names", () => {
    const colors = palette("base.css");
    const full = getDistinctSeriesColors(phases, colors);
    const uncontested = phases.filter((p) => full.get(p) === colors[getSeriesHash(p, colors)]);
    expect(uncontested.length).toBeGreaterThanOrEqual(3);
    for (let mask = 1; mask < 1 << phases.length; mask++) {
      const subset = phases.filter((_, i) => mask & (1 << i));
      const assigned = getDistinctSeriesColors(subset, colors);
      subset
        .filter((p) => uncontested.includes(p))
        .forEach((p) => expect(assigned.get(p)).toBe(full.get(p)));
    }
  });

  it("keeps a name's colour when other names disappear, unless a sorted-earlier name shares its hash slot", () => {
    const colors = palette("base.css");
    const alone = getDistinctSeriesColors(["Succeeded"], colors).get("Succeeded");
    expect(alone).toBe(colors[getSeriesHash("Succeeded", colors)]);
    expect(getDistinctSeriesColors(["Running", "Succeeded"], colors).get("Succeeded")).toBe(alone);
    expect(getDistinctSeriesColors(["Succeeded", "Unknown"], colors).get("Succeeded")).toBe(alone);
    // Pending hashes to the same slot and sorts first, so it holds that colour whenever present.
    expect(getDistinctSeriesColors(["Pending", "Succeeded"], colors).get("Succeeded")).not.toBe(
      alone,
    );
  });

  it("never auto-assigns a reserved colour or a near shade of it", () => {
    const colors = palette("base.css");
    const home = colors[getSeriesHash("Running", colors)];
    const nearShade = `#${((parseInt(home.slice(1), 16) + 0x020202) & 0xffffff).toString(16).padStart(6, "0")}`;
    [home, nearShade].forEach((reserved) => {
      const assigned = getDistinctSeriesColors(phases, colors, [reserved]);
      expect([...assigned.values()]).not.toContain(home);
      expect(new Set(assigned.values()).size).toBe(phases.length);
    });
  });

  it("reuses colours only once every slot is taken", () => {
    const names = Array.from({ length: 14 }, (_, i) => `series-${i}`);
    const assigned = getDistinctSeriesColors(names, palette("base.css"));
    expect(new Set(assigned.values()).size).toBe(12);
  });
});

describe("createDistinctSeriesColor", () => {
  const root = document.documentElement.style;
  const hexes = ["#5b8ef0", "#34d399", "#fb923c", "#f472b6"];
  afterEach(() => hexes.forEach((_, i) => root.removeProperty(`--color-chart-series-${i + 1}`)));

  it("leaves non-hash colour modes to getSeriesColor", () => {
    const color = createDistinctSeriesColor(["a", "b"], { mode: "fixed" }, "light");
    expect(color("a")).toBeUndefined();
  });

  it("skips names that have their own colorBySeries mapping", () => {
    hexes.forEach((hex, i) => root.setProperty(`--color-chart-series-${i + 1}`, hex));
    const color = createDistinctSeriesColor(
      ["a", "b"],
      { mode: "palette-classic-by-series", colorBySeries: [{ value: "a", color: "#000000" }] },
      "light",
    );
    expect(color("a")).toBeUndefined();
    expect(color("b")).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("keeps a colorBySeries colour away from the automatic slices", () => {
    hexes.forEach((hex, i) => root.setProperty(`--color-chart-series-${i + 1}`, hex));
    const auto = createDistinctSeriesColor(
      ["a", "b"],
      { mode: "palette-classic-by-series" },
      "light",
    );
    const bColor = auto("b")!;
    const color = createDistinctSeriesColor(
      ["a", "b"],
      { mode: "palette-classic-by-series", colorBySeries: [{ value: "a", color: bColor }] },
      "light",
    );
    expect(color("b")).toBeDefined();
    expect(color("b")).not.toBe(bColor);
  });
});
