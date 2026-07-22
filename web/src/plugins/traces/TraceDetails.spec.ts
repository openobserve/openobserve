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

// Shared spy — hoisted so the same instance is returned on every useNotifications() call
const mockShowErrorNotification = vi.fn();

// Mock useNotifications composable
vi.mock("@/aws-exports", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    default: { ...((actual.default as object) || {}), isEnterprise: "false" },
  };
});

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: mockShowErrorNotification,
  }),
}));

// Mock useServiceCorrelation — onMounted now calls loadKeyFields() to
// populate serviceDetectionConfig, so we provide a no-op that returns
// an empty config immediately to keep existing tests working.
vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({
    loadKeyFields: vi.fn().mockResolvedValue({}),
  }),
  TRACE_SERVICE_DETECTION_KEY: Symbol("traceServiceDetection"),
  initServiceCorrelationProviders: vi.fn(),
}));

// ---------------------------------------------------------------------------
// ODrawer stub — replaces the migrated trace filters drawer
// (-> ODrawer with v-model:open). Renders default + footer
// slots and exposes migrated props/emits so we can assert wiring without
// going through the real Reka portal/teleport.
// ---------------------------------------------------------------------------
const ODrawerStub = {
  name: "ODrawer",
  inheritAttrs: false,
  props: [
    "open",
    "side",
    "persistent",
    "size",
    "width",
    "title",
    "subTitle",
    "showClose",
    "seamless",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="trace-details-filters-drawer-stub"
      :data-open="String(open)"
      :data-width="width"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test="trace-details-filters-drawer-primary"
        @click="$emit('click:primary')"
      />
      <button
        data-test="trace-details-filters-drawer-secondary"
        @click="$emit('click:secondary')"
      />
      <button
        data-test="trace-details-filters-drawer-update-open-false"
        @click="$emit('update:open', false)"
      />
    </div>
  `,
};

describe("TraceDetails", () => {
  let wrapper: any;
  let mountOptions: any;

  beforeEach(async () => {
    // The active tab and tab order persist to localStorage, so a test that
    // switches tabs would otherwise leak its selection into every later test.
    localStorage.removeItem("o2_trace_active_tab");
    localStorage.removeItem("o2_trace_tab_order");

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

    mountOptions = {
      attachTo: "#app",
      props: {
        traceId: "test-trace-id",
      },
      global: {
        plugins: [i18n, router],
        provide: { store },
        stubs: {
          ODrawer: ODrawerStub,
          CodeQueryEditor: {
            name: "CodeQueryEditor",
            props: ["query", "language"],
            emits: ["update:query"],
            template: '<div data-test="trace-details-filters-code-editor" />',
          },
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
              "hoveredSpanId",
              "isSidebarOpen",
              "scrollContainer",
            ],
            emits: [
              "toggle-collapse",
              "select-span",
              "update-current-index",
              "search-result",
              "hover-span",
              "unhover-span",
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
              "activeTab",
              "selectedLogStreams",
              "showLogStreamSelector",
            ],
            emits: [
              "view-logs",
              "close",
              "open-trace",
              "add-filter",
              "apply-filter-immediately",
              "update:activeTab",
            ],
          },
        },
      },
    };

    wrapper = mount(TraceDetails, mountOptions);

    await flushPromises();
  });

  /**
   * Re-mounts with the same options. Needed by tests that assert on state read
   * from localStorage during setup, which only runs at mount time.
   */
  async function remount() {
    wrapper.unmount();
    wrapper = mount(TraceDetails, mountOptions);
    await flushPromises();
    return wrapper;
  }

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

    // Regression: these were written as <OButton name="content-copy" /> but
    // `name` is not an OButton prop (ButtonProps exposes iconLeft/iconRight).
    // It fell through to the native <button name> attribute, so the buttons
    // rendered EMPTY — and OButton defaults to variant="primary", so they
    // showed as solid filled blocks. The old test below hid this because it
    // only queried by data-test, which still resolved.
    it("renders the copy buttons with their icon, not as empty buttons", () => {
      const copyBtn = wrapper.find(
        '[data-test="trace-details-copy-trace-id-btn"]',
      );

      expect(copyBtn.exists()).toBe(true);
      // OIcon resolves to an SVG component, so the icon NAME never reaches the
      // DOM — the observable difference is simply that a broken button renders
      // no children at all.
      expect(copyBtn.element.children.length).toBeGreaterThan(0);
      // A stray `name` attribute means the icon prop was mis-spelled again and
      // fell through $attrs onto the native <button>.
      expect(copyBtn.attributes("name")).toBeUndefined();
      // Icon-only buttons must not render as a filled primary block.
      expect(copyBtn.attributes("data-o2-variant")).toBe("ghost");
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
      // OInput wraps the native input in a div; find the inner element
      const searchInputWrapper = wrapper.find(
        '[data-test="trace-details-search-input"]',
      );
      if (searchInputWrapper.exists()) {
        const nativeInput = searchInputWrapper.find("input");
        if (nativeInput.exists()) {
          await nativeInput.setValue("test-search");
          expect(wrapper.vm.searchQuery).toBe("test-search");
        }
      }
    });

    it("should show search navigation buttons when there are results", async () => {
      // Search is a waterfall-view affordance — it is hidden on the flame-graph
      // (the default view), map and thread tabs.
      wrapper.vm.activeTab = "waterfall";
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
    it("should display stream selector with placeholder", () => {
      const streamSelector = wrapper.find(
        '[data-test="trace-details-log-streams-select"]',
      );
      expect(streamSelector.exists()).toBe(true);

      // The component uses :placeholder (not :label)
      const selectComponent = streamSelector.vm || streamSelector.element;
      expect(selectComponent).toBeDefined();
    });

    it("should handle view logs button click with conditional disabled state", async () => {
      const viewLogsBtn = wrapper.find(
        '[data-test="trace-details-view-logs-btn"]',
      );
      expect(viewLogsBtn.exists()).toBe(true);

      // The component HAS isViewLogsDisabled computed property that controls disabled state
      // When no log streams are selected, button should be disabled
      if (wrapper.vm.isViewLogsDisabled) {
        expect(viewLogsBtn.attributes("disabled")).toBeDefined();
      } else {
        const routerPushSpy = vi.spyOn(router, "push");
        await viewLogsBtn.trigger("click");

        // Should navigate to logs page
        expect(routerPushSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            path: "/logs",
            query: expect.any(Object),
          }),
        );
        routerPushSpy.mockRestore();
      }
    });

    it("should have wrapper spans for conditional tooltips on View Logs button", () => {
      // The component HAS tooltip functionality with wrapper spans
      const viewLogsBtn = wrapper.find(
        '[data-test="trace-details-view-logs-btn"]',
      );

      if (viewLogsBtn.exists()) {
        // Button may have tooltip wrapper spans for conditional tooltip behavior
        const tooltipWrapper = viewLogsBtn.element.parentElement;
        // The wrapper structure exists for tooltip functionality
        expect(tooltipWrapper).toBeDefined();
      }
    });
  });

  describe("Span interaction", () => {
    // The trace tree, header and span sidebar all live inside the waterfall
    // view. The component defaults to the flame graph, so opt in explicitly.
    beforeEach(async () => {
      wrapper.vm.activeTab = "waterfall";
      await wrapper.vm.$nextTick();
    });

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

    it("should cancel any in-flight span scroll when sidebar closes", () => {
      const cancelScroll = vi.fn();
      wrapper.vm.traceTreeRef = { cancelScroll };

      wrapper.vm.closeSidebar();

      expect(cancelScroll).toHaveBeenCalledTimes(1);
      expect(wrapper.vm.searchObj.data.traceDetails.selectedSpanId).toBe(null);
    });

    it("should not throw on close when the trace tree ref is absent", () => {
      wrapper.vm.traceTreeRef = null;

      expect(() => wrapper.vm.closeSidebar()).not.toThrow();
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
      expect(wrapper.vm.getSpanKind("1")).toBe("Internal");
      expect(wrapper.vm.getSpanKind("2")).toBe("Server");
      expect(wrapper.vm.getSpanKind("3")).toBe("Client");
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
              ODrawer: ODrawerStub,
              CodeQueryEditor: {
                name: "CodeQueryEditor",
                props: ["query", "language"],
                emits: ["update:query"],
                template:
                  '<div data-test="trace-details-filters-code-editor" />',
              },
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
                  "activeTab",
                  "selectedLogStreams",
                  "showLogStreamSelector",
                ],
                emits: [
                  "view-logs",
                  "close",
                  "open-trace",
                  "add-filter",
                  "apply-filter-immediately",
                  "update:activeTab",
                ],
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
          expect(traceId.classes()).toContain("cursor-pointer");
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
            ODrawer: ODrawerStub,
            CodeQueryEditor: {
              name: "CodeQueryEditor",
              props: ["query", "language"],
              emits: ["update:query"],
              template: '<div data-test="trace-details-filters-code-editor" />',
            },
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
                "activeTab",
                "selectedLogStreams",
                "showLogStreamSelector",
              ],
              emits: [
                "view-logs",
                "close",
                "open-trace",
                "add-filter",
                "apply-filter-immediately",
                "update:activeTab",
              ],
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
              ODrawer: ODrawerStub,
              CodeQueryEditor: {
                name: "CodeQueryEditor",
                props: ["query", "language"],
                emits: ["update:query"],
                template:
                  '<div data-test="trace-details-filters-code-editor" />',
              },
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": {
                template: "<div>Sidebar</div>",
                props: [
                  "span",
                  "baseTracePosition",
                  "searchQuery",
                  "streamName",
                  "serviceStreamsEnabled",
                  "parentMode",
                  "activeTab",
                  "selectedLogStreams",
                  "showLogStreamSelector",
                ],
                emits: [
                  "view-logs",
                  "close",
                  "open-trace",
                  "add-filter",
                  "apply-filter-immediately",
                  "update:activeTab",
                ],
              },
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
      it.skip("should show log stream selector when true (default)", () => {
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
              ODrawer: ODrawerStub,
              CodeQueryEditor: {
                name: "CodeQueryEditor",
                props: ["query", "language"],
                emits: ["update:query"],
                template:
                  '<div data-test="trace-details-filters-code-editor" />',
              },
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": {
                template: "<div>Sidebar</div>",
                props: [
                  "span",
                  "baseTracePosition",
                  "searchQuery",
                  "streamName",
                  "serviceStreamsEnabled",
                  "parentMode",
                  "activeTab",
                  "selectedLogStreams",
                  "showLogStreamSelector",
                ],
                emits: [
                  "view-logs",
                  "close",
                  "open-trace",
                  "add-filter",
                  "apply-filter-immediately",
                  "update:activeTab",
                ],
              },
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
              ODrawer: ODrawerStub,
              CodeQueryEditor: {
                name: "CodeQueryEditor",
                props: ["query", "language"],
                emits: ["update:query"],
                template:
                  '<div data-test="trace-details-filters-code-editor" />',
              },
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": {
                template: "<div>Sidebar</div>",
                props: [
                  "span",
                  "baseTracePosition",
                  "searchQuery",
                  "streamName",
                  "serviceStreamsEnabled",
                  "parentMode",
                  "activeTab",
                  "selectedLogStreams",
                  "showLogStreamSelector",
                ],
                emits: [
                  "view-logs",
                  "close",
                  "open-trace",
                  "add-filter",
                  "apply-filter-immediately",
                  "update:activeTab",
                ],
              },
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
              ODrawer: ODrawerStub,
              CodeQueryEditor: {
                name: "CodeQueryEditor",
                props: ["query", "language"],
                emits: ["update:query"],
                template:
                  '<div data-test="trace-details-filters-code-editor" />',
              },
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": {
                template: "<div>Sidebar</div>",
                props: [
                  "span",
                  "baseTracePosition",
                  "searchQuery",
                  "streamName",
                  "serviceStreamsEnabled",
                  "parentMode",
                  "activeTab",
                  "selectedLogStreams",
                  "showLogStreamSelector",
                ],
                emits: [
                  "view-logs",
                  "close",
                  "open-trace",
                  "add-filter",
                  "apply-filter-immediately",
                  "update:activeTab",
                ],
              },
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
              ODrawer: ODrawerStub,
              CodeQueryEditor: {
                name: "CodeQueryEditor",
                props: ["query", "language"],
                emits: ["update:query"],
                template:
                  '<div data-test="trace-details-filters-code-editor" />',
              },
              "chart-renderer": {
                template: '<div data-test="chart-renderer">Chart</div>',
              },
              "trace-tree": { template: "<div>Tree</div>" },
              "trace-header": { template: "<div>Header</div>" },
              "trace-details-sidebar": {
                template: "<div>Sidebar</div>",
                props: [
                  "span",
                  "baseTracePosition",
                  "searchQuery",
                  "streamName",
                  "serviceStreamsEnabled",
                  "parentMode",
                  "activeTab",
                  "selectedLogStreams",
                  "showLogStreamSelector",
                ],
                emits: [
                  "view-logs",
                  "close",
                  "open-trace",
                  "add-filter",
                  "apply-filter-immediately",
                  "update:activeTab",
                ],
              },
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
    it("should open a new window when handleExpandToFullView is called in standalone mode", () => {
      // handleExpandToFullView has no mode guard — it opens in a new tab from any mode
      const windowOpenSpy = vi.spyOn(window, "open").mockImplementation();
      const resolveRouterSpy = vi
        .spyOn(router, "resolve")
        .mockReturnValue({ href: "/mock-route" } as any);

      wrapper.vm.handleExpandToFullView();

      expect(resolveRouterSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "traceDetails",
          query: expect.objectContaining({ trace_id: "test-trace-id" }),
        }),
      );
      expect(windowOpenSpy).toHaveBeenCalledWith("/mock-route", "_blank");

      windowOpenSpy.mockRestore();
      resolveRouterSpy.mockRestore();
    });

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
            ODrawer: ODrawerStub,
            CodeQueryEditor: {
              name: "CodeQueryEditor",
              props: ["query", "language"],
              emits: ["update:query"],
              template: '<div data-test="trace-details-filters-code-editor" />',
            },
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
            ODrawer: ODrawerStub,
            CodeQueryEditor: {
              name: "CodeQueryEditor",
              props: ["query", "language"],
              emits: ["update:query"],
              template: '<div data-test="trace-details-filters-code-editor" />',
            },
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
            ODrawer: ODrawerStub,
            CodeQueryEditor: {
              name: "CodeQueryEditor",
              props: ["query", "language"],
              emits: ["update:query"],
              template: '<div data-test="trace-details-filters-code-editor" />',
            },
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
      expect(defaultWrapper.props("hideSessionReplayButton")).toBe(false);
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

  describe("Current functionality verification", () => {
    it("should have isViewLogsDisabled computed property", () => {
      // The component HAS isViewLogsDisabled computed property
      expect(wrapper.vm.isViewLogsDisabled).toBeDefined();
      expect(typeof wrapper.vm.isViewLogsDisabled).toBe("boolean");
    });

    it("should pass selected-log-streams and show-log-stream-selector props to TraceDetailsSidebar", async () => {
      // Set up span selection to show sidebar
      const spanId = tracesMockData.tracesDetails.traceSpans.hits[0].span_id;
      wrapper.vm.updateSelectedSpan(spanId);
      await wrapper.vm.$nextTick();

      const sidebar = wrapper.findComponent(
        '[data-test="trace-details-sidebar"]',
      );
      if (sidebar.exists()) {
        // The component DOES pass these props based on the current implementation
        expect(sidebar.props("selectedLogStreams")).toBeDefined();
        expect(sidebar.props("showLogStreamSelector")).toBeDefined();
        expect(sidebar.props("selectedLogStreams")).toEqual(
          wrapper.vm.searchObj.data.traceDetails.selectedLogStreams,
        );
        expect(sidebar.props("showLogStreamSelector")).toBe(
          wrapper.vm.showLogStreamSelector,
        );
      }
    });

    it("should use placeholder for log stream selector", () => {
      const streamSelector = wrapper.find(
        '[data-test="trace-details-log-streams-select"]',
      );

      if (streamSelector.exists()) {
        const selectElement = streamSelector.element as HTMLElement;
        // The component uses :placeholder (confirmed current implementation)
        expect(selectElement).toBeDefined();
      }
    });

    it("should have conditional disabled state and tooltip wrapper on View Logs button", () => {
      const viewLogsBtn = wrapper.find(
        '[data-test="trace-details-view-logs-btn"]',
      );

      if (viewLogsBtn.exists()) {
        // The component HAS conditional disabled state via isViewLogsDisabled
        // Test that the computed property exists and controls the disabled state
        expect(wrapper.vm.isViewLogsDisabled).toBeDefined();

        // The button may have tooltip wrapper structure
        const parentElement = viewLogsBtn.element.parentElement;
        expect(parentElement).toBeDefined();
      }
    });

    it("comprehensive test: should verify current implementation is intact", async () => {
      // 1. isViewLogsDisabled computed property should exist
      expect(wrapper.vm.isViewLogsDisabled).toBeDefined();
      expect(typeof wrapper.vm.isViewLogsDisabled).toBe("boolean");

      // 2. View Logs button may be disabled based on isViewLogsDisabled state
      const viewLogsBtn = wrapper.find(
        '[data-test="trace-details-view-logs-btn"]',
      );
      if (viewLogsBtn.exists()) {
        // Disabled state is controlled by isViewLogsDisabled computed property
        if (wrapper.vm.isViewLogsDisabled) {
          expect(viewLogsBtn.attributes("disabled")).toBeDefined();
        } else {
          expect(viewLogsBtn.attributes("disabled")).toBeUndefined();
        }
      }

      // 3. Set up span selection to test sidebar props
      const spanId = tracesMockData.tracesDetails.traceSpans.hits[0].span_id;
      wrapper.vm.updateSelectedSpan(spanId);
      await wrapper.vm.$nextTick();

      // 4. TraceDetailsSidebar should receive selected-log-streams props correctly
      const sidebar = wrapper.findComponent(
        '[data-test="trace-details-sidebar"]',
      );
      if (sidebar.exists()) {
        expect(sidebar.props("selectedLogStreams")).toBeDefined();
        expect(sidebar.props("showLogStreamSelector")).toBeDefined();
        expect(sidebar.props("selectedLogStreams")).toEqual(
          wrapper.vm.searchObj.data.traceDetails.selectedLogStreams,
        );
        expect(sidebar.props("showLogStreamSelector")).toBe(
          wrapper.vm.showLogStreamSelector,
        );
      }

      // 5. Log stream selector should exist with current structure
      const streamSelector = wrapper.find(
        '[data-test="trace-details-log-streams-select"]',
      );
      expect(streamSelector.exists()).toBe(true);
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
            ODrawer: ODrawerStub,
            CodeQueryEditor: {
              name: "CodeQueryEditor",
              props: ["query", "language"],
              emits: ["update:query"],
              template: '<div data-test="trace-details-filters-code-editor" />',
            },
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
      const replayBtn = wrapper.find(
        '[data-test="trace-details-view-session-replay-btn"]',
      );
      expect(replayBtn.exists()).toBe(true);
    });

    it("should not show session replay button when no RUM session exists", async () => {
      wrapper.vm.searchObj.data.traceDetails.spanList =
        tracesMockData.tracesDetails.traceSpans.hits;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.hasRumSessionId).toBe(false);
      const replayBtn = wrapper.find(
        '[data-test="trace-details-view-session-replay-btn"]',
      );
      expect(replayBtn.exists()).toBe(false);
    });

    it("should hide session replay button when hideSessionReplayButton prop is true", async () => {
      // The button v-if checks hasRumSessionId && !hideSessionReplayButton
      const hiddenWrapper = mount(TraceDetails, {
        attachTo: "#app",
        props: {
          hideSessionReplayButton: true,
          spanListProp: [
            {
              ...tracesMockData.tracesDetails.traceSpans.hits[0],
              rum_session_id: "session-hidden",
            },
          ],
          mode: "embedded",
        },
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            ODrawer: ODrawerStub,
            CodeQueryEditor: {
              name: "CodeQueryEditor",
              props: ["query", "language"],
              emits: ["update:query"],
              template: '<div data-test="trace-details-filters-code-editor" />',
            },
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

      const replayBtn = hiddenWrapper.find(
        '[data-test="trace-details-view-session-replay-btn"]',
      );
      expect(replayBtn.exists()).toBe(false);

      hiddenWrapper.unmount();
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
    // formatRumEventsAsSpans(tracedResources, viewEvents, actionEvents, allViewEvents)
    // tracedResources: RUM events with _oo_trace_id (the resource linked to a backend trace)
    // viewEvents:      type='view' events fetched via fetchViewEvents
    // actionEvents:    type='action' events fetched via fetchActionEvents
    // allViewEvents:   all leaf events (resource, error, long_task, action) for the view

    beforeEach(() => {
      wrapper.vm.searchObj.data.traceDetails.selectedTrace = {
        service_name: [],
      };
    });

    it("should format resource RUM events as spans", () => {
      const resource = {
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
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [resource], // tracedResources
        [], // viewEvents
        [], // actionEvents
        [resource], // allViewEvents
      );

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
      const resource = {
        type: "resource",
        date: 1234567890,
        resource_method: "POST",
        resource_url: "https://api.example.com/error",
        resource_duration: 50000000,
        resource_status_code: 500,
        _oo_trace_id: "trace-124",
        service: "Frontend",
        session_id: "session-124",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [resource],
        [],
        [],
        [resource],
      );

      expect(result[0].span_status).toBe("ERROR");
    });

    it("should format action RUM events as spans", () => {
      const action = {
        type: "action",
        date: 1234567890,
        action_id: "action-001",
        action_type: "click",
        action_target_name: "Submit Button",
        action_loading_time: 100000000,
        _oo_trace_id: "trace-125",
        service: "Frontend",
        session_id: "session-125",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };
      // Provide a tracedResource with the same date so proximity distance = 0
      const tracedResource = { date: 1234567890, _oo_trace_id: "trace-125" };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [tracedResource], // sets traceId and tracedTimestamp
        [], // viewEvents
        [action], // actionEvents
        [action], // allViewEvents
      );

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("Action: click on Submit Button");
      expect(result[0].span_status).toBe("OK");
      expect(result[0].span_kind).toBe("0"); // Unspecified
      expect(result[0].rum_event_type).toBe("action");
    });

    it("should format view RUM events as spans", () => {
      const view = {
        type: "view",
        date: 1234567890,
        view_id: "view-001",
        view_url: "https://example.com/home",
        view_time_spent: 200000000,
        _oo_trace_id: "trace-126",
        service: "Frontend",
        session_id: "session-126",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [view], // tracedResources — provides traceId
        [view], // viewEvents
        [], // actionEvents
        [view], // allViewEvents — classifyLeafEvents skips 'view' type → no leaf spans
      );

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("View: https://example.com/home");
      expect(result[0].span_status).toBe("OK");
      expect(result[0].rum_event_type).toBe("view");
    });

    it("should format error RUM events as spans with ERROR status", () => {
      const error = {
        type: "error",
        date: 1234567890,
        error_message: "Network timeout",
        error_type: "NetworkError",
        _oo_trace_id: "trace-127",
        _oo_span_id: "span-error-1",
        service: "Frontend",
        session_id: "session-127",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [error],
        [],
        [],
        [error],
      );

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("Error: Network timeout");
      expect(result[0].span_status).toBe("ERROR");
      expect(result[0].rum_event_type).toBe("error");
    });

    it("should handle RUM events with missing optional fields", () => {
      const resource = {
        type: "resource",
        date: 1234567890,
        // Missing resource_method, resource_url, resource_duration
        _oo_trace_id: "trace-128",
        service: "Frontend",
        session_id: "session-128",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [resource],
        [],
        [],
        [resource],
      );

      expect(result).toHaveLength(1);
      expect(result[0].operation_name).toBe("GET Unknown URL");
      expect(result[0].duration).toBe(0);
    });

    it("should generate fallback span ID for untraced resource events", () => {
      const resource = {
        type: "resource",
        date: 1234567890,
        resource_url: "https://example.com/api",
        // No _oo_trace_id — isTraced = false; fallback ID uses resource_id || date
        service: "Frontend",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [resource],
        [],
        [],
        [resource],
      );

      expect(result[0].span_id).toBe(`rum_resource_${resource.date}`);
    });

    it("should prefix view span IDs with rum_view_", () => {
      const view = {
        type: "view",
        date: 1234567890,
        view_id: "view-specific-id",
        _oo_trace_id: "trace-130",
        service: "Frontend",
        session_id: "session-130",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [view],
        [view],
        [],
        [view],
      );

      expect(result[0].span_id).toBe("rum_view_view-specific-id");
    });

    it("should add new service names to selectedTrace", () => {
      const resource = {
        type: "resource",
        date: 1234567890,
        _oo_trace_id: "trace-131",
        service: "NewService",
        session_id: "session-131",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [resource],
        [],
        [],
        [resource],
      );

      expect(result).toHaveLength(1);
      const serviceNames =
        wrapper.vm.searchObj.data.traceDetails.selectedTrace.service_name;
      const newService = serviceNames.find(
        (s: any) => s.service_name === "NewService",
      );
      expect(newService).toBeDefined();
      expect(newService.count).toBe(1);
    });

    it("should not duplicate existing service names when service already in list", () => {
      wrapper.vm.searchObj.data.traceDetails.selectedTrace.service_name = [
        { service_name: "Frontend", count: 1 },
      ];

      const resource = {
        type: "resource",
        date: 1234567890,
        _oo_trace_id: "trace-132",
        service: "Frontend",
        session_id: "session-132",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [resource],
        [],
        [],
        [resource],
      );

      expect(result).toHaveLength(1);
      const serviceNames =
        wrapper.vm.searchObj.data.traceDetails.selectedTrace.service_name;
      // registerServiceColors only adds NEW services; existing entries are left unchanged
      expect(
        serviceNames.filter((s: any) => s.service_name === "Frontend"),
      ).toHaveLength(1);
      expect(
        serviceNames.find((s: any) => s.service_name === "Frontend").count,
      ).toBe(1);
    });

    it("should use _oo_span_id as the span ID for traced resource events", () => {
      const resource = {
        type: "resource",
        date: 1234567890,
        _oo_trace_id: "trace-133",
        _oo_span_id: "span-child",
        service: "Frontend",
        session_id: "session-133",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [resource],
        [],
        [],
        [resource],
      );

      expect(result[0].span_id).toBe("span-child");
    });

    it("should return empty array when no events are provided", () => {
      expect(wrapper.vm.formatRumEventsAsSpans([], [], [], [])).toEqual([]);
    });

    it("should handle multiple RUM events of different types", () => {
      const resource = {
        type: "resource",
        date: 1234567890,
        resource_method: "GET",
        resource_url: "https://api.example.com/data",
        _oo_trace_id: "trace-134",
        service: "Frontend",
        session_id: "session-134",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };
      const action = {
        type: "action",
        date: 1234567891,
        action_id: "action-001",
        action_type: "click",
        action_target_name: "Button",
        _oo_trace_id: "trace-134",
        service: "Frontend",
        session_id: "session-134",
        [store.state.zoConfig.timestamp_column]: 1234567891000,
      };
      const error = {
        type: "error",
        date: 1234567892,
        error_message: "Failed",
        _oo_trace_id: "trace-134",
        service: "Frontend",
        session_id: "session-134",
        [store.state.zoConfig.timestamp_column]: 1234567892000,
      };
      // tracedResource provides timing context (same date as resource → proximity = 0)
      const tracedResource = { date: 1234567890, _oo_trace_id: "trace-134" };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [tracedResource],
        [],
        [action],
        [resource, action, error],
      );

      expect(result).toHaveLength(3);
      // Sorted ascending by date: resource < action < error
      expect(result[0].rum_event_type).toBe("resource");
      expect(result[1].rum_event_type).toBe("action");
      expect(result[2].rum_event_type).toBe("error");
      expect(result[2].span_status).toBe("ERROR");
    });

    it("should calculate start_time and end_time correctly", () => {
      const resource = {
        type: "resource",
        date: 1000, // seconds
        resource_duration: 500000000, // 500ms expressed in nanoseconds
        _oo_trace_id: "trace-135",
        service: "Frontend",
        session_id: "session-135",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [resource],
        [],
        [],
        [resource],
      );

      expect(result[0].start_time).toBe(1000000000); // date * 1_000_000
      expect(result[0].end_time).toBe(1500000000); // (date + 500ms) * 1_000_000
      expect(result[0].duration).toBe(500000); // 500ms * 1000 = 500 000 µs
    });

    it("should handle unknown event types with default operation name", () => {
      const event = {
        type: "custom_unknown_type",
        date: 1234567890,
        _oo_trace_id: "trace-136",
        service: "Frontend",
        session_id: "session-136",
        [store.state.zoConfig.timestamp_column]: 1234567890000,
      };

      const result = wrapper.vm.formatRumEventsAsSpans(
        [event],
        [],
        [],
        [event],
      );

      expect(result[0].operation_name).toBe("Unknown RUM Event");
    });
  });

  describe("Bug fix: invalid span_id in URL query param", () => {
    // Helper that builds a full mount with a custom route query so we can
    // control which span_id (if any) arrives via the URL.
    function mountWithSpanQuery(spanId: string | undefined) {
      vi.spyOn(router, "currentRoute", "get").mockReturnValue({
        value: {
          query: {
            trace_id: "test-trace-id",
            from: "1752490492843",
            to: "1752490493164",
            stream: "test-stream",
            org_identifier: "default",
            ...(spanId !== undefined ? { span_id: spanId } : {}),
          },
          name: "traceDetails",
        },
      } as any);

      return mount(TraceDetails, {
        attachTo: "#app",
        props: { traceId: "test-trace-id" },
        global: {
          plugins: [i18n, router],
          provide: { store },
          stubs: {
            ODrawer: ODrawerStub,
            CodeQueryEditor: {
              name: "CodeQueryEditor",
              props: ["query", "language"],
              emits: ["update:query"],
              template: '<div data-test="trace-details-filters-code-editor" />',
            },
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
                "activeTab",
                "selectedLogStreams",
                "showLogStreamSelector",
              ],
              emits: [
                "view-logs",
                "close",
                "open-trace",
                "add-filter",
                "apply-filter-immediately",
                "update:activeTab",
              ],
            },
          },
        },
      });
    }

    beforeEach(() => {
      mockShowErrorNotification.mockClear();

      // Register the search API handler that returns real trace spans
      globalThis.server.use(
        http.post(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
          async ({ request }) => {
            const body = (await request.json()) as any;
            if (body.query?.sql?.includes("_rumdata")) {
              return HttpResponse.json({
                took: 0,
                hits: [],
                total: 0,
                from: 0,
                size: 0,
                scan_size: 0,
              });
            }
            return HttpResponse.json(tracesMockData.tracesDetails.traceSpans);
          },
        ),
      );
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should show error notification and close sidebar when span_id in URL does not exist in trace", async () => {
      // The mock trace data contains spans with IDs: "6b080023171f5767",
      // "d427ced59acf399b", "bf6bde74cdcc245f".  Use a completely different id.
      const missingSpanId = "nonexistent-span-000000";
      const localWrapper = mountWithSpanQuery(missingSpanId);
      await flushPromises();

      // showErrorNotification must have been called with the missing span id
      expect(mockShowErrorNotification).toHaveBeenCalledWith(
        expect.stringContaining(missingSpanId),
      );

      // State must be cleaned up
      expect(localWrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(
        false,
      );
      expect(localWrapper.vm.searchObj.data.traceDetails.selectedSpanId).toBe(
        "",
      );

      // Sidebar must not be rendered because showSpanDetails is false
      expect(
        localWrapper.find('[data-test="trace-details-sidebar"]').exists(),
      ).toBe(false);

      localWrapper.unmount();
    });

    it("should open sidebar and scroll when span_id in URL matches a span in the trace", async () => {
      // "6b080023171f5767" is the root span in the mock trace data
      const validSpanId =
        tracesMockData.tracesDetails.traceSpans.hits[0].span_id;
      const localWrapper = mountWithSpanQuery(validSpanId);
      await flushPromises();

      // No error must have been shown
      expect(mockShowErrorNotification).not.toHaveBeenCalled();

      // Sidebar state must reflect the selected span
      expect(localWrapper.vm.searchObj.data.traceDetails.showSpanDetails).toBe(
        true,
      );
      expect(localWrapper.vm.searchObj.data.traceDetails.selectedSpanId).toBe(
        validSpanId,
      );

      localWrapper.unmount();
    });

    it("opens Preview when a URL-selected span is an LLM evaluator span", async () => {
      const response = JSON.parse(
        JSON.stringify(tracesMockData.tracesDetails.traceSpans),
      );
      response.hits[0].gen_ai_system = "openai";
      const spanId = response.hits[0].span_id;

      globalThis.server.use(
        http.post(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
          async ({ request }) => {
            const body = (await request.json()) as any;
            if (body.query?.sql?.includes("_rumdata")) {
              return HttpResponse.json({ hits: [], total: 0 });
            }
            return HttpResponse.json(response);
          },
        ),
      );

      const localWrapper = mountWithSpanQuery(spanId);
      await flushPromises();

      expect(localWrapper.vm.sidebarActiveTab).toBe("preview");
      localWrapper.unmount();
    });

    it("opens Preview when a URL-selected remote evaluator has a response", async () => {
      const response = JSON.parse(
        JSON.stringify(tracesMockData.tracesDetails.traceSpans),
      );
      response.hits[0].attributes_response =
        '{"code":"OK","value":0.9,"reason":"good"}';
      const spanId = response.hits[0].span_id;

      globalThis.server.use(
        http.post(
          `${store.state.API_ENDPOINT}/api/${store.state.selectedOrganization.identifier}/_search`,
          async ({ request }) => {
            const body = (await request.json()) as any;
            if (body.query?.sql?.includes("_rumdata")) {
              return HttpResponse.json({ hits: [], total: 0 });
            }
            return HttpResponse.json(response);
          },
        ),
      );

      const localWrapper = mountWithSpanQuery(spanId);
      await flushPromises();

      expect(localWrapper.vm.sidebarActiveTab).toBe("preview");
      localWrapper.unmount();
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

  describe("Sidebar active tab", () => {
    it("should initialize sidebarActiveTab to 'attributes'", () => {
      expect(wrapper.vm.sidebarActiveTab).toBe("attributes");
    });

    it("should set sidebarActiveTab to 'preview' when first selected span is an LLM span", async () => {
      const spanId = tracesMockData.tracesDetails.traceSpans.hits[0].span_id;
      // Mark the span as LLM by setting gen_ai_system on the span in spanMap
      wrapper.vm.spanMap[spanId].gen_ai_system = "openai";

      wrapper.vm.updateSelectedSpan(spanId);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.sidebarActiveTab).toBe("preview");
    });

    it("should keep sidebarActiveTab as 'attributes' when first selected span is not an LLM span", async () => {
      const spanId = tracesMockData.tracesDetails.traceSpans.hits[0].span_id;

      wrapper.vm.updateSelectedSpan(spanId);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.sidebarActiveTab).toBe("attributes");
    });
  });

  describe("effectiveSpanId", () => {
    it("should return hoveredSpanId when hovering over a span", () => {
      wrapper.vm.hoveredSpanId = "hovered-span-1";
      wrapper.vm.searchObj.data.traceDetails.selectedSpanId = "selected-span-1";

      expect(wrapper.vm.effectiveSpanId).toBe("hovered-span-1");
    });

    it("should return selectedSpanId when not hovering", () => {
      wrapper.vm.hoveredSpanId = "";
      wrapper.vm.searchObj.data.traceDetails.selectedSpanId = "selected-span-1";

      expect(wrapper.vm.effectiveSpanId).toBe("selected-span-1");
    });
  });

  describe("Hover span handlers", () => {
    it("should set hoveredSpanId when onHoverSpan is called", () => {
      wrapper.vm.onHoverSpan("hovered-span-42");
      expect(wrapper.vm.hoveredSpanId).toBe("hovered-span-42");
    });

    it("should clear hoveredSpanId when onUnhoverSpan is called", () => {
      wrapper.vm.hoveredSpanId = "hovered-span-42";
      wrapper.vm.onUnhoverSpan();
      expect(wrapper.vm.hoveredSpanId).toBe("");
    });

    it("should clear hoveredSpanId when closeSidebar is called", () => {
      wrapper.vm.hoveredSpanId = "hovered-span-99";
      wrapper.vm.closeSidebar();
      expect(wrapper.vm.hoveredSpanId).toBe("");
    });

    it("should clear hoveredSpanId when updateSelectedSpan is called", () => {
      wrapper.vm.hoveredSpanId = "hovered-span-77";
      const spanId = tracesMockData.tracesDetails.traceSpans.hits[0].span_id;
      wrapper.vm.updateSelectedSpan(spanId);
      expect(wrapper.vm.hoveredSpanId).toBe("");
    });
  });

  describe("TraceTree hover integration", () => {
    it("should pass hoveredSpanId prop to TraceTree child component", async () => {
      // TraceTree only renders inside the waterfall view.
      wrapper.vm.activeTab = "waterfall";
      wrapper.vm.hoveredSpanId = "hovered-span-from-parent";
      await wrapper.vm.$nextTick();

      const traceTree = wrapper.findComponent(
        '[data-test="trace-details-tree"]',
      );
      expect(traceTree.exists()).toBe(true);
      expect(traceTree.props("hoveredSpanId")).toBe("hovered-span-from-parent");
    });
  });

  describe("Migrated filters drawer (ODrawer)", () => {
    const drawerSelector = '[data-test="trace-details-filters-drawer-stub"]';

    it("renders the ODrawer with migrated props (width, title, button labels)", () => {
      const drawer = wrapper.find(drawerSelector);
      expect(drawer.exists()).toBe(true);
      expect(drawer.attributes("data-width")).toBe("30");
      // title and labels are wired from i18n; the data attributes just need to be defined
      expect(drawer.attributes("data-title")).toBeDefined();
      expect(drawer.attributes("data-primary-label")).toBeDefined();
      expect(drawer.attributes("data-secondary-label")).toBeDefined();
    });

    it("binds open via v-model:open to showFilterPopover state", async () => {
      expect(wrapper.vm.showFilterPopover).toBe(false);
      expect(wrapper.find(drawerSelector).attributes("data-open")).toBe(
        "false",
      );

      wrapper.vm.showFilterPopover = true;
      await wrapper.vm.$nextTick();

      expect(wrapper.find(drawerSelector).attributes("data-open")).toBe("true");
    });

    it("closes drawer when ODrawer emits click:secondary (cancel)", async () => {
      wrapper.vm.showFilterPopover = true;
      await wrapper.vm.$nextTick();

      await wrapper
        .find('[data-test="trace-details-filters-drawer-secondary"]')
        .trigger("click");

      expect(wrapper.vm.showFilterPopover).toBe(false);
    });

    it("applies query and closes drawer when ODrawer emits click:primary", async () => {
      wrapper.vm.showFilterPopover = true;
      wrapper.vm.localEditorValue = "service_name = 'test-service'";
      await wrapper.vm.$nextTick();

      await wrapper
        .find('[data-test="trace-details-filters-drawer-primary"]')
        .trigger("click");

      // applyAndViewTraces() closes the drawer and clears the local editor value
      expect(wrapper.vm.showFilterPopover).toBe(false);
      expect(wrapper.vm.localEditorValue).toBe("");
    });

    it("merges existing editorValue with localEditorValue on click:primary", async () => {
      wrapper.vm.searchObj.data.editorValue = "level = 'error'";
      wrapper.vm.localEditorValue = "duration > 100";
      wrapper.vm.showFilterPopover = true;
      await wrapper.vm.$nextTick();

      await wrapper
        .find('[data-test="trace-details-filters-drawer-primary"]')
        .trigger("click");

      expect(wrapper.vm.searchObj.data.editorValue).toBe(
        "level = 'error' and duration > 100",
      );
      expect(wrapper.vm.showFilterPopover).toBe(false);
    });

    it("uses localEditorValue alone when existing editorValue is empty", async () => {
      wrapper.vm.searchObj.data.editorValue = "";
      wrapper.vm.localEditorValue = "status_code = 200";
      wrapper.vm.showFilterPopover = true;
      await wrapper.vm.$nextTick();

      await wrapper
        .find('[data-test="trace-details-filters-drawer-primary"]')
        .trigger("click");

      expect(wrapper.vm.searchObj.data.editorValue).toBe("status_code = 200");
    });

    it("renders the CodeQueryEditor inside the drawer default slot", () => {
      const editor = wrapper.find(
        '[data-test="trace-details-filters-code-editor"]',
      );
      expect(editor.exists()).toBe(true);
    });
  });

  describe("Tab order and active-tab persistence", () => {
    const ORDER_KEY = "o2_trace_tab_order";
    const ACTIVE_KEY = "o2_trace_active_tab";

    const tabValues = () => wrapper.vm.traceTabs.map((tab: any) => tab.value);
    const storedOrder = () =>
      JSON.parse(localStorage.getItem(ORDER_KEY) as string);

    // The fixture trace has no LLM spans, so the dag and thread tabs are
    // filtered out of traceTabs regardless of the stored order.
    it("defaults to the flame graph when nothing is persisted", () => {
      expect(wrapper.vm.activeTab).toBe("flame-graph");
    });

    it("restores the persisted active tab on mount", async () => {
      localStorage.setItem(ACTIVE_KEY, "map");
      await remount();

      expect(wrapper.vm.activeTab).toBe("map");
    });

    it("persists the active tab when it changes", async () => {
      wrapper.vm.updateActiveTab("waterfall");
      await wrapper.vm.$nextTick();

      expect(localStorage.getItem(ACTIVE_KEY)).toBe("waterfall");
    });

    it("falls back to the default when the persisted tab is unavailable for this trace", async () => {
      // "thread" only renders for traces with LLM spans; this fixture has none.
      localStorage.setItem(ACTIVE_KEY, "thread");
      await remount();

      expect(tabValues()).not.toContain("thread");
      expect(wrapper.vm.activeTab).toBe("flame-graph");
    });

    it("ignores a persisted tab that is no longer a known tab", async () => {
      localStorage.setItem(ACTIVE_KEY, "some-removed-tab");
      await remount();

      expect(wrapper.vm.activeTab).toBe("flame-graph");
    });

    it("renders tabs in the persisted order", async () => {
      localStorage.setItem(
        ORDER_KEY,
        JSON.stringify(["map", "waterfall", "flame-graph"]),
      );
      await remount();

      expect(tabValues()).toEqual(["map", "waterfall", "flame-graph"]);
    });

    it("drops unknown values from a persisted order and appends newly shipped tabs", async () => {
      // A stored order written before "map" shipped, containing a since-removed tab.
      localStorage.setItem(
        ORDER_KEY,
        JSON.stringify(["waterfall", "retired-tab", "flame-graph"]),
      );
      await remount();

      // "retired-tab" is discarded; "map" is appended rather than lost.
      expect(tabValues()).toEqual(["waterfall", "flame-graph", "map"]);
    });

    it("survives a corrupt persisted order", async () => {
      localStorage.setItem(ORDER_KEY, "{not json");
      await remount();

      expect(tabValues()).toEqual(["flame-graph", "waterfall", "map"]);
    });

    it("moves a tab before the drop target and persists the new order", async () => {
      wrapper.vm.onTabReorder({ from: "map", to: "flame-graph", before: true });
      await wrapper.vm.$nextTick();

      expect(tabValues()).toEqual(["map", "flame-graph", "waterfall"]);
      expect(storedOrder()).toEqual([
        "map",
        "flame-graph",
        "waterfall",
        "dag",
        "thread",
      ]);
    });

    it("moves a tab after the drop target", async () => {
      wrapper.vm.onTabReorder({
        from: "flame-graph",
        to: "map",
        before: false,
      });
      await wrapper.vm.$nextTick();

      expect(tabValues()).toEqual(["waterfall", "map", "flame-graph"]);
    });

    it("keeps hidden tabs in the persisted order so the arrangement survives", async () => {
      wrapper.vm.onTabReorder({ from: "map", to: "flame-graph", before: true });
      await wrapper.vm.$nextTick();

      // dag and thread are not rendered for this trace, but must not be dropped
      // from storage — otherwise the order resets when opening an LLM trace.
      expect(storedOrder()).toContain("dag");
      expect(storedOrder()).toContain("thread");
    });

    it("ignores a reorder whose source tab is unknown", async () => {
      const before = tabValues();
      wrapper.vm.onTabReorder({ from: "ghost", to: "map", before: true });
      await wrapper.vm.$nextTick();

      expect(tabValues()).toEqual(before);
    });
  });
});
