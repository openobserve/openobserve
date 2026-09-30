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
 * Replays a real histogram SSE capture (nginx / k8s_cluster=production /
 * body_path str_match, trace prefix 01a0f10b289573bab993ba0264737534) through
 * the REAL handleHistogramStreamingHits/Metadata + generateHistogramData
 * pipeline — not mocked — to check whether the reported "empty bars at the
 * older end of the range" symptom reproduces from a single, uninterrupted
 * histogram stream alone, independent of any overlapping-stream theory.
 *
 * Only useHistogram is left unmocked here (unlike useSearchResponseHandler.spec.ts,
 * which mocks it) so the real merge-by-zo_sql_key logic actually runs and
 * searchObj.data.histogram.xData/yData reflect the real accumulated aggs.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSearchResponseHandler } from "./useSearchResponseHandler";

// ---------------------------------------------------------------------------
// Fixture: every (metadata, hits) pair from the captured stream, in the exact
// order they arrived. histogram_interval is 3600s (1 hour) throughout;
// order_by is "desc" throughout. time_offset values are verbatim from the
// capture (microseconds).
// ---------------------------------------------------------------------------
type Chunk = { start: number; end: number; hits: [string, number][] };

const CHUNKS: Chunk[] = [
  { start: 1790744400000000, end: 1790745555000000, hits: [["2026-09-30T05:00:00", 10]] },
  {
    start: 1790733600000000,
    end: 1790744400000000,
    hits: [
      ["2026-09-30T04:00:00", 33],
      ["2026-09-30T03:00:00", 33],
      ["2026-09-30T02:00:00", 33],
    ],
  },
  {
    start: 1790722800000000,
    end: 1790733600000000,
    hits: [
      ["2026-09-30T01:00:00", 32],
      ["2026-09-30T00:00:00", 33],
      ["2026-09-29T23:00:00", 33],
    ],
  },
  {
    start: 1790712000000000,
    end: 1790722800000000,
    hits: [
      ["2026-09-29T22:00:00", 36],
      ["2026-09-29T21:00:00", 36],
      ["2026-09-29T20:00:00", 39],
    ],
  },
  {
    start: 1790701200000000,
    end: 1790712000000000,
    hits: [
      ["2026-09-29T19:00:00", 33],
      ["2026-09-29T18:00:00", 32],
      ["2026-09-29T17:00:00", 31],
    ],
  },
  {
    start: 1790690400000000,
    end: 1790701200000000,
    hits: [
      ["2026-09-29T16:00:00", 33],
      ["2026-09-29T15:00:00", 32],
      ["2026-09-29T14:00:00", 36],
    ],
  },
  {
    start: 1790679600000000,
    end: 1790690400000000,
    hits: [
      ["2026-09-29T13:00:00", 34],
      ["2026-09-29T12:00:00", 33],
      ["2026-09-29T11:00:00", 33],
    ],
  },
  {
    start: 1790668800000000,
    end: 1790679600000000,
    hits: [
      ["2026-09-29T10:00:00", 31],
      ["2026-09-29T09:00:00", 33],
      ["2026-09-29T08:00:00", 35],
    ],
  },
  {
    start: 1790658000000000,
    end: 1790668800000000,
    hits: [
      ["2026-09-29T07:00:00", 26],
      ["2026-09-29T06:00:00", 33],
      ["2026-09-29T05:00:00", 26],
    ],
  },
  {
    start: 1790647200000000,
    end: 1790658000000000,
    hits: [
      ["2026-09-29T04:00:00", 32],
      ["2026-09-29T03:00:00", 32],
      ["2026-09-29T02:00:00", 32],
    ],
  },
  {
    start: 1790636400000000,
    end: 1790647200000000,
    hits: [
      ["2026-09-29T01:00:00", 31],
      ["2026-09-29T00:00:00", 32],
      ["2026-09-28T23:00:00", 33],
    ],
  },
  {
    start: 1790625600000000,
    end: 1790636400000000,
    hits: [
      ["2026-09-28T22:00:00", 32],
      ["2026-09-28T21:00:00", 33],
      ["2026-09-28T20:00:00", 33],
    ],
  },
  {
    start: 1790614800000000,
    end: 1790625600000000,
    hits: [
      ["2026-09-28T19:00:00", 33],
      ["2026-09-28T18:00:00", 33],
      ["2026-09-28T17:00:00", 33],
    ],
  },
  {
    start: 1790604000000000,
    end: 1790614800000000,
    hits: [
      ["2026-09-28T16:00:00", 34],
      ["2026-09-28T15:00:00", 35],
      ["2026-09-28T14:00:00", 33],
    ],
  },
  {
    start: 1790593200000000,
    end: 1790604000000000,
    hits: [
      ["2026-09-28T13:00:00", 33],
      ["2026-09-28T12:00:00", 31],
      ["2026-09-28T11:00:00", 33],
    ],
  },
  {
    start: 1790582400000000,
    end: 1790593200000000,
    hits: [
      ["2026-09-28T10:00:00", 32],
      ["2026-09-28T09:00:00", 31],
      ["2026-09-28T08:00:00", 32],
    ],
  },
  {
    start: 1790571600000000,
    end: 1790582400000000,
    hits: [
      ["2026-09-28T07:00:00", 33],
      ["2026-09-28T06:00:00", 37],
      ["2026-09-28T05:00:00", 32],
    ],
  },
  {
    start: 1790560800000000,
    end: 1790571600000000,
    hits: [
      ["2026-09-28T04:00:00", 33],
      ["2026-09-28T03:00:00", 32],
      ["2026-09-28T02:00:00", 32],
    ],
  },
  {
    start: 1790550000000000,
    end: 1790560800000000,
    hits: [
      ["2026-09-28T01:00:00", 32],
      ["2026-09-28T00:00:00", 33],
      ["2026-09-27T23:00:00", 33],
    ],
  },
  {
    start: 1790539200000000,
    end: 1790550000000000,
    hits: [
      ["2026-09-27T22:00:00", 33],
      ["2026-09-27T21:00:00", 32],
      ["2026-09-27T20:00:00", 33],
    ],
  },
  {
    start: 1790528400000000,
    end: 1790539200000000,
    hits: [
      ["2026-09-27T19:00:00", 32],
      ["2026-09-27T18:00:00", 33],
      ["2026-09-27T17:00:00", 32],
    ],
  },
  {
    start: 1790517600000000,
    end: 1790528400000000,
    hits: [
      ["2026-09-27T16:00:00", 32],
      ["2026-09-27T15:00:00", 32],
      ["2026-09-27T14:00:00", 34],
    ],
  },
  {
    start: 1790506800000000,
    end: 1790517600000000,
    hits: [
      ["2026-09-27T13:00:00", 32],
      ["2026-09-27T12:00:00", 32],
      ["2026-09-27T11:00:00", 32],
    ],
  },
  {
    start: 1790496000000000,
    end: 1790506800000000,
    hits: [
      ["2026-09-27T10:00:00", 32],
      ["2026-09-27T09:00:00", 33],
      ["2026-09-27T08:00:00", 33],
    ],
  },
  {
    start: 1790485200000000,
    end: 1790496000000000,
    hits: [
      ["2026-09-27T07:00:00", 33],
      ["2026-09-27T06:00:00", 33],
      ["2026-09-27T05:00:00", 33],
    ],
  },
  {
    start: 1790474400000000,
    end: 1790485200000000,
    hits: [
      ["2026-09-27T04:00:00", 32],
      ["2026-09-27T03:00:00", 33],
      ["2026-09-27T02:00:00", 32],
    ],
  },
  {
    start: 1790463600000000,
    end: 1790474400000000,
    hits: [
      ["2026-09-27T01:00:00", 32],
      ["2026-09-27T00:00:00", 32],
      ["2026-09-26T23:00:00", 32],
    ],
  },
  {
    start: 1790452800000000,
    end: 1790463600000000,
    hits: [
      ["2026-09-26T22:00:00", 32],
      ["2026-09-26T21:00:00", 32],
      ["2026-09-26T20:00:00", 32],
    ],
  },
  {
    start: 1790442000000000,
    end: 1790452800000000,
    hits: [
      ["2026-09-26T19:00:00", 32],
      ["2026-09-26T18:00:00", 36],
      ["2026-09-26T17:00:00", 31],
    ],
  },
  {
    start: 1790431200000000,
    end: 1790442000000000,
    hits: [
      ["2026-09-26T16:00:00", 32],
      ["2026-09-26T15:00:00", 33],
      ["2026-09-26T14:00:00", 32],
    ],
  },
  {
    start: 1790420400000000,
    end: 1790431200000000,
    hits: [
      ["2026-09-26T13:00:00", 32],
      ["2026-09-26T12:00:00", 32],
      ["2026-09-26T11:00:00", 33],
    ],
  },
  {
    start: 1790409600000000,
    end: 1790420400000000,
    hits: [
      ["2026-09-26T10:00:00", 34],
      ["2026-09-26T09:00:00", 33],
      ["2026-09-26T08:00:00", 32],
    ],
  },
  {
    start: 1790398800000000,
    end: 1790409600000000,
    hits: [
      ["2026-09-26T07:00:00", 32],
      ["2026-09-26T06:00:00", 32],
      ["2026-09-26T05:00:00", 32],
    ],
  },
  {
    start: 1790388000000000,
    end: 1790398800000000,
    hits: [
      ["2026-09-26T04:00:00", 32],
      ["2026-09-26T03:00:00", 32],
      ["2026-09-26T02:00:00", 32],
    ],
  },
  {
    start: 1790377200000000,
    end: 1790388000000000,
    hits: [
      ["2026-09-26T01:00:00", 32],
      ["2026-09-26T00:00:00", 32],
      ["2026-09-25T23:00:00", 32],
    ],
  },
  {
    start: 1790366400000000,
    end: 1790377200000000,
    hits: [
      ["2026-09-25T22:00:00", 32],
      ["2026-09-25T21:00:00", 32],
      ["2026-09-25T20:00:00", 32],
    ],
  },
  {
    start: 1790355600000000,
    end: 1790366400000000,
    hits: [
      ["2026-09-25T19:00:00", 34],
      ["2026-09-25T18:00:00", 32],
      ["2026-09-25T17:00:00", 35],
    ],
  },
  {
    start: 1790344800000000,
    end: 1790355600000000,
    hits: [
      ["2026-09-25T16:00:00", 32],
      ["2026-09-25T15:00:00", 34],
      ["2026-09-25T14:00:00", 34],
    ],
  },
  {
    start: 1790334000000000,
    end: 1790344800000000,
    hits: [
      ["2026-09-25T13:00:00", 34],
      ["2026-09-25T12:00:00", 34],
      ["2026-09-25T11:00:00", 33],
    ],
  },
  {
    start: 1790323200000000,
    end: 1790334000000000,
    hits: [
      ["2026-09-25T10:00:00", 32],
      ["2026-09-25T09:00:00", 32],
      ["2026-09-25T08:00:00", 32],
    ],
  },
  {
    start: 1790312400000000,
    end: 1790323200000000,
    hits: [
      ["2026-09-25T07:00:00", 34],
      ["2026-09-25T06:00:00", 32],
      ["2026-09-25T05:00:00", 33],
    ],
  },
];

