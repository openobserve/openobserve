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

// Replay of a live capture: rows without zo_sql_breakdown are the SQL NULL group of the breakdown field.
import { describe, it, expect, beforeEach, vi } from "vitest";

// Captured aggs: NULL-group rows (no zo_sql_breakdown) beside rows whose breakdown value is 0.
const MIXED_AGGS = [
  { zo_sql_key: "2026-09-24T12:00:00", zo_sql_num: 37 },
  { zo_sql_key: "2026-09-24T11:00:00", zo_sql_num: 29 },
  { zo_sql_key: "2026-09-24T10:00:00", zo_sql_num: 32 },
  { zo_sql_key: "2026-09-24T09:00:00", zo_sql_breakdown: 0, zo_sql_num: 20 },
  { zo_sql_key: "2026-09-24T09:00:00", zo_sql_num: 11 },
  { zo_sql_key: "2026-09-24T08:00:00", zo_sql_breakdown: 0, zo_sql_num: 32 },
  { zo_sql_key: "2026-09-24T07:00:00", zo_sql_breakdown: 0, zo_sql_num: 35 },
  { zo_sql_key: "2026-09-24T06:00:00", zo_sql_breakdown: 0, zo_sql_num: 33 },
];

const createMockState = () => ({
  searchObj: {
    organizationIdentifier: "default",
    communicationMethod: "http",
    meta: {
      sqlMode: false,
      jobId: "",
      showHistogram: true,
      refreshHistogram: false,
      logsVisualizeToggle: "logs",
      resultGrid: { rowsPerPage: 100, showPagination: true, chartInterval: "1 hour" },
    },
    data: {
      resultGrid: { currentPage: 1 },
      queryResults: {
        hits: [],
        aggs: [] as any[],
        total: 0,
        scan_size: 0,
        took: 0,
        result_cache_ratio: 0,
        histogram_breakdown_field: "severity" as string | null,
        partitionDetail: { partitions: [], paginations: [] },
      },
      histogram: {
        xData: [],
        yData: [],
        breakdownField: null,
        breakdownSeries: null,
        chartParams: { title: "", unparsed_x_data: [], timezone: "" },
        errorMsg: "",
        errorCode: 0,
        errorDetail: "",
      },
    },
  },
  searchAggData: { hasAggregation: false, total: 0 },
  notificationMsg: { value: "" },
  histogramMappedData: new Map(),
  histogramResults: { value: [] as any[] },
});

let mockState: ReturnType<typeof createMockState>;

const mockLogsUtils = {
  fnParsedSQL: vi.fn(() => ({})),
  hasAggregation: vi.fn(() => false),
};

vi.mock("./searchState", () => ({
  searchState: vi.fn(() => mockState),
}));

vi.mock("./logsUtils", () => ({
  logsUtils: vi.fn(() => mockLogsUtils),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: { timezone: "UTC", zoConfig: { timestamp_column: "_timestamp" } },
  })),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: vi.fn((key: string) => key) })),
}));

import { useHistogram } from "./useHistogram";
import { convertStackedLogData } from "@/utils/logs/convertLogData";

describe("histogram NULL breakdown group capture replay", () => {
  let histogram: ReturnType<typeof useHistogram>;

  beforeEach(() => {
    mockState = createMockState();
    mockState.searchObj.data.queryResults.aggs = [...MIXED_AGGS];
    vi.clearAllMocks();
    mockLogsUtils.fnParsedSQL.mockReturnValue({});
    mockLogsUtils.hasAggregation.mockReturnValue(false);
    histogram = useHistogram();
  });

  it("stacks the NULL group as an (empty) series without losing counts", () => {
    histogram.generateHistogramData();

    const hist = mockState.searchObj.data.histogram;
    const series = hist.breakdownSeries as unknown as Map<string, number[]>;
    expect(hist.breakdownField).toBe("severity");

    const { options } = convertStackedLogData(hist.xData, series, hist.chartParams, false);
    expect(options.series.map((s: any) => s.name).sort()).toEqual(["(empty)", "0"]);

    const { xData, yData } = hist;
    const idxFor = (iso: string) => xData.indexOf(new Date(iso + "Z").getTime());

    expect(yData[idxFor("2026-09-24T12:00:00")]).toBe(37);
    expect(yData[idxFor("2026-09-24T11:00:00")]).toBe(29);
    expect(yData[idxFor("2026-09-24T10:00:00")]).toBe(32);
    expect(yData[idxFor("2026-09-24T08:00:00")]).toBe(32);
    expect(yData[idxFor("2026-09-24T07:00:00")]).toBe(35);
    // The NULL group and the 0 group share this hour and stack to 20 + 11.
    expect(yData[idxFor("2026-09-24T09:00:00")]).toBe(31);
    expect(series.get("")![idxFor("2026-09-24T09:00:00")]).toBe(11);
    expect(series.get("0")![idxFor("2026-09-24T09:00:00")]).toBe(20);

    const capturedTotal = MIXED_AGGS.reduce((sum, row) => sum + row.zo_sql_num, 0);
    expect(mockState.searchObj.data.queryResults.total).toBe(capturedTotal);
  });
});
