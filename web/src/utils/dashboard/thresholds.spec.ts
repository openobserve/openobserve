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
import * as echarts from "echarts";
import {
  applyGaugeThresholds,
  applyLineAreaThresholds,
  buildBandAreaData,
  buildGaugeAxisLineColors,
  buildLimitLineData,
  gaugeDialRange,
  limitDash,
  buildThresholdPieces,
  buildThresholdVisualMap,
  echartsPaletteColor,
  getLineAreaPercentRange,
  getStackedPercentRange,
  getSeriesThresholds,
  metricThresholdColor,
  normalizeThresholds,
  resolveStepValues,
  stepColorFor,
  type Thresholds,
} from "./thresholds";
import { formatUnitValue, getUnitValue } from "./convertDataIntoUnitValue";
import { toSeriesOverrideEntry } from "./seriesOverrides";

// Chart overrides are stored as `series` / `series_regex` entries of override_config.
const seriesEntries = (overrides: any[]) =>
  overrides.map((o) => toSeriesOverrideEntry(o)).filter((e) => e !== null);

const AMBER = "#F59E0B";
const RED = "#EF4444";
const GREEN = "#22C55E";

const t = (extra: Partial<Thresholds> = {}): Thresholds => ({
  mode: "absolute",
  showAs: "color_line",
  baseColor: null,
  steps: [
    { value: 500, color: AMBER },
    { value: 1000, color: RED },
  ],
  ...extra,
});

describe("normalizeThresholds", () => {
  it("returns null for absent, non-object or step-less input", () => {
    expect(normalizeThresholds(undefined)).toBeNull();
    expect(normalizeThresholds(null)).toBeNull();
    expect(normalizeThresholds("x")).toBeNull();
    expect(normalizeThresholds({ steps: [] })).toBeNull();
    expect(normalizeThresholds({ mode: "absolute" })).toBeNull();
  });

  it("sorts steps ascending and drops invalid ones", () => {
    const result = normalizeThresholds({
      steps: [
        { value: 1000, color: RED },
        { value: "abc", color: AMBER },
        { value: 200, color: "" },
        { value: null, color: GREEN },
        { value: Infinity, color: GREEN },
        { value: "500", color: AMBER },
        { color: GREEN },
      ],
    });
    expect(result?.steps).toEqual([
      { value: 500, color: AMBER },
      { value: 1000, color: RED },
    ]);
  });

  it("returns null when every step is invalid", () => {
    expect(normalizeThresholds({ steps: [{ value: "x", color: RED }, { value: 1 }] })).toBeNull();
  });

  it("keeps the later step when two share a value", () => {
    const result = normalizeThresholds({
      steps: [
        { value: 5, color: AMBER },
        { value: 5, color: RED },
      ],
    });
    expect(result?.steps).toEqual([{ value: 5, color: RED }]);
  });

  it("defaults mode, showAs and baseColor", () => {
    expect(normalizeThresholds({ steps: [{ value: 1, color: RED }] })).toEqual({
      mode: "absolute",
      showAs: "color_line",
      baseColor: null,
      steps: [{ value: 1, color: RED }],
    });
  });

  it("keeps known mode/showAs/baseColor and rejects unknown ones", () => {
    const steps = [{ value: 1, color: RED }];
    expect(
      normalizeThresholds({ mode: "percentage", showAs: "color_band", baseColor: GREEN, steps }),
    ).toMatchObject({ mode: "percentage", showAs: "color_band", baseColor: GREEN });
    expect(
      normalizeThresholds({ mode: "weird", showAs: "nope", baseColor: "", steps }),
    ).toMatchObject({ mode: "absolute", showAs: "color_line", baseColor: null });
  });
});

describe("getSeriesThresholds", () => {
  it("returns the panel thresholds for any series", () => {
    const config = { thresholds: { steps: [{ value: 500, color: AMBER }] } };
    expect(getSeriesThresholds(config, "api")?.steps).toEqual([{ value: 500, color: AMBER }]);
    expect(getSeriesThresholds(config, "web")?.steps).toEqual([{ value: 500, color: AMBER }]);
  });

  it("returns null when the panel has no thresholds", () => {
    expect(getSeriesThresholds({}, "api")).toBeNull();
    expect(getSeriesThresholds(undefined, "api")).toBeNull();
  });
});

