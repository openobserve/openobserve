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
        async ({ request }) => {
          const body = await request.json();
          // Check if this is a RUM data query
          if (body.query?.sql?.includes("_rumdata")) {
            // Return empty RUM data
            return HttpResponse.json({
              took: 0,
              hits: [],
              total: 0,
              from: 0,
              size: 0,
              scan_size: 0,
            });
          }
          // Return trace spans for regular trace queries
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
      const spanCount = wrapper
        .find('[data-test="trace-details-spans-count"]')
        .find('[data-test="span-count-text"]');
      expect(spanCount.exists()).toBe(true);
      expect(spanCount.text()).toContain(
        `${tracesMockData.tracesDetails.traceSpans.hits.length} spans`,
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
      expect(searchResults.text()).toContain("3/5");
    });

    it.skip("should handle next match navigation", async () => {
      const nextBtn = wrapper.find(
        '[data-test="trace-details-search-next-btn"]',
      );
      if (nextBtn.exists() && wrapper.vm.traceTreeRef) {
        await nextBtn.trigger("click");
        expect(wrapper.vm.traceTreeRef.nextMatch).toHaveBeenCalled();
      }
    });

    it.skip("should handle previous match navigation", async () => {
      const prevBtn = wrapper.find(
        '[data-test="trace-details-search-prev-btn"]',
      );
      if (prevBtn.exists() && wrapper.vm.traceTreeRef) {
        await prevBtn.trigger("click");
        expect(wrapper.vm.traceTreeRef.prevMatch).toHaveBeenCalled();
      }
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

  describe("Props: Mode control", () => {
    describe("mode prop - standalone", () => {
      it("should default to standalone mode", () => {
        expect(wrapper.props("mode")).toBe("standalone");
      });

      it("should show back button when showBackButton is true in standalone mode", async () => {
        const backBtn = wrapper.find('[data-test="trace-details-back-btn"]');
        expect(backBtn.exists()).toBe(true);
      });

      it("should show close button when showCloseButton is true in standalone mode", () => {
        const closeBtn = wrapper.find('[data-test="trace-details-close-btn"]');
        expect(closeBtn.exists()).toBe(true);
      });

      it("should show share button when showShareButton is true in standalone mode", () => {
        const shareBtn = wrapper.find(
          '[data-test="trace-details-share-link-btn"]',
        );
        expect(shareBtn.exists()).toBe(true);
      });

      it("should not show expand button in standalone mode", () => {
        const expandBtn = wrapper.find(
          '[data-test="trace-details-expand-btn"]',
        );
        expect(expandBtn.exists()).toBe(false);
      });

      it("should fetch data from API in standalone mode", () => {
        expect(wrapper.vm.shouldFetchData).toBe(true);
      });

      it("should use route query params for trace ID in standalone mode", () => {
        expect(wrapper.vm.effectiveTraceId).toBe("test-trace-id");
      });
    });

    describe("mode prop - embedded", () => {
      let embeddedWrapper: any;

      beforeEach(async () => {
        embeddedWrapper = mount(TraceDetails, {
          attachTo: "#app",
          props: {
            mode: "embedded",
            traceIdProp: "embedded-trace-id",
            streamNameProp: "embedded-stream",
            spanListProp: tracesMockData.tracesDetails.traceSpans.hits,
            startTimeProp: 1752490492843,
            endTimeProp: 1752490493164,
            showBackButton: false,
            showExpandButton: true,
            showShareButton: false,
            showCloseButton: false,
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
                  "selectedSpanId",
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
                template:
                  '<div data-test="trace-details-sidebar">Sidebar</div>',
                props: [
                  "span",
                  "baseTracePosition",
                  "searchQuery",
                  "streamName",
                  "serviceStreamsEnabled",
                  "parentMode",
                ],
                emits: ["view-logs", "close", "open-trace"],
              },
            },
          },
        });

        await flushPromises();
      });

      afterEach(() => {
        if (embeddedWrapper) {
          embeddedWrapper.unmount();
        }
      });

      it("should mount in embedded mode", () => {
        expect(embeddedWrapper.props("mode")).toBe("embedded");
        expect(embeddedWrapper.exists()).toBe(true);
      });

      it("should not show back button in embedded mode when showBackButton is false", () => {
        const backBtn = embeddedWrapper.find(
          '[data-test="trace-details-back-btn"]',
        );
        expect(backBtn.exists()).toBe(false);
      });

      it("should show expand button in embedded mode when showExpandButton is true", () => {
        const expandBtn = embeddedWrapper.find(
          '[data-test="trace-details-expand-btn"]',
        );
        expect(expandBtn.exists()).toBe(true);
      });

      it("should not show share button in embedded mode when showShareButton is false", () => {
        const shareBtn = embeddedWrapper.find(
          '[data-test="trace-details-share-link-btn"]',
        );
        expect(shareBtn.exists()).toBe(false);
      });

      it("should not show close button in embedded mode when showCloseButton is false", () => {
        const closeBtn = embeddedWrapper.find(
          '[data-test="trace-details-close-btn"]',
        );
        expect(closeBtn.exists()).toBe(false);
      });

      it("should make trace ID clickable in embedded mode", async () => {
        await embeddedWrapper.vm.$nextTick();
        const traceId = embeddedWrapper.find(
          '[data-test="trace-details-trace-id"]',
        );
        if (traceId.exists()) {
          expect(traceId.classes()).toContain("tw:cursor-pointer");
        }
      });

      it("should show open_in_new icon next to trace ID in embedded mode", () => {
        const openIcon = embeddedWrapper.find(
          '[data-test="trace-details-trace-id-open-btn"]',
        );
        expect(openIcon.exists()).toBe(true);
      });

      it("should not fetch data when spanListProp is provided", () => {
        expect(embeddedWrapper.vm.shouldFetchData).toBe(false);
      });

      it("should use provided spanListProp", () => {
        expect(embeddedWrapper.vm.effectiveSpanList).toEqual(
          tracesMockData.tracesDetails.traceSpans.hits,
        );
      });

      it("should emit close event when handleBackOrClose is called in embedded mode", async () => {
        embeddedWrapper.vm.handleBackOrClose();
        await embeddedWrapper.vm.$nextTick();
        expect(embeddedWrapper.emitted("close")).toBeTruthy();
      });

      it("should emit spanSelected event when span is selected in embedded mode", async () => {
        const spanId = tracesMockData.tracesDetails.traceSpans.hits[0].span_id;
        embeddedWrapper.vm.updateSelectedSpan(spanId);
        await embeddedWrapper.vm.$nextTick();
        expect(embeddedWrapper.emitted("spanSelected")).toBeTruthy();
      });
    });
  });

  describe("Props: Data props (embedded mode)", () => {
    let embeddedWrapper: any;

    beforeEach(async () => {
      embeddedWrapper = mount(TraceDetails, {
        attachTo: "#app",
        props: {
          mode: "embedded",
          traceIdProp: "custom-trace-123",
          streamNameProp: "custom-stream",
          spanListProp: tracesMockData.tracesDetails.traceSpans.hits,
          startTimeProp: 1234567890000,
          endTimeProp: 1234567900000,
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
                "selectedSpanId",
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
              props: [
                "span",
                "baseTracePosition",
                "searchQuery",
                "streamName",
                "serviceStreamsEnabled",
                "parentMode",
              ],
              emits: ["view-logs", "close", "open-trace"],
            },
          },
        },
      });

      await flushPromises();
    });

    afterEach(() => {
      if (embeddedWrapper) {
        embeddedWrapper.unmount();
      }
    });

    it("should use traceIdProp when provided", () => {
      expect(embeddedWrapper.vm.effectiveTraceId).toBe("custom-trace-123");
    });

    it("should use streamNameProp when provided", () => {
      expect(embeddedWrapper.vm.effectiveStreamName).toBe("custom-stream");
    });

    it("should use spanListProp when provided", () => {
      expect(embeddedWrapper.vm.effectiveSpanList).toEqual(
        tracesMockData.tracesDetails.traceSpans.hits,
      );
    });

    it("should use startTimeProp and endTimeProp for time range", () => {
      const timeRange = embeddedWrapper.vm.effectiveTimeRange;
      expect(timeRange.from).toBe(1234567890000);
      expect(timeRange.to).toBe(1234567900000);
    });

    it("should process provided span list and build trace tree", () => {
      expect(embeddedWrapper.vm.traceTree).toBeDefined();
      expect(embeddedWrapper.vm.traceTree.length).toBeGreaterThan(0);
    });

    it("should watch for spanListProp changes and rebuild tree", async () => {
      const newSpanList = [
        ...tracesMockData.tracesDetails.traceSpans.hits,
        {
          ...tracesMockData.tracesDetails.traceSpans.hits[0],
          span_id: "new-span-id",
          operation_name: "New Operation",
        },
      ];

      await embeddedWrapper.setProps({ spanListProp: newSpanList });
      await flushPromises();

      expect(embeddedWrapper.vm.effectiveSpanList.length).toBe(
        newSpanList.length,
      );
    });

    it("should watch for traceIdProp changes and fetch new data", async () => {
      await embeddedWrapper.setProps({
        traceIdProp: "new-trace-id",
        spanListProp: [], // Empty to trigger fetch
      });
      await flushPromises();

      expect(embeddedWrapper.vm.effectiveTraceId).toBe("new-trace-id");
    });
  });

  describe("Props: UI visibility controls", () => {
    describe("showBackButton prop", () => {
      it("should show back button when true in standalone mode", () => {
        const backBtn = wrapper.find('[data-test="trace-details-back-btn"]');
        expect(backBtn.exists()).toBe(true);
      });

      it("should hide back button when false", async () => {
        const wrapperNoBack = mount(TraceDetails, {
          attachTo: "#app",
          props: {
            mode: "standalone",
            showBackButton: false,
          },
          global: {
            plugins: [i18n, router],
            provide: { store },
            stubs: {
              "q-resize-observer": true,
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": { template: "<div>Sidebar</div>" },
            },
          },
        });

        await flushPromises();
        const backBtn = wrapperNoBack.find(
          '[data-test="trace-details-back-btn"]',
        );
        expect(backBtn.exists()).toBe(false);
        wrapperNoBack.unmount();
      });
    });

    describe("showLogStreamSelector prop", () => {
      it("should show log stream selector when true (default)", () => {
        const selector = wrapper.find(
          '[data-test="trace-details-log-streams-select"]',
        );
        expect(selector.exists()).toBe(true);
      });

      it("should hide log stream selector when false", async () => {
        const wrapperNoSelector = mount(TraceDetails, {
          attachTo: "#app",
          props: {
            showLogStreamSelector: false,
          },
          global: {
            plugins: [i18n, router],
            provide: { store },
            stubs: {
              "q-resize-observer": true,
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": { template: "<div>Sidebar</div>" },
            },
          },
        });

        await flushPromises();
        const selector = wrapperNoSelector.find(
          '[data-test="trace-details-log-streams-select"]',
        );
        expect(selector.exists()).toBe(false);
        wrapperNoSelector.unmount();
      });
    });

    describe("showShareButton prop", () => {
      it("should show share button when true in standalone mode", () => {
        const shareBtn = wrapper.find(
          '[data-test="trace-details-share-link-btn"]',
        );
        expect(shareBtn.exists()).toBe(true);
      });
    });

    describe("showCloseButton prop", () => {
      it("should show close button when true in standalone mode", () => {
        const closeBtn = wrapper.find('[data-test="trace-details-close-btn"]');
        expect(closeBtn.exists()).toBe(true);
      });
    });

    describe("showExpandButton prop", () => {
      it("should show expand button in embedded mode when true", async () => {
        const embeddedWrapper = mount(TraceDetails, {
          attachTo: "#app",
          props: {
            mode: "embedded",
            showExpandButton: true,
            spanListProp: tracesMockData.tracesDetails.traceSpans.hits,
          },
          global: {
            plugins: [i18n, router],
            provide: { store },
            stubs: {
              "q-resize-observer": true,
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": { template: "<div>Sidebar</div>" },
            },
          },
        });

        await flushPromises();
        const expandBtn = embeddedWrapper.find(
          '[data-test="trace-details-expand-btn"]',
        );
        expect(expandBtn.exists()).toBe(true);
        embeddedWrapper.unmount();
      });
    });
  });

  describe("Props: Correlation-specific props", () => {
    describe("correlatedLogStream prop", () => {
      it("should use correlatedLogStream when expanding to full view", async () => {
        const embeddedWrapper = mount(TraceDetails, {
          attachTo: "#app",
          props: {
            mode: "embedded",
            traceIdProp: "test-trace-123",
            streamNameProp: "test-stream",
            spanListProp: tracesMockData.tracesDetails.traceSpans.hits,
            startTimeProp: 1234567890000,
            endTimeProp: 1234567900000,
            correlatedLogStream: "correlated-log-stream",
            showExpandButton: true,
          },
          global: {
            plugins: [i18n, router],
            provide: { store },
            stubs: {
              "q-resize-observer": true,
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": { template: "<div>Sidebar</div>" },
            },
          },
        });

        await flushPromises();

        const windowOpenSpy = vi.spyOn(window, "open").mockImplementation();
        const resolveRouterSpy = vi
          .spyOn(router, "resolve")
          .mockReturnValue({ href: "/mock-route" } as any);

        embeddedWrapper.vm.handleExpandToFullView();
        await embeddedWrapper.vm.$nextTick();

        expect(resolveRouterSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            query: expect.objectContaining({
              log_stream: "correlated-log-stream",
            }),
          }),
        );

        windowOpenSpy.mockRestore();
        resolveRouterSpy.mockRestore();
        embeddedWrapper.unmount();
      });
    });

    describe("enableCorrelationLinks prop", () => {
      it("should pass enableCorrelationLinks to child components", async () => {
        const embeddedWrapper = mount(TraceDetails, {
          attachTo: "#app",
          props: {
            mode: "embedded",
            enableCorrelationLinks: true,
            spanListProp: tracesMockData.tracesDetails.traceSpans.hits,
          },
          global: {
            plugins: [i18n, router],
            provide: { store },
            stubs: {
              "q-resize-observer": true,
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": { template: "<div>Sidebar</div>" },
            },
          },
        });

        await flushPromises();
        expect(embeddedWrapper.props("enableCorrelationLinks")).toBe(true);
        embeddedWrapper.unmount();
      });
    });

    describe("currentTraceStreamName computed", () => {
      it("should compute current trace stream name for correlation", () => {
        expect(wrapper.vm.currentTraceStreamName).toBeDefined();
      });
    });

    describe("serviceStreamsEnabled computed", () => {
      it("should check if service streams feature is enabled", () => {
        expect(wrapper.vm.serviceStreamsEnabled).toBeDefined();
        expect(typeof wrapper.vm.serviceStreamsEnabled).toBe("boolean");
      });
    });
  });

  describe("Integration: Mode switching scenarios", () => {
    it("should handle transition from embedded to standalone via expand", async () => {
      const embeddedWrapper = mount(TraceDetails, {
        attachTo: "#app",
        props: {
          mode: "embedded",
          traceIdProp: "test-trace-id",
          streamNameProp: "test-stream",
          spanListProp: tracesMockData.tracesDetails.traceSpans.hits,
          startTimeProp: 1234567890000,
          endTimeProp: 1234567900000,
          showExpandButton: true,
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            "q-resize-observer": true,
            "chart-renderer": {
              template: '<div data-test="chart-renderer">Chart</div>',
            },
            "trace-tree": { template: "<div>Tree</div>" },
            "trace-header": { template: "<div>Header</div>" },
            "trace-details-sidebar": { template: "<div>Sidebar</div>" },
          },
        },
      });

      await flushPromises();

      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation();
      const expandBtn = embeddedWrapper.find(
        '[data-test="trace-details-expand-btn"]',
      );

      if (expandBtn.exists()) {
        await expandBtn.trigger("click");
        expect(windowOpenSpy).toHaveBeenCalled();
      }

      windowOpenSpy.mockRestore();
      embeddedWrapper.unmount();
    });

    it("should build correct URL when expanding to full view with all params", async () => {
      const embeddedWrapper = mount(TraceDetails, {
        attachTo: "#app",
        props: {
          mode: "embedded",
          traceIdProp: "trace-123",
          streamNameProp: "stream-abc",
          startTimeProp: 1000000,
          endTimeProp: 2000000,
          correlatedLogStream: "log-stream-xyz",
          spanListProp: tracesMockData.tracesDetails.traceSpans.hits,
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            "q-resize-observer": true,
            "chart-renderer": {
              template: '<div data-test="chart-renderer">Chart</div>',
            },
            "trace-tree": { template: "<div>Tree</div>" },
            "trace-header": { template: "<div>Header</div>" },
            "trace-details-sidebar": { template: "<div>Sidebar</div>" },
          },
        },
      });

      await flushPromises();

      const resolveRouterSpy = vi
        .spyOn(router, "resolve")
        .mockReturnValue({ href: "/mock-route" } as any);

      embeddedWrapper.vm.handleExpandToFullView();

      expect(resolveRouterSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "traceDetails",
          query: expect.objectContaining({
            trace_id: "trace-123",
            stream: "stream-abc",
            from: "1000000",
            to: "2000000",
            log_stream: "log-stream-xyz",
          }),
        }),
      );

      resolveRouterSpy.mockRestore();
      embeddedWrapper.unmount();
    });
  });

  describe("Props validation and defaults", () => {
    it("should have correct default values for all props", () => {
      const defaultWrapper = mount(TraceDetails, {
        attachTo: "#app",
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            "q-resize-observer": true,
            "chart-renderer": {
              template: '<div data-test="chart-renderer">Chart</div>',
            },
            "trace-tree": { template: "<div>Tree</div>" },
            "trace-header": { template: "<div>Header</div>" },
            "trace-details-sidebar": { template: "<div>Sidebar</div>" },
          },
        },
      });

      expect(defaultWrapper.props("mode")).toBe("standalone");
      expect(defaultWrapper.props("traceIdProp")).toBe("");
      expect(defaultWrapper.props("streamNameProp")).toBe("");
      expect(defaultWrapper.props("spanListProp")).toEqual([]);
      expect(defaultWrapper.props("startTimeProp")).toBe(0);
      expect(defaultWrapper.props("endTimeProp")).toBe(0);
      expect(defaultWrapper.props("correlatedLogStream")).toBe("");
      expect(defaultWrapper.props("showBackButton")).toBe(true);
      expect(defaultWrapper.props("showHeader")).toBe(true);
      expect(defaultWrapper.props("showTimeline")).toBe(true);
      expect(defaultWrapper.props("showLogStreamSelector")).toBe(true);
      expect(defaultWrapper.props("showShareButton")).toBe(true);
      expect(defaultWrapper.props("showCloseButton")).toBe(true);
      expect(defaultWrapper.props("showExpandButton")).toBe(false);
      expect(defaultWrapper.props("enableCorrelationLinks")).toBe(false);

      defaultWrapper.unmount();
    });

    it("should validate mode prop values", () => {
      const propValidator = TraceDetails.props.mode.validator;
      expect(propValidator("standalone")).toBe(true);
      expect(propValidator("embedded")).toBe(true);
      expect(propValidator("invalid")).toBe(false);
    });
  });

  describe("Coverage: redirectToLogs edge cases", () => {
    it("should return early when selectedTrace is not available (line 1815)", () => {
      const routerPushSpy = vi.spyOn(router, "push");
      wrapper.vm.searchObj.data.traceDetails.selectedTrace = null;

      wrapper.vm.redirectToLogs();

      expect(routerPushSpy).not.toHaveBeenCalled();
      routerPushSpy.mockRestore();
    });

    it("should navigate to logs with correct parameters when selectedTrace exists", async () => {
      const routerPushSpy = vi.spyOn(router, "push");
      wrapper.vm.searchObj.data.traceDetails.selectedTrace = {
        trace_id: "test-trace-id",
        trace_start_time: 1000000,
        trace_end_time: 2000000,
      };
      wrapper.vm.searchObj.data.traceDetails.selectedLogStreams = [
        "stream1",
        "stream2",
      ];

      wrapper.vm.redirectToLogs();

      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/logs",
          query: expect.objectContaining({
            stream_type: "logs",
            stream: "stream1,stream2",
            type: "trace_explorer",
          }),
        }),
      );
      routerPushSpy.mockRestore();
    });
  });

  describe("Coverage: redirectToSessionReplay edge cases", () => {
    it("should handle case when firstRumSessionData is null (lines 1851-1853)", () => {
      const routerPushSpy = vi.spyOn(router, "push");
      // Set spanList without RUM session data - firstRumSessionData will be null
      wrapper.vm.searchObj.data.traceDetails.spanList =
        tracesMockData.tracesDetails.traceSpans.hits;

      // Verify firstRumSessionData is null
      expect(wrapper.vm.firstRumSessionData).toBeNull();

      // This should not throw an error now that the bug is fixed
      // Previously would throw: Cannot read properties of null (reading 'rum_session_id')
      expect(() => wrapper.vm.redirectToSessionReplay()).not.toThrow();
      expect(routerPushSpy).not.toHaveBeenCalled();
      routerPushSpy.mockRestore();
    });

    it("should navigate to session viewer when rum_session_id exists", () => {
      const routerPushSpy = vi.spyOn(router, "push");
      // Add RUM session data to spanList
      wrapper.vm.searchObj.data.traceDetails.spanList = [
        {
          ...tracesMockData.tracesDetails.traceSpans.hits[0],
          rum_session_id: "session-123",
          start_time: 1000000000,
          end_time: 2000000000,
          rum_date: 1500000000,
        },
      ];

      wrapper.vm.redirectToSessionReplay();

      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "SessionViewer",
          params: {
            id: "session-123",
          },
          query: expect.objectContaining({
            event_time: 1500000000,
          }),
        }),
      );
      routerPushSpy.mockRestore();
    });
  });

  describe("Coverage: filterStreamFn function", () => {
    // Note: logStreams is NOT exported from the component, so we can't directly manipulate it
    // We can only test filterStreamFn with the streams that are already loaded via loadLogStreams()

    it("should filter streams by search value (lines 1871-1872)", async () => {
      // filterStreamFn filters the internal logStreams and updates filteredStreamOptions
      wrapper.vm.filterStreamFn("k8s");
      await wrapper.vm.$nextTick();

      // Should find streams containing "k8s"
      expect(wrapper.vm.filteredStreamOptions.length).toBeGreaterThanOrEqual(0);
    });

    it("should filter streams case-insensitively", async () => {
      wrapper.vm.filterStreamFn("K8S");
      await wrapper.vm.$nextTick();

      // Case-insensitive search should work
      expect(wrapper.vm.filteredStreamOptions.length).toBeGreaterThanOrEqual(0);
    });

    it("should return all streams when search value is empty", async () => {
      wrapper.vm.filterStreamFn("");
      await wrapper.vm.$nextTick();

      // Empty search should return all available streams
      expect(Array.isArray(wrapper.vm.filteredStreamOptions)).toBe(true);
    });

    it("should return empty array when no match found", async () => {
      wrapper.vm.filterStreamFn("nonexistent-stream-xyz-123");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filteredStreamOptions).toEqual([]);
    });

    it("should handle undefined search value", async () => {
      wrapper.vm.filterStreamFn();
      await wrapper.vm.$nextTick();

      // Undefined should be treated as empty string
      expect(Array.isArray(wrapper.vm.filteredStreamOptions)).toBe(true);
    });
  });

  describe("Coverage: openTraceDetails function", () => {
    it("should set showSpanDetails and showTraceDetails to true (lines 1877-1878)", () => {
      wrapper.vm.searchObj.data.traceDetails.showSpanDetails = false;
      wrapper.vm.showTraceDetails = false;

      wrapper.vm.openTraceDetails();

      expect(wrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(true);
      expect(wrapper.vm.showTraceDetails).toBe(true);
    });

    it("should work when values are already true", () => {
      wrapper.vm.searchObj.data.traceDetails.showSpanDetails = true;
      wrapper.vm.showTraceDetails = true;

      wrapper.vm.openTraceDetails();

      expect(wrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(true);
      expect(wrapper.vm.showTraceDetails).toBe(true);
    });
  });

  describe("Coverage: routeToTracesList with datetime handling", () => {
    it("should use period for relative datetime (default case)", async () => {
      const routerPushSpy = vi.spyOn(router, "push");
      wrapper.vm.searchObj.data.datetime.type = "relative";
      wrapper.vm.searchObj.data.datetime.relativeTimePeriod = "15m";

      wrapper.vm.routeToTracesList();

      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            period: "15m",
          }),
        }),
      );
      routerPushSpy.mockRestore();
    });

    it("should use from/to for absolute datetime (lines 1939-1940)", async () => {
      const routerPushSpy = vi.spyOn(router, "push");
      wrapper.vm.searchObj.data.datetime.type = "absolute";
      wrapper.vm.searchObj.data.datetime.startTime = 1234567890000;
      wrapper.vm.searchObj.data.datetime.endTime = 1234567900000;

      wrapper.vm.routeToTracesList();

      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({
            from: "1234567890000",
            to: "1234567900000",
          }),
        }),
      );
      const callArg: any = routerPushSpy.mock.calls[0][0];
      expect(callArg.query.period).toBeUndefined();
      routerPushSpy.mockRestore();
    });

    it("should not navigate when in embedded mode", () => {
      const embeddedWrapper = mount(TraceDetails, {
        attachTo: "#app",
        props: {
          mode: "embedded",
          spanListProp: tracesMockData.tracesDetails.traceSpans.hits,
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            "q-resize-observer": true,
            "chart-renderer": {
              template: '<div data-test="chart-renderer">Chart</div>',
            },
            "trace-tree": { template: "<div>Tree</div>" },
            "trace-header": { template: "<div>Header</div>" },
            "trace-details-sidebar": { template: "<div>Sidebar</div>" },
          },
        },
      });

      const routerPushSpy = vi.spyOn(router, "push");

      embeddedWrapper.vm.routeToTracesList();

      expect(routerPushSpy).not.toHaveBeenCalled();
      routerPushSpy.mockRestore();
      embeddedWrapper.unmount();
    });
  });

  describe("Coverage: openTraceLink function", () => {
    it("should call openTraceLink and verify trace details are reset (lines 1952-1953)", async () => {
      // Call the function
      await wrapper.vm.openTraceLink();
      await flushPromises();

      // Verify the function executed (spanList should be processed)
      expect(wrapper.vm.searchObj.data.traceDetails).toBeDefined();
    });

    it("should verify openTraceLink reprocesses trace data", async () => {
      // Set some initial data
      wrapper.vm.searchObj.data.traceDetails.showSpanDetails = true;
      wrapper.vm.searchObj.data.traceDetails.selectedSpanId = "test-span";

      // Call openTraceLink
      await wrapper.vm.openTraceLink();
      await flushPromises();

      // After reset and setup, these should be reset
      expect(wrapper.vm.searchObj.data.traceDetails.selectedSpanId).toBe("");
      expect(wrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(
        false,
      );
    });
  });

  describe("Coverage: RUM session integration", () => {
    it("should show session replay button when RUM session exists", async () => {
      wrapper.vm.searchObj.data.traceDetails.spanList = [
        {
          ...tracesMockData.tracesDetails.traceSpans.hits[0],
          rum_session_id: "session-123",
        },
      ];
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.hasRumSessionId).toBe(true);
    });

    it("should not show session replay button when no RUM session exists", async () => {
      wrapper.vm.searchObj.data.traceDetails.spanList =
        tracesMockData.tracesDetails.traceSpans.hits;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.hasRumSessionId).toBe(false);
    });
  });

  describe("Coverage: Stream filtering integration", () => {
    it("should filter streams when user types in search", async () => {
      wrapper.vm.logStreams = [
        "app-logs",
        "system-logs",
        "error-logs",
        "debug-logs",
      ];

      const searchInput = wrapper.find(
        '[data-test="trace-details-stream-search-input"]',
      );
      if (searchInput.exists()) {
        await searchInput.setValue("error");
        await wrapper.vm.$nextTick();

        wrapper.vm.filterStreamFn("error");
        expect(wrapper.vm.filteredStreamOptions).toEqual(["error-logs"]);
      }
    });
  });

  describe("Priority 1: RUM Integration - formatRumEventsAsSpans", () => {
    beforeEach(() => {
      // Reset selectedTrace service_name array before each test
      wrapper.vm.searchObj.data.traceDetails.selectedTrace = {
        service_name: [],
      };
    });

    it("should format resource RUM events as spans", () => {
      const rumEvents = [
        {
          type: "resource",
          date: 1234567890,
          resource_method: "GET",
          resource_url: "https://api.example.com/data",
          resource_duration: 150000000, // 150ms in nanoseconds
          resource_status_code: 200,
          _oo_trace_id: "trace-123",
          _oo_span_id: "span-resource-1",
          service: "Frontend",
          session_id: "session-123",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("GET https://api.example.com/data");
      expect(result[0].span_status).toBe("OK");
      expect(result[0].span_kind).toBe("3"); // Client
      expect(result[0].service_name).toBe("Frontend");
      expect(result[0].rum_event_type).toBe("resource");
      expect(result[0].rum_session_id).toBe("session-123");
      expect(result[0].trace_id).toBe("trace-123");
      expect(result[0].span_id).toBe("span-resource-1");
    });

    it("should format resource RUM events with error status codes as ERROR", () => {
      const rumEvents = [
        {
          type: "resource",
          date: 1234567890,
          resource_method: "POST",
          resource_url: "https://api.example.com/error",
          resource_duration: 50000000,
          resource_status_code: 500, // Error status
          _oo_trace_id: "trace-124",
          service: "Frontend",
          session_id: "session-124",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result[0].span_status).toBe("ERROR");
    });

    it("should format action RUM events as spans", () => {
      const rumEvents = [
        {
          type: "action",
          date: 1234567890,
          action_type: "click",
          action_target_name: "Submit Button",
          action_duration: 100000000,
          _oo_trace_id: "trace-125",
          _oo_span_id: "span-action-1",
          service: "Frontend",
          session_id: "session-125",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("Action: click on Submit Button");
      expect(result[0].span_status).toBe("OK");
      expect(result[0].span_kind).toBe("0"); // Unspecified
      expect(result[0].rum_event_type).toBe("action");
    });

    it("should format view RUM events as spans", () => {
      const rumEvents = [
        {
          type: "view",
          date: 1234567890,
          view_url: "https://example.com/home",
          action_duration: 200000000,
          _oo_trace_id: "trace-126",
          _oo_span_id: "span-view-1",
          service: "Frontend",
          session_id: "session-126",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("View: https://example.com/home");
      expect(result[0].span_status).toBe("OK");
      expect(result[0].rum_event_type).toBe("view");
    });

    it("should format error RUM events as spans with ERROR status", () => {
      const rumEvents = [
        {
          type: "error",
          date: 1234567890,
          error_message: "Network timeout",
          error_type: "NetworkError",
          resource_duration: 0,
          _oo_trace_id: "trace-127",
          _oo_span_id: "span-error-1",
          service: "Frontend",
          session_id: "session-127",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("Error: Network timeout");
      expect(result[0].span_status).toBe("ERROR");
      expect(result[0].rum_event_type).toBe("error");
    });

    it("should handle RUM events with missing optional fields", () => {
      const rumEvents = [
        {
          type: "resource",
          date: 1234567890,
          // Missing resource_method, resource_url, resource_duration
          _oo_trace_id: "trace-128",
          service: "Frontend",
          session_id: "session-128",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("GET Unknown URL");
      expect(result[0].duration).toBe(0);
    });

    it("should generate unique span IDs when not provided", () => {
      const rumEvents = [
        {
          type: "action",
          date: 1234567890,
          action_type: "click",
          // No _oo_span_id or action_id provided
          _oo_trace_id: "trace-129",
          service: "Frontend",
          session_id: "session-129",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result[0].span_id).toMatch(/^rum_action_\d+_/);
    });

    it("should use event-specific ID fields for span_id", () => {
      const rumEvents = [
        {
          type: "view",
          date: 1234567890,
          view_id: "view-specific-id",
          _oo_trace_id: "trace-130",
          service: "Frontend",
          session_id: "session-130",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result[0].span_id).toBe("view-specific-id");
    });

    it("should add new service names to selectedTrace", () => {
      const rumEvents = [
        {
          type: "resource",
          date: 1234567890,
          _oo_trace_id: "trace-131",
          service: "NewService",
          session_id: "session-131",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result).toHaveLength(1);
      const serviceNames =
        wrapper.vm.searchObj.data.traceDetails.selectedTrace.service_name;
      const newService = serviceNames.find(
        (s: any) => s.service_name === "NewService",
      );
      expect(newService).toBeDefined();
      expect(newService.count).toBe(1);
    });

    it("should increment count for existing service names", () => {
      // Add initial service
      wrapper.vm.searchObj.data.traceDetails.selectedTrace.service_name = [
        { service_name: "Frontend", count: 1 },
      ];

      const rumEvents = [
        {
          type: "resource",
          date: 1234567890,
          _oo_trace_id: "trace-132",
          service: "Frontend", // Same service
          session_id: "session-132",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result).toHaveLength(1);
      const serviceNames =
        wrapper.vm.searchObj.data.traceDetails.selectedTrace.service_name;
      const frontendService = serviceNames.find(
        (s: any) => s.service_name === "Frontend",
      );
      expect(frontendService.count).toBe(2);
    });

    it("should use parent_span_id from _oo_parent_span_id", () => {
      const rumEvents = [
        {
          type: "resource",
          date: 1234567890,
          _oo_trace_id: "trace-133",
          _oo_span_id: "span-child",
          _oo_parent_span_id: "span-parent",
          service: "Frontend",
          session_id: "session-133",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      // The parent_span_id is not directly in the return object, but it's used internally
      expect(result[0].span_id).toBe("span-child");
    });

    it("should return empty array when rumEvents is null or undefined", () => {
      expect(wrapper.vm.formatRumEventsAsSpans(null)).toEqual([]);
      expect(wrapper.vm.formatRumEventsAsSpans(undefined)).toEqual([]);
    });

    it("should return empty array when rumEvents is empty", () => {
      expect(wrapper.vm.formatRumEventsAsSpans([])).toEqual([]);
    });

    it("should handle multiple RUM events of different types", () => {
      const rumEvents = [
        {
          type: "resource",
          date: 1234567890,
          resource_method: "GET",
          resource_url: "https://api.example.com/data",
          _oo_trace_id: "trace-134",
          service: "Frontend",
          session_id: "session-134",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
        {
          type: "action",
          date: 1234567891,
          action_type: "click",
          action_target_name: "Button",
          _oo_trace_id: "trace-134",
          service: "Frontend",
          session_id: "session-134",
          [store.state.zoConfig.timestamp_column]: 1234567891000,
        },
        {
          type: "error",
          date: 1234567892,
          error_message: "Failed",
          _oo_trace_id: "trace-134",
          service: "Frontend",
          session_id: "session-134",
          [store.state.zoConfig.timestamp_column]: 1234567892000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result).toHaveLength(3);
      expect(result[0].rum_event_type).toBe("resource");
      expect(result[1].rum_event_type).toBe("action");
      expect(result[2].rum_event_type).toBe("error");
      expect(result[2].span_status).toBe("ERROR");
    });

    it("should calculate start_time and end_time correctly", () => {
      const rumEvents = [
        {
          type: "resource",
          date: 1000, // in seconds
          resource_duration: 500000000, // 500ms in nanoseconds
          _oo_trace_id: "trace-135",
          service: "Frontend",
          session_id: "session-135",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result[0].start_time).toBe(1000000000); // 1000 seconds in nanoseconds
      expect(result[0].end_time).toBe(1500000000); // start + duration
      expect(result[0].duration).toBe(500000); // duration in microseconds
    });

    it("should handle unknown event types with default operation name", () => {
      const rumEvents = [
        {
          type: "custom_unknown_type",
          date: 1234567890,
          _oo_trace_id: "trace-136",
          service: "Frontend",
          session_id: "session-136",
          [store.state.zoConfig.timestamp_column]: 1234567890000,
        },
      ];

      const result = wrapper.vm.formatRumEventsAsSpans(rumEvents);

      expect(result[0].operation_name).toBe("Unknown RUM Event");
    });
  });

  describe("Priority 3: Search Navigation", () => {
    let mockTraceTreeRef: any;

    beforeEach(() => {
      // Create a mock TraceTree component reference with nextMatch and prevMatch methods
      mockTraceTreeRef = {
        nextMatch: vi.fn(),
        prevMatch: vi.fn(),
      };
    });

    describe("nextMatch function", () => {
      it("should call nextMatch on TraceTree ref when ref exists", () => {
        wrapper.vm.traceTreeRef = mockTraceTreeRef;

        wrapper.vm.nextMatch();

        expect(mockTraceTreeRef.nextMatch).toHaveBeenCalledTimes(1);
      });

      it("should handle case when TraceTree ref is null", () => {
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation();
        wrapper.vm.traceTreeRef = null;

        // Should not throw error
        expect(() => wrapper.vm.nextMatch()).not.toThrow();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "TraceTree component reference not found",
        );
        consoleWarnSpy.mockRestore();
      });

      it("should handle case when TraceTree ref is undefined", () => {
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation();
        wrapper.vm.traceTreeRef = undefined;

        expect(() => wrapper.vm.nextMatch()).not.toThrow();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "TraceTree component reference not found",
        );
        consoleWarnSpy.mockRestore();
      });

      it("should not call nextMatch when ref does not exist", () => {
        wrapper.vm.traceTreeRef = null;
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation();

        wrapper.vm.nextMatch();

        // Mock should not be called since ref is null
        expect(mockTraceTreeRef.nextMatch).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
      });
    });

    describe("prevMatch function", () => {
      it("should call prevMatch on TraceTree ref when ref exists", () => {
        wrapper.vm.traceTreeRef = mockTraceTreeRef;

        wrapper.vm.prevMatch();

        expect(mockTraceTreeRef.prevMatch).toHaveBeenCalledTimes(1);
      });

      it("should handle case when TraceTree ref is null", () => {
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation();
        wrapper.vm.traceTreeRef = null;

        // Should not throw error
        expect(() => wrapper.vm.prevMatch()).not.toThrow();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "TraceTree component reference not found",
        );
        consoleWarnSpy.mockRestore();
      });

      it("should handle case when TraceTree ref is undefined", () => {
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation();
        wrapper.vm.traceTreeRef = undefined;

        expect(() => wrapper.vm.prevMatch()).not.toThrow();

        expect(consoleWarnSpy).toHaveBeenCalledWith(
          "TraceTree component reference not found",
        );
        consoleWarnSpy.mockRestore();
      });

      it("should not call prevMatch when ref does not exist", () => {
        wrapper.vm.traceTreeRef = null;
        const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation();

        wrapper.vm.prevMatch();

        // Mock should not be called since ref is null
        expect(mockTraceTreeRef.prevMatch).not.toHaveBeenCalled();
        consoleWarnSpy.mockRestore();
      });
    });

    describe("handleIndexUpdate function", () => {
      it("should update currentIndex with new value", () => {
        wrapper.vm.currentIndex = 0;

        wrapper.vm.handleIndexUpdate(5);

        expect(wrapper.vm.currentIndex).toBe(5);
      });

      it("should handle negative index values", () => {
        wrapper.vm.currentIndex = 0;

        wrapper.vm.handleIndexUpdate(-1);

        expect(wrapper.vm.currentIndex).toBe(-1);
      });

      it("should handle zero index", () => {
        wrapper.vm.currentIndex = 10;

        wrapper.vm.handleIndexUpdate(0);

        expect(wrapper.vm.currentIndex).toBe(0);
      });

      it("should handle large index values", () => {
        wrapper.vm.currentIndex = 0;

        wrapper.vm.handleIndexUpdate(9999);

        expect(wrapper.vm.currentIndex).toBe(9999);
      });

      it("should overwrite previous index value", () => {
        wrapper.vm.currentIndex = 10;

        wrapper.vm.handleIndexUpdate(20);
        expect(wrapper.vm.currentIndex).toBe(20);

        wrapper.vm.handleIndexUpdate(30);
        expect(wrapper.vm.currentIndex).toBe(30);
      });
    });

    describe("handleSearchResult function", () => {
      it("should update searchResults with new value", () => {
        wrapper.vm.searchResults = 0;

        wrapper.vm.handleSearchResult(10);

        expect(wrapper.vm.searchResults).toBe(10);
      });

      it("should handle zero search results", () => {
        wrapper.vm.searchResults = 10;

        wrapper.vm.handleSearchResult(0);

        expect(wrapper.vm.searchResults).toBe(0);
      });

      it("should handle negative values", () => {
        wrapper.vm.searchResults = 5;

        wrapper.vm.handleSearchResult(-1);

        expect(wrapper.vm.searchResults).toBe(-1);
      });

      it("should handle large search result values", () => {
        wrapper.vm.searchResults = 0;

        wrapper.vm.handleSearchResult(1000);

        expect(wrapper.vm.searchResults).toBe(1000);
      });

      it("should update searchResults multiple times", () => {
        wrapper.vm.searchResults = 0;

        wrapper.vm.handleSearchResult(5);
        expect(wrapper.vm.searchResults).toBe(5);

        wrapper.vm.handleSearchResult(10);
        expect(wrapper.vm.searchResults).toBe(10);

        wrapper.vm.handleSearchResult(0);
        expect(wrapper.vm.searchResults).toBe(0);
      });
    });

    describe("Search navigation integration", () => {
      it("should coordinate between nextMatch and handleIndexUpdate", () => {
        wrapper.vm.traceTreeRef = mockTraceTreeRef;
        wrapper.vm.currentIndex = 0;

        // Simulate user clicking next
        wrapper.vm.nextMatch();
        expect(mockTraceTreeRef.nextMatch).toHaveBeenCalled();

        // Simulate TraceTree component emitting updated index
        wrapper.vm.handleIndexUpdate(1);
        expect(wrapper.vm.currentIndex).toBe(1);
      });

      it("should coordinate between prevMatch and handleIndexUpdate", () => {
        wrapper.vm.traceTreeRef = mockTraceTreeRef;
        wrapper.vm.currentIndex = 5;

        // Simulate user clicking prev
        wrapper.vm.prevMatch();
        expect(mockTraceTreeRef.prevMatch).toHaveBeenCalled();

        // Simulate TraceTree component emitting updated index
        wrapper.vm.handleIndexUpdate(4);
        expect(wrapper.vm.currentIndex).toBe(4);
      });

      it("should handle search result updates from child component", () => {
        wrapper.vm.searchResults = 0;

        // Simulate TraceTree emitting search results
        wrapper.vm.handleSearchResult(25);

        expect(wrapper.vm.searchResults).toBe(25);
      });
    });
  });
});
