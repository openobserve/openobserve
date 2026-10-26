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

import { describe, it, expect } from "vitest";
import * as echarts from "echarts";
import { computeStepSeconds } from "@/utils/metrics/metricDefaults";
import {
  HEATMAP_LABEL_CELL_LIMIT,
  HEATMAP_MAX_CELLS,
  HEATMAP_MAX_COLUMNS,
  HEATMAP_SPLIT_AREA,
  addHeatmapWarning,
  cutHeatmapToBudget,
  cutHistogramsToBudget,
  heatmapBudgetWarning,
  heatmapCellItemStyle,
  heatmapColorRange,
  heatmapColorScale,
  histogramBudgetWarnings,
  heatmapLargeGridDefaults,
  heatmapValueLabel,
  isHeatmapColorRangeInverted,
  visualMapRangeOf,
} from "./heatmapDefaults";
import { HEATMAP_PALETTES, HEATMAP_STOP_COUNT, samplePalette } from "./heatmapPalettes";
import { HeatmapConverter } from "./promql/convertPromQLHeatmapChart";
import { chartColor } from "@/utils/chartTheme";

describe("isHeatmapColorRangeInverted", () => {
  it("is true only when both pins are set with min >= max", () => {
    expect(isHeatmapColorRangeInverted({ heatmap_color_min: 5, heatmap_color_max: 5 })).toBe(true);
    expect(isHeatmapColorRangeInverted({ heatmap_color_min: "9", heatmap_color_max: 2 })).toBe(
      true,
    );
    expect(isHeatmapColorRangeInverted({ heatmap_color_min: 1, heatmap_color_max: 2 })).toBe(false);
    expect(isHeatmapColorRangeInverted({ heatmap_color_min: 5, heatmap_color_max: null })).toBe(
      false,
    );
    expect(isHeatmapColorRangeInverted(undefined)).toBe(false);
  });
});

describe("cutHeatmapToBudget contiguous", () => {
  it("keeps the busiest unbroken run of rows instead of the busiest rows", () => {
    const totals = [9, 1, 1, 5, 6, 1];
    expect(cutHeatmapToBudget(1, totals, 2)?.rows).toEqual([0, 4]);
    expect(cutHeatmapToBudget(1, totals, 2, true)?.rows).toEqual([3, 4]);
    expect(cutHeatmapToBudget(1, totals, 6, true)).toBeNull();
  });
});

describe("shared heatmap defaults", () => {
  it("runs the colour ramp cool-to-warm", () => {
    // ColorBrewer publishes Spectral warm-first. Used in that order, a
    // histogram's near-empty high-`le` rows came out as a solid dark-red slab —
    // the loudest thing on the chart — while the busy low buckets sank into
    // blue. The eye reads hot as "more", so low must be cool.
    const stops = heatmapColorScale({}, { min: 0, max: 10 }, []).color;
    expect(stops).toHaveLength(HEATMAP_STOP_COUNT);
    expect(stops[0]).toBe("#5e4fa2");
    expect(stops.at(-1)).toBe("#9e0142");
  });

  it("strokes cells in the panel background so they read as discrete tiles", () => {
    // Without a border ECharts paints cells edge to edge and a dense heatmap
    // collapses into solid horizontal bands.
    expect(heatmapCellItemStyle({ state: { theme: "dark" } })).toEqual({
      borderColor: chartColor("--color-surface-base"),
      borderWidth: 1,
    });
    expect(heatmapCellItemStyle({ state: { theme: "light" } })).toEqual({
      borderColor: chartColor("--color-surface-base"),
      borderWidth: 1,
    });
  });

  it("survives a missing store rather than throwing", () => {
    expect(heatmapCellItemStyle(undefined).borderWidth).toBe(1);
  });

  it("turns the split-area backdrop off", () => {
    // The cell borders delineate the grid; a banded backdrop under them muddies it.
    expect(HEATMAP_SPLIT_AREA).toEqual({ show: false });
  });
});