describe("resolveStepValues", () => {
  it("leaves absolute steps unchanged", () => {
    const abs = t();
    expect(resolveStepValues(abs, { min: 0, max: 10 })).toBe(abs);
  });

  it("maps percentage steps onto the range", () => {
    const pct = t({
      mode: "percentage",
      steps: [
        { value: 50, color: AMBER },
        { value: 90, color: RED },
      ],
    });
    expect(resolveStepValues(pct, { min: 100, max: 300 })?.steps).toEqual([
      { value: 200, color: AMBER },
      { value: 280, color: RED },
    ]);
    expect(resolveStepValues(pct, { min: 100, max: 300 })?.mode).toBe("absolute");
  });

  it("returns null for percentage steps without a finite range", () => {
    const pct = t({ mode: "percentage" });
    expect(resolveStepValues(pct, null)).toBeNull();
    expect(resolveStepValues(pct, { min: Infinity, max: -Infinity })).toBeNull();
  });
});

describe("stepColorFor", () => {
  it("returns the highest step at or below the value", () => {
    expect(stepColorFor(500, t(), "#000")).toBe(AMBER);
    expect(stepColorFor(999, t(), "#000")).toBe(AMBER);
    expect(stepColorFor(1000, t(), "#000")).toBe(RED);
    expect(stepColorFor("1200.5", t(), "#000")).toBe(RED);
  });

  it("returns the fallback below the first step when no base colour is set", () => {
    expect(stepColorFor(499, t(), "#000")).toBe("#000");
    expect(stepColorFor(-5, t(), null)).toBeNull();
  });

  it("prefers the thresholds' own base colour below the first step", () => {
    expect(stepColorFor(10, t({ baseColor: GREEN }), "#000")).toBe(GREEN);
  });

  it("treats a non-numeric value as below the first step", () => {
    expect(stepColorFor(null, t(), "#000")).toBe("#000");
    expect(stepColorFor("n/a", t({ baseColor: GREEN }), "#000")).toBe(GREEN);
  });
});

describe("visualMap pieces", () => {
  it("leaves the range below the first step uncovered without a base colour", () => {
    expect(buildThresholdPieces(t())).toEqual([
      { gte: 500, lt: 1000, color: AMBER },
      { gte: 1000, color: RED },
    ]);
  });

  it("adds a base piece when a base colour is set", () => {
    expect(buildThresholdPieces(t({ baseColor: GREEN }))[0]).toEqual({ lt: 500, color: GREEN });
  });

  it("splits a single step in two same-colour pieces so one piece is bounded", () => {
    const one = (value: number) => t({ steps: [{ value, color: RED }] });
    expect(buildThresholdPieces(one(500))).toEqual([
      { gte: 500, lt: 1000, color: RED },
      { gte: 1000, color: RED },
    ]);
    expect(buildThresholdPieces(one(0))).toEqual([
      { gte: 0, lt: 1, color: RED },
      { gte: 1, color: RED },
    ]);
    expect(buildThresholdPieces(one(-40))[0]).toEqual({ gte: -40, lt: 0, color: RED });
  });

  it("builds a hidden piecewise map on the value dimension of one series", () => {
    expect(buildThresholdVisualMap(t(), 3)).toEqual({
      type: "piecewise",
      show: false,
      seriesIndex: 3,
      dimension: 1,
      pieces: buildThresholdPieces(t()),
      inRange: { color: [AMBER] },
      outOfRange: {},
    });
  });
});

