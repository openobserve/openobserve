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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { defineComponent } from "vue";
import { mount } from "@vue/test-utils";
import { Dialog, Notify } from "quasar";
import { createI18n } from "vue-i18n";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

// Create i18n instance
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: {
        queryRangeRestrictionMsg: "Query range restricted to {range}",
      },
    },
  },
});

// ---------------------------------------------------------------------------
// Mockable state for the `hasBreakdown` block tests
// ---------------------------------------------------------------------------
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
      resultGrid: {
        rowsPerPage: 100,
        showPagination: true,
        chartInterval: "1 minute",
      },
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
        histogram_breakdown_field: null as string | null,
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

// These mocks MUST be declared before the `import` of useHistogram below.
vi.mock("./searchState", () => ({
  searchState: vi.fn(() => mockState),
}));

vi.mock("./logsUtils", () => ({
  logsUtils: vi.fn(() => mockLogsUtils),
}));

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      timezone: "UTC",
      zoConfig: { timestamp_column: "_timestamp" },
    },
  })),
}));

// histogramDateTimezone is stubbed to epoch ms so assertions are readable;
// other zincutils exports are preserved because downstream modules import them.
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return {
    ...actual,
    histogramDateTimezone: vi.fn((ts: string) => new Date(ts).getTime()),
    formatSizeFromMB: vi.fn(() => "0 MB"),
  };
});

import { useHistogram } from "./useHistogram";

// Test wrapper — mounts the composable so `useStore()` resolves.
const TestComponent = defineComponent({
  setup() {
    return { ...useHistogram() };
  },
  template: "<div></div>",
});