describe("large-grid guards", () => {
  const fmt = () => "x";

  it("labels a small grid, where the numbers can actually be read", () => {
    expect(heatmapValueLabel(120, fmt)).toEqual({
      show: true,
      fontSize: 12,
      formatter: fmt,
    });
  });

  it("drops the labels once the grid is too dense to read them", () => {
    // A Prometheus histogram over a full-size panel is ~24 buckets x ~300
    // timestamps ≈ 7,000 cells. Labelling all of them means a text element AND a
    // unit-formatter call per cell — the difference between a heavy chart and a
    // hung tab. Nothing is lost: at that density the labels overlap into mush.
    expect(heatmapValueLabel(7224, fmt)).toEqual({ show: false });
  });

  it("adds nothing to a small grid", () => {
    // Animation and per-cell rendering are fine when there is little to draw.
    expect(heatmapLargeGridDefaults(120)).toEqual({});
  });

  it("chunks the render and kills the animation on a big grid", () => {
    // Nobody watches a heatmap fade in; animating thousands of rects is pure
    // cost, and `progressive` keeps the render off the main thread's critical
    // path instead of doing it in one blocking pass.
    expect(heatmapLargeGridDefaults(7224)).toEqual({
      animation: false,
      progressive: 1000,
      progressiveThreshold: 1000,
    });
  });

  it("switches over at the documented limit, not somewhere near it", () => {
    expect(heatmapValueLabel(HEATMAP_LABEL_CELL_LIMIT, fmt).show).toBe(true);
    expect(heatmapValueLabel(HEATMAP_LABEL_CELL_LIMIT + 1, fmt).show).toBe(false);
  });
});

describe("the column cap is what actually bounds the work", () => {
  // A heatmap's cost is COLUMNS x BUCKETS. Capping labels and chunking the
  // render only soften the blow; capping the COLUMNS is what stops the grid
  // being enormous in the first place. `step: "0"` let the backend decide, and
  // it returns ~300 points at any range — ~7,000 cells against a 24-bucket
  // histogram, which is what took the tab down.
  const columnsFor = (rangeSeconds: number) =>
    Math.round(rangeSeconds / computeStepSeconds(rangeSeconds, HEATMAP_MAX_COLUMNS));

  it.each([
    ["15 minutes", 15 * 60],
    ["1 hour", 60 * 60],
    ["6 hours", 6 * 60 * 60],
    ["1 day", 24 * 60 * 60],
    ["30 days", 30 * 24 * 60 * 60],
  ])("never exceeds the cap over %s", (_label, rangeSeconds) => {
    expect(columnsFor(rangeSeconds)).toBeLessThanOrEqual(HEATMAP_MAX_COLUMNS);
  });

  it("takes a 15m histogram from ~7,000 cells down to ~1,400", () => {
    // 24 le buckets is typical. This is the whole fix in one number.
    const cells = columnsFor(15 * 60) * 24;
    expect(cells).toBeLessThan(2000);
  });
});

describe("heatmapColorRange", () => {
  const auto = { min: 0, max: 100 };

  it("returns the base range untouched when nothing is pinned", () => {
    expect(heatmapColorRange({}, auto)).toEqual(auto);
    expect(heatmapColorRange(undefined, auto)).toEqual(auto);
    expect(heatmapColorRange({ heatmap_color_min: null, heatmap_color_max: "" }, auto)).toEqual(
      auto,
    );
  });

  it("pins only the min and keeps the automatic max", () => {
    expect(heatmapColorRange({ heatmap_color_min: 10 }, auto)).toEqual({
      min: 10,
      max: 100,
    });
  });

  it("pins only the max and keeps the automatic min", () => {
    expect(heatmapColorRange({ heatmap_color_max: 50 }, auto)).toEqual({
      min: 0,
      max: 50,
    });
  });

  it("pins both ends", () => {
    expect(heatmapColorRange({ heatmap_color_min: 10, heatmap_color_max: 50 }, auto)).toEqual({
      min: 10,
      max: 50,
    });
  });

  it("accepts zero as a pinned bound", () => {
    expect(heatmapColorRange({ heatmap_color_min: 0, heatmap_color_max: 0.5 }, auto)).toEqual({
      min: 0,
      max: 0.5,
    });
  });

  it.each([
    [50, 10],
    [20, 20],
  ])("ignores both pins when min %s >= max %s", (min, max) => {
    expect(heatmapColorRange({ heatmap_color_min: min, heatmap_color_max: max }, auto)).toEqual(
      auto,
    );
  });

  it("ignores a single pin that crosses the other, automatic end", () => {
    expect(heatmapColorRange({ heatmap_color_min: 100 }, auto)).toEqual(auto);
    expect(heatmapColorRange({ heatmap_color_max: -1 }, auto)).toEqual(auto);
  });

  it("ignores a non-numeric pin", () => {
    expect(heatmapColorRange({ heatmap_color_min: "abc", heatmap_color_max: 50 }, auto)).toEqual({
      min: 0,
      max: 50,
    });
  });
});