describe("limit lines and bands", () => {
  it("builds one dashed, labelled line per step in its colour", () => {
    const lines = buildLimitLineData(t(), (v) => `${v} ms`);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      yAxis: 500,
      lineStyle: { color: AMBER, type: [12, 4] },
      label: { show: true, color: AMBER },
    });
    expect(lines[1].label.formatter()).toBe("1000 ms");
  });

  it("builds bands between steps up to the plot edge", () => {
    const bands = buildBandAreaData(t());
    expect(bands).toHaveLength(2);
    expect(bands[0][0].yAxis).toBe(500);
    expect(bands[0][1].yAxis).toBe(1000);
    expect(bands[1][1].yAxis).toBe(Infinity);
    expect(bands[0][0].itemStyle.color).toBe("rgba(245, 158, 11, 0.12)");
  });

  it("adds a base band from the plot bottom when a base colour is set", () => {
    const bands = buildBandAreaData(t({ baseColor: GREEN }));
    expect(bands).toHaveLength(3);
    expect(bands[0][0].yAxis).toBe(-Infinity);
    expect(bands[0][1].yAxis).toBe(500);
  });
});

describe("gauge", () => {
  it("builds translucent axisLine stops as fractions of min..max", () => {
    expect(buildGaugeAxisLineColors(t(), 0, 2000, "#112233")).toEqual([
      [0.25, "rgba(17, 34, 51, 0.28)"],
      [0.5, "rgba(245, 158, 11, 0.28)"],
      [1, "rgba(239, 68, 68, 0.28)"],
    ]);
  });

  it("clamps steps outside min..max", () => {
    const stops = buildGaugeAxisLineColors(t(), 0, 800, "#112233");
    expect(stops.map((s) => s[0])).toEqual([0.625, 1, 1]);
  });

  it("colours the progress by the value's step and bands the arc", () => {
    const gauge: any = {
      min: 0,
      max: 2000,
      axisLine: { lineStyle: { width: "20" } },
      data: [{ name: "api", value: 1200, itemStyle: { color: "#112233" } }],
    };
    applyGaugeThresholds(gauge, t(), "#999999");
    expect(gauge.data[0].itemStyle.color).toBe(RED);
    expect(gauge.axisLine.lineStyle.width).toBe("20");
    expect(gauge.axisLine.lineStyle.color[0]).toEqual([0.25, "rgba(17, 34, 51, 0.28)"]);
  });

  it("keeps the gauge colour below the first step and falls back to the palette colour", () => {
    const gauge: any = { min: 0, max: 100, data: [{ value: 10, itemStyle: { color: null } }] };
    applyGaugeThresholds(gauge, t({ steps: [{ value: 50, color: RED }] }), "#5070dd");
    expect(gauge.data[0].itemStyle.color).toBe("#5070dd");
    expect(gauge.axisLine.lineStyle.color[0][1]).toBe("rgba(80, 112, 221, 0.28)");
  });

  it("resolves percentage steps against the gauge min..max", () => {
    const gauge: any = { min: 0, max: 200, data: [{ value: 150, itemStyle: { color: "#000" } }] };
    applyGaugeThresholds(
      gauge,
      t({ mode: "percentage", steps: [{ value: 70, color: RED }] }),
      "#000",
    );
    expect(gauge.data[0].itemStyle.color).toBe(RED);
    expect(gauge.axisLine.lineStyle.color[0][0]).toBe(0.7);
  });

  it("gives the ECharts palette colour by series position", () => {
    expect(echartsPaletteColor(0)).toBe("#5070dd");
    expect(echartsPaletteColor(0)).not.toBe(echartsPaletteColor(1));
  });
});

describe("metricThresholdColor", () => {
  it("returns the step colour, the base colour, or null", () => {
    expect(metricThresholdColor(1200, t())).toBe(RED);
    expect(metricThresholdColor(10, t())).toBeNull();
    expect(metricThresholdColor(10, t({ baseColor: GREEN }))).toBe(GREEN);
    expect(metricThresholdColor(10, null)).toBeNull();
  });
});

const lineOptions = (seriesExtra: Record<string, any> = {}) => ({
  series: [
    {
      name: "api",
      data: [
        [1, 100],
        [2, 600],
        [3, 1200],
      ],
      markLine: { silent: true, data: [{ yAxis: 700, name: "SLO" }] },
      ...seriesExtra,
    },
    { name: "web", data: [50, 300, 900], ...seriesExtra },
    { type: "line", data: [["t", null]], markLine: { data: [] }, zlevel: 1 },
  ],
});

