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

import { describe, expect, it, vi } from "vitest";
import { buildSQLContext } from "@/utils/dashboard/sql/shared/contextBuilder";

vi.mock("@/utils/dashboard/sqlProcessData", () => ({
  processData: vi.fn((data) => data[0] || []),
  breakdownValueLabel: vi.fn((value) => value),
}));
vi.mock("@/utils/dashboard/sqlMissingValueFiller", () => ({
  fillMissingValues: vi.fn((data) => data),
}));
vi.mock("@/utils/dashboard/sql/shared/seriesBuilder", () => ({
  buildDataLookupMap: vi.fn(() => new Map()),
  createSeriesBuilders: vi.fn(() => ({
    getSeries: vi.fn(() => []),
    getAnnotationMarkLine: vi.fn(() => []),
    getSeriesMarkArea: vi.fn(() => null),
  })),
}));
vi.mock("@/utils/dashboard/sql/shared/trellisConfig", () => ({
  createTrellisHelpers: vi.fn(() => ({ updateTrellisConfig: vi.fn() })),
}));
vi.mock("@/utils/dashboard/legendConfiguration", () => ({
  createBaseLegendConfig: vi.fn(() => ({ orient: "horizontal" })),
  getChartDimensions: vi.fn(() => ({ chartWidth: 800, chartHeight: 400 })),
  calculateChartDimensions: vi.fn(() => ({
    availableWidth: 800,
    availableHeight: 400,
  })),
  calculatePieChartRadius: vi.fn(() => 50),
}));
vi.mock("@/utils/dashboard/sqlChartSeriesProps", () => ({
  getPropsByChartTypeForSeries: vi.fn(() => ({ type: "line" })),
}));

const store = {
  state: { theme: "light", zoConfig: { timestamp_column: "_timestamp" } },
};
const chartPanelRef = { value: { offsetWidth: 800, offsetHeight: 400 } };

const buildCtx = (panelSchema: any, rows: any[]) =>
  buildSQLContext(panelSchema, [rows], store, chartPanelRef, null, [{}], { queries: [{}] }, {}, []);

const barPanel = (config: any = {}) => ({
  id: "p1",
  type: "bar",
  queries: [
    {
      fields: {
        x: [{ alias: "value", label: "" }],
        y: [{ alias: "trace_count", label: "" }],
        z: [],
        breakdown: [{ alias: "series" }],
      },
    },
  ],
  config: { show_legends: true, legends_position: "bottom", ...config },
});

const rows = [
  { value: "notify_failed_with_a_long_name_here_please", trace_count: 4, series: "Baseline" },
  { value: "notify_failed_with_a_long_name_here_please", trace_count: 9, series: "Selected" },
];

const bottomFor = (config: any) =>
  (buildCtx(barPanel(config), rows) as any).options.grid.bottom as number;

describe("buildSQLContext bottom space for rotated category labels", () => {
  it("reserves room for the rotated labels in addition to the bottom legend", () => {
    const flat = bottomFor({});
    const rotated = bottomFor({ axis_label_rotate: 30, axis_label_truncate_width: 80 });
    // a rotated long label is much taller than the one flat line the label band covers
    expect(rotated - flat).toBeGreaterThanOrEqual(25);
  });

  it("reserves nothing extra when the labels are not rotated", () => {
    expect(bottomFor({ axis_label_rotate: 0 })).toBe(bottomFor({}));
  });

  it("measures short labels instead of the truncate width", () => {
    const short = [{ value: "ok", trace_count: 1, series: "Baseline" }];
    const long = bottomFor({ axis_label_rotate: 30, axis_label_truncate_width: 80 });
    const shortBottom = (
      buildCtx(barPanel({ axis_label_rotate: 30, axis_label_truncate_width: 80 }), short) as any
    ).options.grid.bottom;
    expect(shortBottom).toBeLessThan(long);
  });
});
