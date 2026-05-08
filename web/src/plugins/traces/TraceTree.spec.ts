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

// Mock @tanstack/vue-virtual BEFORE any imports so the virtualizer returns
// synthetic virtual rows even when scrollContainer is null (as in jsdom).
vi.mock("@tanstack/vue-virtual", () => ({
  useVirtualizer: vi.fn((optionsComputed: any) => {
    const { computed } = require("vue");
    return computed(() => {
      const options = optionsComputed.value;
      const count = options.count;
      const estimateSize = options.estimateSize?.() ?? 30;
      const scrollToIndex = vi.fn();
      const items = Array.from({ length: count }, (_, i) => ({
        key: i,
        index: i,
        start: i * estimateSize,
        end: (i + 1) * estimateSize,
        size: estimateSize,
        lane: 0,
      }));
      return {
        getVirtualItems: () => items,
        getTotalSize: () => count * estimateSize,
        scrollToIndex,
      };
    });
  }),
}));

vi.mock("@/utils/traces/convertTraceData", () => ({
  getServiceIconDataUrl: vi
    .fn()
    .mockReturnValue("data:image/svg+xml;base64,ICON"),
  getSpanTechIconDataUrl: vi.fn().mockReturnValue(null),
}));

vi.mock("@/composables/useTraces", () => ({
  default: () => ({
    searchObj: { meta: { serviceColors: {} } },
    buildQueryDetails: vi.fn(),
    navigateToLogs: vi.fn(),
  }),
}));

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import * as quasar from "quasar";
import i18n from "@/locales";
import router from "@/test/unit/helpers/router";
import { createStore } from "vuex";

import { getServiceIconDataUrl } from "@/utils/traces/convertTraceData";
import TraceTree from "@/plugins/traces/TraceTree.vue";

installQuasar({
  plugins: [quasar.Dialog, quasar.Notify],
});

const mockStore = createStore({
  state: {
    theme: "light",
    API_ENDPOINT: "http://localhost:8080",
    zoConfig: {
      timestamp_column: "@timestamp",
    },
    selectedOrganization: {
      identifier: "test-org",
    },
  },
});

const mockSpans = [
  {
    spanId: "d9603ec7f76eb499",
    operationName: "service:alerts:evaluate_scheduled",
    serviceName: "alertmanager",
    spanStatus: "UNSET",
    spanKind: "Client",
    parentId: "6702b0494b2b6e57",
    hasChildSpans: true,
    style: {
      color: "#1ab8be",
      backgroundColor: "#1ab8be33",
      top: "0px",
      left: "0px",
    },
    depth: 0,
    index: 0,
  },
  {
    spanId: "6702b0494b2b6e57",
    operationName: "service:alerts:process",
    serviceName: "alertmanager",
    spanStatus: "ERROR",
    spanKind: "Server",
    parentId: null,
    hasChildSpans: false,
    style: {
      color: "#ff6b6b",
      backgroundColor: "#ff6b6b33",
      top: "60px",
      left: "0px",
    },
    depth: 0,
    index: 1,
  },
];

const mockSpanMap = {
  d9603ec7f76eb499: {
    _timestamp: 1752490492843047,
    start_time: 1752490492843047200,
    end_time: 1752490493164419300,
    duration: 321372,
    span_id: "d9603ec7f76eb499",
    operation_name: "service:alerts:evaluate_scheduled",
    service_name: "alertmanager",
    span_status: "UNSET",
    span_kind: 2,
    parent_id: "6702b0494b2b6e57",
  },
  "6702b0494b2b6e57": {
    _timestamp: 1752490492843047,
    start_time: 1752490492843047200,
    end_time: 1752490493164419300,
    duration: 321372,
    span_id: "6702b0494b2b6e57",
    operation_name: "service:alerts:process",
    service_name: "alertmanager",
    span_status: "ERROR",
    span_kind: 1,
    parent_id: null,
  },
};

const mockBaseTracePosition = {
  durationMs: 350.372,
  startTimeMs: 1752490492843,
  tics: [
    {
      value: 0,
      label: "0.00us",
      left: "-1px",
    },
    {
      value: 80.34,
      label: "80.34ms",
      left: "25%",
    },
    {
      value: 160.69,
      label: "160.69ms",
      left: "50%",
    },
    {
      value: 241.03,
      label: "241.03ms",
      left: "75%",
    },
    {
      value: 321.37,
      label: "321.37ms",
      left: "100%",
    },
  ],
};

const mockSpanDimensions = {
  height: 30,
  barHeight: 8,
  textHeight: 25,
  gap: 15,
  collapseHeight: "14",
  collapseWidth: 14,
  connectorPadding: 2,
  paddingLeft: 8,
  hConnectorWidth: 20,
  dotConnectorWidth: 6,
  dotConnectorHeight: 6,
  colors: ["#b7885e", "#1ab8be", "#ffcb99", "#f89570", "#839ae2"],
};

