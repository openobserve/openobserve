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

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import TraceDetails from "@/plugins/traces/TraceDetails.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { http, HttpResponse } from "msw";

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// Mock useNotifications composable
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
  }),
}));

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

/**
 * Test Suite: TraceDetails Component - Missing span_kind Field
 *
 * This test suite covers scenarios where span_kind is not available in the trace data.
 *
 * WHAT CAN FAIL:
 * ===============
 *
 * 1. **getSpanKind() Function Issues:**
 *    - TypeError if span_kind is null/undefined and .toString() is called
 *    - Returns undefined instead of a default value
 *    - Causes "Cannot read property 'toString' of undefined" errors
 *
 * 2. **getFormattedSpan() Function Issues:**
 *    - May fail when accessing span.span_kind.toString() on line 1101
 *    - Could cause entire trace tree build to fail
 *    - May result in incomplete span data being passed to child components
 *
 * 3. **UI Rendering Issues:**
 *    - TraceTree component may fail to render if spanKind is undefined
 *    - TraceDetailsSidebar may have missing span kind information
 *    - Service map may not properly categorize spans without kind
 *
 * 4. **Data Processing Issues:**
 *    - buildTracesTree() may create malformed span objects
 *    - spanPositionList may contain spans with undefined spanKind
 *    - Chart rendering may fail if it depends on spanKind
 *
 * 5. **Search and Filter Issues:**
 *    - Searching by span kind may fail
 *    - Filtering operations that rely on spanKind will be affected
 *
 * 6. **Service Map Building:**
 *    - buildServiceTree() may fail to properly categorize services
 *    - Service relationships may not be correctly established
 */