const TOTAL_HITS = CHUNKS.reduce((n, c) => n + c.hits.length, 0);
const NEWEST_KEY = CHUNKS[0].hits[0][0]; // "2026-09-30T05:00:00" — first to arrive
const OLDEST_CHUNK = CHUNKS[CHUNKS.length - 1];
const OLDEST_KEY = OLDEST_CHUNK.hits[OLDEST_CHUNK.hits.length - 1][0]; // "2026-09-25T05:00:00" — last to arrive

// ---------------------------------------------------------------------------
// Mock state — shared by useSearchResponseHandler AND the real useHistogram.
// Range padded a bit beyond the fixture so skeleton generation covers it.
// ---------------------------------------------------------------------------
const createMockState = () => ({
  searchObj: {
    organizationIdentifier: "default",
    communicationMethod: "http",
    data: {
      queryResults: {
        hits: [],
        aggs: [] as any[],
        total: 0,
        scan_size: 0,
        took: 0,
        result_cache_ratio: 0,
        histogram_breakdown_field: null as string | null,
        partitionDetail: { partitions: [], paginations: [] },
      },
      histogram: {
        xData: [] as number[],
        yData: [] as number[],
        breakdownField: null,
        breakdownSeries: null,
        chartParams: { title: "", titleParts: null, unparsed_x_data: [], timezone: "" },
        errorMsg: "",
        errorCode: 0,
        errorDetail: "",
      },
      errorMsg: "",
      errorCode: 0,
      errorDetail: "",
      countErrorMsg: "",
      functionError: "",
      histogramInterval: 0 as number,
      // Padded ~1 day before/after the fixture's real coverage.
      customDownloadQueryObj: {
        query: { start_time: 1790150400000000, end_time: 1790832000000000 },
      },
      datetime: { startTime: 1790150400000000, endTime: 1790832000000000, type: "relative" },
      histogramQuery: { query: { start_time: 1790150400000000, end_time: 1790832000000000 } },
      resultGrid: { currentPage: 1 },
      isOperationCancelled: false,
      lastHistogramTraceId: "",
    },
    meta: {
      sqlMode: false,
      jobId: "",
      refreshInterval: 0,
      showHistogram: true,
      refreshHistogram: false,
      logsVisualizeToggle: "logs",
      resultGrid: { rowsPerPage: 100, showPagination: true, chartInterval: "1 hour" },
    },
    loading: false,
    loadingHistogram: false,
  },
  searchObjDebug: {},
  searchAggData: { hasAggregation: false, total: 0 },
  resetQueryData: vi.fn(),
  notificationMsg: { value: "" },
  resetHistogramError: vi.fn(),
  histogramResults: { value: [] as any[] },
  histogramMappedData: new Map(),
});

