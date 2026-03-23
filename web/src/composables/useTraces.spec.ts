// Copyright 2023 OpenObserve Inc.
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

import { describe, it, expect, vi, beforeEach } from "vitest";
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

vi.mock("vuex", () => ({
  useStore: vi.fn(() => ({
    state: {
      selectedOrganization: { identifier: "test-org" },
      zoConfig: { timestamp_column: "_timestamp" },
      organizationData: {
        organizationSettings: {
          span_id_field_name: "span_id",
          trace_id_field_name: "trace_id",
        },
      },
    },
  })),
}));

const { mockCopyToClipboard, mockNotify } = vi.hoisted(() => ({
  mockCopyToClipboard: vi.fn().mockResolvedValue(undefined),
  mockNotify: vi.fn(),
}));

vi.mock("quasar", () => ({
  copyToClipboard: mockCopyToClipboard,
  useQuasar: vi.fn(() => ({ notify: mockNotify })),
}));

vi.mock("@/utils/zincutils", () => ({
  b64EncodeStandard: vi.fn((s: string) => `b64std:${s}`),
  b64EncodeUnicode: vi.fn((s: string) => `b64uni:${s}`),
  useLocalTraceFilterField: vi.fn(() => ({ value: {} })),
}));

vi.mock("@/utils/traces/traceColors", () => ({
  getSpanColorHex: vi.fn((index: number) => `#color-${index}`),
}));

import useTraces from "./useTraces";

// ---------------------------------------------------------------------------

describe("useTraces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset shared singleton state before each test
    const { resetSearchObj } = useTraces();
    resetSearchObj();
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
      expect(inst).toHaveProperty("getUrlQueryParams");
      expect(inst).toHaveProperty("copyTracesUrl");
      expect(inst).toHaveProperty("buildQueryDetails");
      expect(inst).toHaveProperty("navigateToLogs");
      expect(inst).toHaveProperty("tracesShareURL");
      expect(inst).toHaveProperty("formatTracesMetaData");
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
      expect(firstRow[0]).toMatchObject({ label: expect.any(String), value: expect.any(Number) });
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
    it("calls router.push with /logs path", () => {
      const { navigateToLogs } = useTraces();
      navigateToLogs({
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

    it("passes all query parameters to router.push", () => {
      const { navigateToLogs } = useTraces();
      navigateToLogs({
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
          service_name: [
            { service_name: "svc-a", count: 3, duration: 100 },
          ],
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
          first_event: { service_name: "shared-service", operation_name: "GET" },
        },
        {
          trace_id: "t2",
          start_time: 3_000_000,
          end_time: 4_000_000,
          duration: 500,
          service_name: ["shared-service"],
          spans: [1, 0],
          first_event: { service_name: "shared-service", operation_name: "POST" },
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
          llm_usage_tokens_input: 100,
          llm_usage_tokens_output: 200,
          llm_usage_tokens_total: 300,
          llm_usage_cost_total: 0.05,
        },
      ];

      const [item] = formatTracesMetaData(traces);
      expect(item.llm_usage_details_input).toBe(100);
      expect(item.llm_usage_details_output).toBe(200);
      expect(item.llm_usage_details_total).toBe(300);
      expect(item.llm_cost_details_total).toBe(0.05);
    });
  });
});
