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

const START_US = 1_700_000_000_000_000;
const END_US = START_US + 3_600_000_000;
const store = {
  state: { zoConfig: { max_dashboard_series: 100 }, timezone: "UTC", theme: "light" },
};
const chartRef = { value: { offsetWidth: 500, offsetHeight: 300 } };
const unlabelled = () => ({
  resultType: "matrix",
  result: [{ metric: {}, values: [1_700_000_000, 1_700_000_060].map((ts) => [ts, "1"]) }],
});

const legendOf = async (queries: any[]) => {
  const metadata = {
    queries: queries.map((_, panelQueryIndex) => ({
      startTime: START_US,
      endTime: END_US,
      panelQueryIndex,
      timeRangeGap: { seconds: 0, periodAsStr: "" },
    })),
  };
  const panel = {
    id: "p1",
    type: "line",
    queryType: "promql",
    config: {},
    queries: queries.map((config) => ({ query: "sum(rate(x[5m]))", fields: {}, config })),
  };
  const result: any = await convertPromQLData(
    panel,
    queries.map(unlabelled),
    store,
    chartRef,
    null,
    [],
    metadata,
    undefined,
    true,
  );
  return result.options.series.map((series: any) => series?.name).filter(Boolean);
};

describe("convertPromQLData legend for label-less series", () => {
  it("names inputs after their letters and the formula after itself", async () => {
    expect(await legendOf([{ ref: "A" }, { ref: "B" }, { formula: "B / A * 100" }])).toEqual([
      "A",
      "B",
      "B / A * 100",
    ]);
  });

  it("keeps a formula-free panel's names unchanged", async () => {
    expect(await legendOf([{ ref: "A" }, { ref: "B" }])).toEqual(["{}", "{}"]);
  });
});
