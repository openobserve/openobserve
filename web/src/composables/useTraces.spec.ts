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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRouterPush = vi.fn();
const mockCurrentRoute = {
  value: {
    query: { trace_id: "trace-abc", span_id: "span-xyz" },
  },
};

vi.mock("vue-router", () => ({
  useRouter: vi.fn(() => ({
    push: mockRouterPush,
    currentRoute: mockCurrentRoute,
  })),
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...(actual as object),
    useStore: vi.fn(() => ({
      state: {
        selectedOrganization: { identifier: "test-org" },
        zoConfig: { timestamp_column: "_timestamp", sql_reserved_keywords: [] },
        organizationData: {
          organizationSettings: {
            span_id_field_name: "span_id",
            trace_id_field_name: "trace_id",
          },
        },
      },
      dispatch: vi.fn(),
    })),
  };
});

const { mockCopyToClipboard, mockNotify } = vi.hoisted(() => ({
  mockCopyToClipboard: vi.fn().mockResolvedValue(undefined),
  mockNotify: vi.fn(),
}));

vi.mock("quasar", () => ({
  copyToClipboard: mockCopyToClipboard,
  useQuasar: vi.fn(() => ({ notify: mockNotify })),
}));

// useLocalTraceFilterField behaves like a ref: called with no args it returns the
// current value; called with an arg it writes the new value.  We simulate that
// contract so tests can inspect what was written.
// vi.hoisted() ensures these declarations are available when vi.mock() factories run.
const { localTraceFilterStore, mockUseLocalTraceFilterField } = vi.hoisted(
  () => {
    const localTraceFilterStore = { value: {} as Record<string, any> };
    const mockUseLocalTraceFilterField = vi.fn((newVal?: any) => {
      if (newVal !== undefined) {
        localTraceFilterStore.value = newVal;
      }
      return localTraceFilterStore;
    });
    return { localTraceFilterStore, mockUseLocalTraceFilterField };
  },
);

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    b64EncodeStandard: vi.fn((s: string) => `b64std:${s}`),
    b64EncodeUnicode: vi.fn((s: string) => `b64uni:${s}`),
    useLocalTraceFilterField: mockUseLocalTraceFilterField,
  };
});

vi.mock("@/utils/traces/traceColors", () => ({
  getSpanColorHex: vi.fn((index: number) => `#color-${index}`),
}));

import { getSpanColorHex } from "@/utils/traces/traceColors";
import useTraces, { DEFAULT_TRACE_COLUMNS } from "./useTraces";

// ---------------------------------------------------------------------------

