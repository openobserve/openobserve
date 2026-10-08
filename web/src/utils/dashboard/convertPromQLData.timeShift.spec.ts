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

import { describe, it, expect, vi } from "vitest";
import { alignShiftedPromQLResults, convertPromQLData } from "./convertPromQLData";
import { getAreaGradientColor } from "./colorPalette";
import echartsTokens from "echarts/lib/visual/tokens.js";

vi.mock("./chartDimensionUtils", () => ({
  calculateOptimalFontSize: vi.fn(() => 14),
  calculateWidthText: vi.fn((text) => (text?.length || 0) * 8),
  calculateDynamicNameGap: vi.fn(() => 25),
  calculateRotatedLabelBottomSpace: vi.fn(() => 0),
  applyMeasuredYAxisLeftInset: vi.fn(),
}));

const DAY_MS = 86_400_000;
const DAY_S = 86_400;
// Panel window, µs (as the executor stores it).
const START_US = 1_700_000_000_000_000;
const END_US = START_US + 3_600_000_000;

const series = (labels: Record<string, string>, timestamps: number[], value = "1") => ({
  metric: { __name__: "x", ...labels },
  values: timestamps.map((ts) => [ts, value]),
});

const matrix = (...result: any[]) => ({ resultType: "matrix", result });

/** Expanded metadata: primaries first, then one entry per (query, offset). */
const meta = (entries: { panelQueryIndex: number; gapMs?: number; period?: string }[]) => ({
  queries: entries.map(({ panelQueryIndex, gapMs = 0, period = "" }) => ({
    startTime: START_US - gapMs * 1000,
    endTime: END_US - gapMs * 1000,
    panelQueryIndex,
    timeRangeGap: { seconds: gapMs, periodAsStr: period },
  })),
});

/** Range-query step, µs, per expanded index. */
const stepMeta = (count: number, stepSeconds: number) =>
  Array.from({ length: count }, () => [{ step: stepSeconds * 1_000_000 }]);

const grid = (start: number, step: number, count: number) =>
  Array.from({ length: count }, (_, i) => start + i * step);