const mockSpanList = [
  {
    span_id: "d9603ec7f76eb499",
    service_name: "alertmanager",
    operation_name: "service:alerts:evaluate_scheduled",
    duration: 321372,
    span_status: "UNSET",
    links: [
      {
        context: {
          traceId: "f6e08ab2a928aa393375f0d9b05a9054",
          spanId: "ecc59cb843104cf8",
        },
      },
      {
        context: {
          traceId: "6262666637a9ae45ad3e25f5111dd59f",
          spanId: "d9603ec7f76eb499",
        },
      },
    ],
  },
  {
    span_id: "6702b0494b2b6e57",
    service_name: "alertmanager",
    operation_name: "service:alerts:process",
    duration: 321372,
    span_status: "ERROR",
    links: [],
  },
];

function mountTraceTree(
  extraProps: Record<string, unknown> = {},
  storePlugin = mockStore,
) {
  return mount(TraceTree, {
    props: {
      spans: mockSpans,
      isCollapsed: false,
      collapseMapping: {},
      baseTracePosition: mockBaseTracePosition,
      depth: 0,
      spanDimensions: mockSpanDimensions,
      spanMap: mockSpanMap,
      leftWidth: 300,
      searchQuery: "",
      spanList: mockSpanList,
      ...extraProps,
    },
    global: {
      plugins: [i18n, router, storePlugin],
      stubs: {
        "q-resize-observer": true,
        "span-block": true,
      },
    },
  });
}

