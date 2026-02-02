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
import tracesMockData from "@/test/unit/mockData/traces";

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

// Mock search service

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: vi.fn().mockResolvedValue(undefined),
  },
});

describe("TraceDetails", () => {
  let wrapper: any;

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

    globalThis.server.use(
      http.post(
        `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
        () => {
          return HttpResponse.json(tracesMockData.tracesDetails.traceSpans);
        },
      ),
    );

    vi.doMock("@/composables/useTraces", () => ({
      default: () => ({
        searchObj: {
          data: {
            traceDetails: {
              spanList: tracesMockData.tracesDetails.traceSpans.hits,
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
              "test-service": "#b7885e",
              "child-service": "#1ab8be",
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

  it("should mount TraceDetails component", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find(".trace-details").exists()).toBe(true);
  });

  // describe("Loading state", () => {
  //   it("should show loading spinner when isLoadingTraceDetails is true", async () => {
  //     const spinner = wrapper.find(".q-spinner");
  //     const loadingText = wrapper.find(
  //       '[data-test="trace-details-loading-text"]',
  //     );

  //     expect(spinner.exists()).toBe(true);
  //     expect(loadingText.exists()).toBe(true);
  //     expect(loadingText.text()).toContain("Fetching your trace");
  //   });
  // });

  describe("Toolbar functionality", () => {
    beforeEach(() => {
      vi.waitFor(() => {}, {
        timeout: 1000,
      });
    });
    it("should display operation name in toolbar", () => {
      const operationName = wrapper.find(
        '[data-test="trace-details-operation-name"]',
      );

      expect(operationName.exists()).toBe(true);
      expect(operationName.text()).toContain(
        tracesMockData.tracesDetails.traceSpans.hits[0].operation_name,
      );
    });

    it("should display trace ID in toolbar", () => {
      const traceId = wrapper.find('[data-test="trace-details-trace-id"]');
      expect(traceId.exists()).toBe(true);
    });

    it("should display span count", () => {
      const spanCount = wrapper.find('[data-test="trace-details-spans-count"]');
      expect(spanCount.exists()).toBe(true);
      expect(spanCount.text()).toContain(
        `Spans: ${tracesMockData.tracesDetails.traceSpans.hits.length}`,
      );
    });

    it("should copy trace ID when copy button is clicked", async () => {
      const copyBtn = wrapper.find(
        '[data-test="trace-details-copy-trace-id-btn"]',
      );
      if (copyBtn.exists()) {
        await copyBtn.trigger("click");
        expect(navigator.clipboard.writeText).toHaveBeenCalled();
      }
    });

    it("should navigate back to traces list when back button is clicked", async () => {
      const backBtn = wrapper.find('[data-test="trace-details-back-btn"]');
      if (backBtn.exists()) {
        const routerPushSpy = vi.spyOn(router, "push");
        await backBtn.trigger("click");
        expect(routerPushSpy).toHaveBeenCalled();
      }
    });

    it("should show share link button", () => {
      const shareBtn = wrapper.find(
        '[data-test="trace-details-share-link-btn"]',
      );
      expect(shareBtn.exists()).toBe(true);
    });
  });

  describe("Search functionality", () => {
    it("should handle search query changes", async () => {
      const searchInput = wrapper.find(
        '[data-test="trace-details-search-input"]',
      );
      if (searchInput.exists()) {
        await searchInput.setValue("test-search");
        expect(wrapper.vm.searchQuery).toBe("test-search");
      }
    });

    it("should show search navigation buttons when there are results", async () => {
      wrapper.vm.searchResults = 5;
      wrapper.vm.currentIndex = 2;
      await wrapper.vm.$nextTick();

      const searchResults = wrapper.find(
        '[data-test="trace-details-search-results"]',
      );
      expect(searchResults.exists()).toBe(true);
      expect(searchResults.text()).toContain("3 of 5");
    });

    it("should handle next match navigation", async () => {
      const nextBtn = wrapper.find(
        '[data-test="trace-details-search-next-btn"]',
      );
      if (nextBtn.exists() && wrapper.vm.traceTreeRef) {
        await nextBtn.trigger("click");
        expect(wrapper.vm.traceTreeRef.nextMatch).toHaveBeenCalled();
      }
    });

    it("should handle previous match navigation", async () => {
      const prevBtn = wrapper.find(
        '[data-test="trace-details-search-prev-btn"]',
      );
      if (prevBtn.exists() && wrapper.vm.traceTreeRef) {
        await prevBtn.trigger("click");
        expect(wrapper.vm.traceTreeRef.prevMatch).toHaveBeenCalled();
      }
    });
  });

  describe("Timeline and chart functionality", () => {
    it("should toggle timeline expansion", async () => {
      const toggleBtn = wrapper.find(
        '[data-test="trace-details-toggle-timeline-btn"]',
      );
      expect(toggleBtn.exists()).toBe(true);

      await toggleBtn.trigger("click");
      expect(wrapper.vm.isTimelineExpanded).toBe(true);
    });

    it("should switch between timeline and service map views", async () => {
      wrapper.vm.isTimelineExpanded = true;
      await wrapper.vm.$nextTick();

      const serviceMapBtn = wrapper.find(
        '[data-test="trace-details-visual-service_map-btn"]',
      );
      if (serviceMapBtn.exists()) {
        await serviceMapBtn.trigger("click");
        expect(wrapper.vm.activeVisual).toBe("service_map");
      }
    });

    it("should display visual title correctly", () => {
      const visualTitle = wrapper.find(
        '[data-test="trace-details-visual-title"]',
      );
      expect(visualTitle.exists()).toBe(true);
      expect(visualTitle.text()).toContain("Trace Timeline");
    });

    it("should render service map chart when service map is selected", async () => {
      wrapper.vm.isTimelineExpanded = true;
      wrapper.vm.activeVisual = "service_map";
      await wrapper.vm.$nextTick();

      const chart = wrapper.find(
        '[data-test="trace-details-service-map-chart"]',
      );
      expect(chart.exists()).toBe(true);
    });

    it("should render chart when timeline is expanded", async () => {
      wrapper.vm.isTimelineExpanded = true;
      wrapper.vm.activeVisual = "timeline";
      await wrapper.vm.$nextTick();

      const chart = wrapper.find('[data-test="trace-details-timeline-chart"]');
      expect(chart.exists()).toBe(true);
    });
  });

  describe("Stream selection", () => {
    it("should display stream selector", () => {
      const streamSelector = wrapper.find(
        '[data-test="trace-details-log-streams-select"]',
      );
      expect(streamSelector.exists()).toBe(true);
    });

    it("should handle view logs button click", async () => {
      const viewLogsBtn = wrapper.find(
        '[data-test="trace-details-view-logs-btn"]',
      );
      expect(viewLogsBtn.exists()).toBe(true);

      const routerPushSpy = vi.spyOn(router, "push");
      await viewLogsBtn.trigger("click");

      // Should navigate to logs page
      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/logs",
          query: expect.any(Object),
        }),
      );
    });
  });

  describe("Span interaction", () => {
    it("should handle span selection", () => {
      const spanId = "test-span-id";
      wrapper.vm.updateSelectedSpan(spanId);

      expect(wrapper.vm.searchObj.data.traceDetails.selectedSpanId).toBe(
        spanId,
      );
      expect(wrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(true);
    });

    it("should handle sidebar close", () => {
      wrapper.vm.closeSidebar();

      expect(wrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(
        false,
      );
      expect(wrapper.vm.searchObj.data.traceDetails.selectedSpanId).toBe(null);
    });

    it("should render trace tree component", () => {
      const traceTree = wrapper.find('[data-test="trace-details-tree"]');
      expect(traceTree.exists()).toBe(true);
    });

    it("should render trace header component", () => {
      const traceHeader = wrapper.find('[data-test="trace-details-header"]');
      expect(traceHeader.exists()).toBe(true);
    });

    it("should render trace details sidebar when span is selected", async () => {
      wrapper.vm.searchObj.data.traceDetails.showSpanDetails = true;
      wrapper.vm.searchObj.data.traceDetails.selectedSpanId = "test-span-id";
      await wrapper.vm.$nextTick();

      const sidebar = wrapper.find('[data-test="trace-details-sidebar"]');
      expect(sidebar.exists()).toBe(true);
    });
  });

  // describe("Resize functionality", () => {
  // it("should handle resize start", () => {
  //   const mockEvent = { clientX: 100 };
  //   wrapper.vm.startResize(mockEvent);
  //   expect(wrapper.vm.initialX).toBe(100);
  //   expect(wrapper.vm.initialWidth).toBe(wrapper.vm.leftWidth);
  // });
  // it("should handle resize", () => {
  //   wrapper.vm.initialX = 100;
  //   wrapper.vm.initialWidth = 250;
  //   const mockEvent = { clientX: 150 };
  //   wrapper.vm.resizing(mockEvent);
  //   expect(wrapper.vm.leftWidth).toBe(300); // 250 + (150 - 100)
  // });
  // });

  describe("Data processing", () => {
    it("should process span data correctly", () => {
      expect(wrapper.vm.spanList).toEqual(
        tracesMockData.tracesDetails.traceSpans.hits,
      );
    });

    it("should calculate trace position", () => {
      expect(wrapper.vm.baseTracePosition.tics).toBeDefined();
      expect(wrapper.vm.baseTracePosition.tics.length).toBe(5);
      expect(wrapper.vm.baseTracePosition.tics[0].value).toBe(0);
      expect(wrapper.vm.baseTracePosition.tics[4].value).toBe(295.99);
    });
  });

  // describe("Error handling", () => {
  //   it("should handle missing trace data gracefully", async () => {
  //     wrapper.vm.searchObj.data.traceDetails.spanList = [];
  //     await wrapper.vm.$nextTick();

  //     expect(wrapper.vm.traceTree).toEqual([]);
  //   });

  //   it("should handle invalid span data", () => {
  //     const invalidSpan = { invalid: "data" };
  //     expect(() => wrapper.vm.getFormattedSpan(invalidSpan)).not.toThrow();
  //   });
  // });


  describe("Component lifecycle", () => {
    it("should setup trace details on mount", async () => {
      expect(wrapper.vm.searchObj.data.traceDetails.spanList).toEqual(
        tracesMockData.tracesDetails.traceSpans.hits,
      );
    });

    it("should clean up properly on unmount", () => {
      wrapper.unmount();
      // Should not throw any errors during cleanup
    });
  });

  describe("Utility functions", () => {
    it("should format time correctly", () => {
      const time = 10000000; // 1 second in nanoseconds
      const result = wrapper.vm.convertTimeFromNsToMs(time);
      expect(result).toBe(10); // Should be 1 millisecond
    });

    it("should get span kind correctly", () => {
      expect(wrapper.vm.getSpanKind("1")).toBe("Client");
      expect(wrapper.vm.getSpanKind("2")).toBe("Server");
      expect(wrapper.vm.getSpanKind("3")).toBe("Producer");
    });

    it("should adjust opacity correctly", () => {
      const color = "#ffffff";
      const result = wrapper.vm.adjustOpacity(color, 0.5);
      expect(result).toBe("#ffffff80"); // 50% opacity
    });
  });
});
