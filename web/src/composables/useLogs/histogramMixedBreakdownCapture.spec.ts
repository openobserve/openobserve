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

/**
 * Reproduces a second, independent histogram bug found via a live browser
 * capture (openobserve-histogram-debug.json): for the same query, with
 * histogram_breakdown_field set, some partitions returned hits WITHOUT
 * zo_sql_breakdown (flat: {zo_sql_key, zo_sql_num}) while others returned
 * hits WITH it ({zo_sql_key, zo_sql_breakdown, zo_sql_num}) — a mixed
 * response shape from the backend for what should be one consistent query.
 *
 * generateHistogramData's `hasBreakdown` check (useHistogram.ts) is an
 * all-or-nothing gate: ANY hit anywhere in aggs having zo_sql_breakdown
 * switches the ENTIRE render to the stacked path, which then silently drops
 * every hit that lacks zo_sql_breakdown — even though those hits have real,
 * valid zo_sql_num counts. That's a real captured symptom: 29 breakdown-
 * tagged hours rendered correctly, 140 flat hours rendered as zero.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// A representative slice of the real captured aggs: a run of flat (no
// breakdown) hours immediately followed by a run of breakdown-tagged hours,
// exactly as seen in openobserve-histogram-debug.json around 2026-09-24.
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

describe("histogram mixed breakdown-shape capture replay", () => {
  let histogram: ReturnType<typeof useHistogram>;

  beforeEach(() => {
    mockState = createMockState();
    mockState.searchObj.data.queryResults.aggs = [...MIXED_AGGS];
    vi.clearAllMocks();
    mockLogsUtils.fnParsedSQL.mockReturnValue({});
    mockLogsUtils.hasAggregation.mockReturnValue(false);
    histogram = useHistogram();
  });

  it("does not zero out real counts for hours whose hits came back without zo_sql_breakdown", () => {
    histogram.generateHistogramData();

    const hist = mockState.searchObj.data.histogram;
    // Since the backend response is inconsistently shaped for this capture
    // (some hours tagged with zo_sql_breakdown, most not), hasBreakdown's
    // every() check falls through to the flat single-series path — matching
    // what Visualize renders for the same data, no spurious legend entry.
    expect(hist.breakdownField).toBeNull();
    expect(hist.breakdownSeries).toBeNull();

    const { xData, yData } = hist;
    const idxFor = (iso: string) => xData.indexOf(new Date(iso + "Z").getTime());

    // The three flat (no zo_sql_breakdown) hours have real, non-zero counts
    // in the source data — they must not render as zero.
    expect(yData[idxFor("2026-09-24T12:00:00")]).toBe(37);
    expect(yData[idxFor("2026-09-24T11:00:00")]).toBe(29);
    expect(yData[idxFor("2026-09-24T10:00:00")]).toBe(32);

    // The breakdown-tagged hours still work — the flat path doesn't key on
    // zo_sql_breakdown at all, so their counts are unaffected.
    expect(yData[idxFor("2026-09-24T08:00:00")]).toBe(32);
    expect(yData[idxFor("2026-09-24T07:00:00")]).toBe(35);

    // The hour with BOTH a tagged and an untagged hit sums both (20 + 11).
    expect(yData[idxFor("2026-09-24T09:00:00")]).toBe(31);
  });
});
