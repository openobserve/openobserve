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
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import enLocale from "@/locales/languages/en-US.json";
import { BREAKDOWN_EMPTY_VALUE } from "@/utils/logs/constants";
import { getEmptyBreakdownFilter } from "@/utils/logs/breakdownFilter";

// Create i18n instance. Uses the real `search` messages rather than a stub —
// these tests pin the exact rendered en-US wording.
const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: {
    en: {
      search: enLocale.search,
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
import { convertStackedLogData } from "@/utils/logs/convertLogData";

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

    it("should have isHistogramEnabled function", () => {
      expect(typeof wrapper.vm.isHistogramEnabled).toBe("function");
    });
  });

  describe("generateHistogramSkeleton", () => {
    it("skips the skeleton instead of throwing when the run built no request", () => {
      (mockState.searchObj.data as any).customDownloadQueryObj = {};
      mockState.searchObj.data.queryResults.aggs = [{ zo_sql_key: "2026-04-24T10:00:00" }];
      expect(() => wrapper.vm.generateHistogramSkeleton()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // getHistogramTitle — pins the rendered en-US sentence
  // --------------------------------------------------------------------------
  describe("getHistogramTitle", () => {
    beforeEach(() => {
      mockState.searchObj.data.queryResults.total = 250;
      mockState.searchObj.data.queryResults.took = 42;
    });

    it("renders the title with the scan size in logs mode", () => {
      mockState.searchObj.meta.logsVisualizeToggle = "logs";

      expect(wrapper.vm.getHistogramTitle()).toBe(
        "Showing 1 to 100 out of 250 events in 42 ms. (Scan Size: 0 MB)",
      );
    });

    it("labels the scan size as delta when a result cache ratio is present", () => {
      mockState.searchObj.meta.logsVisualizeToggle = "logs";
      mockState.searchObj.data.queryResults.result_cache_ratio = 50;

      expect(wrapper.vm.getHistogramTitle()).toBe(
        "Showing 1 to 100 out of 250 events in 42 ms. (Delta Scan Size: 0 MB)",
      );
    });

    it("omits the scan size outside logs mode", () => {
      mockState.searchObj.meta.logsVisualizeToggle = "visualize";

      expect(wrapper.vm.getHistogramTitle()).toBe("Showing 1 to 100 out of 250 events in 42 ms.");
    });

    it("returns an empty title and sets a notification when it throws", () => {
      // resultGrid is read first inside the try block — removing it forces the catch.
      mockState.searchObj.data.resultGrid = undefined as any;

      expect(wrapper.vm.getHistogramTitle()).toBe("");
      expect(mockState.notificationMsg.value).toBe("Error while generating histogram title.");
    });
  });

  // --------------------------------------------------------------------------
  // getHistogramTitleParts — the structured contract SearchResult's chips
  // consume. Chips MUST build from these values; deriving them by parsing the
  // rendered title breaks in every non-English locale.
  // --------------------------------------------------------------------------
  describe("getHistogramTitleParts", () => {
    beforeEach(() => {
      mockState.searchObj.data.queryResults.total = 250;
      mockState.searchObj.data.queryResults.took = 42;
    });

    it("includes the resolved scan label and size in logs mode", () => {
      mockState.searchObj.meta.logsVisualizeToggle = "logs";

      expect(wrapper.vm.getHistogramTitleParts()).toEqual({
        start: 1,
        end: 100,
        total: "250",
        took: 42,
        scanLabel: "Scan Size",
        scanSize: "0 MB",
      });
    });

    it("omits the scan fields outside logs mode", () => {
      mockState.searchObj.meta.logsVisualizeToggle = "visualize";

      expect(wrapper.vm.getHistogramTitleParts()).toEqual({
        start: 1,
        end: 100,
        total: "250",
        took: 42,
      });
    });

    it("returns null when the computation throws, so the chips hide", () => {
      mockState.searchObj.data.resultGrid = undefined as any;

      expect(wrapper.vm.getHistogramTitleParts()).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // generateHistogramData — hasBreakdown block
  // --------------------------------------------------------------------------
  describe("generateHistogramData — hasBreakdown block", () => {
    const ts1 = "2026-04-24T10:00:00";
    const ts2 = "2026-04-24T10:01:00";
    const ts3 = "2026-04-24T10:02:00";

    const setAggs = (aggs: any[], breakdownField: string | null = "severity") => {
      mockState.searchObj.data.queryResults.aggs = aggs;
      mockState.searchObj.data.queryResults.histogram_breakdown_field = breakdownField;
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
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

      expect([...series.keys()]).toEqual(["trace", "info", "warn", "error"]);
    });

    it("case-insensitive severity ordering (ERROR === error)", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "ERROR", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "Info", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

      expect([...series.keys()]).toEqual(["Info", "ERROR"]);
    });

    it("sorts unknown categories alphabetically after known severities", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "zeta", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "alpha", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 1 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

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
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

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
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

      expect(series.has("0")).toBe(true);
      expect(series.get("0")).toEqual([5]);
      expect(series.get("1")).toEqual([2]);
    });

    it("stacks rows with a null or undefined breakdown under the (empty) series without losing counts", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts1, zo_sql_breakdown: null, zo_sql_num: 99 },
        { zo_sql_key: ts1, zo_sql_breakdown: undefined, zo_sql_num: 77 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;

      expect(hist.breakdownField).toBe("severity");
      expect(series.get("info")).toEqual([3]);
      expect(series.get("")).toEqual([176]);
      expect(hist.yData).toEqual([179]);
      expect(mockState.searchObj.data.queryResults.total).toBe(179);
    });

    it("stacks a lone zo_sql_breakdown: null row under (empty) without dropping its count", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts1, zo_sql_breakdown: null, zo_sql_num: 99 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;

      expect(hist.breakdownField).toBe("severity");
      expect(series.get("info")).toEqual([3]);
      expect(series.get("")).toEqual([99]);
      expect(mockState.searchObj.data.queryResults.total).toBe(102);
    });

    it("renders empty-string and error rows as an (empty) series and an error series", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "", zo_sql_num: 40 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 2 },
        { zo_sql_key: ts2, zo_sql_breakdown: "", zo_sql_num: 8 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;
      const { options } = convertStackedLogData(hist.xData, series, hist.chartParams, false);

      expect(options.series.map((s: any) => s.name).sort()).toEqual(["(empty)", "error"]);
      expect(series.get("")).toEqual([40, 8]);
      expect(series.get("error")).toEqual([2, 0]);
      expect(mockState.searchObj.data.queryResults.total).toBe(50);
    });

    it("merges missing, null and empty-string breakdowns into one (empty) bucket", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "", zo_sql_num: 1 },
        { zo_sql_key: ts1, zo_sql_breakdown: null, zo_sql_num: 2 },
        { zo_sql_key: ts1, zo_sql_num: 4 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

      expect([...series.keys()]).toEqual([""]);
      expect(series.get("")).toEqual([7]);
      expect(mockState.searchObj.data.queryResults.total).toBe(7);
    });

    it("sums a NULL row and an empty string row in one bucket and filters both on drilldown", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_num: 11 },
        { zo_sql_key: ts1, zo_sql_breakdown: "", zo_sql_num: 40 },
      ]);

      wrapper.vm.generateHistogramData();
      const histogram = mockState.searchObj.data.histogram;
      const series = histogram.breakdownSeries as unknown as Map<string, number[]>;

      expect(series.get(BREAKDOWN_EMPTY_VALUE)).toEqual([51]);
      expect(getEmptyBreakdownFilter(histogram.breakdownField, "include", (f) => f)).toBe(
        `(${histogram.breakdownField} is null OR ${histogram.breakdownField} = '')`,
      );
      expect(getEmptyBreakdownFilter(histogram.breakdownField, "exclude", (f) => f)).toBe(
        `(${histogram.breakdownField} is not null AND ${histogram.breakdownField} != '')`,
      );
    });

    it("sums multiple aggs rows for the same (timestamp, category)", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 7 },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 2 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

      expect(series.get("info")).toEqual([12]);
    });

    it("parses string zo_sql_num values numerically (no string concat)", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: "10" },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: "20" },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

      // If parseInt was skipped we'd see "1020" → 1020 after final parse.
      expect(series.get("info")).toEqual([30]);
    });

    it("takes only timestamps from histogramResults.value and counts from aggs", () => {
      mockState.histogramResults.value = [
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 5 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 2 },
      ];
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
        { zo_sql_key: ts2, zo_sql_breakdown: "error", zo_sql_num: 4 },
      ]);

      wrapper.vm.generateHistogramData();
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

      expect(series.get("info")).toEqual([3, 0]);
      expect(series.get("error")).toEqual([0, 4]);
    });

    it("keeps skeleton timestamps on the x-axis even when they have no breakdown data", () => {
      // Skeleton entries (zo_sql_num: 0, no breakdown) pushed by response handler
      // pre-populate the full query range. Both ts1 and ts2 must appear on the
      // x-axis so the chart fills the whole range from the first render rather
      // than "growing from the center" as partitions stream in.
      mockState.histogramResults.value = [
        { zo_sql_key: ts1, zo_sql_num: 0 }, // skeleton
        { zo_sql_key: ts2, zo_sql_num: 0 }, // skeleton
      ];
      setAggs([{ zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 4 }]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      // Both timestamps present; empty bucket renders as 0 across all categories.
      expect(hist.chartParams.unparsed_x_data).toEqual([ts1, ts2]);
      expect(hist.xData).toEqual([new Date(ts1).getTime(), new Date(ts2).getTime()]);
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;
      expect(series.get("info")).toEqual([4, 0]);
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
      const series = mockState.searchObj.data.histogram.breakdownSeries as unknown as Map<
        string,
        number[]
      >;

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
        [{ zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 }],
        "", // falsy
      );

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      expect(hist.breakdownField).toBeNull();
      expect(hist.breakdownSeries).toBeNull();
    });

    it("stacks under a single (empty) series when no aggs row has zo_sql_breakdown", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_num: 3 },
        { zo_sql_key: ts2, zo_sql_num: 5 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;

      expect(hist.breakdownField).toBe("severity");
      expect([...series.keys()]).toEqual([""]);
      expect(series.get("")).toEqual([3, 5]);
      expect(hist.yData).toEqual([3, 5]);
    });

    it("stays stacked when an empty-only partition is followed by populated rows", () => {
      setAggs([{ zo_sql_key: ts1, zo_sql_num: 4 }]);
      wrapper.vm.generateHistogramData();
      const first = mockState.searchObj.data.histogram;
      expect(first.breakdownField).toBe("severity");
      expect([...(first.breakdownSeries as unknown as Map<string, number[]>).keys()]).toEqual([""]);

      setAggs([
        { zo_sql_key: ts1, zo_sql_num: 4 },
        { zo_sql_key: ts2, zo_sql_breakdown: "error", zo_sql_num: 2 },
      ]);
      wrapper.vm.generateHistogramData();
      const second = mockState.searchObj.data.histogram;
      const series = second.breakdownSeries as unknown as Map<string, number[]>;

      expect(second.breakdownField).toBe("severity");
      expect(series.get("")).toEqual([4, 0]);
      expect(series.get("error")).toEqual([0, 2]);
      expect(mockState.searchObj.data.queryResults.total).toBe(6);
    });

    it("stacks an untagged row under (empty) beside a tagged row in the same bucket", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_num: 10 },
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 3 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;

      expect(hist.breakdownField).toBe("severity");
      expect(series.get("")).toEqual([10]);
      expect(series.get("info")).toEqual([3]);
      expect(hist.yData).toEqual([13]);
      expect(mockState.searchObj.data.queryResults.total).toBe(13);
    });

    it("enters breakdown path when every aggs row has breakdown", () => {
      setAggs([
        { zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 10 },
        { zo_sql_key: ts1, zo_sql_breakdown: "error", zo_sql_num: 3 },
      ]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;

      expect(hist.breakdownField).toBe("severity");
      expect(hist.breakdownSeries).toBeInstanceOf(Map);
      const series = hist.breakdownSeries as unknown as Map<string, number[]>;
      expect(series.get("info")).toEqual([10]);
      expect(series.get("error")).toEqual([3]);
      expect(mockState.searchObj.data.queryResults.total).toBe(13);
    });

    it("writes chartParams.timezone from the store", () => {
      setAggs([{ zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 1 }]);

      wrapper.vm.generateHistogramData();
      expect(mockState.searchObj.data.histogram.chartParams.timezone).toBe("UTC");
    });

    it("resets errorCode/errorMsg/errorDetail on successful breakdown build", () => {
      mockState.searchObj.data.histogram.errorCode = 500;
      mockState.searchObj.data.histogram.errorMsg = "stale";
      mockState.searchObj.data.histogram.errorDetail = "stale detail";

      setAggs([{ zo_sql_key: ts1, zo_sql_breakdown: "info", zo_sql_num: 1 }]);

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;
      expect(hist.errorCode).toBe(0);
      expect(hist.errorMsg).toBe("");
      expect(hist.errorDetail).toBe("");
    });

    it("writes an empty stacked histogram for empty aggs when the breakdown field is set", () => {
      mockState.searchObj.data.queryResults.aggs = [];
      mockState.searchObj.data.queryResults.histogram_breakdown_field = "severity";

      wrapper.vm.generateHistogramData();
      const hist = mockState.searchObj.data.histogram;
      expect(hist.breakdownField).toBe("severity");
      expect((hist.breakdownSeries as unknown as Map<string, number[]>).size).toBe(0);
      expect(hist.xData).toEqual([]);
      expect(hist.yData).toEqual([]);
    });
  });
});
