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

import {
  anomalyIntervalMs,
  buildAnomalyBandOptions,
  formatReading,
  latestBandK,
  toAnomalyBandRows,
  type AnomalyBandRow,
} from "@/utils/alerts/anomalyBandChart";

const LABELS = {
  value: "Value",
  range: "Expected range",
  expected: "Expected",
  anomaly: "Anomaly",
  anomalyAbove: "Anomaly: above the expected range",
  anomalyBelow: "Anomaly: below the expected range",
  event: "Drop / absence",
};

const COLORS = {
  value: "c-value",
  band: "c-band",
  anomaly: "c-anomaly",
  event: "c-event",
  axis: "c-axis",
  grid: "c-grid",
};

const SPAN = { startMs: 0, endMs: 10_000 };

const row = (tsMs: number, over: Partial<AnomalyBandRow> = {}): AnomalyBandRow => ({
  tsMs,
  value: 10,
  flagged: null,
  expected: null,
  lower: null,
  upper: null,
  event: null,
  threshold: null,
  ...over,
});

const options = (rows: AnomalyBandRow[]) => buildAnomalyBandOptions(rows, LABELS, COLORS, SPAN);

const seriesNamed = (opts: any, name: string) => opts.series.filter((s: any) => s.name === name);

describe("toAnomalyBandRows", () => {
  it("reads the metric-query aliases and converts the bucket key to milliseconds", () => {
    const rows = toAnomalyBandRows([
      {
        zo_sql_key: "2026-10-01T00:05:00",
        zo_sql_num: 12,
        anomaly_value: 12,
        expected_value: 8,
        expected_lower: 5,
        expected_upper: 11,
        event_value: null,
        threshold_value: 3.4,
      },
    ]);
    expect(rows).toEqual([
      {
        tsMs: Date.parse("2026-10-01T00:05:00Z"),
        value: 12,
        flagged: 12,
        expected: 8,
        lower: 5,
        upper: 11,
        event: null,
        threshold: 3.4,
      },
    ]);
  });

  it("leaves legacy rows without bounds as nulls, not zeroes", () => {
    const [legacy] = toAnomalyBandRows([{ zo_sql_key: "2026-10-01T00:05:00", zo_sql_num: 3 }]);
    expect(legacy.lower).toBeNull();
    expect(legacy.upper).toBeNull();
    expect(legacy.expected).toBeNull();
  });

  it("orders buckets by time", () => {
    const rows = toAnomalyBandRows([
      { zo_sql_key: "2026-10-01T00:10:00", zo_sql_num: 2 },
      { zo_sql_key: "2026-10-01T00:05:00", zo_sql_num: 1 },
    ]);
    expect(rows.map((r) => r.value)).toEqual([1, 2]);
  });
});

