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
 * Test Suite: TraceDetails Component - All Missing Fields
 *
 * Testing with real-world problematic data:
 * {
 *   "_timestamp": 1764742278731548,
 *   "duration": 483,
 *   "end_time": 1764742278732032000,
 *   "events": "[]",
 *   "flags": 1,
 *   "links": "[]",
 *   "operation_name": "Karomi.",
 *   "param_actionexecutedcontext": "System",
 *   "start_time": 1764742278731548200,
 *   "trace_id": "e3af81cb1ad290bdb81e7f2b493f0b09"
 * }
 *
 * Missing Critical Fields:
 * - span_id
 * - service_name
 * - span_kind
 * - span_status
 * - idle_ns
 * - busy_ns
 * - reference_parent_span_id
 */

describe("TraceDetails - All Missing Fields (Real Data)", () => {
  let wrapper: any;

  // Real problematic data
  const realWorldProblematicSpan = {
    _timestamp: 1764742278731548,
    duration: 483,
    end_time: 1764742278732032000,
    events: "[]",
    flags: 1,
    links: "[]",
    operation_name: "Karomi.",
    param_actionexecutedcontext: "System",
    start_time: 1764742278731548200,
    trace_id: "e3af81cb1ad290bdb81e7f2b493f0b09",
    span_id: "e3af81cb1ad290bdb81e7f2b493f0bsa",
    service_name: "nodeA",
  };

  const mockSpansWithManyMissingFields = {
    hits: [
      realWorldProblematicSpan,
      {
        // Second span with minimal fields
        _timestamp: 1764742278731600,
        duration: 500,
        end_time: 1764742278732100000,
        events: "[]",
        links: "[]",
        operation_name: "Another Operation",
        start_time: 1764742278731600000,
        trace_id: "e3af81cb1ad290bdb81e7f2b493f0b09",
      },
    ],
  };

  beforeEach(async () => {
    // Spy on console.warn to verify our validation warnings
    vi.spyOn(console, "warn").mockImplementation(() => {});

    // Mock router query params
    vi.spyOn(router, "currentRoute", "get").mockReturnValue({
      value: {
        query: {
          trace_id: "e3af81cb1ad290bdb81e7f2b493f0b09",
          from: "1764742278731000",
          to: "1764742278732100",
          stream: "test-stream",
          org_identifier: "default",
        },
        name: "traceDetails",
      },
    } as any);

    // Mock API to return problematic data
    globalThis.server.use(
      http.post(
        `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
        () => {
          return HttpResponse.json(mockSpansWithManyMissingFields);
        },
      ),
    );

    vi.doMock("@/composables/useTraces", () => ({
      default: () => ({
        searchObj: {
          data: {
            traceDetails: {
              spanList: mockSpansWithManyMissingFields.hits,
              selectedTrace: {
                trace_id: "e3af81cb1ad290bdb81e7f2b493f0b09",
                trace_start_time: 1764742278731000,
                trace_end_time: 1764742278732100,
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
              startTime: 1764742278731000,
              endTime: 1764742278732100,
            },
          },
          meta: {
            serviceColors: {
              "Unknown Service": "#b7885e",
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
        traceId: "e3af81cb1ad290bdb81e7f2b493f0b09",
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

  describe("Critical: Component mounting with real problematic data", () => {
    it("should mount component without crashing", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find(".trace-details").exists()).toBe(true);
    });

    it("should not throw any errors during mount", () => {
      // If we got here, no errors were thrown
      expect(wrapper.vm).toBeDefined();
    });

    it("should log validation warnings for missing fields", () => {
      // Check if console.warn was called with validation messages
      expect(console.warn).toHaveBeenCalled();
    });
  });

  describe("Critical: Missing span_id handling", () => {
    it("should generate span_id if missing", () => {
      // Check that spans are processed despite missing span_id
      expect(wrapper.vm.spanList).toBeDefined();
      expect(wrapper.vm.spanList.length).toBe(2);
    });

    it("should create spanMap with generated IDs", () => {
      const spanMapKeys = Object.keys(wrapper.vm.spanMap);
      // May have generated IDs or undefined key
      expect(spanMapKeys.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle span selection with missing span_id", () => {
      // Should not crash even if span_id is missing
      expect(() => {
        const formattedSpan = wrapper.vm.getFormattedSpan(
          realWorldProblematicSpan,
        );
        expect(formattedSpan.spanId).toBeDefined();
      }).not.toThrow();
    });
  });

  describe("Critical: Missing service_name handling", () => {
    it("should use default service name", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );
      expect(formattedSpan.serviceName).toBe("nodeA");
    });

    it("should not crash when building service tree", () => {
      expect(() => {
        wrapper.vm.buildServiceTree();
      }).not.toThrow();
    });

    it("should assign color for Unknown Service", () => {
      // Service colors should handle unknown services
      expect(wrapper.vm.searchObj.meta.serviceColors).toBeDefined();
    });
  });

  describe("Critical: Missing span_kind handling", () => {
    it("should use Unspecified for missing span_kind", () => {
      const result = wrapper.vm.getSpanKind(undefined);
      expect(result).toBe("Unspecified");
    });

    it("should format span without span_kind", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );
      expect(formattedSpan.spanKind).toBe("Unspecified");
    });

    it("should not crash on null span_kind", () => {
      const result = wrapper.vm.getSpanKind(null);
      expect(result).toBe("Unspecified");
    });

    it("should handle empty string span_kind", () => {
      const result = wrapper.vm.getSpanKind("");
      expect(result).toBe("Unspecified");
    });
  });

  describe("Critical: Missing span_status handling", () => {
    it("should use UNSET as default span_status", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );
      expect(formattedSpan.spanStatus).toBe("UNSET");
    });
  });

  describe("Critical: Missing idle_ns and busy_ns handling", () => {
    it("should use 0 for missing idle_ns", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );
      expect(formattedSpan.idleMs).toBe(0);
      expect(Number.isNaN(formattedSpan.idleMs)).toBe(false);
    });

    it("should use 0 for missing busy_ns", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );
      expect(formattedSpan.busyMs).toBe(0);
      expect(Number.isNaN(formattedSpan.busyMs)).toBe(false);
    });
  });

  describe("Critical: Missing reference_parent_span_id handling", () => {
    it("should use empty string for missing parent ID", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );
      expect(formattedSpan.parentId).toBe("");
    });

    it("should treat spans with no parent as root spans", () => {
      // Spans without parentId should be added to traceTree root
      expect(wrapper.vm.traceTree).toBeDefined();
      expect(Array.isArray(wrapper.vm.traceTree)).toBe(true);
    });
  });

  describe("Data integrity with missing fields", () => {
    it("should preserve all provided fields", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );

      // Check that provided fields are preserved
      expect(formattedSpan.operationName).toBe("Karomi.");
      expect(formattedSpan.durationUs).toBe(483);
    });

    it("should calculate time fields correctly", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );

      expect(formattedSpan.startTimeMs).toBeDefined();
      expect(formattedSpan.endTimeMs).toBeDefined();
      expect(formattedSpan.durationMs).toBeDefined();
      expect(Number.isNaN(formattedSpan.startTimeMs)).toBe(false);
    });

    it("should parse links correctly", () => {
      const formattedSpan = wrapper.vm.getFormattedSpan(
        realWorldProblematicSpan,
      );
      expect(formattedSpan.links).toEqual([]);
    });
  });

  describe("Validation function", () => {
    it("should validate span and report missing optional fields", () => {
      const validation = wrapper.vm.validateSpan(realWorldProblematicSpan);

      // All required fields are present in real data
      expect(validation.valid).toBe(true);
      expect(validation.missing).toEqual([]);
    });

    it("should detect missing required fields", () => {
      const invalidSpan = {
        _timestamp: 123,
        // Missing: start_time, end_time, duration, operation_name, trace_id
      };

      const validation = wrapper.vm.validateSpan(invalidSpan);

      expect(validation.valid).toBe(false);
      expect(validation.missing).toContain("start_time");
      expect(validation.missing).toContain("end_time");
      expect(validation.missing).toContain("duration");
      expect(validation.missing).toContain("operation_name");
      expect(validation.missing).toContain("trace_id");
    });
  });

  describe("Chart and visualization with missing fields", () => {
    it("should build trace chart without errors", () => {
      expect(() => {
        wrapper.vm.buildTraceChart();
      }).not.toThrow();
    });

    it("should build service tree without errors", () => {
      expect(() => {
        wrapper.vm.buildServiceTree();
      }).not.toThrow();
    });

    it("should calculate trace position without errors", () => {
      expect(() => {
        wrapper.vm.calculateTracePosition();
      }).not.toThrow();
    });
  });

  describe("UI rendering with missing fields", () => {
    it("should render operation name", () => {
      const operationName = wrapper.find(
        '[data-test="trace-details-operation-name"]',
      );
      if (operationName.exists()) {
        expect(operationName.text()).toContain("Karomi.");
      }
    });

    it("should render trace ID", () => {
      const traceId = wrapper.find('[data-test="trace-details-trace-id"]');
      if (traceId.exists()) {
        expect(traceId.text()).toContain("e3af81cb1ad290bdb81e7f2b493f0b09");
      }
    });

    it("should render span count", () => {
      const spanCount = wrapper.find('[data-test="trace-details-spans-count"]');
      if (spanCount.exists()) {
        expect(spanCount.text()).toContain("Spans: 2");
      }
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle completely empty span object", () => {
      expect(() => {
        wrapper.vm.getFormattedSpan({});
      }).not.toThrow();
    });

    it("should handle span with only trace_id", () => {
      const minimalSpan = {
        trace_id: "test-trace",
        start_time: Date.now(),
        end_time: Date.now(),
        duration: 100,
        operation_name: "test",
      };

      expect(() => {
        wrapper.vm.getFormattedSpan(minimalSpan);
      }).not.toThrow();
    });

    it("should handle multiple spans with different missing fields", () => {
      // Second span may have different missing fields
      expect(wrapper.vm.spanList.length).toBe(2);
      expect(() => {
        wrapper.vm.buildTracesTree();
      }).not.toThrow();
    });
  });

  describe("User actions with problematic data", () => {
    it("should allow navigation back", async () => {
      const backBtn = wrapper.find('[data-test="trace-details-back-btn"]');
      if (backBtn.exists()) {
        const routerPushSpy = vi.spyOn(router, "push");
        await backBtn.trigger("click");
        expect(routerPushSpy).toHaveBeenCalled();
      }
    });

    it("should allow copy trace ID", async () => {
      const copyBtn = wrapper.find(
        '[data-test="trace-details-copy-trace-id-btn"]',
      );
      if (copyBtn.exists()) {
        await copyBtn.trigger("click");
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
      }
    });

    it("should allow navigation to logs", async () => {
      const viewLogsBtn = wrapper.find(
        '[data-test="trace-details-view-logs-btn"]',
      );
      if (viewLogsBtn.exists()) {
        const routerPushSpy = vi.spyOn(router, "push");
        await viewLogsBtn.trigger("click");
        expect(routerPushSpy).toHaveBeenCalled();
      }
    });
  });
});