describe("a pinned colour range rendered by ECharts", () => {
  // The converter's own output, so a change to the ECharts out-of-range default fails here.
  const cellFills = (config: Record<string, any>) => {
    const values = [5, 10, 15, 20, 500];
    const options: any = new HeatmapConverter().convert(
      [
        {
          timestamps: values.map((_v, i) => [i, `00:0${i}:00`]),
          series: [
            {
              name: "s",
              values: [],
              data: Object.fromEntries(values.map((v, i) => [i, String(v)])),
            },
          ],
          queryIndex: 0,
        } as any,
      ],
      { type: "heatmap", config },
      { state: { theme: "light" } },
      { legends: [] },
    );
    const chart = echarts.init(null as any, null, {
      renderer: "svg",
      ssr: true,
      width: 400,
      height: 300,
    });
    chart.setOption({ animation: false, ...options, tooltip: undefined });
    const data = (chart as any).getModel().getSeriesByIndex(0).getData();
    const fills = values.map((_v, i) => data.getItemVisual(i, "style").fill);
    chart.dispose();
    return fills;
  };

  it("saturates cells beyond the pinned ends to the end colours", () => {
    const [below, atMin, middle, atMax, above] = cellFills({
      heatmap_color_min: 10,
      heatmap_color_max: 20,
    });

    expect(below).toMatch(/^(#|rgb)/);
    expect(above).toMatch(/^(#|rgb)/);
    expect(below).toBe(atMin);
    expect(above).toBe(atMax);
    expect(atMin).not.toBe(atMax);
    expect(middle).not.toBe(atMin);
    expect(middle).not.toBe(atMax);
  });
});

describe("cutHeatmapToBudget", () => {
  it("is 50,000 cells by default", () => {
    expect(HEATMAP_MAX_CELLS).toBe(50_000);
    expect(cutHeatmapToBudget(500, Array(100).fill(1))).toBeNull();
    expect(cutHeatmapToBudget(500, Array(101).fill(1))).not.toBeNull();
  });

  it("leaves a grid that fits untouched", () => {
    expect(cutHeatmapToBudget(4, [1, 2, 3], 12)).toBeNull();
    expect(cutHeatmapToBudget(0, [1, 2, 3], 1)).toBeNull();
  });

  it("keeps every column and the floor(budget / columns) largest rows, in their original order", () => {
    expect(cutHeatmapToBudget(4, [5, 50, 1, 30, 40], 12)).toEqual({
      firstColumn: 0,
      rows: [1, 3, 4],
    });
  });

  it("breaks equal totals by original order", () => {
    expect(cutHeatmapToBudget(2, [7, 9, 7, 7], 4)).toEqual({ firstColumn: 0, rows: [0, 1] });
  });

  it("keeps the last budget columns and the single largest row once columns alone exceed it", () => {
    expect(cutHeatmapToBudget(10, [3, 8, 8], 4)).toEqual({ firstColumn: 6, rows: [1] });
  });
});

describe("heatmap warnings", () => {
  it("says how many rows a row cut kept", () => {
    expect(heatmapBudgetWarning({ firstColumn: 0, rows: Array(400).fill(0) }, 125, 1250)).toBe(
      "Showing 400 of 1,250 rows to stay within the heatmap cell limit",
    );
  });

  it("says how many columns and rows a column cut kept", () => {
    expect(heatmapBudgetWarning({ firstColumn: 10_000, rows: [3] }, 60_000, 4)).toBe(
      "Showing the last 50,000 of 60,000 columns and 1 of 4 rows to stay within the heatmap cell limit",
    );
  });

  it("appends to an existing panel warning instead of replacing it", () => {
    const extras: any = {};
    addHeatmapWarning(extras, "First");
    addHeatmapWarning(extras, "Second");
    expect(extras.limitNumberOfSeriesWarningMessage).toBe("First. Second");
    expect(() => addHeatmapWarning(undefined, "x")).not.toThrow();
  });
});

describe("visualMapRangeOf", () => {
  it("floors at 0 for non-negative data and follows the data below 0", () => {
    expect(visualMapRangeOf(3, 9)).toEqual({ min: 0, max: 9 });
    expect(visualMapRangeOf(-9, -3)).toEqual({ min: -9, max: -3 });
    expect(visualMapRangeOf(Infinity, -Infinity)).toEqual({ min: 0, max: 0 });
  });
});

describe("heatmapColorScale", () => {
  const range = { min: 0, max: 100 };
  const stopsOf = (config: Record<string, any>, cellSets: any[][] = []) =>
    heatmapColorScale(config, range, cellSets).color;

  it("is the square-root-warped Spectral ramp over the given range when nothing is configured", () => {
    const scale = heatmapColorScale({}, range, []);
    expect(scale.min).toBe(0);
    expect(scale.max).toBe(100);
    expect([scale.color[1], scale.color[10], scale.color[20], scale.color[39]]).toEqual([
      "#50aaaf",
      "#ffffbf",
      "#fca95f",
      "#a50944",
    ]);
    expect(stopsOf({ heatmap_color_scale: "sqrt" })).toEqual(scale.color);
    expect(stopsOf({ heatmap_color_scale: "unknown" })).toEqual(scale.color);
  });

  it.each(Object.keys(HEATMAP_PALETTES))("runs %s from its first stop to its last", (id) => {
    const stops = stopsOf({ heatmap_palette: id });
    expect(stops).toHaveLength(HEATMAP_STOP_COUNT);
    expect(stops[0]).toBe(HEATMAP_PALETTES[id][0]);
    expect(stops.at(-1)).toBe(HEATMAP_PALETTES[id].at(-1));
  });

  it("offers the eight palettes, each a valid hex ramp", () => {
    expect(Object.keys(HEATMAP_PALETTES)).toEqual([
      "spectral",
      "viridis",
      "magma",
      "inferno",
      "blues",
      "greens",
      "reds",
      "rd-yl-bu",
    ]);
    for (const stops of Object.values(HEATMAP_PALETTES)) {
      expect(stops.length).toBeGreaterThan(2);
      for (const stop of stops) expect(stop).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("falls back to Spectral for an unknown palette id", () => {
    expect(stopsOf({ heatmap_palette: "nope" })).toEqual(stopsOf({}));
  });

  it("reverses the ramp before the scale warp, so the low end stays stretched", () => {
    const stops = stopsOf({ heatmap_palette: "viridis", heatmap_palette_reverse: true });
    expect(stops[0]).toBe("#fde725");
    expect(stops.at(-1)).toBe("#440154");
    const reversed = [...HEATMAP_PALETTES.viridis].reverse();
    expect(stops[1]).toBe(samplePalette(reversed, Math.sqrt(1 / (HEATMAP_STOP_COUNT - 1))));
  });

  it("samples a linear scale at the stop's own position", () => {
    const stops = stopsOf({ heatmap_color_scale: "linear" });
    expect(stops[10]).toBe(samplePalette(HEATMAP_PALETTES.spectral, 10 / 40));
    expect(stops[10]).not.toBe(stopsOf({})[10]);
  });

  it("runs a log scale from the smallest positive cell to max", () => {
    const cells = [
      [0, 0, 0],
      [1, 0, 1],
      [2, 0, "-"],
      [3, 0, 100],
    ];
    const scale = heatmapColorScale({ heatmap_color_scale: "log" }, range, [cells]);
    expect(scale.min).toBe(1);
    expect(scale.max).toBe(100);
    expect(scale.color[0]).toBe("#5e4fa2");
    expect(scale.color.at(-1)).toBe("#9e0142");
    // Stop 20 sits at value 50.5 on the [1, 100] bar.
    expect(scale.color[20]).toBe(
      samplePalette(HEATMAP_PALETTES.spectral, Math.log(50.5) / Math.log(100)),
    );
  });

  it("puts every value at or below the log floor under the bar, so it takes the lowest colour", () => {
    const scale = heatmapColorScale({ heatmap_color_scale: "log" }, { min: -40, max: 40 }, [
      [[0, 0, 4]],
    ]);
    expect(scale.min).toBe(4);
    expect(scale.max).toBe(40);
  });

  it("uses a pinned min above the smallest cell as the log floor", () => {
    const scale = heatmapColorScale({ heatmap_color_scale: "log" }, { min: 10, max: 1000 }, [
      [[0, 0, 1]],
    ]);
    expect(scale.min).toBe(10);
    expect(scale.color[1]).toBe(
      samplePalette(HEATMAP_PALETTES.spectral, Math.log(34.75 / 10) / Math.log(100)),
    );
  });

  it("falls back to linear when no cell is positive", () => {
    const negative = { min: -5, max: 0 };
    expect(heatmapColorScale({ heatmap_color_scale: "log" }, negative, [[[0, 0, -3]]])).toEqual(
      heatmapColorScale({ heatmap_color_scale: "linear" }, negative, []),
    );
  });
});

describe("colour scales rendered by ECharts", () => {
  const cellFills = (config: Record<string, any>, values: number[]) => {
    const options: any = new HeatmapConverter().convert(
      [
        {
          timestamps: values.map((_v, i) => [i, `00:0${i}:00`]),
          series: [
            {
              name: "s",
              values: [],
              data: Object.fromEntries(values.map((v, i) => [i, String(v)])),
            },
          ],
          queryIndex: 0,
        } as any,
      ],
      { type: "heatmap", config },
      { state: { theme: "light" } },
      { legends: [] },
    );
    const chart = echarts.init(null as any, null, {
      renderer: "svg",
      ssr: true,
      width: 400,
      height: 300,
    });
    chart.setOption({ animation: false, ...options, tooltip: undefined });
    const data = (chart as any).getModel().getSeriesByIndex(0).getData();
    const fills = values.map((_v, i) => data.getItemVisual(i, "style").fill);
    chart.dispose();
    return fills;
  };

  it("draws the same low cell differently under each scale", () => {
    const values = [0, 40, 1000];
    const low = (scale: string) => cellFills({ heatmap_color_scale: scale }, values)[1];
    expect(new Set([low("linear"), low("sqrt"), low("log")]).size).toBe(3);
  });

  it("gives a zero cell the lowest colour on a log scale", () => {
    const [negative, zero, smallest, middle] = cellFills(
      { heatmap_color_scale: "log" },
      [-3, 0, 1, 50, 1000],
    );
    expect(zero).toBe(smallest);
    expect(negative).toBe(smallest);
    expect(middle).not.toBe(smallest);
  });

  it("paints the chosen palette's ends", () => {
    const [low, high] = cellFills({ heatmap_palette: "blues" }, [0, 10]);
    expect([low, high]).toEqual(["rgba(247,251,255,1)", "rgba(8,48,107,1)"]);
  });
});

describe("cutHistogramsToBudget", () => {
  it("leaves a stack that fits untouched", () => {
    expect(cutHistogramsToBudget(10, [5, 5], [1, 2], 100)).toBeNull();
  });

  it("drops the smallest histograms first and keeps the rest in their original order", () => {
    expect(cutHistogramsToBudget(10, [4, 4, 4], [9, 1, 5], 80)).toEqual({
      groups: [0, 2],
      firstColumn: 0,
    });
  });

  it("keeps every bucket of the one histogram left and cuts its oldest columns", () => {
    expect(cutHistogramsToBudget(120, [500], [1], 50_000)).toEqual({
      groups: [0],
      firstColumn: 20,
    });
  });

  it("drops histograms before cutting columns", () => {
    expect(cutHistogramsToBudget(100, [300, 300], [1, 2], 20_000)).toEqual({
      groups: [1],
      firstColumn: 34,
    });
  });

  it("keeps one column when even that exceeds the budget", () => {
    expect(cutHistogramsToBudget(5, [200], [1], 100)).toEqual({ groups: [0], firstColumn: 4 });
  });

  it("warns about dropped histograms and cut columns", () => {
    expect(histogramBudgetWarnings({ groups: [1], firstColumn: 34 }, 100, 2)).toEqual([
      "Showing the 1 busiest of 2 histograms to stay within the heatmap cell limit",
      "Showing the last 66 of 100 columns to stay within the heatmap cell limit",
    ]);
    expect(histogramBudgetWarnings({ groups: [0, 1], firstColumn: 0 }, 100, 2)).toEqual([]);
  });
});