describe("buildAnomalyBandOptions", () => {
  it("draws the band as a stacked pair: lower, then upper minus lower", () => {
    const opts: any = options([
      row(1000, { lower: 5, upper: 11 }),
      row(2000, { lower: -2, upper: 4 }),
    ]);
    const [lower, height] = seriesNamed(opts, LABELS.range);
    expect(lower.stack).toBe("band");
    expect(height.stack).toBe("band");
    expect(lower.stackStrategy).toBe("all");
    expect(height.stackStrategy).toBe("all");
    expect(lower.data).toEqual([
      [1000, 5],
      [2000, -2],
    ]);
    expect(height.data).toEqual([
      [1000, 6],
      [2000, 6],
    ]);
    expect(lower.areaStyle).toBeUndefined();
    expect(height.areaStyle.color).toBe(COLORS.band);
  });

  it("hides the lower edge itself: no line, no symbol, no tooltip", () => {
    const [lower] = seriesNamed(options([row(1000, { lower: 5, upper: 11 })]), LABELS.range);
    expect(lower.lineStyle.opacity).toBe(0);
    expect(lower.symbol).toBe("none");
    expect(lower.tooltip.show).toBe(false);
  });

  it("draws no band for legacy rows that carry no bounds", () => {
    const [lower, height] = seriesNamed(options([row(1000), row(2000)]), LABELS.range);
    expect(lower.data.every(([, v]: [number, number | null]) => v === null)).toBe(true);
    expect(height.data.every(([, v]: [number, number | null]) => v === null)).toBe(true);
  });

  it("stacks a wholly negative band and a band straddling zero without flipping", () => {
    const [lower, height] = seriesNamed(
      options([row(1000, { lower: -10, upper: -5 }), row(2000, { lower: -3, upper: 2 })]),
      LABELS.range,
    );
    expect(lower.data).toEqual([
      [1000, -10],
      [2000, -3],
    ]);
    expect(height.data).toEqual([
      [1000, 5],
      [2000, 5],
    ]);
  });

  it("gaps the band and the value where a bucket has no scored reading", () => {
    const opts: any = options([row(1000, { value: null, event: 0 })]);
    const [lower, height] = seriesNamed(opts, LABELS.range);
    const [value] = seriesNamed(opts, LABELS.value);
    expect([lower.data[0][1], height.data[0][1], value.data[0][1]]).toEqual([null, null, null]);
    expect(seriesNamed(opts, LABELS.event)[0].data[0][1]).toBe(0);
  });

  it("gaps the band where only one bound is present", () => {
    const [lower, height] = seriesNamed(options([row(1000, { lower: 5 })]), LABELS.range);
    expect(lower.data).toEqual([[1000, null]]);
    expect(height.data).toEqual([[1000, null]]);
  });

  it("keeps one entry per bucket in every series, since stacking aligns by index", () => {
    const opts: any = options([row(1000, { lower: 1, upper: 2 }), row(2000), row(3000)]);
    for (const series of opts.series) expect(series.data).toHaveLength(3);
  });

  it("colours value, flag and event by meaning and never bridges a gap", () => {
    const opts: any = options([row(1000, { flagged: 10, event: 0 })]);
    const [value] = seriesNamed(opts, LABELS.value);
    const [flag] = seriesNamed(opts, LABELS.anomaly);
    const [event] = seriesNamed(opts, LABELS.event);
    expect(value.lineStyle.color).toBe(COLORS.value);
    expect(value.connectNulls).toBe(false);
    expect(flag.itemStyle.color).toBe(COLORS.anomaly);
    expect(flag.connectNulls).toBe(false);
    expect(flag.showSymbol).toBe(true);
    expect(event.type).toBe("scatter");
    expect(event.itemStyle.color).toBe(COLORS.event);
  });

  it("uses a time axis pinned to the window and a y axis that does not force zero", () => {
    const opts: any = options([row(1000)]);
    expect(opts.xAxis.type).toBe("time");
    expect(opts.xAxis.min).toBe(SPAN.startMs);
    expect(opts.xAxis.max).toBe(SPAN.endMs);
    expect(opts.yAxis.scale).toBe(true);
  });

  it("shows value, range and expected in the axis tooltip", () => {
    const opts: any = options([row(1000, { value: 12, lower: 5, upper: 11, expected: 8 })]);
    expect(opts.tooltip.trigger).toBe("axis");
    const html = opts.tooltip.formatter([{ axisValue: 1000, axisValueLabel: "00:00" }]);
    expect(html).toContain("Value: 12.00");
    expect(html).toContain("Expected range: [5.00, 11.00]");
    expect(html).toContain("Expected: 8.00");
  });

  it("omits the range from the tooltip on a legacy row", () => {
    const opts: any = options([row(1000, { value: 12 })]);
    const html = opts.tooltip.formatter([{ axisValue: 1000, axisValueLabel: "00:00" }]);
    expect(html).toContain("Value: 12.00");
    expect(html).not.toContain("Expected range");
  });

  it("names a flagged bucket's direction in the tooltip, with the anomaly series' marker", () => {
    const tooltipFor = (over: Partial<AnomalyBandRow>) =>
      options([row(1000, over)]).tooltip.formatter([
        { axisValue: 1000, axisValueLabel: "00:00", seriesName: "Value", marker: "<i>v</i>" },
        { axisValue: 1000, seriesName: "Anomaly", marker: "<i>red</i>" },
      ]);
    expect(tooltipFor({ value: 20, flagged: 20, lower: 5, upper: 11 })).toContain(
      "<i>red</i><b>Anomaly: above the expected range</b>",
    );
    expect(tooltipFor({ value: 1, flagged: 1, lower: 5, upper: 11 })).toContain(
      "<b>Anomaly: below the expected range</b>",
    );
    expect(tooltipFor({ value: 3, flagged: 3 })).toContain("<b>Anomaly</b>");
    expect(tooltipFor({ value: 8, lower: 5, upper: 11 })).not.toContain("Anomaly");
  });

  it("matches the legend swatch to the band fill: same colour, same opacity", () => {
    const opts: any = options([row(1000, { lower: 1, upper: 2 })]);
    const swatch = opts.legend.data.find((d: any) => d?.name === LABELS.range);
    const [, height] = seriesNamed(opts, LABELS.range);
    expect(swatch.itemStyle).toEqual({
      color: height.areaStyle.color,
      opacity: height.areaStyle.opacity,
    });
  });

  it("puts a symbol only on value points with no non-null neighbour", () => {
    const opts: any = options([
      row(1000, { value: 1 }),
      row(2000, { value: null }),
      row(3000, { value: 5 }),
      row(4000, { value: null }),
      row(5000, { value: 6 }),
      row(6000, { value: 7 }),
    ]);
    const [value] = seriesNamed(opts, LABELS.value);
    const sizes = value.data.map((_: unknown, dataIndex: number) =>
      value.symbolSize(null, { dataIndex }),
    );
    expect(sizes).toEqual([6, 0, 6, 0, 0, 0]);
  });

  it("breaks the line and band across a bucket the query returned no row for", () => {
    const fiveMin = 300_000;
    const rows = [
      row(0, { lower: 5, upper: 15 }),
      row(fiveMin, { lower: 5, upper: 15 }),
      row(7 * fiveMin, { lower: 5, upper: 15 }),
      row(8 * fiveMin, { lower: 5, upper: 15 }),
    ];
    const opts: any = buildAnomalyBandOptions(rows, LABELS, COLORS, SPAN, fiveMin);
    const value = seriesNamed(opts, LABELS.value)[0];
    expect(value.connectNulls).toBe(false);
    expect(value.data).toEqual([
      [0, 10],
      [fiveMin, 10],
      [2 * fiveMin, null],
      [7 * fiveMin, 10],
      [8 * fiveMin, 10],
    ]);
    const [, height] = seriesNamed(opts, LABELS.range);
    expect(height.data[2]).toEqual([2 * fiveMin, null]);
    expect(options(rows).series[2].data).toHaveLength(4);
  });

  it("parses the histogram interval the gap check needs", () => {
    expect(anomalyIntervalMs("5m")).toBe(300_000);
    expect(anomalyIntervalMs("1h")).toBe(3_600_000);
    expect(anomalyIntervalMs(undefined)).toBeNull();
    expect(anomalyIntervalMs("5 minutes")).toBeNull();
  });

  it("shows a value and the bound it crossed at a precision that tells them apart", () => {
    const html = options([
      row(1000, { value: 100.49, lower: 90, upper: 100.48 }),
    ]).tooltip.formatter([{ axisValue: 1000, axisValueLabel: "00:00" }]);
    expect(html).toContain("Value: 100.49");
    expect(html).toContain("Expected range: [90.00, 100.48]");
    const plain = options([row(1000, { value: 150, lower: 90, upper: 120 })]).tooltip.formatter([
      { axisValue: 1000, axisValueLabel: "00:00" },
    ]);
    expect(plain).toContain("Value: 150");
    expect(plain).toContain("Expected range: [90.00, 120]");
  });

  it("lists the event legend entry only when a drop or absence exists", () => {
    expect(options([row(1000)]).legend.data).not.toContain(LABELS.event);
    expect(options([row(1000, { event: 0 })]).legend.data).toContain(LABELS.event);
  });
});

