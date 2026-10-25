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
import { convertPromQLData, METRIC_MAX_CELLS } from "./convertPromQLData";

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
const chartRef = { value: { offsetWidth: 600, offsetHeight: 300 } };

const series = (job: string, samples: string[]) => ({
  metric: { job },
  values: samples.map((v, i) => [1_700_000_000 + i * 60, v]),
});
const matrix = (...result: any[]) => ({ resultType: "matrix", result });
const vector = (...result: any[]) => ({ resultType: "vector", result });

const convert = async (data: any[], config: any = {}) => {
  const panel = {
    id: "p1",
    type: "metric",
    queryType: "promql",
    config: { decimals: 0, ...config },
    queries: data.map(() => ({ query: "x", fields: {}, config: { promql_legend: "{job}" } })),
  };
  const metadata = { queries: data.map((_, panelQueryIndex) => ({ panelQueryIndex })) };
  const result: any = await convertPromQLData(
    panel,
    data,
    store,
    chartRef,
    null,
    { value: [] },
    metadata,
    undefined,
    false,
  );
  return result;
};

const cellsOf = (result: any) =>
  result.options.series.filter((s: any) => s._metricText !== undefined);

describe("convertPromQLData metric cells", () => {
  it("draws one cell per series of one query, each with its label and grid rect", async () => {
    const result = await convert([matrix(series("api", ["1", "5"]), series("web", ["2", "7"]))]);
    const cells = cellsOf(result);
    expect(cells.map((c: any) => [c._metricLabel, c._metricText])).toEqual([
      ["api", "5"],
      ["web", "7"],
    ]);
    for (const cell of cells) {
      expect(typeof cell.renderItem).toBe("function");
      expect(cell._metricLayout.width).toBeGreaterThan(0);
      expect(cell.silent).toBeUndefined();
    }
    expect(cells[0]._metricLayout.left).not.toBe(cells[1]._metricLayout.left);
    const label = cells[0].renderItem().children.find((c: any) => c.style.text === "api");
    expect(label.style).toMatchObject({ overflow: "truncate" });
    expect(label.style.width).toBeLessThan(cells[0]._metricLayout.width);
  });

  it("keeps every query, not only the last one", async () => {
    const result = await convert([matrix(series("api", ["3"])), matrix(series("web", ["9"]))]);
    expect(cellsOf(result).map((c: any) => c._metricText)).toEqual(["3", "9"]);
  });

  it("does not let an empty query replace another query's value with 0", async () => {
    const result = await convert([matrix(series("api", ["3"])), matrix()]);
    const cells = cellsOf(result);
    expect(cells).toHaveLength(1);
    expect(cells[0]._metricText).toBe("3");
  });

  it("draws no cell at all when every query is empty", async () => {
    const result = await convert([matrix(), matrix()]);
    expect(result.options.series).toEqual([]);
  });

  it("labels and colours a cell from its series override", async () => {
    const result = await convert([matrix(series("api", ["3"]), series("web", ["4"]))], {
      override_config: [
        {
          field: { matchBy: "series", value: "web" },
          config: [
            { type: "display_name", value: "Web tier" },
            { type: "series_color", value: "#123456" },
          ],
        },
      ],
    });
    const web = cellsOf(result)[1];
    expect(web._metricLabel).toBe("Web tier");
    expect(web._metricName).toBe("web");
    expect(web._metricBgColor).toBe("#123456");
  });

  it("draws one cell per series of an instant query", async () => {
    const result = await convert([
      vector({ metric: { job: "api" }, value: [1_700_000_000, "4"] }),
      vector({ metric: { job: "web" }, value: [1_700_000_000, "6"] }),
    ]);
    expect(cellsOf(result).map((c: any) => c._metricRaw)).toEqual(["4", "6"]);
  });

  it("keeps a single series full-panel with its sparkline", async () => {
    const result = await convert([matrix(series("api", ["1", "2", "3"]))], {
      sparkline: { enabled: true },
    });
    expect(result.options.series).toHaveLength(2);
    const [cell] = cellsOf(result);
    expect(cell._metricLayout).toMatchObject({ left: 0, top: 0, width: 600 });
    expect(result.options.polar.center).toBeDefined();
  });

  it("draws each grid cell's own sparkline", async () => {
    const result = await convert(
      [matrix(series("api", ["1", "2", "3"]), series("web", ["3", "1", "2"]))],
      { sparkline: { enabled: true, type: "line" } },
    );
    const cells = cellsOf(result);
    expect(result.options.series).toHaveLength(2);
    for (const cell of cells) {
      expect(cell._metricSparkData).toHaveLength(3);
      const drawn = cell.renderItem().children.map((child: any) => child.type);
      expect(drawn).toContain("polyline");
    }
  });

  it("reduces a range series with the configured aggregation", async () => {
    const data = [matrix(series("api", ["4", "10", "1"]))];
    expect(cellsOf(await convert(data))[0]._metricText).toBe("1");
    expect(cellsOf(await convert(data, { aggregation: "max" }))[0]._metricText).toBe("10");
    expect(cellsOf(await convert(data, { aggregation: "avg" }))[0]._metricText).toBe("5");
    expect(cellsOf(await convert(data, { aggregation: "first" }))[0]._metricRaw).toBe(4);
  });

  it("shows an instant sample as is, whatever aggregation a range query left behind", async () => {
    const result = await convert(
      [vector({ metric: { job: "api" }, value: [1_700_000_000, "8"] })],
      {
        aggregation: "diff",
      },
    );
    expect(cellsOf(result)[0]._metricRaw).toBe("8");
  });

  it("keeps the last sample as received, so a value mapping on it still matches", async () => {
    const result = await convert([matrix(series("api", ["1", "+Inf"]))], {
      mappings: [{ type: "value", value: "+Inf", text: "unbounded" }],
    });
    expect(cellsOf(result)[0]._metricText).toBe("unbounded");
  });

  it("caps the cells and says how many were dropped", async () => {
    const many = Array.from({ length: METRIC_MAX_CELLS + 10 }, (_, i) => series(`j${i}`, ["1"]));
    const result = await convert([matrix(...many)]);
    expect(cellsOf(result)).toHaveLength(METRIC_MAX_CELLS);
    expect(result.extras.seriesLimit).toEqual({
      shown: METRIC_MAX_CELLS,
      total: METRIC_MAX_CELLS + 10,
      cap: METRIC_MAX_CELLS,
    });
  });

  it("shows no cap notice under the cap", async () => {
    const result = await convert([matrix(series("api", ["1"]), series("web", ["2"]))]);
    expect(result.extras.seriesLimit).toBeUndefined();
  });
});