let mockState: ReturnType<typeof createMockState>;

const mockSearchPartitionMap: Record<
  string,
  { partition: number; chunks: Record<number, number> }
> = {};

const mockLogsUtils = {
  fnParsedSQL: vi.fn(() => ({})),
  hasAggregation: vi.fn(() => false),
  removeTraceId: vi.fn(),
  updateUrlQueryParams: vi.fn(),
  showCancelSearchNotification: vi.fn(),
};

const mockSearchPagination = {
  refreshPagination: vi.fn(),
  sortResponse: vi.fn(),
};

const mockStreamFields = {
  updateFieldValues: vi.fn(),
  extractFields: vi.fn(),
  updateGridColumns: vi.fn(),
  filterHitsColumns: vi.fn(),
  resetFieldValues: vi.fn(),
};

const mockLogsHighlighter = { clearCache: vi.fn() };

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: { timezone: "UTC", zoConfig: { timestamp_column: "_timestamp" } },
  })),
}));

vi.mock("vue-i18n", () => ({
  useI18n: vi.fn(() => ({ t: vi.fn((key: string) => key) })),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => ({ showErrorNotification: vi.fn() })),
}));

vi.mock("./searchState", () => ({
  searchState: vi.fn(() => ({ ...mockState, searchPartitionMap: mockSearchPartitionMap })),
}));