describe("buildAnomalyBandOptions units", () => {
  const tooltipOf = (over: Partial<AnomalyBandRow>, unit?: string) =>
    buildAnomalyBandOptions([row(1000, over)], LABELS, COLORS, SPAN, null, unit).tooltip.formatter([
      { axisValue: 1000, axisValueLabel: "00:00" },
    ]);
  const axisLabel = (value: number, unit?: string) =>
    buildAnomalyBandOptions(
      [row(1000)],
      LABELS,
      COLORS,
      SPAN,
      null,
      unit,
    ).yAxis.axisLabel.formatter(value);

  it("labels the y-axis compactly when no unit is known", () => {
    expect(axisLabel(939_000)).toBe("939K");
    expect(axisLabel(1_100_000)).toBe("1.1M");
    expect(axisLabel(12)).toBe("12");
    expect(axisLabel(12.5)).toBe("12.5");
  });

  it("labels the y-axis in time units for microseconds", () => {
    expect(axisLabel(800_000, "microseconds")).toBe("800ms");
    expect(axisLabel(1_100_000, "microseconds")).toBe("1.1s");
  });

  it("moves a tick that rounds up to 1,000 into the next step", () => {
    expect(axisLabel(999_999)).toBe("1M");
    expect(axisLabel(999_999, "microseconds")).toBe("1s");
  });

  it("scales tooltip readings to microsecond time units", () => {
    const html = tooltipOf(
      { value: 938_661, lower: 801_027, upper: 1_083_743, expected: 942_385 },
      "microseconds",
    );
    expect(html).toContain("Value: 939ms");
    expect(html).toContain("Expected range: [801ms, 1.08s]");
    expect(html).toContain("Expected: 942ms");
  });

  it("shows tooltip readings compactly when no unit is known", () => {
    const html = tooltipOf({ value: 938_661, lower: 801_027, upper: 1_083_743, expected: 942_385 });
    expect(html).toContain("Value: 939K");
    expect(html).toContain("Expected range: [801K, 1.08M]");
    expect(html).toContain("Expected: 942K");
  });

  it("widens precision after scaling when a value and its bound would read alike", () => {
    const html = tooltipOf({ value: 100_490, lower: 90_000, upper: 100_480 });
    expect(html).toContain("Value: 100.49K");
    expect(html).toContain("Expected range: [90.00K, 100.48K]");
  });

  it("widens on the exact scaled value for a near-equal billions pair", () => {
    const html = tooltipOf({ value: 1_234_567_892, lower: 1_000_000_000, upper: 1_234_567_891 });
    expect(html).toContain("Value: 1.234567892B");
    expect(html).toContain("Expected range: [1.000000000B, 1.234567891B]");
  });

  it("widens on the exact scaled value for a near-equal minutes pair", () => {
    const html = tooltipOf(
      { value: 61_000_030, lower: 50_000_000, upper: 61_000_000 },
      "microseconds",
    );
    expect(html).toContain("Value: 1.0166672m");
    expect(html).toContain("Expected range: [50.0000000s, 1.0166667m]");
  });

  it("keeps tiny readings apart instead of rounding them to zero", () => {
    const html = tooltipOf({ value: 4e-7, lower: 1e-7, upper: 2e-7 });
    expect(html).toContain("Value: 0.0000004");
    expect(html).toContain("Expected range: [0.0000001, 0.0000002]");
  });

  it("moves a reading that rounds up to 1,000 into the next step", () => {
    expect(tooltipOf({ value: 999_999.6 })).toContain("Value: 1.00M");
    expect(tooltipOf({ value: 999_999.6 }, "microseconds")).toContain("Value: 1.00s");
    expect(tooltipOf({ value: -999_999.6 })).toContain("Value: -1.00M");
  });
});

describe("formatReading", () => {
  it("formats by magnitude so a value and its bounds read alike", () => {
    expect(formatReading(4060.45)).toBe("4,060");
    expect(formatReading(1218)).toBe("1,218");
    expect(formatReading(-150.6)).toBe("-151");
    expect(formatReading(12)).toBe("12.00");
    expect(formatReading(3.14159)).toBe("3.14");
    expect(formatReading(-2.5)).toBe("-2.50");
    expect(formatReading(0.012345)).toBe("0.0123");
    expect(formatReading(0)).toBe("0");
  });
});

describe("latestBandK", () => {
  it("reads k from the newest bucket that carries one", () => {
    expect(
      latestBandK([row(1000, { threshold: 3 }), row(2000, { threshold: 4.5 }), row(3000)]),
    ).toBe(4.5);
  });

  it("is null when no bucket carries a k", () => {
    expect(latestBandK([row(1000), row(2000)])).toBeNull();
    expect(latestBandK([])).toBeNull();
  });
});