const panel = (type: string, thresholds: any, extra: Record<string, any> = {}) => ({
  type,
  config: { unit: "milliseconds", decimals: 0, thresholds, ...extra },
});

const steps = { steps: t().steps };

const markers = (options: any) =>
  options.series.filter((s: any) => s.name === undefined && s.data.length === 0);

describe("applyLineAreaThresholds", () => {
  it("does nothing without thresholds or on other chart types", () => {
    const options = lineOptions();
    const before = JSON.stringify(options);
    applyLineAreaThresholds(options, panel("line", undefined));
    applyLineAreaThresholds(options, panel("stacked", steps));
    applyLineAreaThresholds(options, panel("h-stacked", steps));
    expect(JSON.stringify(options)).toBe(before);
    expect(options).not.toHaveProperty("visualMap");
  });

  it("color_line: one visualMap per data series and limit lines once per panel", () => {
    const options: any = lineOptions();
    applyLineAreaThresholds(options, panel("line", steps));
    expect(options.visualMap.map((v: any) => v.seriesIndex)).toEqual([0, 1]);
    expect(options.series).toHaveLength(4);
    const [marker] = markers(options);
    expect(marker).toMatchObject({
      type: "line",
      xAxisIndex: 0,
      yAxisIndex: 0,
      markLine: { silent: true, symbol: ["none", "none"] },
    });
    expect(marker.markLine.data.map((d: any) => d.yAxis)).toEqual([500, 1000]);
    expect(marker.markLine.data[0].label.formatter()).toBe("500ms");
    expect(marker.markArea).toBeUndefined();
    expect(options.series[0].markLine.data).toEqual([{ yAxis: 700, name: "SLO" }]);
    expect(options.series[1].markLine).toBeUndefined();
  });

  it("color: visualMap only", () => {
    const options: any = lineOptions();
    applyLineAreaThresholds(options, panel("line", { ...steps, showAs: "color" }));
    expect(options.visualMap).toHaveLength(2);
    expect(markers(options)).toHaveLength(0);
  });

  it("line: limit lines only", () => {
    const options: any = lineOptions();
    applyLineAreaThresholds(options, panel("line", { ...steps, showAs: "line" }));
    expect(options.visualMap).toBeUndefined();
    expect(markers(options)[0].markLine.data).toHaveLength(2);
  });

  it("color_band: visualMap, limit lines and bands", () => {
    const options: any = lineOptions();
    applyLineAreaThresholds(options, panel("area", { ...steps, showAs: "color_band" }));
    expect(options.visualMap).toHaveLength(2);
    const [marker] = markers(options);
    expect(marker.markArea).toMatchObject({ silent: true });
    expect(marker.markArea.data).toHaveLength(2);
    expect(marker.markLine.data).toHaveLength(2);
  });

  it("area: drops the gradient fill colour so the fill follows the steps", () => {
    const gradient = { type: "linear", colorStops: [] };
    const options: any = lineOptions({ areaStyle: { color: gradient } });
    applyLineAreaThresholds(options, panel("area", steps));
    expect(options.series[0].areaStyle.color).toBeUndefined();
    expect(typeof options.series[0].areaStyle.opacity).toBe("number");
  });

  it("area-stacked: never recoloured, limit lines only", () => {
    const gradient = { type: "linear", colorStops: [] };
    const options: any = lineOptions({ areaStyle: { color: gradient } });
    applyLineAreaThresholds(options, panel("area-stacked", steps));
    expect(options.visualMap).toBeUndefined();
    expect(options.series[0].areaStyle.color).toBe(gradient);
    expect(markers(options)[0].markLine.data).toHaveLength(2);
  });

  it("area-stacked with color_band gets bands but no colouring", () => {
    const options: any = lineOptions();
    applyLineAreaThresholds(options, panel("area-stacked", { ...steps, showAs: "color_band" }));
    expect(options.visualMap).toBeUndefined();
    expect(markers(options)[0].markArea.data).toHaveLength(2);
  });

  it("percentage: resolves against the data shown", () => {
    const pct = {
      mode: "percentage",
      steps: [{ value: 50, color: RED }],
    };
    const options: any = lineOptions();
    applyLineAreaThresholds(options, panel("line", pct));
    // data shown spans 50..1200, so 50% is 625
    expect(options.visualMap[0].pieces[0]).toEqual({ gte: 625, lt: 1250, color: RED });
  });

  it("percentage: resolves against the y-axis range when both ends are set", () => {
    const pct = { mode: "percentage", steps: [{ value: 50, color: RED }] };
    const options: any = lineOptions();
    applyLineAreaThresholds(options, panel("line", pct, { y_axis_min: 0, y_axis_max: 2000 }));
    expect(options.visualMap[0].pieces[0]).toEqual({ gte: 1000, lt: 2000, color: RED });
  });

  it("draws limit lines once per grid in trellis layouts", () => {
    const options: any = lineOptions();
    options.series[1].xAxisIndex = 1;
    options.series[1].yAxisIndex = 1;
    applyLineAreaThresholds(options, panel("line", steps));
    const grids = markers(options).map((m: any) => [m.xAxisIndex, m.yAxisIndex]);
    expect(grids).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  it("keeps one set of lines when every series has the same steps", () => {
    const options: any = lineOptions();
    applyLineAreaThresholds(options, panel("line", steps));
    expect(markers(options)).toHaveLength(1);
    expect(markers(options)[0].markLine.data).toHaveLength(2);
  });

  it("appends to an existing visualMap", () => {
    const options: any = { ...lineOptions(), visualMap: { type: "continuous" } };
    applyLineAreaThresholds(options, panel("line", steps));
    expect(options.visualMap).toHaveLength(3);
    expect(options.visualMap[0]).toEqual({ type: "continuous" });
  });
});

describe("axis reach for limit lines", () => {
  const withAxis = (extra: Record<string, any> = {}) => ({
    ...lineOptions(),
    yAxis: { type: "value", ...extra },
  });

  it("stretches an auto max to the highest limit with headroom", () => {
    const options: any = withAxis();
    applyLineAreaThresholds(options, panel("line", { steps: [{ value: 2000, color: RED }] }));
    expect(typeof options.yAxis.max).toBe("function");
    expect(options.yAxis.max({ min: 50, max: 1200 })).toBe(2500);
    expect(options.yAxis.max({ min: 50, max: 2600 })).toBeNull();
  });

  it("gives the top limit label room when it sits at the data max", () => {
    const options: any = withAxis();
    applyLineAreaThresholds(options, panel("line", { steps: [{ value: 800, color: RED }] }));
    expect(options.yAxis.max({ min: 0, max: 790 })).toBe(900);
  });

  it("reaches a negative limit below the data", () => {
    const options: any = withAxis();
    applyLineAreaThresholds(options, panel("line", { steps: [{ value: -300, color: RED }] }));
    expect(options.yAxis.min({ min: 0, max: 1200 })).toBe(-450);
    expect(options.yAxis.min({ min: -900, max: 1200 })).toBeNull();
  });

  it("keeps a user-set y-axis max and min", () => {
    const options: any = withAxis({ max: 1500 });
    applyLineAreaThresholds(
      options,
      panel(
        "line",
        {
          steps: [
            { value: -2000, color: RED },
            { value: 2000, color: RED },
          ],
        },
        { y_axis_min: 0 },
      ),
    );
    expect(options.yAxis.max).toBe(1500);
    expect(options.yAxis.min).toBeUndefined();
  });

  it("does not touch the axis without thresholds or with colour only", () => {
    const plain: any = withAxis();
    applyLineAreaThresholds(plain, panel("line", undefined));
    expect(plain.yAxis).toEqual({ type: "value" });
    const colourOnly: any = withAxis();
    applyLineAreaThresholds(colourOnly, panel("line", { ...steps, showAs: "color" }));
    expect(colourOnly.yAxis.max).toBeUndefined();
  });

  it("stretches each trellis axis by its own limits", () => {
    const options: any = { ...lineOptions(), yAxis: [{}, {}] };
    options.series[1].yAxisIndex = 1;
    applyLineAreaThresholds(options, panel("line", { steps: [{ value: 3000, color: RED }] }));
    expect(typeof options.yAxis[0].max).toBe("function");
    expect(typeof options.yAxis[1].max).toBe("function");
  });
});

describe("tooltip over-limit cue", () => {
  const rowFormatter = (params: any[]) =>
    params
      .map(
        (it) =>
          `${it.marker} ${it.seriesName} : ${formatUnitValue(getUnitValue(it.value[1], "milliseconds", "", 0))}`,
      )
      .join("<br/>");
  const run = (values: [string, number][]) => {
    const options: any = { ...lineOptions(), tooltip: { formatter: rowFormatter } };
    applyLineAreaThresholds(options, panel("line", steps));
    const params = values.map(([seriesName, v], i) => ({
      seriesName,
      marker: `<span id="m${i}"></span>`,
      value: [1, v],
    }));
    return options.tooltip.formatter(params).split("<br/>");
  };

  it("adds the reached step after the value, and nothing below the first step", () => {
    const [api, web] = run([
      ["api", 1200],
      ["web", 300],
    ]);
    expect(api).toBe('<span id="m0"></span> api : 1s · over 1s');
    expect(web).toBe('<span id="m1"></span> web : 300ms');
  });

  it("names the highest step reached", () => {
    const [api] = run([["api", 700]]);
    expect(api).toBe('<span id="m0"></span> api : 700ms · over 500ms');
  });

  it("puts the cue on the series that owns the steps when an earlier row has the same marker", () => {
    const options: any = { ...lineOptions(), tooltip: { formatter: rowFormatter } };
    applyLineAreaThresholds(
      options,
      panel("line", undefined, {
        override_config: seriesEntries([
          { matchBy: "name", value: "api", thresholds: { steps: [{ value: 500, color: RED }] } },
        ]),
      }),
    );
    const marker = '<span id="same"></span>';
    const [web, api] = options.tooltip
      .formatter([
        { seriesName: "web", marker, value: [1, 1200] },
        { seriesName: "api", marker, value: [1, 1200] },
      ])
      .split("<br/>");
    expect(web).toBe(`${marker} web : 1s`);
    expect(api).toBe(`${marker} api : 1s · over 500ms`);
  });

  it("leaves tooltips alone without thresholds", () => {
    const options: any = { ...lineOptions(), tooltip: { formatter: rowFormatter } };
    applyLineAreaThresholds(options, panel("line", undefined));
    expect(options.tooltip.formatter).toBe(rowFormatter);
  });
});

describe("gauge band opacity token", () => {
  it("reads the token, which dark mode raises", () => {
    document.documentElement.style.setProperty("--chart-threshold-band-opacity", "0.5");
    try {
      const stops = buildGaugeAxisLineColors(t(), 0, 2000, "#112233");
      expect(stops[0][1]).toBe("rgba(17, 34, 51, 0.5)");
    } finally {
      document.documentElement.style.removeProperty("--chart-threshold-band-opacity");
    }
  });
});

describe("limit line dashes and override labels", () => {
  it("gives each step its own dash, widest for the lowest", () => {
    expect(limitDash(0, 1)).toEqual([12, 4]);
    expect(limitDash(0, 2)).toEqual([12, 4]);
    expect(limitDash(1, 2)).toEqual([2, 2]);
    const three = [0, 1, 2].map((i) => limitDash(i, 3));
    expect(new Set(three.map(String)).size).toBe(3);
    expect(three[2]).toEqual([2, 2]);
  });

  it("labels override-owned lines with the series display name on the left; panel lines keep their label", () => {
    const options: any = lineOptions();
    const config = {
      thresholds: steps,
      override_config: seriesEntries([
        {
          matchBy: "name",
          value: "web",
          displayName: "Checkout",
          thresholds: { steps: [{ value: 800, color: GREEN }] },
        },
      ]),
    };
    applyLineAreaThresholds(options, {
      type: "line",
      config: { unit: "milliseconds", decimals: 2, ...config },
    });
    const lines = markers(options)[0].markLine.data;
    const panelLine = lines.find((d: any) => d.yAxis === 1000);
    const overrideLine = lines.find((d: any) => d.yAxis === 800);
    expect(panelLine.label.position).toBe("insideEndTop");
    expect(panelLine.label.formatter()).toBe("1.00s");
    expect(overrideLine.label.position).toBe("insideStartTop");
    expect(overrideLine.label.formatter()).toBe("Checkout 800.00ms");
  });

  it("alternates the label position of further override lines on one grid", () => {
    const options: any = lineOptions();
    const own = (value: string, v: number) => ({
      matchBy: "name",
      value,
      thresholds: { steps: [{ value: v, color: GREEN }] },
    });
    applyLineAreaThresholds(options, {
      type: "line",
      config: {
        unit: "milliseconds",
        override_config: seriesEntries([own("api", 800), own("web", 820)]),
      },
    });
    const positions = markers(options)[0].markLine.data.map((d: any) => d.label.position);
    expect(positions).toEqual(["insideStartTop", "insideMiddleTop"]);
  });

  it("labels a line shared by several matched series with the value only", () => {
    const options: any = lineOptions();
    applyLineAreaThresholds(options, {
      type: "line",
      config: {
        unit: "milliseconds",
        decimals: 2,
        override_config: seriesEntries([
          { matchBy: "regex", value: ".*", thresholds: { steps: [{ value: 800, color: GREEN }] } },
        ]),
      },
    });
    const lines = markers(options)[0].markLine.data;
    expect(lines).toHaveLength(1);
    expect(lines[0].label.formatter()).toBe("800.00ms");
    expect(lines[0].label.position).toBe("insideStartTop");
  });
});

describe("gaugeDialRange", () => {
  it("maps untouched defaults to 0..1 for percent-1 only", () => {
    expect(gaugeDialRange(undefined, undefined, "percent-1")).toEqual({ min: 0, max: 1 });
    expect(gaugeDialRange(0, 100, "percent-1")).toEqual({ min: 0, max: 1 });
    expect(gaugeDialRange("", null, "percent-1")).toEqual({ min: 0, max: 1 });
    expect(gaugeDialRange(undefined, undefined, "percent")).toEqual({ min: 0, max: 100 });
    expect(gaugeDialRange(undefined, undefined, undefined)).toEqual({ min: 0, max: 100 });
  });

  it("keeps any user-chosen min or max", () => {
    expect(gaugeDialRange(0, 50, "percent-1")).toEqual({ min: 0, max: 50 });
    expect(gaugeDialRange(10, 100, "percent-1")).toEqual({ min: 10, max: 100 });
    expect(gaugeDialRange(5, 2000, "milliseconds")).toEqual({ min: 5, max: 2000 });
  });
});

describe("getStackedPercentRange", () => {
  it("sums values per x within each stack group and spans 0..largest total", () => {
    const series = [
      {
        stack: "q0",
        data: [
          [1, 10],
          [2, 40],
        ],
      },
      {
        stack: "q0",
        data: [
          [1, 20],
          [2, 50],
        ],
      },
      {
        stack: "q1",
        data: [
          [1, 300],
          [2, 5],
        ],
      },
      {
        stack: "q1",
        data: [
          [1, 100],
          [2, null],
        ],
      },
    ];
    // q0 totals 30 / 90, q1 totals 400 / 5
    expect(getStackedPercentRange({}, series)).toEqual({ min: 0, max: 400 });
  });

  it("treats series without a stack name as one group and keys plain values by index", () => {
    const series = [{ data: [10, 20] }, { data: [5, 30] }];
    expect(getStackedPercentRange({}, series)).toEqual({ min: 0, max: 50 });
  });

  it("keeps a negative total as the minimum and honours a full configured range", () => {
    expect(getStackedPercentRange({}, [{ data: [-30, 10] }, { data: [-20, 5] }])).toEqual({
      min: -50,
      max: 15,
    });
    expect(getStackedPercentRange({ y_axis_min: 0, y_axis_max: 9 }, [{ data: [1] }])).toEqual({
      min: 0,
      max: 9,
    });
    expect(getStackedPercentRange({}, [{ data: [null] }])).toBeNull();
  });
});

describe("getLineAreaPercentRange", () => {
  it("reads [x, y] pairs, plain values and numeric strings, skipping nulls", () => {
    const series = [
      {
        data: [
          [1, "10"],
          [2, null],
        ],
      },
      { data: [5, null, 40] },
    ];
    expect(getLineAreaPercentRange({}, series)).toEqual({ min: 5, max: 40 });
  });

  it("uses only a complete configured range", () => {
    const series = [{ data: [5, 40] }];
    expect(getLineAreaPercentRange({ y_axis_min: 0 }, series)).toEqual({ min: 5, max: 40 });
    expect(getLineAreaPercentRange({ y_axis_min: 0, y_axis_max: 100 }, series)).toEqual({
      min: 0,
      max: 100,
    });
  });

  it("returns null when there is no data", () => {
    expect(getLineAreaPercentRange({}, [{ data: [null] }])).toBeNull();
  });
});

describe("rendered by ECharts", () => {
  const render = async (options: any) => {
    const chart = echarts.init(null as any, null, {
      renderer: "svg",
      ssr: true,
      width: 400,
      height: 300,
    });
    chart.setOption({ animation: false, ...options });
    const svg = chart.renderToSVGString();
    chart.dispose();
    return svg;
  };

  const chartOptions = (thresholds: any) => {
    const options: any = {
      legend: { show: true },
      xAxis: { type: "category", data: ["a", "b", "c", "d", "e"] },
      yAxis: { type: "value", min: 0, max: 1500 },
      series: [{ name: "api", type: "line", color: "#123456", data: [100, 600, 1200, 400, 800] }],
    };
    applyLineAreaThresholds(options, panel("line", thresholds));
    return options;
  };

  it("colours the line by step and keeps the series colour below the first step and in the legend", async () => {
    const svg = await render(chartOptions(steps));
    const stops = [...svg.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
    expect(stops).toEqual(expect.arrayContaining([RED, AMBER, "#123456"]));
    expect(svg).not.toMatch(/stop-color="rgb\(0,0,0\)" stop-opacity="0"/);
    const paths = svg.split("<path");
    expect(paths.some((p) => p.includes('stroke="url(#') && p.includes("stroke-linejoin"))).toBe(
      true,
    );
    // The legend icon is the only series-coloured path without series metadata.
    const legendIcon = (p: string) =>
      p.includes('stroke="#123456"') && !p.includes("ecmeta_series_index");
    expect(paths.some(legendIcon)).toBe(true);
  });

  it("renders a single step, with and without a base colour", async () => {
    const one = { steps: [{ value: 700, color: RED }] };
    const plain = await render(chartOptions(one));
    expect([...plain.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1])).toEqual(
      expect.arrayContaining([RED, "#123456"]),
    );
    const based = await render(chartOptions({ ...one, baseColor: GREEN }));
    expect([...based.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1])).toEqual(
      expect.arrayContaining([RED, GREEN]),
    );
  });

  it("uses the base colour below the first step when one is set", async () => {
    const svg = await render(chartOptions({ ...steps, baseColor: GREEN }));
    const stops = [...svg.matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]);
    expect(stops).toEqual(expect.arrayContaining([RED, AMBER, GREEN]));
  });

  it("draws dashed limit lines labelled with the formatted value", async () => {
    const svg = await render(chartOptions(steps));
    expect(svg).toContain(">500ms<");
    expect(svg).toContain(`>${formatUnitValue(getUnitValue(1000, "milliseconds", "", 0))}<`);
    expect(svg).toMatch(new RegExp(`stroke="${RED}"[^>]*stroke-dasharray`));
    // No end symbols (arrow/circle) are painted in the step colour.
    const pathTags = svg.match(/<path [^>]*>/g) ?? [];
    expect(pathTags.some((p) => p.includes(`fill="${RED}"`))).toBe(false);
    // The marker series adds no legend entry.
    expect(svg.match(/ecmeta_ssr_type="legend"/g)).toHaveLength(1);
  });
});
