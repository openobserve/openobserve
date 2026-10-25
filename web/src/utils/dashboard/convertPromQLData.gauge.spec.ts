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
import { convertPromQLData } from "./convertPromQLData";

vi.mock("./chartDimensionUtils", () => ({
  calculateOptimalFontSize: vi.fn(() => 14),
  calculateWidthText: vi.fn((text) => (text?.length || 0) * 8),
  calculateDynamicNameGap: vi.fn(() => 25),
  calculateRotatedLabelBottomSpace: vi.fn(() => 0),
  applyMeasuredYAxisLeftInset: vi.fn(),
}));

const store = {
  state: { zoConfig: { max_dashboard_series: 100 }, timezone: "UTC", theme: "light" },
};

const matrix = (...series: string[][]) => ({
  resultType: "matrix",
  result: series.map((values, i) => ({
    metric: { pod: `p${i}` },
    values: values.map((v, t) => [1_700_000_000 + t * 60, v]),
  })),
});

const gaugesOf = async (
  responses: any[],
  config: any = {},
  queryConfigs: any[] = responses.map(() => ({ min: 0, max: 100 })),
  size = { offsetWidth: 500, offsetHeight: 300 },
) => {
  const panel = {
    id: "p1",
    type: "gauge",
    queryType: "promql",
    config,
    queries: queryConfigs.map((qc) => ({ query: "up", fields: {}, config: qc })),
  };
  const result: any = await convertPromQLData(panel, responses, store, { value: size }, null, []);
  return result.options.series.filter((s: any) => s?.type === "gauge" && !s.silent);
};

describe("convertPromQLData gauge values", () => {
  it("reads an instant query's value instead of showing 0", async () => {
    const [gauge] = await gaugesOf([
      { resultType: "vector", result: [{ metric: { pod: "a" }, value: [1_700_000_000, "42"] }] },
    ]);
    expect(gauge.data[0].value).toBe(42);
  });

  it("shows no value for a series without points", async () => {
    const [gauge] = await gaugesOf([matrix([])]);
    expect(gauge.data[0].value).toBeNull();
    expect(gauge.data[0].detail.formatter(gauge.data[0].value)).toBe("-");
  });

  it("applies the panel reducer, defaulting to the last point", async () => {
    const response = matrix(["10", "40", "20"]);
    expect((await gaugesOf([response]))[0].data[0].value).toBe(20);
    expect((await gaugesOf([response], { aggregation: "max" }))[0].data[0].value).toBe(40);
    expect((await gaugesOf([response], { aggregation: "avg" }))[0].data[0].value).toBeCloseTo(
      70 / 3,
    );
  });
});

describe("convertPromQLData gauge range", () => {
  it("keeps the fixed range when range_mode is unset", async () => {
    const [gauge] = await gaugesOf([matrix(["5000"])]);
    expect([gauge.min, gauge.max]).toEqual([0, 100]);
  });

  it("keeps an explicit max of 0", async () => {
    const [gauge] = await gaugesOf([matrix(["-3"])], {}, [{ min: -10, max: 0 }]);
    expect([gauge.min, gauge.max]).toEqual([-10, 0]);
  });

  it("derives the range from every dial for auto queries only", async () => {
    const gauges = await gaugesOf([matrix(["300"], ["1200"]), matrix(["4500"])], {}, [
      { range_mode: "auto", min: 0, max: 100 },
      { min: 0, max: 100 },
    ]);
    expect(gauges.map((g: any) => [g.min, g.max])).toEqual([
      [0, 4500],
      [0, 4500],
      [0, 100],
    ]);
  });
});

describe("convertPromQLData gauge display", () => {
  it("shows mapped text and colour, and the mapping colour beats a threshold step", async () => {
    const [gauge] = await gaugesOf([matrix(["2"])], {
      mappings: [{ type: "value", value: "2", text: "DOWN", color: "#ff0000", textColor: "#fff" }],
      thresholds: {
        mode: "absolute",
        baseColor: "#00ff00",
        steps: [{ value: 1, color: "#0000ff" }],
      },
    });
    const item = gauge.data[0];
    expect(item.detail.formatter(item.value)).toBe("DOWN");
    expect(item.detail.color).toBe("#fff");
    expect(item.itemStyle.color).toBe("#ff0000");
  });

  it("colours the dial by its threshold step when no mapping matches", async () => {
    const [gauge] = await gaugesOf([matrix(["2"])], {
      thresholds: {
        mode: "absolute",
        baseColor: "#00ff00",
        steps: [{ value: 1, color: "#0000ff" }],
      },
    });
    expect(gauge.data[0].itemStyle.color).toBe("#0000ff");
  });

  it("colours a reading of 0 like any other value", async () => {
    const [gauge] = await gaugesOf([matrix(["0"])], {
      color: { mode: "fixed", fixedColor: ["#123456"] },
    });
    expect(gauge.data[0].itemStyle.color).toBe("#123456");
  });

  it("labels min and max at the arc ends only when enabled", async () => {
    const [off] = await gaugesOf([matrix(["5"])]);
    expect(off.axisLabel.show).toBe(false);
    const [on] = await gaugesOf([matrix(["5"])], { show_gauge_end_labels: true });
    expect(on.splitNumber).toBe(1);
    expect(on.axisLabel.show).toBe(true);
    expect(on.axisLabel.formatter(100)).toBe("100.00");
  });

  it("scales the value and title text with the dial", async () => {
    const [small] = await gaugesOf([matrix(["5"])], {}, undefined, {
      offsetWidth: 60,
      offsetHeight: 60,
    });
    const [large] = await gaugesOf([matrix(["5"])], {}, undefined, {
      offsetWidth: 800,
      offsetHeight: 600,
    });
    expect([small.detail.fontSize, small.title.fontSize]).toEqual([12, 10]);
    expect(large.detail.fontSize).toBeGreaterThan(40);
    expect(large.title.fontSize).toBeGreaterThan(10);
  });
});