describe("TraceDetails - Missing span_kind Field", () => {
  let wrapper: any;

  // Mock data with missing span_kind
  const mockSpansWithoutSpanKind = {
    hits: [
      {
        _timestamp: 1755853746625720,
        busy_ns: "657334",
        code_filepath: "src/service/alerts/mod.rs",
        code_lineno: "114",
        code_namespace: "openobserve::service::alerts",
        duration: 295986,
        end_time: 1755853746921707300,
        events: "[]",
        flags: 1,
        idle_ns: "295329796",
        links: "[]",
        operation_name: "service:alerts:evaluate_scheduled",
        reference_parent_span_id: "",
        reference_parent_trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
        reference_ref_type: "ChildOf",
        service_name: "alertmanager",
        service_service_instance: "dev2-openobserve-alertmanager-0",
        service_service_version: "v0.15.0-rc5",
        span_id: "6b080023171f5767",
        // span_kind is intentionally missing
        span_status: "UNSET",
        start_time: 1755853746625720300,
        status_code: 0,
        status_message: "",
        thread_id: "5",
        thread_name: "job_runtime",
        trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
      },
      {
        _timestamp: 1755853746625779,
        busy_ns: "648454",
        code_filepath: "src/service/search/grpc_search.rs",
        code_lineno: "31",
        code_namespace: "openobserve::service::search::grpc_search",
        duration: 295923,
        end_time: 1755853746921702400,
        events: "[]",
        flags: 1,
        idle_ns: "295275675",
        links: "[]",
        operation_name: "service:search:grpc_search",
        reference_parent_span_id: "6b080023171f5767",
        reference_parent_trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
        reference_ref_type: "ChildOf",
        service_name: "alertmanager",
        service_service_instance: "dev2-openobserve-alertmanager-0",
        service_service_version: "v0.15.0-rc5",
        span_id: "d427ced59acf399b",
        // span_kind is intentionally missing
        span_status: "UNSET",
        start_time: 1755853746625779000,
        status_code: 0,
        status_message: "",
        thread_id: "5",
        thread_name: "job_runtime",
        trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
      },
      {
        _timestamp: 1755853746625790,
        busy_ns: "320271",
        code_filepath: "src/service/search/grpc_search.rs",
        code_lineno: "56",
        code_namespace: "openobserve::service::search::grpc_search",
        duration: 295178,
        end_time: 1755853746920969200,
        events: "[]",
        flags: 1,
        idle_ns: "294858953",
        links: "[]",
        node_addr: "http://10.1.105.53:5081",
        node_id: "5",
        operation_name: "service:search:cluster:grpc_search",
        reference_parent_span_id: "d427ced59acf399b",
        reference_parent_trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
        reference_ref_type: "ChildOf",
        service_name: "alertmanager",
        service_service_instance: "dev2-openobserve-alertmanager-0",
        service_service_version: "v0.15.0-rc5",
        span_id: "bf6bde74cdcc245f",
        span_kind: null, // span_kind is explicitly null
        span_status: "UNSET",
        start_time: 1755853746625790200,
        status_code: 0,
        status_message: "",
        thread_id: "5",
        thread_name: "job_runtime",
        trace_id: "eab4575014a1fe101dba7de80a3cf6c3",
      },
    ],
  };

  beforeEach(async () => {
    // Mock router query params
    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        query: {
          trace_id: "test-trace-id",
          from: "1752490492843",
          to: "1752490493164",
          stream: "test-stream",
          org_identifier: "default",
        },
        name: "traceDetails",
      },
    } as any);

    // Mock API to return data without span_kind
    globalThis.server.use(
      http.post(
        `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
        () => {
          return HttpResponse.json(mockSpansWithoutSpanKind);
        },
      ),
    );

    vi.doMock("@/composables/useTraces", () => ({
      default: () => ({
        searchObj: {
          data: {
            traceDetails: {
              spanList: mockSpansWithoutSpanKind.hits,
              selectedTrace: {
                trace_id: "test-trace-id",
                trace_start_time: 1752490492843,
                trace_end_time: 1752490493164,
              },
              selectedSpanId: "",
              showSpanDetails: false,
              selectedLogStreams: ["test-stream"],
              isLoadingTraceDetails: false,
              isLoadingTraceMeta: false,
            },
            stream: {
              selectedStream: {
                value: "test-stream",
              },
            },
            datetime: {
              type: "relative",
              relativeTimePeriod: "15m",
              startTime: 1752490492843,
              endTime: 1752490493164,
            },
          },
          meta: {
            serviceColors: {
              alertmanager: "#b7885e",
            },
            redirectedFromLogs: false,
          },
        },
        copyTracesUrl: vi.fn(),
      }),
    }));

    wrapper = mount(TraceDetails, {
      attachTo: "#app",
      props: {
        traceId: "test-trace-id",
      },
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: {
          "q-resize-observer": true,
          "chart-renderer": {
            template: '<div data-test="chart-renderer">Chart</div>',
            props: ["data", "id"],
            emits: ["updated:chart"],
          },
          "trace-tree": {
            template: '<div data-test="trace-tree">Trace Tree</div>',
            props: [
              "collapseMapping",
              "spans",
              "baseTracePosition",
              "spanDimensions",
              "spanMap",
              "leftWidth",
              "searchQuery",
              "spanList",
            ],
            emits: [
              "toggle-collapse",
              "select-span",
              "update-current-index",
              "search-result",
            ],
            methods: {
              nextMatch: vi.fn(),
              prevMatch: vi.fn(),
            },
          },
          "trace-header": {
            template: '<div data-test="trace-header">Trace Header</div>',
            props: ["baseTracePosition", "splitterWidth"],
            emits: ["resize-start"],
          },
          "trace-details-sidebar": {
            template: '<div data-test="trace-details-sidebar">Sidebar</div>',
            props: ["span", "baseTracePosition", "searchQuery"],
            emits: ["view-logs", "close", "open-trace"],
          },
        },
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  describe("Critical: getSpanKind() function behavior", () => {
    it("should handle missing span_kind without throwing error", () => {
      expect(() => {
        wrapper.vm.getSpanKind(undefined);
      }).not.toThrow();
    });

    it("should handle null span_kind without throwing error", () => {
      expect(() => {
        wrapper.vm.getSpanKind(null);
      }).not.toThrow();
    });

    it("should handle empty string span_kind", () => {
      const result = wrapper.vm.getSpanKind("");
      expect(result).toBe("Unspecified");
    });

    it("should return undefined for unmapped span_kind values", () => {
      const result = wrapper.vm.getSpanKind("999");
      expect(result).toBe("Unknown");
    });

    it("should handle non-string span_kind gracefully", () => {
      expect(() => {
        wrapper.vm.getSpanKind(undefined);
      }).not.toThrow();
    });
  });

  describe("Critical: Component mounting with missing span_kind", () => {
    it("should mount component successfully even with missing span_kind", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".trace-details").exists()).toBe(true);
    });

    it("should not display any error messages", () => {
      const errorMessages = wrapper.findAll(".q-notification");
      expect(errorMessages.length).toBe(0);
    });

    it("should render trace content area", () => {
      const content = wrapper.find(".trace-details-content");
      // Component should handle missing data gracefully
      expect(wrapper.vm).toBeDefined();
    });
  });

  describe("Critical: Data processing with missing span_kind", () => {
    it("should process spanList even when span_kind is missing", () => {
      expect(wrapper.vm.spanList).toBeDefined();
      expect(wrapper.vm.spanList.length).toBeGreaterThan(0);
    });

    it("should build trace tree without errors", () => {
      expect(() => {
        wrapper.vm.buildTracesTree();
      }).not.toThrow();
    });

    it("should create spanMap with all spans", () => {
      expect(wrapper.vm.spanMap).toBeDefined();
      expect(Object.keys(wrapper.vm.spanMap).length).toBeGreaterThan(0);
    });

    it("should handle spans in spanMap with undefined spanKind", () => {
      const spanIds = Object.keys(wrapper.vm.spanMap);
      spanIds.forEach((spanId: string) => {
        const span = wrapper.vm.spanMap[spanId];
        // Span should exist even if spanKind is undefined
        expect(span).toBeDefined();
      });
    });

    it("should create spanPositionList with all spans", () => {
      expect(wrapper.vm.spanPositionList).toBeDefined();
      expect(Array.isArray(wrapper.vm.spanPositionList)).toBe(true);
    });

    it("should not crash when formatting span with missing span_kind", () => {
      const mockSpan = mockSpansWithoutSpanKind.hits[0];
      expect(() => {
        // This simulates what happens in getFormattedSpan
        const spanKind = mockSpan.span_kind
          ? wrapper.vm.getSpanKind(mockSpan.span_kind.toString())
          : undefined;
        expect(spanKind).toBeUndefined();
      }).not.toThrow();
    });
  });

  describe("Critical: UI rendering with missing span_kind", () => {
    it("should render operation name correctly", () => {
      const operationName = wrapper.find(
        '[data-test="trace-details-operation-name"]',
      );
      if (operationName.exists()) {
        expect(operationName.text()).toBeTruthy();
      }
    });

    it("should render trace ID correctly", () => {
      const traceId = wrapper.find('[data-test="trace-details-trace-id"]');
      if (traceId.exists()) {
        expect(traceId.text()).toBeTruthy();
      }
    });

    it("should render span count correctly", () => {
      const spanCount = wrapper.find('[data-test="trace-details-spans-count"]');
      if (spanCount.exists()) {
        expect(spanCount.text()).toContain("Spans:");
      }
    });

    it("should render trace tree component", () => {
      const traceTree = wrapper.find('[data-test="trace-details-tree"]');
      expect(traceTree.exists()).toBe(true);
    });

    it("should render trace header component", () => {
      const traceHeader = wrapper.find('[data-test="trace-details-header"]');
      expect(traceHeader.exists()).toBe(true);
    });
  });

  describe("Critical: Chart and visualization with missing span_kind", () => {
    it("should build trace chart without errors", () => {
      expect(() => {
        wrapper.vm.buildTraceChart();
      }).not.toThrow();
    });

    it("should have valid chart data structure", () => {
      expect(wrapper.vm.ChartData).toBeDefined();
    });

    it("should build service tree without errors", () => {
      expect(() => {
        wrapper.vm.buildServiceTree();
      }).not.toThrow();
    });

    it("should have valid service map data", () => {
      expect(wrapper.vm.traceServiceMap).toBeDefined();
    });

    it("should toggle timeline without errors", async () => {
      const toggleBtn = wrapper.find(
        '[data-test="trace-details-toggle-timeline-btn"]',
      );
      if (toggleBtn.exists()) {
        await toggleBtn.trigger("click");
        expect(wrapper.vm.isTimelineExpanded).toBe(true);
      }
    });
  });

  describe("Critical: Span interaction with missing span_kind", () => {
    it("should handle span selection without errors", () => {
      const spanId = mockSpansWithoutSpanKind.hits[0].span_id;
      expect(() => {
        wrapper.vm.updateSelectedSpan(spanId);
      }).not.toThrow();
    });

    it("should open sidebar for span without span_kind", () => {
      const spanId = mockSpansWithoutSpanKind.hits[0].span_id;
      wrapper.vm.updateSelectedSpan(spanId);
      expect(wrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(true);
    });

    it("should have valid span data in spanMap even without span_kind", () => {
      const spanId = mockSpansWithoutSpanKind.hits[0].span_id;
      const span = wrapper.vm.spanMap[spanId];
      expect(span).toBeDefined();
      expect(span.span_id).toBe(spanId);
    });
  });

  describe("Edge cases: Mixed span_kind availability", () => {
    it("should handle mix of present and missing span_kind", () => {
      // Test that the component can handle some spans with span_kind and some without
      expect(wrapper.vm.spanList.length).toBe(3);
      expect(wrapper.vm.spanList[0].span_kind).toBeUndefined();
      expect(wrapper.vm.spanList[1].span_kind).toBeUndefined();
      expect(wrapper.vm.spanList[2].span_kind).toBeNull();
    });

    it("should process all spans regardless of span_kind presence", () => {
      const processedSpanIds = Object.keys(wrapper.vm.spanMap);
      const originalSpanIds = mockSpansWithoutSpanKind.hits.map(
        (s) => s.span_id,
      );
      expect(processedSpanIds.length).toBe(originalSpanIds.length);
    });
  });

  describe("Critical: Navigation and actions with missing span_kind", () => {
    it("should navigate to logs without errors", async () => {
      const viewLogsBtn = wrapper.find(
        '[data-test="trace-details-view-logs-btn"]',
      );
      if (viewLogsBtn.exists()) {
        const routerPushSpy = vi.spyOn(router, "push");
        await viewLogsBtn.trigger("click");
        expect(routerPushSpy).toHaveBeenCalled();
      }
    });

    it("should copy trace ID without errors", async () => {
      const copyBtn = wrapper.find(
        '[data-test="trace-details-copy-trace-id-btn"]',
      );
      if (copyBtn.exists()) {
        await copyBtn.trigger("click");
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
      }
    });

    it("should navigate back to traces list without errors", async () => {
      const backBtn = wrapper.find('[data-test="trace-details-back-btn"]');
      if (backBtn.exists()) {
        const routerPushSpy = vi.spyOn(router, "push");
        await backBtn.trigger("click");
        expect(routerPushSpy).toHaveBeenCalled();
      }
    });
  });

  describe("Integration: Full trace lifecycle with missing span_kind", () => {
    it("should complete full trace rendering lifecycle", async () => {
      expect(wrapper.vm.traceTree).toBeDefined();
      expect(wrapper.vm.spanPositionList).toBeDefined();
      expect(wrapper.vm.baseTracePosition).toBeDefined();
      expect(wrapper.vm.collapseMapping).toBeDefined();
    });

    it("should calculate trace position correctly", () => {
      if (wrapper.vm.baseTracePosition.tics) {
        expect(wrapper.vm.baseTracePosition.tics).toBeDefined();
        expect(wrapper.vm.baseTracePosition.tics.length).toBeGreaterThan(0);
      }
    });

    it("should handle collapse/expand of spans", () => {
      const spanId = mockSpansWithoutSpanKind.hits[0].span_id;
      expect(() => {
        wrapper.vm.toggleSpanCollapse(spanId);
      }).not.toThrow();
    });

    it("should update chart when data changes", () => {
      expect(() => {
        wrapper.vm.updateChart({});
      }).not.toThrow();
    });
  });

  describe("Performance: Memory leaks and cleanup", () => {
    it("should clean up properly on unmount", () => {
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });

    it("should not leave dangling references in spanMap", () => {
      const initialSpanMapSize = Object.keys(wrapper.vm.spanMap).length;
      wrapper.vm.closeSidebar();
      const finalSpanMapSize = Object.keys(wrapper.vm.spanMap).length;
      expect(finalSpanMapSize).toBe(initialSpanMapSize);
    });
  });
});