describe("alignShiftedPromQLResults", () => {
  it("moves shifted timestamps forward by the offset (ms to s)", () => {
    const current = grid(1_700_000_000, 60, 5);
    const past = current.map((ts) => ts - DAY_S);
    const { data } = alignShiftedPromQLResults(
      [matrix(series({ pod: "a" }, current)), matrix(series({ pod: "a" }, past))],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    expect(data[1].result[0].values.map((v: any) => v[0])).toEqual(current);
  });

  it("snaps an odd step onto the current grid, so no x value is doubled (35s step, 1d offset)", () => {
    const current = grid(1_700_000_005, 35, 20);
    // The past window's grid is aligned to its own start: 1d is not a multiple of 35s.
    const past = grid(1_700_000_005 - DAY_S + 17, 35, 20);
    const { data } = alignShiftedPromQLResults(
      [matrix(series({ pod: "a" }, current)), matrix(series({ pod: "a" }, past))],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 35),
    );

    const shifted = data[1].result[0].values.map((v: any) => v[0]);
    const union = new Set([...current, ...shifted]);
    expect(union.size).toBe(current.length);
    shifted.forEach((ts: number) => expect((ts - current[0]) % 35).toBe(0));
  });

  it("keeps only shifted series that match a primary label set", () => {
    const ts = grid(1_700_000_000, 60, 3);
    const past = ts.map((t) => t - DAY_S);
    const { data } = alignShiftedPromQLResults(
      [
        matrix(series({ pod: "a" }, ts), series({ pod: "b" }, ts)),
        matrix(series({ pod: "a" }, past), series({ pod: "z" }, past)),
        matrix(series({ pod: "b" }, past), series({ pod: "y" }, past), series({ pod: "w" }, past)),
      ],
      meta([
        { panelQueryIndex: 0 },
        { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" },
        { panelQueryIndex: 0, gapMs: 7 * DAY_MS, period: "1 week ago" },
      ]),
      stepMeta(3, 60),
    );

    expect(data[1].result.map((s: any) => s.metric.pod)).toEqual(["a"]);
    expect(data[2].result.map((s: any) => s.metric.pod)).toEqual(["b"]);
    const total = data.reduce((n: number, q: any) => n + q.result.length, 0);
    expect(total).toBeLessThanOrEqual(3 * data[0].result.length);
  });

  it("maps every expanded index to its panel query and suffixes only shifted ones", () => {
    const ts = grid(1_700_000_000, 60, 2);
    const { parentQueryIndex, nameSuffixes } = alignShiftedPromQLResults(
      [
        matrix(series({ pod: "a" }, ts)),
        matrix(series({ pod: "a" }, ts)),
        matrix(series({ pod: "a" }, ts)),
        matrix(series({ pod: "a" }, ts)),
      ],
      meta([
        { panelQueryIndex: 0 },
        { panelQueryIndex: 1 },
        { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" },
        { panelQueryIndex: 1, gapMs: DAY_MS, period: "1 day ago" },
      ]),
    );

    expect(parentQueryIndex).toEqual([0, 1, 0, 1]);
    expect(nameSuffixes).toEqual(["", "", "1 day ago", "1 day ago"]);
  });

  it("keeps the shifted series when the current period is empty", () => {
    const past = grid(1_700_000_000 - DAY_S, 60, 3);
    const { data } = alignShiftedPromQLResults(
      [matrix(), matrix(series({ pod: "a" }, past))],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    expect(data[1].result).toHaveLength(1);
  });

  it("leaves data without shifted entries untouched", () => {
    const input = [matrix(series({ pod: "a" }, [1]))];
    const { data, parentQueryIndex } = alignShiftedPromQLResults(input, null);

    expect(data).toEqual(input);
    expect(parentQueryIndex).toEqual([0]);
  });
});

describe("convertPromQLData with time-shifted results", () => {
  const store = {
    state: { zoConfig: { max_dashboard_series: 100 }, timezone: "UTC", theme: "light" },
  };
  const chartRef = { value: { offsetWidth: 500, offsetHeight: 300 } };

  const convert = (
    panelSchema: any,
    data: any[],
    metadata: any,
    resultMetaData?: any,
    storeOverride = store,
  ) =>
    convertPromQLData(
      panelSchema,
      data,
      storeOverride,
      chartRef,
      null,
      [],
      metadata,
      resultMetaData,
      true,
    );

  const panel = (type: string, queries: any[] = [{ config: {} }]) => ({
    id: "p1",
    type,
    queryType: "promql",
    config: {},
    queries: queries.map((q) => ({ query: "rate(x[5m])", fields: {}, ...q })),
  });

  const ts = grid(1_700_000_000, 60, 4);
  const twoPods = (shiftS = 0) =>
    matrix(
      series(
        { pod: "api-1" },
        ts.map((t) => t - shiftS),
      ),
      series(
        { pod: "api-2" },
        ts.map((t) => t - shiftS),
      ),
    );
  const overlayMeta = meta([
    { panelQueryIndex: 0 },
    { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" },
    { panelQueryIndex: 0, gapMs: 7 * DAY_MS, period: "1 week ago" },
  ]);
  const names = (result: any) =>
    (result.options.series ?? []).map((s: any) => s?.name).filter(Boolean);

  it("shows the current series and one per offset, suffixed with the period", async () => {
    const result = await convert(
      panel("line"),
      [twoPods(), twoPods(DAY_S), twoPods(7 * DAY_S)],
      overlayMeta,
      stepMeta(3, 60),
    );

    expect(names(result)).toEqual([
      "api-1",
      "api-2",
      "api-1 (1 day ago)",
      "api-2 (1 day ago)",
      "api-1 (1 week ago)",
      "api-2 (1 week ago)",
    ]);
  });

  it("lines shifted series up on the current x values", async () => {
    const result = await convert(
      panel("line"),
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    const shifted = result.options.series.find((s: any) => s.name === "api-1 (1 day ago)");
    expect(shifted.data).toHaveLength(ts.length);
    expect(shifted.data.every((point: any) => point[1] !== null)).toBe(true);
  });

  it("reads legend templates through the panel query index (query A hidden)", async () => {
    const result = await convert(
      panel("line", [
        { config: { promql_legend: "A {pod}" } },
        { config: { promql_legend: "B {pod}" } },
      ]),
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 1 }, { panelQueryIndex: 1, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    expect(names(result)).toEqual([
      "B api-1",
      "B api-2",
      "B api-1 (1 day ago)",
      "B api-2 (1 day ago)",
    ]);
  });

  it("tags only current-period series with a query index, so exemplars never pick a shifted one", async () => {
    const result = await convert(
      panel("line"),
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    const tagged = result.options.series.filter((s: any) => typeof s._queryIndex === "number");
    expect(tagged.map((s: any) => s.name)).toEqual(["api-1", "api-2"]);
  });

  it("tags every series with its panel query and role, leaving _queryIndex as it was", async () => {
    const result = await convert(
      panel("line", [{ config: {} }, { config: {} }]),
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 1 }, { panelQueryIndex: 1, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    expect(
      result.options.series
        .filter((s: any) => s.name)
        .map((s: any) => [s.name, s._panelQueryIndex, s._seriesRole, s._queryIndex]),
    ).toEqual([
      ["api-1", 1, "primary", 0],
      ["api-2", 1, "primary", 0],
      ["api-1 (1 day ago)", 1, "shifted", undefined],
      ["api-2 (1 day ago)", 1, "shifted", undefined],
    ]);
  });

  it("tags stacked series with their panel query and role", async () => {
    const result = await convert(
      panel("stacked", [{ config: {} }, { config: {} }]),
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 1 }, { panelQueryIndex: 1, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    expect(
      result.options.series
        .filter((s: any) => s.name)
        .map((s: any) => [s.name, s._panelQueryIndex, s._seriesRole]),
    ).toEqual([
      ["api-1", 1, "primary"],
      ["api-2", 1, "primary"],
      ["api-1 (1 day ago)", 1, "shifted"],
      ["api-2 (1 day ago)", 1, "shifted"],
    ]);
  });

  it("renders when only a shifted result has data", async () => {
    const result = await convert(
      panel("line"),
      [undefined, twoPods(DAY_S)],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    expect(result.options).not.toBeNull();
    expect(names(result)).toEqual(["api-1 (1 day ago)", "api-2 (1 day ago)"]);
  });

  // The executor publishes `[...queryResults]`, so a stream that has not delivered yet is an undefined slot.
  it.each([
    ["a shifted stream lands before its primary", [undefined, twoPods(DAY_S)]],
    [
      "the second of two offsets lands before the first",
      [twoPods(), undefined, twoPods(7 * DAY_S)],
    ],
  ])("builds only real time series while %s", async (_case, data) => {
    const result = await convert(panel("line"), data, overlayMeta, stepMeta(3, 60));

    expect(result.options.series.every((s: any) => s && typeof s === "object")).toBe(true);
    expect(result.options.xAxis.type).toBe("time");
    expect(result.extras.isTimeSeries).toBe(true);
  });

  describe("ties each shifted series to its primary", () => {
    const pair = (result: any, name: string) => [
      result.options.series.find((s: any) => s.name === name),
      result.options.series.find((s: any) => s.name === `${name} (1 day ago)`),
    ];
    const oneDay = meta([
      { panelQueryIndex: 0 },
      { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" },
    ]);

    const explorer = (config: Record<string, any> = {}) => ({
      ...panel("line"),
      config: { explorer_overlays: true, ...config },
    });

    it("draws it dashed in the primary's palette colour", async () => {
      const result = await convert(
        panel("line"),
        [twoPods(), twoPods(DAY_S)],
        oneDay,
        stepMeta(2, 60),
      );

      for (const name of ["api-1", "api-2"]) {
        const [primary, shifted] = pair(result, name);
        expect(shifted.itemStyle.color).toBeTruthy();
        expect(shifted.itemStyle.color).toBe(primary.itemStyle.color);
        expect(shifted.lineStyle.type).toBe("dashed");
        expect(primary.lineStyle?.type).toBeUndefined();
      }
    });

    it("in the Explorer, draws it dotted so it reads apart from a dashed forecast", async () => {
      const result = await convert(
        explorer(),
        [twoPods(), twoPods(DAY_S)],
        oneDay,
        stepMeta(2, 60),
      );
      const [, shifted] = pair(result, "api-1");
      expect(shifted.lineStyle.type).toBe("dotted");
    });

    it("in the Explorer's classic palette, keeps ECharts' own primary colours and gives them to the twins", async () => {
      const classic = explorer({ color: { mode: "palette-classic" } });
      const alone = await convert(
        classic,
        [twoPods()],
        meta([{ panelQueryIndex: 0 }]),
        stepMeta(1, 60),
      );
      const overlaid = await convert(classic, [twoPods(), twoPods(DAY_S)], oneDay, stepMeta(2, 60));
      const theme = echartsTokens.color.theme;

      ["api-1", "api-2"].forEach((name, position) => {
        const [before] = pair(alone, name);
        const [primary, shifted] = pair(overlaid, name);
        expect(before.itemStyle.color).toBe(theme[position]);
        expect(primary.itemStyle.color).toBe(theme[position]);
        expect(shifted.itemStyle.color).toBe(theme[position]);
      });
    });

    it("on a dashboard, leaves the classic palette to ECharts", async () => {
      const classic = { ...panel("line"), config: { color: { mode: "palette-classic" } } };
      const result = await convert(classic, [twoPods(), twoPods(DAY_S)], oneDay, stepMeta(2, 60));
      const [primary, shifted] = pair(result, "api-1");
      expect(primary.itemStyle.color).toBeNull();
      expect(shifted.itemStyle.color).toBeNull();
    });

    it("keeps the twins out of the Explorer's legend, and in a dashboard's", async () => {
      const data = [twoPods(), twoPods(DAY_S)];
      const inExplorer = await convert(explorer(), data, oneDay, stepMeta(2, 60));
      expect(inExplorer.options.legend.data).toEqual(["api-1", "api-2"]);
      const [, twin] = pair(inExplorer, "api-1");
      expect(twin._legendFollows).toBe("api-1");
      const onDashboard = await convert(panel("line"), data, oneDay, stepMeta(2, 60));
      expect(onDashboard.options.legend.data).toBeUndefined();
    });

    it("keeps a compared series with no current counterpart in the Explorer's legend", async () => {
      const onlyPast = await convert(
        explorer(),
        [matrix(), twoPods(DAY_S)],
        oneDay,
        stepMeta(2, 60),
      );
      expect(onlyPast.options.legend.data).toEqual(["api-1 (1 day ago)", "api-2 (1 day ago)"]);
    });

    it("follows a series colour mapping set on the primary", async () => {
      const mapped: any = panel("line");
      mapped.config = { color: { colorBySeries: [{ value: "api-1", color: "#123456" }] } };
      const result = await convert(mapped, [twoPods(), twoPods(DAY_S)], oneDay, stepMeta(2, 60));

      const [primary, shifted] = pair(result, "api-1");
      expect(primary.itemStyle.color).toBe("#123456");
      expect(shifted.itemStyle.color).toBe("#123456");
    });

    it("lets a mapping on the shifted series' own name win, and ties the unmapped ones", async () => {
      const mapped: any = panel("line");
      mapped.config = {
        color: {
          colorBySeries: [
            { value: "api-1", color: "#123456" },
            { value: "api-1 (1 day ago)", color: "#abcdef" },
          ],
        },
      };
      const result = await convert(mapped, [twoPods(), twoPods(DAY_S)], oneDay, stepMeta(2, 60));

      const [primary, shifted] = pair(result, "api-1");
      expect(primary.itemStyle.color).toBe("#123456");
      expect(shifted.itemStyle.color).toBe("#abcdef");
      const [otherPrimary, otherShifted] = pair(result, "api-2");
      expect(otherShifted.itemStyle.color).toBeTruthy();
      expect(otherShifted.itemStyle.color).toBe(otherPrimary.itemStyle.color);
    });

    it("takes the primary's colour when the colour depends on the values", async () => {
      const shaded: any = panel("line");
      shaded.config = { color: { mode: "continuous-green-yellow-red" } };
      // Numeric samples: the value scale skips PromQL's string samples.
      const past = matrix(
        series(
          { pod: "api-1" },
          ts.map((t) => t - DAY_S),
          9 as any,
        ),
      );
      const result = await convert(
        shaded,
        [
          matrix(series({ pod: "api-1" }, ts, 1 as any), series({ pod: "api-2" }, ts, 5 as any)),
          past,
        ],
        oneDay,
        stepMeta(2, 60),
      );

      const [primary, shifted] = pair(result, "api-1");
      expect(primary.itemStyle.color).toBeTruthy();
      expect(shifted.itemStyle.color).toBe(primary.itemStyle.color);
    });

    it.each(["bar", "scatter"])(
      "fades it on a %s chart, which has no line to dash",
      async (type) => {
        const result = await convert(
          panel(type),
          [twoPods(), twoPods(DAY_S)],
          oneDay,
          stepMeta(2, 60),
        );

        const [primary, shifted] = pair(result, "api-1");
        expect(shifted.itemStyle.color).toBe(primary.itemStyle.color);
        expect(shifted.itemStyle.opacity).toBeLessThan(1);
        expect(primary.itemStyle.opacity).toBeUndefined();
      },
    );

    it("keeps line and area series unfaded, the dash marks them", async () => {
      for (const type of ["line", "area"]) {
        const result = await convert(
          panel(type),
          [twoPods(), twoPods(DAY_S)],
          oneDay,
          stepMeta(2, 60),
        );
        const [, shifted] = pair(result, "api-1");
        expect(shifted.itemStyle.opacity).toBeUndefined();
        expect(shifted.lineStyle.type).toBe("dashed");
      }
    });

    describe("fills an area in its final colour", () => {
      it("when the primary's value-based colour replaces its own", async () => {
        const shaded: any = panel("area");
        shaded.config = { color: { mode: "continuous-green-yellow-red" } };
        const past = matrix(
          series(
            { pod: "api-1" },
            ts.map((t) => t - DAY_S),
            9 as any,
          ),
        );
        const result = await convert(
          shaded,
          [
            matrix(series({ pod: "api-1" }, ts, 1 as any), series({ pod: "api-2" }, ts, 5 as any)),
            past,
          ],
          oneDay,
          stepMeta(2, 60),
        );

        const [primary, shifted] = pair(result, "api-1");
        expect(shifted.itemStyle.color).toBe(primary.itemStyle.color);
        expect(shifted.areaStyle.color).toEqual(primary.areaStyle.color);
      });

      it("when a mapping on its own name colours it", async () => {
        const mapped: any = panel("area");
        mapped.config = {
          color: { colorBySeries: [{ value: "api-1 (1 day ago)", color: "#abcdef" }] },
        };
        const result = await convert(mapped, [twoPods(), twoPods(DAY_S)], oneDay, stepMeta(2, 60));

        const [, shifted] = pair(result, "api-1");
        expect(shifted.itemStyle.color).toBe("#abcdef");
        expect(shifted.areaStyle.color).toEqual(getAreaGradientColor("#abcdef"));
      });
    });

    it("keeps the primary's colour while the primary stream is still pending", async () => {
      const full = await convert(
        panel("line"),
        [twoPods(), twoPods(DAY_S)],
        oneDay,
        stepMeta(2, 60),
      );
      const partial = await convert(
        panel("line"),
        [undefined, twoPods(DAY_S)],
        oneDay,
        stepMeta(2, 60),
      );

      const [primary] = pair(full, "api-1");
      const [, shifted] = pair(partial, "api-1");
      expect(shifted.itemStyle.color).toBe(primary.itemStyle.color);
    });
  });

  it.each([
    ["without", [twoPods()], meta([{ panelQueryIndex: 0 }]), 1],
    [
      "with",
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      2,
    ],
  ])("converts a panel whose colorBySeries is not an array, %s a shift", async (_c, data, m, n) => {
    const unmapped: any = panel("line");
    unmapped.config = { color: { mode: "palette-classic-by-series", colorBySeries: false } };
    const result = await convert(unmapped, data, m, stepMeta(n, 60));

    expect(names(result)).toHaveLength(2 * n);
  });

  it("does not count shifted windows as extra queries when splitting the series budget", async () => {
    const tightStore = {
      state: { ...store.state, zoConfig: { max_dashboard_series: 2 } },
    };
    const result = await convert(
      panel("line"),
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
      tightStore,
    );

    expect(names(result)).toEqual(["api-1", "api-2", "api-1 (1 day ago)", "api-2 (1 day ago)"]);
  });

  it("drops shifted series whose primary was cut by the series budget", async () => {
    const tightStore = {
      state: { ...store.state, zoConfig: { max_dashboard_series: 1 } },
    };
    const result = await convert(
      panel("line"),
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 0 }, { panelQueryIndex: 0, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
      tightStore,
    );

    expect(names(result)).toEqual(["api-1", "api-1 (1 day ago)"]);
  });

  it("names and configures shifted series through the map on the modular (stacked) path", async () => {
    const result = await convert(
      panel("stacked", [
        { config: { promql_legend: "A {pod}" } },
        { config: { promql_legend: "B {pod}" } },
      ]),
      [twoPods(), twoPods(DAY_S)],
      meta([{ panelQueryIndex: 1 }, { panelQueryIndex: 1, gapMs: DAY_MS, period: "1 day ago" }]),
      stepMeta(2, 60),
    );

    expect(names(result)).toEqual([
      "B api-1",
      "B api-2",
      "B api-1 (1 day ago)",
      "B api-2 (1 day ago)",
    ]);
  });
});