describe("useTraces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the in-memory localStorage simulation
    localTraceFilterStore.value = {};
    // Re-wire the mock after clearAllMocks so it still has the implementation
    mockUseLocalTraceFilterField.mockImplementation((newVal?: any) => {
      if (newVal !== undefined) {
        localTraceFilterStore.value = newVal;
      }
      return localTraceFilterStore;
    });
    // Reset shared singleton state before each test
    const { resetSearchObj } = useTraces();
    resetSearchObj();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Return value structure
  // -------------------------------------------------------------------------
  describe("return value structure", () => {
    it("exposes all expected properties and functions", () => {
      const inst = useTraces();

      expect(inst).toHaveProperty("searchObj");
      expect(inst).toHaveProperty("resetSearchObj");
      expect(inst).toHaveProperty("updatedLocalLogFilterField");
      expect(inst).toHaveProperty("loadLocalLogFilterField");
      expect(inst).toHaveProperty("getUrlQueryParams");
      expect(inst).toHaveProperty("copyTracesUrl");
      expect(inst).toHaveProperty("buildQueryDetails");
      expect(inst).toHaveProperty("navigateToLogs");
      expect(inst).toHaveProperty("tracesShareURL");
      expect(inst).toHaveProperty("formatTracesMetaData");
      expect(inst).toHaveProperty("setServiceColors"); // [auto-generated]
      expect(inst).toHaveProperty("getOrSetServiceColor");
    });
  });

  // -------------------------------------------------------------------------
  // resetSearchObj — state after reset
  // -------------------------------------------------------------------------
  describe("resetSearchObj", () => {
    it("clears errorMsg", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.data.errorMsg = "some error";
      resetSearchObj();
      expect(searchObj.data.errorMsg).toBe("");
    });

    it("clears errorDetail", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.data.errorDetail = "detail";
      resetSearchObj();
      expect(searchObj.data.errorDetail).toBe("");
    });

    it("resets streamLists to empty array", () => {
      const { searchObj, resetSearchObj } = useTraces();
      (searchObj.data.stream.streamLists as any) = [{ label: "s", value: "s" }];
      resetSearchObj();
      expect(searchObj.data.stream.streamLists).toEqual([]);
    });

    it("resets selectedStream to empty label/value", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.data.stream.selectedStream = { label: "svc", value: "svc" };
      resetSearchObj();
      expect(searchObj.data.stream.selectedStream).toEqual({
        label: "",
        value: "",
      });
    });

    it("resets selectedStreamFields to empty array", () => {
      const { searchObj, resetSearchObj } = useTraces();
      (searchObj.data.stream.selectedStreamFields as any) = [{ name: "f" }];
      resetSearchObj();
      expect(searchObj.data.stream.selectedStreamFields).toEqual([]);
    });

    it("resets sortedQueryResults to empty array", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.data.sortedQueryResults = [{ id: 1 }];
      resetSearchObj();
      expect(searchObj.data.sortedQueryResults).toEqual([]);
    });

    it("resets query to empty string", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.data.query = "SELECT *";
      resetSearchObj();
      expect(searchObj.data.query).toBe("");
    });

    it("resets editorValue to empty string", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.data.editorValue = "some editor content";
      resetSearchObj();
      expect(searchObj.data.editorValue).toBe("");
    });

    it("resets sqlMode to false", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.meta.sqlMode = true;
      resetSearchObj();
      expect(searchObj.meta.sqlMode).toBe(false);
    });

    it("resets runQuery to false", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.runQuery = true;
      resetSearchObj();
      expect(searchObj.runQuery).toBe(false);
    });

    it("resets histogram to object with xData and yData arrays", () => {
      const { searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      expect(searchObj.data.histogram).toMatchObject({
        xData: [],
        yData: [],
        chartParams: {
          title: "",
          unparsed_x_data: [],
          timezone: "",
        },
      });
    });

    it("resets isLoadingTraceDetails to false", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.data.traceDetails.isLoadingTraceDetails = true;
      resetSearchObj();
      expect(searchObj.data.traceDetails.isLoadingTraceDetails).toBe(false);
    });

    it("resets isLoadingTraceMeta to false", () => {
      const { searchObj, resetSearchObj } = useTraces();
      searchObj.data.traceDetails.isLoadingTraceMeta = true;
      resetSearchObj();
      expect(searchObj.data.traceDetails.isLoadingTraceMeta).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Initial state / config structure
  // -------------------------------------------------------------------------
  describe("initial state structure", () => {
    it("config.splitterModel is 20", () => {
      const { searchObj } = useTraces();
      expect(searchObj.config.splitterModel).toBe(20);
    });

    it("config.refreshTimes is a 4x3-or-less matrix of objects with label/value", () => {
      const { searchObj } = useTraces();
      expect(Array.isArray(searchObj.config.refreshTimes)).toBe(true);
      const firstRow = searchObj.config.refreshTimes[0];
      expect(firstRow[0]).toMatchObject({
        label: expect.any(String),
        value: expect.any(Number),
      });
    });

    it("meta.resultGrid default sortBy is start_time", () => {
      const { searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      // sortBy is on the object definition, not reset; check structural value
      expect(searchObj.meta.resultGrid.sortBy).toBe("start_time");
    });

    it("meta.resultGrid default sortOrder is desc", () => {
      const { searchObj } = useTraces();
      expect(searchObj.meta.resultGrid.sortOrder).toBe("desc");
    });

    it("data.datetime has relativeTimePeriod 15m and type relative", () => {
      const { searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      expect(searchObj.data.datetime.relativeTimePeriod).toBe("15m");
      expect(searchObj.data.datetime.type).toBe("relative");
    });

    it("data.searchAround.size is 10", () => {
      const { searchObj } = useTraces();
      expect(searchObj.data.searchAround.size).toBe(10);
    });

    it("meta.searchMode defaults to traces", () => {
      const { searchObj } = useTraces();
      expect(searchObj.meta.searchMode).toBe("spans");
    });
  });

  // -------------------------------------------------------------------------
  // getUrlQueryParams
  // -------------------------------------------------------------------------
  describe("getUrlQueryParams", () => {
    it("includes stream from selectedStream.value", () => {
      const { searchObj, getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.stream.selectedStream = { label: "s", value: "my-stream" };
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: 0,
        endTime: 0,
      };

      const params = getUrlQueryParams(false);
      expect(params.stream).toBe("my-stream");
    });

    it("includes period when type is relative and getShareLink is false", () => {
      const { searchObj, getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "30m",
        startTime: 0,
        endTime: 0,
      };

      const params = getUrlQueryParams(false);
      expect(params.period).toBe("30m");
    });

    it("includes from/to when type is relative and getShareLink is true", () => {
      const { searchObj, getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: 1000,
        endTime: 2000,
      };

      const params = getUrlQueryParams(true);
      expect(params.from).toBe(1000);
      expect(params.to).toBe(2000);
    });

    it("includes from/to when type is absolute", () => {
      const { searchObj, getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.datetime = {
        type: "absolute",
        relativeTimePeriod: "",
        startTime: 5000,
        endTime: 9000,
      };

      const params = getUrlQueryParams(false);
      expect(params.from).toBe(5000);
      expect(params.to).toBe(9000);
    });

    it("includes org_identifier from store", () => {
      const { getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      const params = getUrlQueryParams(false);
      expect(params.org_identifier).toBe("test-org");
    });

    it("includes trace_id from current route query", () => {
      const { getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      const params = getUrlQueryParams(false);
      expect(params.trace_id).toBe("trace-abc");
    });

    it("includes span_id from current route query when present", () => {
      const { getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      const params = getUrlQueryParams(false);
      expect(params.span_id).toBe("span-xyz");
    });

    it("includes search_mode=spans when searchMode is spans", () => {
      const { searchObj, getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.searchMode = "spans";
      const params = getUrlQueryParams(false);
      expect(params.search_mode).toBe("spans");
    });

    it("does not include search_mode when searchMode is traces", () => {
      const { searchObj, getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.searchMode = "traces";
      const params = getUrlQueryParams(false);
      expect(params.search_mode).toBeUndefined();
    });

    it("does not include search_mode when searchMode is service-graph", () => {
      const { searchObj, getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.searchMode = "service-graph";
      const params = getUrlQueryParams(false);
      expect(params.search_mode).toBeUndefined();
    });

    it("encodes editorValue as base64 in query param", () => {
      const { searchObj, getUrlQueryParams, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.editorValue = "SELECT * FROM traces";
      const params = getUrlQueryParams(false);
      expect(params.query).toBe("b64uni:SELECT * FROM traces");
    });
  });

  // -------------------------------------------------------------------------
  // buildQueryDetails
  // -------------------------------------------------------------------------
  describe("buildQueryDetails", () => {
    it("returns object with stream, from, to, refresh, query, orgIdentifier", () => {
      const { searchObj, buildQueryDetails, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.traceDetails.selectedLogStreams = ["default"] as any;
      searchObj.data.traceDetails.selectedTrace = {
        trace_id: "trace-abc",
        trace_start_time: 0,
        trace_end_time: 0,
      };

      const span = { spanId: "span-1", startTimeMs: 1000, endTimeMs: 2000 };
      const details = buildQueryDetails(span, true);

      expect(details).toHaveProperty("stream");
      expect(details).toHaveProperty("from");
      expect(details).toHaveProperty("to");
      expect(details).toHaveProperty("refresh");
      expect(details).toHaveProperty("query");
      expect(details).toHaveProperty("orgIdentifier");
    });

    it("builds span query using span_id_field_name and trace_id_field_name", () => {
      const { searchObj, buildQueryDetails, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.traceDetails.selectedLogStreams = ["my-logs"] as any;
      searchObj.data.traceDetails.selectedTrace = {
        trace_id: "trace-xyz",
        trace_start_time: 0,
        trace_end_time: 0,
      };

      const span = { spanId: "s1", startTimeMs: 1000, endTimeMs: 2000 };
      const details = buildQueryDetails(span, true);

      // query should be b64std-encoded
      expect(String(details.query)).toContain("b64std:");
    });

    it("builds trace query (isSpan=false) using trace_id only", () => {
      const { searchObj, buildQueryDetails, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.traceDetails.selectedTrace = {
        trace_id: "trace-xyz",
        trace_start_time: 0,
        trace_end_time: 0,
      };
      searchObj.data.traceDetails.selectedLogStreams = [] as any;

      const span = { startTimeMs: 100, endTimeMs: 200 };
      const details = buildQueryDetails(span, false);

      expect(String(details.query)).toContain("b64std:");
    });

    it("joins multiple log streams with comma", () => {
      const { searchObj, buildQueryDetails, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.traceDetails.selectedLogStreams = [
        "stream-a",
        "stream-b",
      ] as any;
      searchObj.data.traceDetails.selectedTrace = {
        trace_id: "t",
        trace_start_time: 0,
        trace_end_time: 0,
      };

      const span = { spanId: "s", startTimeMs: 100, endTimeMs: 200 };
      const details = buildQueryDetails(span, true);

      expect(details.stream).toBe("stream-a,stream-b");
    });
  });

  // -------------------------------------------------------------------------
  // navigateToLogs
  // -------------------------------------------------------------------------
  describe("navigateToLogs", () => {
    it("calls router.push with /logs path", async () => {
      const { navigateToLogs } = useTraces();
      await navigateToLogs({
        stream: "default",
        from: 1000,
        to: 2000,
        refresh: 0,
        query: "abc",
        orgIdentifier: "test-org",
      });

      expect(mockRouterPush).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/logs" }),
      );
    });

    it("passes all query parameters to router.push", async () => {
      const { navigateToLogs } = useTraces();
      await navigateToLogs({
        stream: "my-stream",
        from: 500,
        to: 1000,
        refresh: 0,
        query: "encoded",
        orgIdentifier: "my-org",
      });

      const callArg = mockRouterPush.mock.calls[0][0];
      expect(callArg.query.stream).toBe("my-stream");
      expect(callArg.query.org_identifier).toBe("my-org");
      expect(callArg.query.query).toBe("encoded");
    });
  });

  // -------------------------------------------------------------------------
  // copyTracesUrl
  // -------------------------------------------------------------------------
  describe("copyTracesUrl", () => {
    it("calls copyToClipboard with a URL string", async () => {
      const { searchObj, copyTracesUrl, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: 0,
        endTime: 0,
      };

      await copyTracesUrl();

      expect(mockCopyToClipboard).toHaveBeenCalledWith(
        expect.stringContaining("http"),
      );
    });

    it("shows positive notification after successful copy", async () => {
      mockCopyToClipboard.mockResolvedValue(undefined);
      const { searchObj, copyTracesUrl, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: 0,
        endTime: 0,
      };

      await copyTracesUrl();
      // Give microtasks a chance to run
      await nextTick();

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "positive" }),
      );
    });

    it("shows negative notification on copy failure", async () => {
      mockCopyToClipboard.mockRejectedValue(new Error("denied"));
      const { searchObj, copyTracesUrl, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: 0,
        endTime: 0,
      };

      await copyTracesUrl();
      await nextTick();

      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({ type: "negative" }),
      );
    });

    it("overrides from/to with customTimeRange when provided", () => {
      const { searchObj, copyTracesUrl, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.data.datetime = {
        type: "relative",
        relativeTimePeriod: "15m",
        startTime: 0,
        endTime: 0,
      };

      copyTracesUrl({ from: "1000", to: "9999" });

      const clipboardArg = mockCopyToClipboard.mock.calls[0][0];
      expect(clipboardArg).toContain("from=1000");
      expect(clipboardArg).toContain("to=9999");
    });
  });

  // -------------------------------------------------------------------------
  // tracesShareURL computed
  // -------------------------------------------------------------------------
  describe("tracesShareURL", () => {
    it("returns a string starting with http", () => {
      const { tracesShareURL, resetSearchObj } = useTraces();
      resetSearchObj();
      expect(tracesShareURL.value).toMatch(/^https?:\/\//);
    });
  });

  // -------------------------------------------------------------------------
  // formatTracesMetaData
  // -------------------------------------------------------------------------
  describe("formatTracesMetaData", () => {
    it("returns empty array for empty input", () => {
      const { formatTracesMetaData } = useTraces();
      expect(formatTracesMetaData([])).toEqual([]);
    });

    it("returns same number of items as input", () => {
      const { formatTracesMetaData, searchObj } = useTraces();
      const traces = [
        {
          trace_id: "t1",
          start_time: 1_000_000,
          end_time: 2_000_000,
          duration: 1000,
          service_name: ["frontend"],
          spans: [5, 1],
          first_event: { service_name: "frontend", operation_name: "GET" },
        },
        {
          trace_id: "t2",
          start_time: 3_000_000,
          end_time: 4_000_000,
          duration: 500,
          service_name: ["backend"],
          spans: [3, 0],
          first_event: { service_name: "backend", operation_name: "POST" },
        },
      ];

      const result = formatTracesMetaData(traces);
      expect(result.length).toBe(2);
    });

    it("maps trace_id, spans, errors correctly", () => {
      const { formatTracesMetaData } = useTraces();
      const traces = [
        {
          trace_id: "trace-1",
          start_time: 1_000_000,
          end_time: 2_000_000,
          duration: 1000,
          service_name: [],
          spans: [7, 2],
          first_event: { service_name: "svc", operation_name: "op" },
        },
      ];

      const [item] = formatTracesMetaData(traces);
      expect(item.trace_id).toBe("trace-1");
      expect(item.spans).toBe(7);
      expect(item.errors).toBe(2);
    });

    it("assigns service colors and populates services map", () => {
      const { formatTracesMetaData, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();

      const traces = [
        {
          trace_id: "t1",
          start_time: 1_000_000,
          end_time: 2_000_000,
          duration: 500,
          service_name: ["frontend"],
          spans: [1, 0],
          first_event: { service_name: "frontend", operation_name: "GET" },
        },
      ];

      const [item] = formatTracesMetaData(traces);
      expect(searchObj.meta.serviceColors["frontend"]).toBeDefined();
      expect(item.services["frontend"]).toBeDefined();
    });

    it("handles service_name as array of objects with count and duration", () => {
      const { formatTracesMetaData } = useTraces();
      const traces = [
        {
          trace_id: "t1",
          start_time: 1_000_000,
          end_time: 2_000_000,
          duration: 500,
          service_name: [{ service_name: "svc-a", count: 3, duration: 100 }],
          spans: [3, 0],
          first_event: { service_name: "svc-a", operation_name: "GET" },
        },
      ];

      const [item] = formatTracesMetaData(traces);
      expect(item.services["svc-a"]).toMatchObject({ count: 3, duration: 100 });
    });

    it("does not assign duplicate colors to same service", () => {
      const { formatTracesMetaData, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();

      const traces = [
        {
          trace_id: "t1",
          start_time: 1_000_000,
          end_time: 2_000_000,
          duration: 500,
          service_name: ["shared-service"],
          spans: [1, 0],
          first_event: {
            service_name: "shared-service",
            operation_name: "GET",
          },
        },
        {
          trace_id: "t2",
          start_time: 3_000_000,
          end_time: 4_000_000,
          duration: 500,
          service_name: ["shared-service"],
          spans: [1, 0],
          first_event: {
            service_name: "shared-service",
            operation_name: "POST",
          },
        },
      ];

      formatTracesMetaData(traces);
      // Color should be assigned once and reused
      const colorKeys = Object.keys(searchObj.meta.serviceColors);
      const uniqueKeys = [...new Set(colorKeys)];
      expect(colorKeys.length).toBe(uniqueKeys.length);
    });

    it("maps LLM usage fields correctly", () => {
      const { formatTracesMetaData } = useTraces();
      const traces = [
        {
          trace_id: "t1",
          start_time: 1_000_000,
          end_time: 2_000_000,
          duration: 500,
          service_name: [],
          spans: [1, 0],
          first_event: {},
          gen_ai_usage_input_tokens: 100,
          gen_ai_usage_output_tokens: 200,
          gen_ai_usage_total_tokens: 300,
          gen_ai_usage_cost: 0.05,
        },
      ];

      const [item] = formatTracesMetaData(traces);
      expect(item.gen_ai_usage_input_tokens).toBe(100);
      expect(item.gen_ai_usage_output_tokens).toBe(200);
      expect(item.gen_ai_usage_total_tokens).toBe(300);
      expect(item.gen_ai_usage_cost).toBe(0.05);
    });
  });

  // -------------------------------------------------------------------------
  // DEFAULT_TRACE_COLUMNS — named export
  // -------------------------------------------------------------------------
  describe("DEFAULT_TRACE_COLUMNS", () => {
    it("has exactly the keys 'traces' and 'spans'", () => {
      expect(Object.keys(DEFAULT_TRACE_COLUMNS).sort()).toEqual(
        ["spans", "traces"].sort(),
      );
    });

    it("traces columns is a non-empty array of strings", () => {
      expect(Array.isArray(DEFAULT_TRACE_COLUMNS.traces)).toBe(true);
      expect(DEFAULT_TRACE_COLUMNS.traces.length).toBeGreaterThan(0);
      DEFAULT_TRACE_COLUMNS.traces.forEach((col) =>
        expect(typeof col).toBe("string"),
      );
    });

    it("spans columns is a non-empty array of strings", () => {
      expect(Array.isArray(DEFAULT_TRACE_COLUMNS.spans)).toBe(true);
      expect(DEFAULT_TRACE_COLUMNS.spans.length).toBeGreaterThan(0);
      DEFAULT_TRACE_COLUMNS.spans.forEach((col) =>
        expect(typeof col).toBe("string"),
      );
    });

    it("traces columns contains the expected fields", () => {
      expect(DEFAULT_TRACE_COLUMNS.traces).toEqual([
        "service_name",
        "operation_name",
        "duration",
        "spans",
        "status",
        "service_latency",
      ]);
    });

    it("spans columns contains the expected fields", () => {
      expect(DEFAULT_TRACE_COLUMNS.spans).toEqual([
        "service_name",
        "operation_name",
        "duration",
        "span_status",
      ]);
    });

    it("spans columns uses span_status not status", () => {
      expect(DEFAULT_TRACE_COLUMNS.spans).toContain("span_status");
      expect(DEFAULT_TRACE_COLUMNS.spans).not.toContain("status");
    });
  });

  // -------------------------------------------------------------------------
  // updatedLocalLogFilterField — persists selected fields under nested key
  // -------------------------------------------------------------------------
  describe("updatedLocalLogFilterField", () => {
    it("should store selectedFields under all[key][searchMode] for traces mode", () => {
      const { searchObj, updatedLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org1";
      searchObj.data.stream.selectedStream = { label: "s", value: "my-stream" };
      searchObj.data.stream.selectedFields = ["service_name", "duration"];

      updatedLocalLogFilterField("traces");

      const saved = localTraceFilterStore.value["org1_my-stream"];
      expect(saved).toBeDefined();
      expect(saved.traces).toEqual(["service_name", "duration"]);
    });

    it("should store selectedFields under all[key][searchMode] for spans mode", () => {
      const { searchObj, updatedLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org1";
      searchObj.data.stream.selectedStream = { label: "s", value: "my-stream" };
      searchObj.data.stream.selectedFields = ["operation_name", "status"];

      updatedLocalLogFilterField("spans");

      const saved = localTraceFilterStore.value["org1_my-stream"];
      expect(saved).toBeDefined();
      expect(saved.spans).toEqual(["operation_name", "status"]);
    });

    it("should default searchMode to traces when no argument is provided", () => {
      const { searchObj, updatedLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "orgX";
      searchObj.data.stream.selectedStream = {
        label: "stream",
        value: "stream-val",
      };
      searchObj.data.stream.selectedFields = ["duration"];

      updatedLocalLogFilterField();

      const saved = localTraceFilterStore.value["orgX_stream-val"];
      expect(saved.traces).toEqual(["duration"]);
    });

    it("should preserve existing sibling mode data when updating one mode", () => {
      const { searchObj, updatedLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org2";
      searchObj.data.stream.selectedStream = { label: "s", value: "stream2" };

      // Write spans first
      searchObj.data.stream.selectedFields = ["method"];
      updatedLocalLogFilterField("spans");

      // Then write traces — spans entry must survive
      searchObj.data.stream.selectedFields = ["service_name", "status"];
      updatedLocalLogFilterField("traces");

      const saved = localTraceFilterStore.value["org2_stream2"];
      expect(saved.spans).toEqual(["method"]);
      expect(saved.traces).toEqual(["service_name", "status"]);
    });

    it("should use 'default' as org identifier when organizationIdentifier is empty", () => {
      const { searchObj, updatedLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "stream-val",
      };
      searchObj.data.stream.selectedFields = ["duration"];

      updatedLocalLogFilterField("traces");

      expect(localTraceFilterStore.value["default_stream-val"]).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // loadLocalLogFilterField — restores selectedFields or falls back to defaults
  // -------------------------------------------------------------------------
  describe("loadLocalLogFilterField", () => {
    it("should load saved traces fields from localStorage when they exist", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org1";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "my-stream",
      };

      // Pre-populate the store
      localTraceFilterStore.value["org1_my-stream"] = {
        traces: ["service_name", "spans"],
      };

      loadLocalLogFilterField("traces");

      expect(searchObj.data.stream.selectedFields).toEqual([
        "service_name",
        "spans",
      ]);
    });

    it("should load saved spans fields from localStorage when they exist", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org1";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "my-stream",
      };

      localTraceFilterStore.value["org1_my-stream"] = {
        spans: ["operation_name", "method"],
      };

      loadLocalLogFilterField("spans");

      expect(searchObj.data.stream.selectedFields).toEqual([
        "operation_name",
        "method",
      ]);
    });

    it("should fall back to DEFAULT_TRACE_COLUMNS.traces when no saved data exists", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org-new";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "unknown-stream",
      };

      // Store is empty — no entry for this key
      loadLocalLogFilterField("traces");

      expect(searchObj.data.stream.selectedFields).toEqual([
        ...DEFAULT_TRACE_COLUMNS.traces,
      ]);
    });

    it("should fall back to DEFAULT_TRACE_COLUMNS.spans when no saved data exists for spans mode", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org-new";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "unknown-stream",
      };

      loadLocalLogFilterField("spans");

      expect(searchObj.data.stream.selectedFields).toEqual([
        ...DEFAULT_TRACE_COLUMNS.spans,
      ]);
    });

    it("should fall back to defaults when the saved entry exists but the mode array is empty", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org1";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "my-stream",
      };

      // Key exists but mode array is empty
      localTraceFilterStore.value["org1_my-stream"] = { traces: [] };

      loadLocalLogFilterField("traces");

      expect(searchObj.data.stream.selectedFields).toEqual([
        ...DEFAULT_TRACE_COLUMNS.traces,
      ]);
    });

    it("should default to traces mode when no argument is provided", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org1";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "my-stream",
      };

      localTraceFilterStore.value["org1_my-stream"] = {
        traces: ["service_name"],
      };

      loadLocalLogFilterField();

      expect(searchObj.data.stream.selectedFields).toEqual(["service_name"]);
    });

    it("should use 'default' as org identifier when organizationIdentifier is empty", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "stream-val",
      };

      localTraceFilterStore.value["default_stream-val"] = {
        traces: ["duration", "status"],
      };

      loadLocalLogFilterField("traces");

      expect(searchObj.data.stream.selectedFields).toEqual([
        "duration",
        "status",
      ]);
    });

    it("should return a copy of the defaults so mutations do not affect DEFAULT_TRACE_COLUMNS", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org-copy";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "copy-stream",
      };

      loadLocalLogFilterField("traces");

      // Mutate the loaded value
      searchObj.data.stream.selectedFields.push("extra_field");

      // The original constant must be unchanged
      expect(DEFAULT_TRACE_COLUMNS.traces).not.toContain("extra_field");
    });

    it("should migrate old 'status' field to 'span_status' in spans mode", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org-migrate";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "migrate-stream",
      };

      // Simulate a saved preference that still has the old "status" field
      localTraceFilterStore.value["org-migrate_migrate-stream"] = {
        spans: ["operation_name", "status", "status_code"],
      };

      loadLocalLogFilterField("spans");

      expect(searchObj.data.stream.selectedFields).toEqual([
        "operation_name",
        "span_status",
        "status_code",
      ]);
    });

    it("should NOT migrate 'status' to 'span_status' in traces mode", () => {
      const { searchObj, loadLocalLogFilterField, resetSearchObj } =
        useTraces();
      resetSearchObj();
      searchObj.organizationIdentifier = "org-no-migrate";
      searchObj.data.stream.selectedStream = {
        label: "s",
        value: "no-migrate-stream",
      };

      localTraceFilterStore.value["org-no-migrate_no-migrate-stream"] = {
        traces: ["service_name", "status", "spans"],
      };

      loadLocalLogFilterField("traces");

      // "status" is a valid traces column — must remain unchanged
      expect(searchObj.data.stream.selectedFields).toContain("status");
      expect(searchObj.data.stream.selectedFields).not.toContain("span_status");
    });
  });

  // -------------------------------------------------------------------------
  // setServiceColors
  // -------------------------------------------------------------------------
  describe("setServiceColors", () => {
    it("empty array → no colors assigned", () => {
      // [auto-generated]
      const { setServiceColors, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = {};

      setServiceColors([]);

      expect(Object.keys(searchObj.meta.serviceColors)).toHaveLength(0);
    });

    it("spans mode: string service_name → assigns color", () => {
      // [auto-generated]
      const { setServiceColors, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = {};

      setServiceColors([{ service_name: "frontend" }]);

      expect(searchObj.meta.serviceColors["frontend"]).toBeDefined();
    });

    it("spans mode: hit with no service_name → no crash, no color assigned", () => {
      // [auto-generated]
      const { setServiceColors, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = {};

      expect(() => setServiceColors([{ operation_name: "GET" }])).not.toThrow();
      expect(Object.keys(searchObj.meta.serviceColors)).toHaveLength(0);
    });

    it("traces mode: array service_name (strings) → assigns colors", () => {
      // [auto-generated]
      const { setServiceColors, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = {};

      setServiceColors([{ service_name: ["svc-a", "svc-b"] }]);

      expect(searchObj.meta.serviceColors["svc-a"]).toBeDefined();
      expect(searchObj.meta.serviceColors["svc-b"]).toBeDefined();
    });

    it("traces mode: array service_name (objects with service_name property) → assigns colors", () => {
      // [auto-generated]
      const { setServiceColors, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = {};

      setServiceColors([
        {
          service_name: [
            { service_name: "obj-svc-a", count: 2, duration: 100 },
            { service_name: "obj-svc-b", count: 1, duration: 50 },
          ],
        },
      ]);

      expect(searchObj.meta.serviceColors["obj-svc-a"]).toBeDefined();
      expect(searchObj.meta.serviceColors["obj-svc-b"]).toBeDefined();
    });

    it("mixed: already-colored service not reassigned; new service gets next color index", () => {
      // [auto-generated]
      const { setServiceColors, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = { "existing-svc": "#color-0" };

      setServiceColors([
        { service_name: "existing-svc" },
        { service_name: "new-svc" },
      ]);

      // Existing color must remain unchanged
      expect(searchObj.meta.serviceColors["existing-svc"]).toBe("#color-0");
      // New service should be assigned the next color
      expect(searchObj.meta.serviceColors["new-svc"]).toBeDefined();
    });

    it("color index starts from existing serviceColors count (not 0)", () => {
      // [auto-generated]
      const { setServiceColors, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      // Pre-populate 2 colors so colorIndex starts at 2
      searchObj.meta.serviceColors = {
        "svc-1": "#color-0",
        "svc-2": "#color-1",
      };

      setServiceColors([{ service_name: "svc-3" }]);

      // getSpanColorHex is mocked as (index) => `#color-${index}`
      // colorIndex = Object.keys(serviceColors).length = 2 before insertion
      expect(searchObj.meta.serviceColors["svc-3"]).toBe("#color-2");
    });
  });

  // -------------------------------------------------------------------------
  // getOrSetServiceColor
  // -------------------------------------------------------------------------
  describe("getOrSetServiceColor", () => {
    it("should return existing color when service already has one", () => {
      const { getOrSetServiceColor, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = { "my-service": "#ff0000" };

      const color = getOrSetServiceColor("my-service");

      expect(color).toBe("#ff0000");
      // Verify the existing color was not overwritten
      expect(searchObj.meta.serviceColors["my-service"]).toBe("#ff0000");
      // Verify no new keys were added
      expect(Object.keys(searchObj.meta.serviceColors)).toHaveLength(1);
    });

    it("should create and return a new color when service is unknown", () => {
      const { getOrSetServiceColor, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = {};

      // Override the mock to return a specific hex for this test
      vi.mocked(getSpanColorHex).mockReturnValueOnce("#abcdef");

      const color = getOrSetServiceColor("new-service");

      expect(color).toBe("#abcdef");
      expect(searchObj.meta.serviceColors["new-service"]).toBe("#abcdef");
      // Should have been called with index 0 since serviceColors was empty
      expect(getSpanColorHex).toHaveBeenCalledWith(0);
    });

    it("should return undefined for empty string input", () => {
      const { getOrSetServiceColor, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = {};

      const color = getOrSetServiceColor("");

      expect(color).toBeUndefined();
      // Should not have added any color for empty string
      expect(Object.keys(searchObj.meta.serviceColors)).toHaveLength(0);
    });

    it("should initialize and assign a color when serviceColors starts empty", () => {
      const { getOrSetServiceColor, searchObj, resetSearchObj } = useTraces();
      resetSearchObj();
      searchObj.meta.serviceColors = {};

      const color = getOrSetServiceColor("valid-service");

      expect(color).toBe("#color-0");
      expect(searchObj.meta.serviceColors["valid-service"]).toBe("#color-0");
    });
  });

  // -------------------------------------------------------------------------
  // serviceGraph state initialization — localStorage-backed fields
  //
  // These fields are read at module evaluation time (module-level singleton),
  // so each test must reset modules and dynamically import a fresh copy of
  // useTraces to observe different localStorage values.
  // -------------------------------------------------------------------------
  describe("serviceGraph state initialization", () => {
    afterEach(() => {
      localStorage.clear();
      vi.resetModules();
    });

    it("should default serviceGraphVisualizationType to 'tree' when localStorage is empty", async () => {
      localStorage.clear();
      vi.resetModules();

      const { default: freshUseTraces } = await import("./useTraces");
      const { searchObj } = freshUseTraces();

      expect(searchObj.meta.serviceGraphVisualizationType).toBe("tree");
    });

    it("should read serviceGraphVisualizationType from localStorage when set", async () => {
      localStorage.setItem("serviceGraph_visualizationType", "graph");
      vi.resetModules();

      const { default: freshUseTraces } = await import("./useTraces");
      const { searchObj } = freshUseTraces();

      expect(searchObj.meta.serviceGraphVisualizationType).toBe("graph");
    });

    it("should default serviceGraphLayoutType to 'horizontal' when localStorage is empty", async () => {
      localStorage.clear();
      vi.resetModules();

      const { default: freshUseTraces } = await import("./useTraces");
      const { searchObj } = freshUseTraces();

      expect(searchObj.meta.serviceGraphLayoutType).toBe("horizontal");
    });

    it("should read serviceGraphLayoutType from localStorage when set", async () => {
      localStorage.setItem("serviceGraph_layoutType", "vertical");
      vi.resetModules();

      const { default: freshUseTraces } = await import("./useTraces");
      const { searchObj } = freshUseTraces();

      expect(searchObj.meta.serviceGraphLayoutType).toBe("vertical");
    });
  });
});