describe("useHistogram Composable", () => {
  let wrapper: any;

  beforeEach(() => {
    mockState = createMockState();
    mockLogsUtils.fnParsedSQL.mockReturnValue({});
    mockLogsUtils.hasAggregation.mockReturnValue(false);

    wrapper = mount(TestComponent, {
      global: { plugins: [store, i18n] },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Histogram Functions", () => {
    it("should have generateHistogramSkeleton function", () => {
      expect(typeof wrapper.vm.generateHistogramSkeleton).toBe("function");
    });

    it("should have generateHistogramData function", () => {
      expect(typeof wrapper.vm.generateHistogramData).toBe("function");
    });

    it("should have getHistogramTitle function", () => {
      expect(typeof wrapper.vm.getHistogramTitle).toBe("function");
    });

    it("should have resetHistogramWithError function", () => {
      expect(typeof wrapper.vm.resetHistogramWithError).toBe("function");
    });

    it("should have setMultiStreamHistogramQuery function", () => {
      expect(typeof wrapper.vm.setMultiStreamHistogramQuery).toBe("function");
    });

    it("should have isHistogramEnabled function", () => {
      expect(typeof wrapper.vm.isHistogramEnabled).toBe("function");
    });
  });

  // --------------------------------------------------------------------------
  // generateHistogramData — hasBreakdown block
  // --------------------------------------------------------------------------
  describe("generateHistogramData — hasBreakdown block", () => {
    const ts1 = "2026-04-24T10:00:00";
    const ts2 = "2026-04-24T10:01:00";
    const ts3 = "2026-04-24T10:02:00";

    const setAggs = (
      aggs: any[],
      breakdownField: string | null = "severity",
    ) => {
      mockState.searchObj.data.queryResults.aggs = aggs;
      mockState.searchObj.data.queryResults.histogram_breakdown_field =
        breakdownField;
    };

    it("enters breakdown path and populates breakdownField + breakdownSeries", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 2 },
        { zo_sql_key: ts2, zo_sql_breakdown: "info", zo_sql_num: 5 },
        { zo_sql_key: ts2, zo_sql_breakdown: "error", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      expect(hist.breakdownField).toBe("severity");
      expect(hist.breakdownSeries).toBeInstanceOf(Map);
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;
      expect([...series.keys()]).toEqual(["info", "error"]); // severity order
      expect(series.get("info")).toEqual([3, 5]);
      expect(series.get("error")).toEqual([2, 1]);
    });

    it("builds xData from sorted unique timestamps", () => {
      setAggs([
        { zo_sql_key: ts2, zo_sql_breakdown: "info", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 2 },
        { zo_sql_key: ts3, zo_sql_breakdown: "info", zo_sql_num: 3 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      expect(hist.xData).toEqual([
        new Date(ts1).getTime(),
        new Date(ts2).getTime(),
        new Date(ts3).getTime(),
      ]);
      expect(hist.chartParams.unparsed_x_data).toEqual([ts1, ts2, ts3]);
    });

    it("orders categories by SEVERITY_ORDER (trace < info < warn < error)", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "trace", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "warn", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      expect([...series.keys()]).toEqual(["trace", "info", "warn", "error"]);
    });

    it("case-insensitive severity ordering (ERROR === error)", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "ERROR", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "Info", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      expect([...series.keys()]).toEqual(["Info", "ERROR"]);
    });

    it("sorts unknown categories alphabetically after known severities", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "zeta", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "alpha", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      expect([...series.keys()]).toEqual(["error", "alpha", "zeta"]);
    });

    it("coerces numeric breakdown values to strings (status codes 200/404/500)", () => {
      setAggs(
        [
          { zo_sql_key: ts1, zo_sql_breakdown: 200, zo_sql_num: 10 },
          { zo_sql_key: ts1, zo_sql_breakdown: 404, zo_sql_num: 3 },
          { zo_sql_key: ts1, zo_sql_breakdown: 500, zo_sql_num: 1 },
        ],
        "status",
      );

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      // All keys are strings (alphabetical since none match severity)
      expect([...series.keys()]).toEqual(["200", "404", "500"]);
      expect(series.get("200")).toEqual([10]);
      expect(series.get("404")).toEqual([3]);
      expect(series.get("500")).toEqual([1]);
    });

    it("handles a breakdown value of numeric 0 (falsy but valid)", () => {
      setAggs(
        [
          { zo_sql_key: ts1, zo_sql_breakdown: 0, zo_sql_num: 5 },
          { zo_sql_key: ts1, zo_sql_breakdown: 1, zo_sql_num: 2 },
        ],
        "severity_num",
      );

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      expect(series.has("0")).toBe(true);
      expect(series.get("0")).toEqual([5]);
      expect(series.get("1")).toEqual([2]);
    });

    it("filters out aggs rows with null/undefined zo_sql_breakdown", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts1, zo_sql_breakdown: null, zo_sql_num: 99 },
        { zo_sql_key: ts1, zo_sql_breakdown: undefined, zo_sql_num: 77 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      expect([...series.keys()]).toEqual(["info"]);
      expect(series.get("info")).toEqual([3]);
      // 99 and 77 should NOT leak into totals
      expect(mockState.searchObj.data.queryResults.total).toBe(3);
    });

    it("sums multiple aggs rows for the same (timestamp, category)", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 7 },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 2 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      expect(series.get("info")).toEqual([12]);
    });

    it("parses string zo_sql_num values numerically (no string concat)", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: "10" },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: "20" },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      // If parseInt was skipped we'd see "1020" → 1020 after final parse.
      expect(series.get("info")).toEqual([30]);
    });

    it("merges prior-page breakdown state from histogramResults.value", () => {
      mockState.histogramResults.value = [
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 5 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 2 },
      ];
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts2, zo_sql_breakdown: "error", zo_sql_num: 4 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      // info at ts1 = 5 (seed) + 3 (page) = 8; error at ts2 = 4 (page only)
      expect(series.get("info")).toEqual([8, 0]);
      expect(series.get("error")).toEqual([2, 4]);
    });

    it("skips seed rows in histogramResults.value that lack zo_sql_breakdown", () => {
      // Skeleton entries (zo_sql_num: 0, no breakdown) pushed by response handler.
      mockState.histogramResults.value = [
        { zo_sql_key: ts1, zo_sql_num: 0 }, // skeleton
        { zo_sql_key: ts2, zo_sql_num: 0 }, // skeleton
      ];
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 4 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      // Only ts1 appears — skeleton-only ts2 bucket is dropped by the filter.
      expect(hist.chartParams.unparsed_x_data).toEqual([ts1]);
      expect(hist.xData).toEqual([new Date(ts1).getTime()]);
    });

    it("yData holds per-timestamp totals summed across categories", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 2 },
        { zo_sql_key: ts2, zo_sql_breakdown: "info", zo_sql_num: 5 },
        { zo_sql_key: ts2, zo_sql_breakdown: "error", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      expect(hist.yData).toEqual([5, 6]);
    });

    it("sets queryResults.total to sum of yData", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 2 },
        { zo_sql_key: ts2, zo_sql_breakdown: "info", zo_sql_num: 5 },
      ]);

      wrapper.vm.generateHistogramData();
      expect(mockState.searchObj.data.queryResults.total).toBe(10);
    });

    it("fills missing (timestamp × category) cells with 0", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts2, zo_sql_breakdown: "error", zo_sql_num: 7 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram
        .breakdownSeries as unknown as Map<string, number[]>;

      expect(series.get("info")).toEqual([3, 0]);
      expect(series.get("error")).toEqual([0, 7]);
    });

    it("falls through to flat path when breakdownField is null", () => {
      setAggs(
        [
          { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
          { zo_sql_key: ts2, zo_sql_breakdown: "info", zo_sql_num: 5 },
        ],
        null, // no breakdown field
      );

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      expect(hist.breakdownField).toBeNull();
      expect(hist.breakdownSeries).toBeNull();
    });

    it("falls through to flat path when breakdownField is empty string", () => {
      setAggs(
        [
          { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        ],
        "", // falsy
      );

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      expect(hist.breakdownField).toBeNull();
      expect(hist.breakdownSeries).toBeNull();
    });

    it("falls through to flat path when no aggs row has zo_sql_breakdown", () => {
      setAggs(
        [
          { zo_sql_key: ts1, zo_sql_num: 3 },
          { zo_sql_key: ts2, zo_sql_num: 5 },
        ],
        "severity", // field present but aggs lack it
      );

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      expect(hist.breakdownField).toBeNull();
      expect(hist.breakdownSeries).toBeNull();
      expect(hist.yData).toEqual([3, 5]);
    });

    it("enters breakdown path when at least one aggs row has breakdown", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_num: 10 }, // no breakdown
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      // hasBreakdown is true because .some() matches the second row.
      expect(hist.breakdownField).toBe("severity");
      expect(hist.breakdownSeries).toBeInstanceOf(Map);
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;
      // The non-breakdown row is skipped; only the info row contributes.
      expect(series.get("info")).toEqual([3]);
      expect(mockState.searchObj.data.queryResults.total).toBe(3);
    });

    it("writes chartParams.timezone from the store", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      expect(
        mockState.searchObj.data.histogram.chartParams.timezone,
      ).toBe("UTC");
    });

    it("resets errorCode/errorMsg/errorDetail on successful breakdown build", () => {
      mockState.searchObj.data.histogram.errorCode = 500;
      mockState.searchObj.data.histogram.errorMsg = "stale";
      mockState.searchObj.data.histogram.errorDetail = "stale detail";

      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;
      expect(hist.errorCode).toBe(0);
      expect(hist.errorMsg).toBe("");
      expect(hist.errorDetail).toBe("");
    });

    it("handles empty aggs array — neither path sets histogram", () => {
      mockState.searchObj.data.queryResults.aggs = [];
      mockState.searchObj.data.queryResults.histogram_breakdown_field =
        "severity";

      const before = JSON.stringify(
        mockState.searchObj.data.histogram.breakdownField,
      );
      wrapper.vm.generateHistogramData();
      // aggs is truthy (empty array) but .some() returns false → flat path,
      // flat path loops over empty data and still writes a histogram.
      const hist = mockState.searchObj.data.histogram;
      expect(hist.breakdownField).toBeNull();
      expect(hist.breakdownSeries).toBeNull();
      expect(hist.xData).toEqual([]);
      expect(hist.yData).toEqual([]);
    });
  });
});