vi.mock("./logsUtils", () => ({
  logsUtils: vi.fn(() => mockLogsUtils),
}));

// useHistogram is intentionally NOT mocked — this test exercises the real
// merge-by-zo_sql_key logic in generateHistogramData.

vi.mock("./useSearchPagination", () => ({
  default: vi.fn(() => mockSearchPagination),
}));

vi.mock("./useStreamFields", () => ({
  default: vi.fn(() => mockStreamFields),
}));

vi.mock("@/composables/useLogsHighlighter", () => ({
  useLogsHighlighter: vi.fn(() => mockLogsHighlighter),
}));

vi.mock("@/utils/common", () => ({
  logsErrorMessage: vi.fn(() => null),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return { ...actual };
});

vi.mock("@/utils/date", () => ({
  convertDateToTimestamp: vi.fn((dateStr: string, time: string) => {
    // Real behaviour needed here: handleHistogramStreamingHits anchors the
    // skeleton on this parsed value. Parse "dd-mm-yyyy" + "HH:MM" as UTC.
    const [day, month, year] = dateStr.split("-").map(Number);
    const [hour, minute] = time.split(":").map(Number);
    const ms = Date.UTC(year, month - 1, day, hour, minute);
    return { timestamp: ms * 1000 };
  }),
}));

describe("histogram stream capture replay (real merge logic)", () => {
  let responseHandler: ReturnType<typeof useSearchResponseHandler>;
  const traceId = "trace-capture";

  beforeEach(() => {
    mockState = createMockState();
    Object.keys(mockSearchPartitionMap).forEach((k) => delete mockSearchPartitionMap[k]);
    vi.clearAllMocks();
    mockLogsUtils.fnParsedSQL.mockReturnValue({});
    mockLogsUtils.hasAggregation.mockReturnValue(false);
    responseHandler = useSearchResponseHandler();
  });

  const feedHistogramChunk = (chunk: Chunk, chunkTraceId: string) => {
    responseHandler.handleSearchResponse(
      {
        type: "histogram",
        traceId: chunkTraceId,
        isPagination: false,
        queryReq: { query: {} },
        meta: {},
      } as any,
      {
        type: "search_response_metadata",
        content: {
          streaming_aggs: false,
          results: {
            histogram_interval: 3600,
            order_by: "desc",
            converted_histogram_query: "",
            histogram_breakdown_field: "severity",
            scan_size: 0,
            took: 0,
            result_cache_ratio: 0,
          },
        },
      } as any,
    );

    responseHandler.handleSearchResponse(
      {
        type: "histogram",
        traceId: chunkTraceId,
        isPagination: false,
        queryReq: { query: {} },
        meta: {},
      } as any,
      {
        type: "search_response_hits",
        content: {
          results: {
            hits: chunk.hits.map(([zo_sql_key, zo_sql_num]) => ({ zo_sql_key, zo_sql_num })),
          },
        },
      } as any,
    );
  };

  it("accumulates every hit from the captured stream with none dropped", () => {
    for (const chunk of CHUNKS) {
      feedHistogramChunk(chunk, traceId);
    }

    const aggs = mockState.searchObj.data.queryResults.aggs;

    // 1) Nothing lost from the raw accumulation.
    expect(aggs.length).toBe(TOTAL_HITS);

    // 2) The very first (newest) datapoint survived to the end.
    const newest = aggs.find((a: any) => a.zo_sql_key === NEWEST_KEY);
    expect(newest).toBeDefined();
    expect(newest.zo_sql_num).toBe(10);

    // 3) The very last (oldest) datapoint — the one that goes missing in the
    //    reported bug — also survived.
    const oldest = aggs.find((a: any) => a.zo_sql_key === OLDEST_KEY);
    expect(oldest).toBeDefined();
    expect(oldest.zo_sql_num).toBe(33);

    // 4) No duplicate keys snuck in (every hour in this fixture is unique).
    const uniqueKeys = new Set(aggs.map((a: any) => a.zo_sql_key));
    expect(uniqueKeys.size).toBe(TOTAL_HITS);

    // 5) generateHistogramData's real merged output (searchObj.data.histogram)
    //    reflects the same two boundary points as non-zero bars, not
    //    zero-filled skeleton placeholders.
    const { xData, yData } = mockState.searchObj.data.histogram;
    expect(xData.length).toBe(yData.length);
    expect(xData.length).toBeGreaterThan(0);

    const newestTs = new Date(NEWEST_KEY + "Z").getTime();
    const oldestTs = new Date(OLDEST_KEY + "Z").getTime();
    const newestIdx = xData.indexOf(newestTs);
    const oldestIdx = xData.indexOf(oldestTs);

    expect(newestIdx).toBeGreaterThanOrEqual(0);
    expect(oldestIdx).toBeGreaterThanOrEqual(0);
    expect(yData[newestIdx]).toBe(10);
    expect(yData[oldestIdx]).toBe(33);
  });

  // ---------------------------------------------------------------------
  // Regression test for the root cause: a concurrent, non-paginated
  // main-search "streaming_aggs" metadata event — e.g. a second full search
  // run firing while the first search's histogram is still streaming (the
  // live-mode debounce double-fire race) — used to hit
  // handleStreamingMetadata's wholesale `searchObj.data.queryResults = {...}`
  // reassignment, which only preserved `hits` — not `aggs` — dropping
  // everything the histogram stream had accumulated so far.
  // preserveHistogramFields() (useSearchResponseHandler.ts) now carries
  // aggs and the other histogram-owned fields through that reassignment.
  //
  // Note: isPagination must be false here to reach the affected branch — a
  // *paginated* fetch with streaming_aggs:true routes into a different,
  // unaffected branch that only touches from/scan_size/took.
  // ---------------------------------------------------------------------
  it("preserves already-accumulated buckets when a concurrent, non-paginated main-search streaming_aggs event fires mid-stream", () => {
    const SPLIT = 20; // feed the first 20 chunks, then interfere, then the rest

    for (let i = 0; i < SPLIT; i++) {
      feedHistogramChunk(CHUNKS[i], traceId);
    }

    const aggsBeforeInterference = [...mockState.searchObj.data.queryResults.aggs];
    expect(aggsBeforeInterference.find((a: any) => a.zo_sql_key === NEWEST_KEY)).toBeDefined();

    // A second, independent (non-paginated) main-search metadata event,
    // streaming_aggs: true — the real handleStreamingMetadata code path,
    // not mocked.
    responseHandler.handleSearchResponse(
      {
        type: "search",
        traceId: "trace-second-search",
        isPagination: false,
        queryReq: { query: { from: 0, size: 50 } },
      } as any,
      {
        type: "search_response_metadata",
        content: {
          streaming_aggs: true,
          results: { total: 50, took: 10, scan_size: 100, hits: [] },
        },
      } as any,
    );

    for (let i = SPLIT; i < CHUNKS.length; i++) {
      feedHistogramChunk(CHUNKS[i], traceId);
    }

    const aggs = mockState.searchObj.data.queryResults.aggs;
    const { xData, yData } = mockState.searchObj.data.histogram;
    const newestTs = new Date(NEWEST_KEY + "Z").getTime();
    const newestIdx = xData.indexOf(newestTs);

    // Nothing lost: the chunks accumulated before the interference are
    // still in aggs, alongside everything fed after it.
    expect(aggs.length).toBe(TOTAL_HITS);
    expect(aggs.find((a: any) => a.zo_sql_key === NEWEST_KEY)).toBeDefined();

    // The oldest data (fed after the interference) is there too.
    expect(aggs.find((a: any) => a.zo_sql_key === OLDEST_KEY)).toBeDefined();

    // The chart renders the newest bucket's real count, not a zero-filled
    // skeleton placeholder.
    expect(newestIdx).toBeGreaterThanOrEqual(0);
    expect(yData[newestIdx]).toBe(10);
  });
});