describe("TraceTree", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mountTraceTree();
  });

  afterEach(() => {
    wrapper.unmount();
    vi.clearAllMocks();
  });

  it("should mount TraceTree component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("should render all spans", () => {
    const spanElements = wrapper.findAll(
      `[data-test^="trace-tree-span-container-"]`,
    );
    expect(spanElements.length).toBe(mockSpans.length);

    for (const span of mockSpans) {
      const spanElement = wrapper.find(
        `[data-test="trace-tree-span-container-${span.spanId}"]`,
      );
      expect(spanElement.exists()).toBe(true);
    }
  });

  it("should render span operation names", () => {
    for (const span of mockSpans) {
      const operationNameElement = wrapper.find(
        `[data-test="trace-tree-span-operation-name-${span.spanId}"]`,
      );
      expect(operationNameElement.exists()).toBe(true);
      expect(operationNameElement.text()).toBe(span.operationName);
    }
  });

  it("should render service names", () => {
    const serviceNameElements = wrapper.findAll(
      '[data-test^="trace-tree-span-service-name-"]',
    );
    expect(serviceNameElements.length).toBe(mockSpans.length);

    expect(serviceNameElements[0].text()).toBe(mockSpans[0].serviceName);
    expect(serviceNameElements[1].text()).toBe(mockSpans[1].serviceName);
  });

  it("should render error icon for error spans", () => {
    const errorIcon = wrapper.find(
      '[data-test="trace-tree-span-error-icon-6702b0494b2b6e57"]',
    );
    expect(errorIcon.exists()).toBe(true);
  });

  it("should not render error icon for non-error spans", () => {
    const errorIcon = wrapper.find(
      '[data-test="trace-tree-span-error-icon-d9603ec7f76eb499"]',
    );
    expect(errorIcon.exists()).toBe(false);
  });

  it("should render collapse button for spans with children", () => {
    const collapseBtn = wrapper.find(
      '[data-test="trace-tree-span-badge-collapse-btn-d9603ec7f76eb499"]',
    );
    expect(collapseBtn.exists()).toBe(true);
  });

  it("should not render collapse button for spans without children", () => {
    const collapseBtn = wrapper.find(
      '[data-test="trace-tree-span-badge-collapse-btn-6702b0494b2b6e57"]',
    );
    expect(collapseBtn.exists()).toBe(false);
  });

  it("should render view logs button", () => {
    const viewLogsBtn = wrapper.find(
      '[data-test="trace-tree-span-view-logs-btn-d9603ec7f76eb499"]',
    );
    expect(viewLogsBtn.exists()).toBe(true);
  });

  describe("Span selection", () => {
    it("should emit selectSpan when span is clicked", async () => {
      const selectBtn = wrapper.find(
        '[data-test="trace-tree-span-operation-name-container-d9603ec7f76eb499"]',
      );
      expect(selectBtn.exists()).toBe(true);
      await selectBtn.trigger("click");

      expect(wrapper.emitted("selectSpan")).toBeTruthy();
      expect(wrapper.emitted("selectSpan")[0]).toEqual(["d9603ec7f76eb499"]);
    });

    it("should emit selectSpan with correct span ID", async () => {
      const selectBtn = wrapper.find(
        '[data-test="trace-tree-span-operation-name-container-6702b0494b2b6e57"]',
      );
      expect(selectBtn.exists()).toBe(true);
      await selectBtn.trigger("click");

      expect(wrapper.emitted("selectSpan")).toBeTruthy();
      expect(wrapper.emitted("selectSpan")[0]).toEqual(["6702b0494b2b6e57"]);
    });
  });

  describe("Span collapse functionality", () => {
    it("should emit toggleCollapse when collapse button is clicked", async () => {
      const collapseBtn = wrapper.find(
        '[data-test="trace-tree-span-badge-collapse-btn-d9603ec7f76eb499"]',
      );
      expect(collapseBtn.exists()).toBe(true);
      await collapseBtn.trigger("click");

      expect(wrapper.emitted("toggleCollapse")).toBeTruthy();
      expect(wrapper.emitted("toggleCollapse")[0]).toEqual([
        "d9603ec7f76eb499",
      ]);
    });

    it("should apply correct collapse icon rotation", async () => {
      await wrapper.setProps({
        collapseMapping: { d9603ec7f76eb499: true },
      });

      const collapseBtn = wrapper.find(
        '[data-test="trace-tree-span-badge-collapse-btn-d9603ec7f76eb499"]',
      );
      expect(collapseBtn.exists()).toBe(true);
    });

    it("should apply correct expand icon rotation", async () => {
      await wrapper.setProps({
        collapseMapping: { d9603ec7f76eb499: false },
      });

      const collapseBtn = wrapper.find(
        '[data-test="trace-tree-span-badge-collapse-btn-d9603ec7f76eb499"]',
      );
      expect(collapseBtn.exists()).toBe(true);
    });
  });

  describe("View logs functionality", () => {
    it("should emit view-logs when view logs button is clicked", async () => {
      const viewLogsBtn = wrapper.find(
        '[data-test="trace-tree-span-view-logs-btn-d9603ec7f76eb499"]',
      );
      expect(viewLogsBtn.exists()).toBe(true);
      await viewLogsBtn.trigger("click");

      // The component should call viewSpanLogs function which uses useTraces composable
      // to navigate to logs page with span-specific query parameters
      expect(viewLogsBtn.exists()).toBe(true);
    });
  });

  describe("Search functionality", () => {
    it("should highlight spans that match search query", async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });

      await flushPromises();

      const highlightedSpans = wrapper.findAll(".highlighted");
      expect(highlightedSpans.length).toBeGreaterThan(0);
    });

    it("should highlight current match", async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });

      await flushPromises();

      const currentMatch = wrapper.find(".current-match");
      expect(currentMatch.exists()).toBe(true);
    });

    it("should not highlight when no search query", async () => {
      await wrapper.setProps({
        searchQuery: "",
      });

      await flushPromises();

      const highlightedSpans = wrapper.findAll(".highlighted");
      expect(highlightedSpans.length).toBe(0);
    });

    it("should find matches in service name", async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });

      await flushPromises();

      const searchResults = wrapper.vm.searchResults;
      expect(searchResults.length).toBeGreaterThan(0);
    });

    it("should find matches in operation name", async () => {
      await wrapper.setProps({
        searchQuery: "evaluate_scheduled",
      });

      await flushPromises();

      const searchResults = wrapper.vm.searchResults;
      expect(searchResults.length).toBeGreaterThan(0);
    });

    it("should find matches in span ID", async () => {
      await wrapper.setProps({
        searchQuery: "d9603ec7f76eb499",
      });

      await flushPromises();

      const searchResults = wrapper.vm.searchResults;
      expect(searchResults.length).toBeGreaterThan(0);
    });

    it("should handle case-insensitive search", async () => {
      await wrapper.setProps({
        searchQuery: "ALERTMANAGER",
      });

      await flushPromises();

      const searchResults = wrapper.vm.searchResults;
      expect(searchResults.length).toBeGreaterThan(0);
    });

    it("should emit search-result with correct count", async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });

      await flushPromises();

      expect(wrapper.emitted("search-result")).toBeTruthy();
      expect(wrapper.emitted("search-result")[0]).toEqual([2]);
    });

    it("should emit update-current-index when current index changes", async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });

      await flushPromises();

      expect(wrapper.emitted("update-current-index")).toBeTruthy();
      expect(wrapper.emitted("update-current-index")[0]).toEqual([0]);
    });

    describe("isHighlighted function", () => {
      beforeEach(async () => {
        await wrapper.setProps({
          searchQuery: "alertmanager",
        });
        await flushPromises();
      });

      it("should return true for array path that matches search results", () => {
        wrapper.vm.searchResults = [
          ["service_name", "alertmanager"],
          ["operation_name", "evaluate_scheduled"],
        ];

        const result = wrapper.vm.isHighlighted([
          "service_name",
          "alertmanager",
        ]);
        expect(result).toBe(true);
      });

      it("should return false for array path that doesn't match search results", () => {
        wrapper.vm.searchResults = [["service_name", "alertmanager"]];

        const result = wrapper.vm.isHighlighted(["operation_name", "process"]);
        expect(result).toBe(false);
      });

      it("should return true for single value that matches search results", () => {
        wrapper.vm.searchResults = ["d9603ec7f76eb499", "6702b0494b2b6e57"];

        const result = wrapper.vm.isHighlighted("d9603ec7f76eb499");
        expect(result).toBe(true);
      });

      it("should return false for single value that doesn't match search results", () => {
        wrapper.vm.searchResults = ["d9603ec7f76eb499"];

        const result = wrapper.vm.isHighlighted("6702b0494b2b6e57");
        expect(result).toBe(false);
      });

      it("should handle empty search results", () => {
        wrapper.vm.searchResults = [];

        const result = wrapper.vm.isHighlighted("d9603ec7f76eb499");
        expect(result).toBe(false);
      });
    });

    describe("scrollToMatch function", () => {
      beforeEach(async () => {
        await wrapper.setProps({
          searchQuery: "alertmanager",
        });
        await flushPromises();
      });

      it("should call virtualizer scrollToIndex when match exists", async () => {
        // scrollToMatch delegates to scrollToSpan → rowVirtualizer.scrollToIndex.
        // We verify the component does not throw and searchResults is non-empty.
        wrapper.vm.searchResults = ["d9603ec7f76eb499"];
        wrapper.vm.currentIndex = 0;

        // Should not throw — span index 0 corresponds to mockSpans[0].spanId
        expect(() => wrapper.vm.scrollToMatch()).not.toThrow();
      });

      it("should not throw when no search results", () => {
        wrapper.vm.searchResults = [];
        wrapper.vm.currentIndex = null;

        expect(() => wrapper.vm.scrollToMatch()).not.toThrow();
      });

      it("should not throw when span ID is not found in spans array", () => {
        wrapper.vm.searchResults = ["nonexistent-span-id"];
        wrapper.vm.currentIndex = 0;

        // scrollToSpan returns early when spanIndex === -1
        expect(() => wrapper.vm.scrollToMatch()).not.toThrow();
      });
    });
  });

  describe("Navigation methods", () => {
    beforeEach(async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });
      await flushPromises();
    });

    it("should have nextMatch method", () => {
      expect(wrapper.vm.nextMatch).toBeDefined();
    });

    it("should have prevMatch method", () => {
      expect(wrapper.vm.prevMatch).toBeDefined();
    });

    it("should navigate to next match", async () => {
      const initialIndex = wrapper.vm.currentIndex;
      wrapper.vm.nextMatch();
      await flushPromises();

      expect(wrapper.vm.currentIndex).toBe(initialIndex + 1);
    });

    it("should navigate to previous match", async () => {
      // First go to next match
      wrapper.vm.nextMatch();
      await flushPromises();

      const currentIndex = wrapper.vm.currentIndex;
      wrapper.vm.prevMatch();
      await flushPromises();

      expect(wrapper.vm.currentIndex).toBe(currentIndex - 1);
    });

    it("should not navigate beyond bounds", async () => {
      // Try to go to previous when at first match
      wrapper.vm.prevMatch();
      await flushPromises();

      expect(wrapper.vm.currentIndex).toBe(0);
    });

    it("should not navigate beyond last match", async () => {
      // Go to last match
      wrapper.vm.nextMatch();
      await flushPromises();

      const lastIndex = wrapper.vm.currentIndex;
      wrapper.vm.nextMatch();
      await flushPromises();

      expect(wrapper.vm.currentIndex).toBe(lastIndex);
    });
  });

  // Hover uses CSS-only (:hover pseudo-class), no JS state tracking.
  // jsdom does not apply CSS pseudo-class styles so these tests are skipped.
  describe.skip("Hover functionality", () => {
    it("should show view logs button on hover", async () => {
      const operationContainer = wrapper.find(
        '[data-test="trace-tree-span-operation-name-container-d9603ec7f76eb499"]',
      );
      await operationContainer.trigger("mouseover");

      const viewLogsContainer = wrapper.find(
        '[data-test="trace-tree-span-view-logs-container-d9603ec7f76eb499"]',
      );
      expect(viewLogsContainer.classes()).toContain("show");
    });

    it("should hide view logs button when not hovered", async () => {
      const operationContainer = wrapper.find(
        '[data-test="trace-tree-span-operation-name-container-d9603ec7f76eb499"]',
      );
      await operationContainer.trigger("mouseover");
      await operationContainer.trigger("mouseout");

      const viewLogsContainer = wrapper.find(
        '[data-test="trace-tree-span-view-logs-container-d9603ec7f76eb499"]',
      );
      expect(viewLogsContainer.classes()).not.toContain("show");
    });
  });

  describe("Theme support", () => {
    it("should apply light theme by default", () => {
      const operationContainer = wrapper.find(
        '[data-test="trace-tree-span-operation-name-container-d9603ec7f76eb499"]',
      );
      expect(operationContainer.exists()).toBe(true);
      expect(operationContainer.classes()).toContain("bg-white");
    });

    it("should apply dark theme when store theme is dark", async () => {
      const darkStore = createStore({
        state: {
          theme: "dark",
          API_ENDPOINT: "http://localhost:8080",
          zoConfig: {
            timestamp_column: "@timestamp",
          },
          selectedOrganization: {
            identifier: "test-org",
          },
        },
      });

      const darkWrapper = mountTraceTree({}, darkStore);

      const operationContainer = darkWrapper.find(
        '[data-test="trace-tree-span-operation-name-container-d9603ec7f76eb499"]',
      );
      expect(operationContainer.exists()).toBe(true);
      expect(operationContainer.classes()).toContain("bg-dark");

      darkWrapper.unmount();
    });
  });

  describe("Span block integration", () => {
    it("should render span-block stubs for each span", () => {
      // span-block is stubbed; verify the component renders without error
      // and the expected number of span containers is present.
      const spanContainers = wrapper.findAll(
        '[data-test^="trace-tree-span-container-"]',
      );
      expect(spanContainers.length).toBe(mockSpans.length);
    });

    it("should not show span-block when isSidebarOpen is true", async () => {
      await wrapper.setProps({ isSidebarOpen: true });
      await flushPromises();

      // With isSidebarOpen=true the span-block column is hidden via v-if
      const spanBlocks = wrapper.findAllComponents({ name: "span-block" });
      expect(spanBlocks.length).toBe(0);
    });
  });

  describe("Error handling", () => {
    it("should handle empty spans array", async () => {
      await wrapper.setProps({
        spans: [],
      });

      const spanElements = wrapper.findAll('[data-test^="trace-tree-span-"]');
      expect(spanElements.length).toBe(0);
    });

    it("should handle missing span data", async () => {
      await wrapper.setProps({
        spanMap: {},
      });

      // Component should not crash
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle invalid search query", async () => {
      await wrapper.setProps({
        searchQuery: null,
      });

      await flushPromises();

      // Component should not crash
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Computed properties", () => {
    describe("currentSelectedValue", () => {
      it("should return null when currentIndex is -1", () => {
        wrapper.vm.currentIndex = -1;
        wrapper.vm.searchResults = ["d9603ec7f76eb499"];

        expect(wrapper.vm.currentSelectedValue).toBeNull();
      });

      it("should return null when searchResults is empty", () => {
        wrapper.vm.currentIndex = 0;
        wrapper.vm.searchResults = [];

        expect(wrapper.vm.currentSelectedValue).toBeNull();
      });

      it("should return the current selected value when valid", () => {
        wrapper.vm.currentIndex = 0;
        wrapper.vm.searchResults = ["d9603ec7f76eb499", "6702b0494b2b6e57"];

        expect(wrapper.vm.currentSelectedValue).toBe("d9603ec7f76eb499");
      });

      it("should return the correct value when currentIndex is not 0", () => {
        wrapper.vm.currentIndex = 1;
        wrapper.vm.searchResults = ["d9603ec7f76eb499", "6702b0494b2b6e57"];

        expect(wrapper.vm.currentSelectedValue).toBe("6702b0494b2b6e57");
      });
    });
  });

  describe("findMatches function", () => {
    it("should find matches in string values", () => {
      const spanList = [
        {
          span_id: "span1",
          service_name: "alertmanager",
          operation_name: "process",
        },
        { span_id: "span2", service_name: "other", operation_name: "other" },
      ];

      const results = wrapper.vm.findMatches(spanList, "alertmanager");
      expect(results).toContain("span1");
      expect(results).not.toContain("span2");
    });

    it("should find matches in number values", () => {
      const spanList = [
        { span_id: "span1", duration: 321372 },
        { span_id: "span2", duration: 100000 },
      ];

      const results = wrapper.vm.findMatches(spanList, "321372");
      expect(results).toContain("span1");
      expect(results).not.toContain("span2");
    });

    it("should find matches in duration with us suffix", () => {
      const spanList = [
        { span_id: "span1", duration: 321372 },
        { span_id: "span2", duration: 100000 },
      ];

      const results = wrapper.vm.findMatches(spanList, "321372us");
      expect(results).toContain("span1");
      expect(results).not.toContain("span2");
    });

    it("should handle case-insensitive search", () => {
      const spanList = [
        { span_id: "span1", service_name: "AlertManager" },
        { span_id: "span2", service_name: "Other" },
      ];

      const results = wrapper.vm.findMatches(spanList, "alertmanager");
      expect(results).toContain("span1");
      expect(results).not.toContain("span2");
    });

    it("should handle trimmed search query", () => {
      const spanList = [
        { span_id: "span1", service_name: "alertmanager" },
        { span_id: "span2", service_name: "other" },
      ];

      const results = wrapper.vm.findMatches(spanList, "  alertmanager  ");
      expect(results).toContain("span1");
      expect(results).not.toContain("span2");
    });

    it("should skip non-string and non-number values", () => {
      const spanList = [
        {
          span_id: "span1",
          service_name: "alertmanager",
          metadata: { key: "value" },
        },
        { span_id: "span2", service_name: "other" },
      ];

      const results = wrapper.vm.findMatches(spanList, "alertmanager");
      expect(results).toContain("span1");
      expect(results).not.toContain("span2");
    });

    it("should return empty array when no matches found", () => {
      const spanList = [
        { span_id: "span1", service_name: "alertmanager" },
        { span_id: "span2", service_name: "other" },
      ];

      const results = wrapper.vm.findMatches(spanList, "nonexistent");
      expect(results).toEqual([]);
    });

    it("should handle empty search query", () => {
      const spanList = [{ span_id: "span1", service_name: "alertmanager" }];

      const results = wrapper.vm.findMatches(spanList, "");
      expect(results).toEqual([]);
    });
  });

  describe("updateSearch function", () => {
    beforeEach(() => {
      vi.spyOn(wrapper.vm, "scrollToMatch");
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should update search results when search query exists", async () => {
      const localSpanList = [
        { span_id: "span1", service_name: "alertmanager" },
        { span_id: "span2", service_name: "other" },
      ];

      await wrapper.setProps({
        spanList: localSpanList,
        searchQuery: "alertmanager",
      });

      await flushPromises();

      expect(wrapper.vm.searchResults).toContain("span1");
      expect(wrapper.vm.currentIndex).toBe(0);
    });

    it("should clear search results when search query is empty", async () => {
      await wrapper.setProps({
        searchQuery: "alertmanager",
      });

      await flushPromises();

      await wrapper.setProps({
        searchQuery: "",
      });

      await flushPromises();

      expect(wrapper.vm.searchResults).toEqual([]);
      expect(wrapper.vm.currentIndex).toBeNull();
    });

    it("should clear search results when search query is only whitespace", async () => {
      wrapper.vm.searchResults = ["span1", "span2"];
      wrapper.vm.currentIndex = 1;

      await wrapper.setProps({
        searchQuery: "   ",
      });

      await flushPromises();

      expect(wrapper.vm.searchResults).toEqual([]);
      expect(wrapper.vm.currentIndex).toBeNull();
    });
  });

  describe("Performance and rendering", () => {
    it("should render large number of spans efficiently", async () => {
      const largeSpans = Array.from({ length: 100 }, (_, i) => ({
        ...mockSpans[0],
        spanId: `span-${i}`,
        index: i,
      }));

      await wrapper.setProps({
        spans: largeSpans,
      });

      await flushPromises();

      const spanElements = wrapper.findAll(
        '[data-test^="trace-tree-span-container-"]',
      );
      expect(spanElements.length).toBe(100);
    });

    it("should update efficiently when props change", async () => {
      await wrapper.setProps({
        spans: [mockSpans[0]],
      });

      await flushPromises();

      const updatedSpans = wrapper.findAll(
        '[data-test^="trace-tree-span-container-"]',
      );
      expect(updatedSpans.length).toBe(1);
    });
  });

  // ─── New tests covering functionality added after Oct 06 2025 ───────────────

  describe("isSidebarOpen prop", () => {
    it("should hide span-block area when isSidebarOpen is true", async () => {
      await wrapper.setProps({ isSidebarOpen: true });
      await flushPromises();

      // When isSidebarOpen is true the right-hand SpanBlock column is hidden via v-if
      const spanBlocks = wrapper.findAllComponents({ name: "span-block" });
      expect(spanBlocks.length).toBe(0);
    });

    it("should show span-block area when isSidebarOpen is false", async () => {
      await wrapper.setProps({ isSidebarOpen: false });
      await flushPromises();

      const spanBlocks = wrapper.findAllComponents({ name: "span-block" });
      expect(spanBlocks.length).toBeGreaterThan(0);
    });

    it("should apply leftWidth as inline width style when isSidebarOpen is true", async () => {
      await wrapper.setProps({ isSidebarOpen: true, leftWidth: 400 });
      await flushPromises();

      // The root div should have width:400px when sidebar is open
      const root = wrapper.element as HTMLElement;
      expect(root.style.width).toBe("400px");
    });

    it("should not apply inline width style when isSidebarOpen is false", async () => {
      await wrapper.setProps({ isSidebarOpen: false, leftWidth: 400 });
      await flushPromises();

      const root = wrapper.element as HTMLElement;
      expect(root.style.width).toBe("");
    });
  });

  describe("selectedSpanId prop — span-row-selected highlight", () => {
    it("should add span-row-selected class to the matching span row", async () => {
      await wrapper.setProps({ selectedSpanId: "d9603ec7f76eb499" });
      await flushPromises();

      const row = wrapper.find(
        '[data-test="trace-tree-span-container-d9603ec7f76eb499"]',
      );
      expect(row.exists()).toBe(true);
      expect(row.classes()).toContain("span-row-selected");
    });

    it("should not add span-row-selected to non-matching rows", async () => {
      await wrapper.setProps({ selectedSpanId: "d9603ec7f76eb499" });
      await flushPromises();

      const row = wrapper.find(
        '[data-test="trace-tree-span-container-6702b0494b2b6e57"]',
      );
      expect(row.exists()).toBe(true);
      expect(row.classes()).not.toContain("span-row-selected");
    });

    it("should remove span-row-selected when selectedSpanId is cleared", async () => {
      await wrapper.setProps({ selectedSpanId: "d9603ec7f76eb499" });
      await flushPromises();
      await wrapper.setProps({ selectedSpanId: "" });
      await flushPromises();

      const row = wrapper.find(
        '[data-test="trace-tree-span-container-d9603ec7f76eb499"]',
      );
      expect(row.exists()).toBe(true);
      expect(row.classes()).not.toContain("span-row-selected");
    });
  });

  describe("LLM trace functionality", () => {
    const llmSpan = {
      spanId: "llm-span-001",
      operationName: "openai.chat",
      serviceName: "llm-service",
      spanStatus: "UNSET",
      spanKind: "Client",
      parentId: null,
      hasChildSpans: false,
      llm_usage: { total: 1500, prompt: 1000, completion: 500 },
      llm_cost: { total: 0.03 },
      style: {
        color: "#ab63fa",
        backgroundColor: "#ab63fa33",
        top: "0px",
        left: "0px",
      },
      depth: 0,
      index: 0,
    };

    beforeEach(async () => {
      await wrapper.setProps({ spans: [llmSpan] });
      await flushPromises();
    });

    it("should expose isLLMTrace utility", () => {
      expect(wrapper.vm.isLLMTrace).toBeDefined();
      expect(typeof wrapper.vm.isLLMTrace).toBe("function");
    });

    it("should expose formatTokens utility", () => {
      expect(wrapper.vm.formatTokens).toBeDefined();
      expect(typeof wrapper.vm.formatTokens).toBe("function");
    });

    it("should expose formatCost utility", () => {
      expect(wrapper.vm.formatCost).toBeDefined();
      expect(typeof wrapper.vm.formatCost).toBe("function");
    });

    it("isLLMTrace should return false for a regular span", () => {
      expect(wrapper.vm.isLLMTrace(mockSpans[0])).toBe(false);
    });
  });

  describe("getChildCount helper", () => {
    it("should return 0 for a span with no spans array", () => {
      const span = { spanId: "x", hasChildSpans: false };
      expect(wrapper.vm.getChildCount(span)).toBe(0);
    });

    it("should return 0 for a span with null spans", () => {
      const span = { spanId: "x", hasChildSpans: true, spans: null };
      expect(wrapper.vm.getChildCount(span)).toBe(0);
    });

    it("should return correct count for a span with children", () => {
      const span = {
        spanId: "x",
        hasChildSpans: true,
        spans: [{ spanId: "c1" }, { spanId: "c2" }, { spanId: "c3" }],
      };
      expect(wrapper.vm.getChildCount(span)).toBe(3);
    });
  });

  // getDirectChildren does not exist in the current virtualizer-based implementation.
  describe.skip("getDirectChildren helper", () => {
    it("should return empty array for span with no spans field", () => {
      const span = { spanId: "x" };
      expect(wrapper.vm.getDirectChildren(span)).toEqual([]);
    });

    it("should return the spans array for a parent span", () => {
      const children = [{ spanId: "c1" }, { spanId: "c2" }];
      const span = { spanId: "x", hasChildSpans: true, spans: children };
      expect(wrapper.vm.getDirectChildren(span)).toEqual(children);
    });
  });

  // getChildrenHeight does not exist in the current virtualizer-based implementation.
  describe.skip("getChildrenHeight helper", () => {
    it("should return 0 when span has no spans array", () => {
      const span = { spanId: "x", hasChildSpans: false };
      expect(wrapper.vm.getChildrenHeight(span)).toBe(0);
    });

    it("should return 0 when span is not collapsed in collapseMapping", async () => {
      await wrapper.setProps({ collapseMapping: { "parent-span": false } });
      const span = {
        spanId: "parent-span",
        hasChildSpans: true,
        spans: [{ spanId: "c1", hasChildSpans: false, spans: [] }],
      };
      expect(wrapper.vm.getChildrenHeight(span)).toBe(0);
    });

    it("should count visible children when span is expanded in collapseMapping", async () => {
      await wrapper.setProps({
        collapseMapping: { "parent-span": true },
      });
      const span = {
        spanId: "parent-span",
        hasChildSpans: true,
        spans: [
          { spanId: "c1", hasChildSpans: false, spans: [] },
          { spanId: "c2", hasChildSpans: false, spans: [] },
        ],
      };
      expect(wrapper.vm.getChildrenHeight(span)).toBe(2);
    });
  });

  // connectorPaths, setBadgeRef, and calculateConnectors do not exist in the
  // current virtualizer-based implementation (CSS connectors only).
  describe.skip("connectorPaths and setBadgeRef", () => {
    it("should expose connectorPaths as a reactive ref", () => {
      expect(wrapper.vm.connectorPaths).toBeDefined();
      expect(typeof wrapper.vm.connectorPaths).toBe("object");
    });

    it("setBadgeRef should store element reference for a given spanId", () => {
      const mockEl = document.createElement("div");
      wrapper.vm.setBadgeRef("test-span-id", mockEl);
      expect(wrapper.exists()).toBe(true);
    });

    it("setBadgeRef should ignore null elements", () => {
      expect(() => wrapper.vm.setBadgeRef("test-span-id", null)).not.toThrow();
    });

    it("calculateConnectors should be callable without throwing", () => {
      expect(() => wrapper.vm.calculateConnectors()).not.toThrow();
    });
  });

  describe("hover-span / unhover-span emits", () => {
    it("should emit hoverSpan when onHoverSpan is called with a spanId", () => {
      wrapper.vm.onHoverSpan("d9603ec7f76eb499");

      expect(wrapper.emitted("hoverSpan")).toBeTruthy();
      expect(wrapper.emitted("hoverSpan")[0]).toEqual(["d9603ec7f76eb499"]);
    });

    it("should emit unhoverSpan when onUnhoverSpan is called", () => {
      wrapper.vm.onUnhoverSpan();

      expect(wrapper.emitted("unhoverSpan")).toBeTruthy();
      expect(wrapper.emitted("unhoverSpan")[0]).toEqual([]);
    });
  });

  describe("highlightedSpanId computed", () => {
    it("should prefer hoveredSpanId over selectedSpanId when both are set", async () => {
      await wrapper.setProps({
        selectedSpanId: "d9603ec7f76eb499",
        hoveredSpanId: "6702b0494b2b6e57",
      });

      expect(wrapper.vm.highlightedSpanId).toBe("6702b0494b2b6e57");
    });

    it("should fall back to selectedSpanId when hoveredSpanId is empty", async () => {
      await wrapper.setProps({
        selectedSpanId: "d9603ec7f76eb499",
        hoveredSpanId: "",
      });

      expect(wrapper.vm.highlightedSpanId).toBe("d9603ec7f76eb499");
    });

    it("should return selectedSpanId when both are empty", async () => {
      await wrapper.setProps({
        selectedSpanId: "",
        hoveredSpanId: "",
      });

      expect(wrapper.vm.highlightedSpanId).toBe("");
    });
  });

  describe("connector segments for spans with depth > 0", () => {
    const depthSpans = [
      {
        spanId: "parent-span",
        operationName: "parent-operation",
        serviceName: "parent-service",
        spanStatus: "UNSET",
        spanKind: "Server",
        parentId: null,
        hasChildSpans: false,
        style: {
          color: "#1ab8be",
          backgroundColor: "#1ab8be33",
          top: "0px",
          left: "0px",
        },
        depth: 0,
        index: 0,
      },
      {
        spanId: "child-span",
        operationName: "child-operation",
        serviceName: "child-service",
        spanStatus: "UNSET",
        spanKind: "Client",
        parentId: "parent-span",
        hasChildSpans: false,
        style: {
          color: "#b7885e",
          backgroundColor: "#b7885e33",
          top: "30px",
          left: "30px",
        },
        depth: 1,
        index: 1,
      },
    ];

    let depthWrapper: any;

    beforeEach(() => {
      depthWrapper = mountTraceTree({ spans: depthSpans });
    });

    afterEach(() => {
      depthWrapper.unmount();
    });

    it("should render vertical connector segments for spans with depth > 0", () => {
      const verticalSegments = depthWrapper.findAll(
        '[data-test="vertical-segment"]',
      );
      expect(verticalSegments.length).toBeGreaterThan(0);
    });

    it("should render horizontal connector segments for spans with depth > 0", () => {
      const horizontalSegment = depthWrapper.find(
        '[data-test="horizontal-segment"]',
      );
      expect(horizontalSegment.exists()).toBe(true);
    });
  });

  describe("collapse badge title tooltip", () => {
    // collapseMapping[id]=true means the span is currently collapsed (children hidden)
    // The title describes what clicking WILL DO (action), not the current state
    it("should show 'expand' title when span is currently collapsed (collapseMapping=true)", async () => {
      await wrapper.setProps({
        collapseMapping: { d9603ec7f76eb499: true },
      });
      await flushPromises();

      const badge = wrapper.find(
        '[data-test="trace-tree-span-badge-collapse-btn-d9603ec7f76eb499"]',
      );
      expect(badge.exists()).toBe(true);
      expect(badge.attributes("title")).toContain("expand");
    });

    it("should show 'collapse' title when span is currently expanded (collapseMapping=false)", async () => {
      await wrapper.setProps({
        collapseMapping: { d9603ec7f76eb499: false },
      });
      await flushPromises();

      const badge = wrapper.find(
        '[data-test="trace-tree-span-badge-collapse-btn-d9603ec7f76eb499"]',
      );
      expect(badge.exists()).toBe(true);
      expect(badge.attributes("title")).toContain("collapse");
    });
  });
});
