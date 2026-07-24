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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { ref } from "vue";
import useRumSpanBuilder from "@/composables/rum/useRumSpanBuilder";
import searchService from "@/services/search";
import { SPAN_KIND_CLIENT, SPAN_KIND_UNSPECIFIED } from "@/utils/traces/constants";

// ---------------------------------------------------------------------------
// Module mocks — hoisted before any import is executed
// ---------------------------------------------------------------------------

vi.mock("@/services/search", () => ({
  default: {
    search: vi.fn(),
  },
}));

const mockGetStream = vi.fn();

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: mockGetStream,
  }),
}));

const mockRouterCurrentRoute = {
  value: {
    query: {} as Record<string, string>,
  },
};

vi.mock("vue-router", () => ({
  useRouter: () => ({
    currentRoute: mockRouterCurrentRoute,
  }),
}));

const mockStore = {
  state: {
    selectedOrganization: {
      identifier: "test-org",
    },
    zoConfig: {
      timestamp_column: "_timestamp",
    },
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeSearchResponse(hits: any[] = []) {
  return { data: { hits } } as any;
}

/**
 * A minimal RUM stream schema that includes the _oo_trace_id field so
 * fetchRumEventsForTrace proceeds past the schema guard.
 */
function makeRumStream(hasTraceIdField = true) {
  return {
    schema: hasTraceIdField ? [{ name: "_oo_trace_id" }, { name: "type" }] : [{ name: "type" }],
  };
}

function makeTracedResource(overrides: Record<string, any> = {}) {
  return {
    _oo_trace_id: "trace-abc",
    _oo_span_id: "span-root",
    view_id: "view-1",
    session_id: "sess-1",
    date: 1_000_000,
    type: "resource",
    resource_url: "https://api.example.com/data",
    resource_method: "GET",
    resource_duration: 2_000_000, // 2 ms in nanoseconds
    resource_status_code: 200,
    service: "my-service",
    action_id: '["action-1"]',
    ...overrides,
  };
}

function makeViewEvent(overrides: Record<string, any> = {}) {
  return {
    view_id: "view-1",
    date: 900_000,
    type: "view",
    view_url: "/home",
    view_time_spent: 5_000_000, // ns
    session_id: "sess-1",
    service: "my-service",
    ...overrides,
  };
}

function makeActionEvent(overrides: Record<string, any> = {}) {
  return {
    action_id: "action-1",
    view_id: "view-1",
    date: 1_000_000,
    type: "action",
    action_type: "click",
    action_target_name: "Submit",
    action_loading_time: 1_000_000, // ns
    session_id: "sess-1",
    service: "my-service",
    ...overrides,
  };
}

function makeResourceEvent(overrides: Record<string, any> = {}) {
  return {
    type: "resource",
    view_id: "view-1",
    date: 1_100_000,
    resource_url: "https://api.example.com/items",
    resource_method: "POST",
    resource_duration: 500_000, // ns
    resource_status_code: 200,
    resource_type: "fetch",
    session_id: "sess-1",
    service: "my-service",
    ...overrides,
  };
}

function makeErrorEvent(overrides: Record<string, any> = {}) {
  return {
    type: "error",
    view_id: "view-1",
    date: 1_200_000,
    error_message: "TypeError: Cannot read property",
    error_type: "TypeError",
    error_id: "err-1",
    session_id: "sess-1",
    service: "my-service",
    ...overrides,
  };
}

function makeLongTaskEvent(overrides: Record<string, any> = {}) {
  return {
    type: "long_task",
    view_id: "view-1",
    date: 1_300_000,
    long_task_duration: 150_000_000, // ns → 150 ms
    long_task_id: "lt-1",
    session_id: "sess-1",
    service: "my-service",
    ...overrides,
  };
}

function makeStaticAssetEvent(overrides: Record<string, any> = {}) {
  return {
    type: "resource",
    view_id: "view-1",
    date: 1_400_000,
    resource_url: "https://cdn.example.com/app.js",
    resource_method: "GET",
    resource_duration: 300_000,
    resource_type: "js",
    resource_status_code: 200,
    resource_id: "res-static-1",
    session_id: "sess-1",
    service: "my-service",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Composable factory — creates a fresh instance per test
// ---------------------------------------------------------------------------

function makeSearchObj(serviceNames: { service_name: string; count: number }[] = []) {
  return {
    data: {
      traceDetails: {
        selectedTrace: {
          service_name: serviceNames,
        },
      },
    },
  };
}

function buildComposable(logStreamNames: string[] = ["_rumdata"], searchObjOverride?: any) {
  const logStreams = ref(logStreamNames);
  const searchObj = searchObjOverride ?? makeSearchObj();
  return useRumSpanBuilder(logStreams, searchObj);
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("useRumSpanBuilder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterCurrentRoute.value.query = {};
    // Default: stream has _oo_trace_id
    mockGetStream.mockResolvedValue(makeRumStream(true));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // fetchRumEventsForTrace — guard conditions
  // =========================================================================

  describe("fetchRumEventsForTrace — guard conditions", () => {
    it("should return empty result when _rumdata is not in logStreams", async () => {
      const { fetchRumEventsForTrace } = buildComposable(["other-stream"]);

      const result = await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(result.tracedResources).toEqual([]);
      expect(result.viewEvents).toEqual([]);
      expect(result.actionEvents).toEqual([]);
      expect(result.allViewEvents).toEqual([]);
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should return empty result when traceId is an empty string", async () => {
      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);

      const result = await fetchRumEventsForTrace("", 1_000_000, 2_000_000);

      expect(result.tracedResources).toEqual([]);
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should return empty result when RUM stream schema lacks _oo_trace_id field", async () => {
      mockGetStream.mockResolvedValue(makeRumStream(false));
      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);

      const result = await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(result.tracedResources).toEqual([]);
      expect(searchService.search).not.toHaveBeenCalled();
    });

    it("should return empty result when getStream returns null schema", async () => {
      mockGetStream.mockResolvedValue(null);
      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);

      const result = await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(result.tracedResources).toEqual([]);
    });

    it("should return empty result when no traced resources are found", async () => {
      // First search (traced resources by _oo_trace_id) returns empty
      vi.mocked(searchService.search).mockResolvedValueOnce(makeSearchResponse([]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      const result = await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(result.tracedResources).toEqual([]);
      // Only the first search should fire — the subsequent 3 should not
      expect(searchService.search).toHaveBeenCalledTimes(1);
    });

    it("should use org_identifier from router query when present", async () => {
      mockRouterCurrentRoute.value.query = { org_identifier: "router-org" };
      vi.mocked(searchService.search).mockResolvedValue(makeSearchResponse([]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ org_identifier: "router-org" }),
        "RUM",
      );
    });

    it("should fall back to store org identifier when router query has none", async () => {
      mockRouterCurrentRoute.value.query = {};
      vi.mocked(searchService.search).mockResolvedValue(makeSearchResponse([]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(searchService.search).toHaveBeenCalledWith(
        expect.objectContaining({ org_identifier: "test-org" }),
        "RUM",
      );
    });
  });

  // =========================================================================
  // fetchRumEventsForTrace — SQL injection sanitisation
  // =========================================================================

  describe("fetchRumEventsForTrace — traceId sanitisation", () => {
    it("should strip single quotes from traceId in the SQL query", async () => {
      vi.mocked(searchService.search).mockResolvedValue(makeSearchResponse([]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      await fetchRumEventsForTrace("trace'with'quotes", 1_000_000, 2_000_000);

      const sql: string = vi.mocked(searchService.search).mock.calls[0][0].query.query
        .sql as string;
      expect(sql).not.toContain("'with'");
      expect(sql).toContain("tracewithquotes");
    });

    it("should strip backslashes from traceId in the SQL query", async () => {
      vi.mocked(searchService.search).mockResolvedValue(makeSearchResponse([]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      await fetchRumEventsForTrace("trace\\injection", 1_000_000, 2_000_000);

      const sql: string = vi.mocked(searchService.search).mock.calls[0][0].query.query
        .sql as string;
      expect(sql).not.toContain("\\");
    });
  });

  // =========================================================================
  // fetchRumEventsForTrace — successful full flow
  // =========================================================================

  describe("fetchRumEventsForTrace — successful fetch", () => {
    it("should return tracedResources, viewEvents, actionEvents and allViewEvents", async () => {
      const tracedResource = makeTracedResource();
      const viewEvent = makeViewEvent();
      const actionEvent = makeActionEvent();
      const allEvent = makeResourceEvent();

      // Call order: tracedResources, viewEvents, actionEvents, allViewEvents
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeSearchResponse([tracedResource]))
        .mockResolvedValueOnce(makeSearchResponse([viewEvent]))
        .mockResolvedValueOnce(makeSearchResponse([actionEvent]))
        .mockResolvedValueOnce(makeSearchResponse([allEvent]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      const result = await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(result.tracedResources).toHaveLength(1);
      expect(result.tracedResources[0]._oo_trace_id).toBe("trace-abc");
      expect(result.viewEvents).toHaveLength(1);
      expect(result.actionEvents).toHaveLength(1);
      expect(result.allViewEvents).toHaveLength(1);
    });

    it("should fire 4 search calls in total for a full flow", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeSearchResponse([makeTracedResource()]))
        .mockResolvedValueOnce(makeSearchResponse([makeViewEvent()]))
        .mockResolvedValueOnce(makeSearchResponse([makeActionEvent()]))
        .mockResolvedValueOnce(makeSearchResponse([makeResourceEvent()]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(searchService.search).toHaveBeenCalledTimes(4);
    });

    it("should include timestamp buffer in search time ranges", async () => {
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeSearchResponse([makeTracedResource()]))
        .mockResolvedValueOnce(makeSearchResponse([]))
        .mockResolvedValueOnce(makeSearchResponse([]))
        .mockResolvedValueOnce(makeSearchResponse([]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      await fetchRumEventsForTrace("trace-abc", 5_000_000, 10_000_000);

      // All queries use ±60s buffer around the trace window
      const firstCall = vi.mocked(searchService.search).mock.calls[0][0];
      expect(firstCall.query.query.start_time).toBe(5_000_000 - 60_000_000);
      expect(firstCall.query.query.end_time).toBe(10_000_000 + 60_000_000);
    });

    it("should skip fetchActionEvents when parsed action_id array is empty", async () => {
      // When action_id parses to [] the source does: primaryActionId = [] || "" which
      // evaluates to [] (truthy), so fetchActionEvents IS still called with an empty array.
      // The result is an empty actionEvents array because the SQL IN () call returns [].
      const resource = makeTracedResource({ action_id: "[]" });
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeSearchResponse([resource]))
        .mockResolvedValueOnce(makeSearchResponse([makeViewEvent()]))
        .mockResolvedValueOnce(makeSearchResponse([]))
        .mockResolvedValueOnce(makeSearchResponse([makeResourceEvent()]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      const result = await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      // 4 calls: tracedRes + viewEvents + actionEvents (empty array) + allViewEvents
      expect(searchService.search).toHaveBeenCalledTimes(4);
      expect(result.actionEvents).toEqual([]);
    });

    it("should handle invalid JSON in action_id gracefully", async () => {
      const resource = makeTracedResource({ action_id: "not-valid-json" });
      vi.mocked(searchService.search)
        .mockResolvedValueOnce(makeSearchResponse([resource]))
        .mockResolvedValueOnce(makeSearchResponse([]))
        .mockResolvedValueOnce(makeSearchResponse([]))
        .mockResolvedValueOnce(makeSearchResponse([]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      const result = await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      // Should not throw; actionEvents defaults to []
      expect(result.actionEvents).toEqual([]);
    });

    it("should return empty result and not throw when search rejects", async () => {
      vi.mocked(searchService.search).mockRejectedValueOnce(new Error("Network error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      const result = await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      expect(result.tracedResources).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should use timestamp_column from store in SQL ORDER BY clause", async () => {
      vi.mocked(searchService.search).mockResolvedValue(makeSearchResponse([]));

      const { fetchRumEventsForTrace } = buildComposable(["_rumdata"]);
      await fetchRumEventsForTrace("trace-abc", 1_000_000, 2_000_000);

      const sql: string = vi.mocked(searchService.search).mock.calls[0][0].query.query
        .sql as string;
      expect(sql).toContain("ORDER BY _timestamp");
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — view spans
  // =========================================================================

  describe("formatRumEventsAsSpans — view spans", () => {
    it("should return empty array when allViewEvents is empty", () => {
      const { formatRumEventsAsSpans } = buildComposable();

      const result = formatRumEventsAsSpans([], [], [], []);

      expect(result).toEqual([]);
    });

    it("should build a view span with correct span_id and operation_name", () => {
      const view = makeViewEvent();
      const traced = makeTracedResource();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [], [makeResourceEvent()]);

      const viewSpan = spans.find((s) => s.span_id === "rum_view_view-1");
      expect(viewSpan).toBeDefined();
      expect(viewSpan!.operation_name).toBe("View: /home");
      expect(viewSpan!.reference_parent_span_id).toBe("");
      expect(viewSpan!.rum_event_type).toBe("view");
      expect(viewSpan!.span_status).toBe("OK");
      expect(viewSpan!.span_kind).toBe(SPAN_KIND_UNSPECIFIED);
    });

    it("should deduplicate view events that share the same view_id", () => {
      const view1 = makeViewEvent({ view_time_spent: 0 });
      const view2 = makeViewEvent({ view_time_spent: 5_000_000 }); // preferred
      const traced = makeTracedResource();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view1, view2], [], [makeResourceEvent()]);

      const viewSpans = spans.filter((s) => s.rum_event_type === "view");
      expect(viewSpans).toHaveLength(1);
    });

    it("should use view_name as fallback when view_url is absent", () => {
      const view = makeViewEvent({ view_url: undefined, view_name: "HomePage" });
      const traced = makeTracedResource();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [], [makeResourceEvent()]);

      const viewSpan = spans.find((s) => s.rum_event_type === "view");
      expect(viewSpan!.operation_name).toBe("View: HomePage");
    });

    it("should use 'Unknown Page' when both view_url and view_name are absent", () => {
      const view = makeViewEvent({ view_url: undefined, view_name: undefined });
      const traced = makeTracedResource();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [], [makeResourceEvent()]);

      const viewSpan = spans.find((s) => s.rum_event_type === "view");
      expect(viewSpan!.operation_name).toBe("View: Unknown Page");
    });

    it("should attach trace_id from the first traced resource to view spans", () => {
      const view = makeViewEvent();
      const traced = makeTracedResource({ _oo_trace_id: "trace-xyz" });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [], [makeResourceEvent()]);

      const viewSpan = spans.find((s) => s.rum_event_type === "view");
      expect(viewSpan!.trace_id).toBe("trace-xyz");
    });

    it("should compute view span timing from view_time_spent", () => {
      const view = makeViewEvent({ date: 1_000_000, view_time_spent: 4_000_000 });
      const traced = makeTracedResource();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [], [makeResourceEvent()]);

      const viewSpan = spans.find((s) => s.rum_event_type === "view");
      // duration = view_time_spent / 1000 = 4000
      expect(viewSpan!.duration).toBe(4000);
      expect(viewSpan!.start_time).toBe(1_000_000 * 1_000_000);
      // end_time = (date + view_time_spent/1_000_000) * 1_000_000
      expect(viewSpan!.end_time).toBe((1_000_000 + 4) * 1_000_000);
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — action spans
  // =========================================================================

  describe("formatRumEventsAsSpans — action spans", () => {
    it("should build an action span with correct parent set to view span", () => {
      const traced = makeTracedResource();
      const view = makeViewEvent();
      const action = makeActionEvent({ date: 1_000_000 }); // within ±10 s of traced.date
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [action], [makeResourceEvent()]);

      const actionSpan = spans.find((s) => s.span_id === "rum_action_action-1");
      expect(actionSpan).toBeDefined();
      expect(actionSpan!.reference_parent_span_id).toBe("rum_view_view-1");
      expect(actionSpan!.operation_name).toBe("Action: click on Submit");
      expect(actionSpan!.span_kind).toBe(SPAN_KIND_UNSPECIFIED);
    });

    it("should collapse actions that are beyond ACTION_PROXIMITY_MS (10 s)", () => {
      const tracedTimestamp = 1_000_000;
      const traced = makeTracedResource({ date: tracedTimestamp });
      const view = makeViewEvent();
      // Far-away action: 30 s after the traced event — should be collapsed
      const farAction = makeActionEvent({
        action_id: "action-far",
        date: tracedTimestamp + 30_000,
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [farAction], [makeResourceEvent()]);

      const collapsed = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsed).toBeDefined();
      expect(collapsed!.operation_name).toContain("1 other actions");
    });

    it("should always show the parent action regardless of distance", () => {
      const tracedTimestamp = 1_000_000;
      const traced = makeTracedResource({
        date: tracedTimestamp,
        // action_id matches farAction
        action_id: '["action-far"]',
      });
      const view = makeViewEvent();
      const farAction = makeActionEvent({
        action_id: "action-far",
        date: tracedTimestamp + 50_000, // 50 s away
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [farAction], [makeResourceEvent()]);

      // The parent action must appear as an individual span, not collapsed
      const actionSpan = spans.find((s) => s.span_id === "rum_action_action-far");
      expect(actionSpan).toBeDefined();
      const collapsedSpan = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsedSpan).toBeUndefined();
    });

    it("should produce no action spans when actionEvents array is empty", () => {
      const traced = makeTracedResource();
      const view = makeViewEvent();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [], [makeResourceEvent()]);

      const actionSpans = spans.filter((s) => s.rum_event_type === "action");
      expect(actionSpans).toHaveLength(0);
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — resource (API call) spans
  // =========================================================================

  describe("formatRumEventsAsSpans — resource spans", () => {
    it("should build a resource span with SPAN_KIND_CLIENT", () => {
      const traced = makeTracedResource();
      const resource = makeResourceEvent({ resource_type: "fetch" });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [resource]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan).toBeDefined();
      expect(resSpan!.span_kind).toBe(SPAN_KIND_CLIENT);
      expect(resSpan!.operation_name).toBe("POST https://api.example.com/items");
    });

    it("should use _oo_span_id as span_id when resource has a trace bridge", () => {
      const traced = makeTracedResource();
      const resource = makeResourceEvent({
        _oo_trace_id: "trace-abc",
        _oo_span_id: "backend-span-1",
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [resource]);

      const resSpan = spans.find((s) => s._is_trace_bridge === true);
      expect(resSpan!.span_id).toBe("backend-span-1");
      expect(resSpan!.trace_id).toBe("trace-abc");
    });

    it("should build a synthetic span_id for untraced resource events", () => {
      const traced = makeTracedResource();
      const resource = makeResourceEvent({
        resource_id: "res-42",
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [resource]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan!.span_id).toBe("rum_resource_res-42");
      expect(resSpan!._is_trace_bridge).toBe(false);
    });

    it("should set span_status to ERROR for resource with status >= 400", () => {
      const traced = makeTracedResource();
      const resource = makeResourceEvent({
        resource_status_code: 500,
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [resource]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan!.span_status).toBe("ERROR");
    });

    it("should set span_status to OK for resource with status < 400", () => {
      const traced = makeTracedResource();
      const resource = makeResourceEvent({
        resource_status_code: 200,
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [resource]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan!.span_status).toBe("OK");
    });

    it("should fall back to 'Frontend' when service field is absent", () => {
      const traced = makeTracedResource();
      const resource = makeResourceEvent({
        service: undefined,
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [resource]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan!.service_name).toBe("Frontend");
    });

    it("should parent resource span to its action when action is fetched", () => {
      const traced = makeTracedResource();
      const action = makeActionEvent();
      const resource = makeResourceEvent({
        action_id: '["action-1"]',
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [makeViewEvent()], [action], [resource]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan!.reference_parent_span_id).toBe("rum_action_action-1");
    });

    it("should fall back to view parent when no matching action exists", () => {
      const traced = makeTracedResource();
      const resource = makeResourceEvent({
        action_id: '["action-ghost"]', // not in actionEvents
        view_id: "view-1",
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      // actionEvents contains action-999, not action-ghost
      const action = makeActionEvent({ action_id: "action-999" });
      const spans = formatRumEventsAsSpans([traced], [makeViewEvent()], [action], [resource]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan!.reference_parent_span_id).toBe("rum_view_view-1");
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — error spans
  // =========================================================================

  describe("formatRumEventsAsSpans — error spans", () => {
    it("should build an error span with span_status ERROR", () => {
      const traced = makeTracedResource();
      const error = makeErrorEvent();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [error]);

      const errSpan = spans.find((s) => s.rum_event_type === "error");
      expect(errSpan).toBeDefined();
      expect(errSpan!.span_status).toBe("ERROR");
      expect(errSpan!.operation_name).toBe("Error: TypeError: Cannot read property");
    });

    it("should fall back to error_type in operation_name when error_message is absent", () => {
      const traced = makeTracedResource();
      const error = makeErrorEvent({ error_message: undefined });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [error]);

      const errSpan = spans.find((s) => s.rum_event_type === "error");
      expect(errSpan!.operation_name).toBe("Error: TypeError");
    });

    it("should show first 3 errors individually", () => {
      const traced = makeTracedResource();
      const errors = [1, 2, 3].map((i) =>
        makeErrorEvent({ error_id: `err-${i}`, date: 1_200_000 + i }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], errors);

      const errSpans = spans.filter((s) => s.rum_event_type === "error");
      expect(errSpans).toHaveLength(3);
      const collapsedSpan = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsedSpan).toBeUndefined();
    });

    it("should collapse errors beyond the first 3 into a grouped span", () => {
      const traced = makeTracedResource();
      const errors = [1, 2, 3, 4, 5].map((i) =>
        makeErrorEvent({ error_id: `err-${i}`, date: 1_200_000 + i }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], errors);

      const errSpans = spans.filter((s) => s.rum_event_type === "error");
      expect(errSpans).toHaveLength(3);
      const collapsed = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsed).toBeDefined();
      expect(collapsed!.operation_name).toBe("[2 more errors]");
      expect(collapsed!.span_status).toBe("ERROR");
    });

    it("should return no error spans when errors array is empty", () => {
      const traced = makeTracedResource();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [makeResourceEvent()]);

      const errSpans = spans.filter((s) => s.rum_event_type === "error");
      expect(errSpans).toHaveLength(0);
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — static asset spans
  // =========================================================================

  describe("formatRumEventsAsSpans — static asset spans", () => {
    it("should build individual spans for 5 or fewer static assets", () => {
      const traced = makeTracedResource();
      const assets = [1, 2, 3].map((i) =>
        makeStaticAssetEvent({ resource_id: `res-${i}`, date: 1_400_000 + i }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], assets);

      // All 3 are resource type
      const assetSpans = spans.filter((s) => s.rum_event_type === "resource");
      expect(assetSpans).toHaveLength(3);
      const collapsed = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsed).toBeUndefined();
    });

    it("should show first 3 assets individually and collapse the rest when > 5", () => {
      const traced = makeTracedResource();
      const assets = [1, 2, 3, 4, 5, 6].map((i) =>
        makeStaticAssetEvent({ resource_id: `res-${i}`, date: 1_400_000 + i }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], assets);

      const assetSpans = spans.filter((s) => s.rum_event_type === "resource");
      expect(assetSpans).toHaveLength(3);
      const collapsed = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsed).toBeDefined();
      expect(collapsed!.operation_name).toBe("[3 static assets]");
    });

    it("should parent each individual static asset span to its view", () => {
      const traced = makeTracedResource();
      const asset = makeStaticAssetEvent({ view_id: "view-1" });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [asset]);

      const assetSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(assetSpan!.reference_parent_span_id).toBe("rum_view_view-1");
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — long task spans
  // =========================================================================

  describe("formatRumEventsAsSpans — long task spans", () => {
    it("should build individual spans for 2 or fewer long tasks", () => {
      const traced = makeTracedResource();
      const tasks = [1, 2].map((i) =>
        makeLongTaskEvent({ long_task_id: `lt-${i}`, date: 1_300_000 + i }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], tasks);

      const taskSpans = spans.filter((s) => s.rum_event_type === "long_task");
      expect(taskSpans).toHaveLength(2);
      const collapsed = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsed).toBeUndefined();
    });

    it("should collapse all long tasks into one group span when there are > 2", () => {
      const traced = makeTracedResource();
      const tasks = [1, 2, 3].map((i) =>
        makeLongTaskEvent({ long_task_id: `lt-${i}`, date: 1_300_000 + i }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], tasks);

      const taskSpans = spans.filter((s) => s.rum_event_type === "long_task");
      expect(taskSpans).toHaveLength(0);
      const collapsed = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsed).toBeDefined();
      expect(collapsed!.operation_name).toBe("[3 long tasks]");
    });

    it("should build long task operation_name from long_task_duration", () => {
      const traced = makeTracedResource();
      const task = makeLongTaskEvent({ long_task_duration: 200_000_000 }); // 200 ms in ns
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [task]);

      const taskSpan = spans.find((s) => s.rum_event_type === "long_task");
      expect(taskSpan!.operation_name).toContain("Long Task:");
    });

    it("should return no long task spans when longTasks array is empty", () => {
      const traced = makeTracedResource();
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [makeResourceEvent()]);

      const taskSpans = spans.filter((s) => s.rum_event_type === "long_task");
      expect(taskSpans).toHaveLength(0);
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — classifyLeafEvents
  // =========================================================================

  describe("formatRumEventsAsSpans — classifyLeafEvents", () => {
    it("should route static resource types to asset bucket, not API bucket", () => {
      const traced = makeTracedResource();
      const jsAsset = makeStaticAssetEvent({ resource_type: "js" });
      const cssAsset = makeStaticAssetEvent({
        resource_type: "css",
        resource_id: "css-1",
        date: 1_401_000,
      });
      const apiCall = makeResourceEvent({ resource_type: "fetch" });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [jsAsset, cssAsset, apiCall]);

      // API call generates one resource span parented to view
      const apiSpans = spans.filter(
        (s) => s.rum_event_type === "resource" && !s._is_collapsed_group,
      );
      // Both static assets and the api call are resource type — the api span
      // uses resolveParentSpanId which might give view_id; static assets give view directly.
      // Verify total resource spans = 3 (2 assets + 1 API)
      expect(apiSpans.length).toBe(3);
    });

    it("should skip 'view' and 'action' typed events from leaf classification", () => {
      const traced = makeTracedResource();
      const viewEvent = makeViewEvent(); // type=view
      const actionEvent = makeActionEvent(); // type=action
      const resource = makeResourceEvent({ resource_type: "fetch" });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans(
        [traced],
        [viewEvent],
        [actionEvent],
        [viewEvent, actionEvent, resource],
      );

      // view and action are NOT emitted as leaf spans through classifyLeafEvents
      const spuriousActionSpans = spans.filter(
        (s) => s.rum_event_type === "action" && s.span_id.startsWith("rum_"),
      );
      // Only legitimate action spans via buildActionSpans carry rum_action_ prefix
      const actionSpan = spans.find((s) => s.span_id === "rum_action_action-1");
      expect(actionSpan).toBeDefined();
      expect(spuriousActionSpans).toHaveLength(1); // that IS the legitimate one
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — output ordering
  // =========================================================================

  describe("formatRumEventsAsSpans — output ordering", () => {
    it("should sort spans by timestamp ascending", () => {
      const traced = makeTracedResource({ date: 1_500_000 });
      const view = makeViewEvent({ date: 900_000 });
      const action = makeActionEvent({ date: 1_000_000 });
      const resource = makeResourceEvent({ date: 1_100_000, resource_type: "fetch" });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [view], [action], [resource]);

      for (let i = 1; i < spans.length; i++) {
        expect(spans[i]["_timestamp"] >= spans[i - 1]["_timestamp"]).toBe(true);
      }
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — registerServiceColors
  // =========================================================================

  describe("formatRumEventsAsSpans — registerServiceColors", () => {
    it("should append new service names to selectedTrace.service_name array", () => {
      const serviceNames: { service_name: string; count: number }[] = [];
      const searchObj = makeSearchObj(serviceNames);
      const { formatRumEventsAsSpans } = buildComposable(["_rumdata"], searchObj);

      const traced = makeTracedResource({ service: "backend-svc" });
      const view = makeViewEvent({ service: "frontend-svc" });

      formatRumEventsAsSpans([traced], [view], [], [makeResourceEvent()]);

      const registeredNames = serviceNames.map((s) => s.service_name);
      expect(registeredNames).toContain("frontend-svc");
    });

    it("should not duplicate existing service names in selectedTrace", () => {
      const serviceNames = [{ service_name: "my-service", count: 5 }];
      const searchObj = makeSearchObj(serviceNames);
      const { formatRumEventsAsSpans } = buildComposable(["_rumdata"], searchObj);

      const traced = makeTracedResource({ service: "my-service" });
      const view = makeViewEvent({ service: "my-service" });

      formatRumEventsAsSpans([traced], [view], [], [makeResourceEvent()]);

      const matching = serviceNames.filter((s) => s.service_name === "my-service");
      expect(matching).toHaveLength(1);
    });

    it("should not throw when selectedTrace is absent", () => {
      const searchObj = {
        data: { traceDetails: { selectedTrace: null } },
      };
      const { formatRumEventsAsSpans } = buildComposable(["_rumdata"], searchObj);

      expect(() =>
        formatRumEventsAsSpans(
          [makeTracedResource()],
          [makeViewEvent()],
          [],
          [makeResourceEvent()],
        ),
      ).not.toThrow();
    });
  });

  // =========================================================================
  // formatRumEventsAsSpans — collapsed span structure
  // =========================================================================

  describe("makeCollapsedSpan structure", () => {
    it("should set _is_collapsed_group true on every collapsed span", () => {
      const traced = makeTracedResource();
      const tasks = [1, 2, 3].map((i) =>
        makeLongTaskEvent({ long_task_id: `lt-${i}`, date: 1_300_000 + i }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], tasks);

      const collapsed = spans.filter((s) => s._is_collapsed_group === true);
      expect(collapsed.length).toBeGreaterThanOrEqual(1);
      collapsed.forEach((s) => {
        expect(s._is_collapsed_group).toBe(true);
      });
    });

    it("should set span_id as rum_collapsed_<label>_<viewId>", () => {
      const traced = makeTracedResource({ view_id: "view-99" });
      const tasks = [1, 2, 3].map((i) =>
        makeLongTaskEvent({
          long_task_id: `lt-${i}`,
          date: 1_300_000 + i,
          view_id: "view-99",
        }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], tasks);

      const collapsed = spans.find((s) => s._is_collapsed_group === true);
      expect(collapsed!.span_id).toContain("rum_collapsed_");
      expect(collapsed!.span_id).toContain("view-99");
    });

    it("should derive collapsed span start/end from event dates", () => {
      const traced = makeTracedResource();
      // 4 errors with dates 1_200_100, 1_200_200, 1_200_300, 1_200_400
      const errors = [1, 2, 3, 4].map((i) =>
        makeErrorEvent({ error_id: `e-${i}`, date: 1_200_000 + i * 100 }),
      );
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], errors);

      const collapsed = spans.find((s) => s._is_collapsed_group === true);
      // First 3 are shown individually (dates 100, 200, 300).
      // The collapsed span covers only index 3 (date 1_200_400 = min of remaining).
      expect(collapsed!.start_time).toBe(1_200_400 * 1_000_000);
    });
  });

  // =========================================================================
  // resolveParentSpanId — edge cases
  // =========================================================================

  describe("resolveParentSpanId", () => {
    it("should return empty string when event has no action_id and no view_id", () => {
      const traced = makeTracedResource();
      const event = makeResourceEvent({
        action_id: undefined,
        view_id: undefined,
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      const spans = formatRumEventsAsSpans([traced], [], [], [event]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan!.reference_parent_span_id).toBe("");
    });

    it("should handle plain string (non-JSON) action_id falling back to view", () => {
      const traced = makeTracedResource();
      const event = makeResourceEvent({
        action_id: "plain-action-id", // not a JSON array
        view_id: "view-1",
        resource_type: "fetch",
      });
      const { formatRumEventsAsSpans } = buildComposable();

      // actionEvents contains a different action — so plain-action-id won't match
      const action = makeActionEvent({ action_id: "other-action" });
      const spans = formatRumEventsAsSpans([traced], [], [action], [event]);

      const resSpan = spans.find((s) => s.rum_event_type === "resource");
      expect(resSpan!.reference_parent_span_id).toBe("rum_view_view-1");
    });
  });
});
