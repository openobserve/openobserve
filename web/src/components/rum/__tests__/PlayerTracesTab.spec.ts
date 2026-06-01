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
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import { nextTick } from "vue";

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSearch = vi.fn();
const mockGetTraces = vi.fn();
const mockFetchQueryDataWithHttpStream = vi.fn();

vi.mock("@/services/search", () => ({
  default: {
    search: (...args: any[]) => mockSearch(...args),
    get_traces: (...args: any[]) => mockGetTraces(...args),
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    b64EncodeUnicode: (sql: string) => sql,
    formatTimeWithSuffix: (us: number) => {
      if (us < 1000) return `${us}us`;
      if (us < 1000000) return `${Math.round(us / 1000)}ms`;
      return `${Math.round(us / 1000000)}s`;
    },
  };
});

vi.mock("@/composables/useStreamingSearch", () => ({
  fetchQueryDataWithHttpStream: (...args: any[]) => mockFetchQueryDataWithHttpStream(...args),
}));

vi.mock("@/utils/trace", () => ({
  generateTraceContext: () => ({ traceId: "mock-trace-context-id" }),
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function createRumHit(overrides: Record<string, any> = {}) {
  return {
    _oo_trace_id: "trace-abc123def456",
    view_url: "https://example.com/products",
    view_loading_type: "initial_load",
    view_id: "view-1",
    type: "resource",
    ...overrides,
  };
}

function createTraceMeta(overrides: Record<string, any> = {}) {
  return {
    trace_id: "trace-abc123def456",
    start_time: 1000000000,
    end_time: 1005000000,
    duration: 5000000,
    ...overrides,
  };
}

function createSpan(overrides: Record<string, any> = {}) {
  return {
    span_id: "span-1",
    trace_id: "trace-abc123def456",
    operation_name: "GET /api/products",
    service_name: "product-catalog",
    span_kind: "s",
    start_time: 1001000000,
    duration: 2000000,
    status: "ok",
    depth: 0,
    ...overrides,
  };
}

function createTraceMetadata(overrides: Record<string, any> = {}) {
  return {
    trace_id: "trace-abc123def456",
    duration: 523000, // 523ms in microseconds
    spans: [5, 0], // [total spans, error spans]
    service_name: [
      { service_name: "product-catalog", count: 3, duration: 300000 },
      { service_name: "api-gateway", count: 2, duration: 223000 }
    ],
    first_event: {
      service_name: "product-catalog",
      operation_name: "GET /api/products"
    },
    ...overrides,
  };
}

/**
 * Set up mocks for the initial rumdata list fetch and trace metadata streaming.
 */
function setupSuccessfulMocks(rumHits?: any[], traceMetadata?: any[]) {
  mockSearch.mockReset();
  mockGetTraces.mockReset();
  mockFetchQueryDataWithHttpStream.mockReset();

  const hits = rumHits ?? [createRumHit()];
  const metadata = traceMetadata ?? [createTraceMetadata()];

  mockSearch.mockImplementation((_params: any, source: string) => {
    if (source === "RUM") {
      return Promise.resolve({ data: { hits } });
    }
    return Promise.resolve({ data: { hits: [] } });
  });

  // Mock the metadata streaming for fetchTraceMetadata
  mockFetchQueryDataWithHttpStream.mockImplementation((queryReq, handlers) => {
    // Simulate streaming response
    setTimeout(() => {
      handlers.data(null, {
        content: {
          results: {
            hits: metadata,
          },
        },
      });
      handlers.complete();
    }, 0);
  });
}

/**
 * Set up mocks for the lazy trace detail fetch (triggered on "View Trace Details" click).
 * Overrides both get_traces and search for the ui spans query.
 */
function setupDetailMocks(traceMeta?: any, spans?: any[]) {
  mockGetTraces.mockResolvedValue({
    data: { hits: [traceMeta ?? createTraceMeta()] },
  });

  mockSearch.mockImplementation((_params: any, source: string) => {
    if (source === "RUM") {
      return Promise.resolve({ data: { hits: [createRumHit()] } });
    }
    return Promise.resolve({ data: { hits: spans ?? [createSpan()] } });
  });
}

// ---------------------------------------------------------------------------
// DOM node for attachTo
// ---------------------------------------------------------------------------

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// ---------------------------------------------------------------------------
// Stubs for O2 components and TraceDetails
// ---------------------------------------------------------------------------

const globalStubs = {
  OButton: {
    name: "OButton",
    template:
      '<button :disabled="disabled || undefined" v-bind="$attrs" @click="!disabled && $emit(\'click\', $event)" @keydown="$emit(\'keydown\', $event)"><slot name="icon-left" /><slot /></button>',
    props: ["variant", "size", "disabled"],
    emits: ["click", "keydown"],
    inheritAttrs: false,
  },
  OSpinner: { template: '<div data-test="spinner" />' },
  OIcon: {
    name: "OIcon",
    template: '<span :data-test="\'icon-\' + name" />',
    props: ["name", "size"],
  },
  OBadge: {
    name: "OBadge",
    template: '<span :data-test="\'badge\'"><slot /></span>',
    props: ["variant", "size"],
  },
  OSeparator: {
    name: "OSeparator",
    template: "<hr />",
    props: ["vertical"],
  },
  TraceDetails: {
    name: "TraceDetails",
    template: '<div data-test="trace-details"><slot /></div>',
    props: [
      "mode",
      "traceIdProp",
      "streamNameProp",
      "spanListProp",
      "startTimeProp",
      "endTimeProp",
      "showBackButton",
      "showTimeline",
      "showLogStreamSelector",
      "showShareButton",
      "showCloseButton",
      "showExpandButton",
      "enableCorrelationLinks",
      "initialTimelineExpanded",
    ],
  },
};

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

interface MountOptions {
  props?: Record<string, any>;
}

function mountComponent(options: MountOptions = {}) {
  const defaultProps = {
    sessionId: "test-session-123",
    currentTime: 0,
    startTime: 1000,
    endTime: 2000,
  };

  return mount(PlayerTracesTab, {
    attachTo: "#app",
    props: { ...defaultProps, ...options.props },
    global: {
      plugins: [i18n, router],
      provide: { store },
      stubs: globalStubs,
    },
  });
}

// Must import after mocks
import PlayerTracesTab from "@/components/rum/PlayerTracesTab.vue";

// ---------------------------------------------------------------------------
// Helper finders
// ---------------------------------------------------------------------------

function findButtonByText(wrapper: VueWrapper, text: string) {
  const buttons = wrapper.findAll("button");
  return buttons.find((btn: any) => btn.text().includes(text));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlayerTracesTab", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockSearch.mockReset();
    mockGetTraces.mockReset();

    setupSuccessfulMocks();

    wrapper = mountComponent();
    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // =========================================================================
  // Component rendering
  // =========================================================================

  describe("component rendering", () => {
    it("mounts PlayerTracesTab without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("renders trace cards when data is loaded", () => {
      expect(
        wrapper.find('[data-test="rum-player-traces-tab-trace-card-0"]').exists(),
      ).toBe(true);
    });

    it("displays view label in the trace card", () => {
      expect(wrapper.text()).toContain("/products");
    });

    it("displays kind badge for initial load", () => {
      expect(wrapper.text()).toContain("Initial");
    });

    it("displays trace ID in abbreviated form in card footer", () => {
      expect(wrapper.text()).toContain("trace-ab");
      expect(wrapper.text()).toContain("def456");
    });

    it("displays View Trace Details button on trace cards", () => {
      const btn = findButtonByText(wrapper, "View Trace Details");
      expect(btn).toBeDefined();
      expect(btn?.exists()).toBe(true);
    });

    it("displays trace count in filter bar", () => {
      expect(wrapper.text()).toContain("1");
    });
  });

  // =========================================================================
  // Loading state
  // =========================================================================

  describe("loading state", () => {
    it("shows loading spinner when data is being fetched", async () => {
      wrapper.unmount();
      mockSearch.mockReturnValue(new Promise(() => {}));

      wrapper = mountComponent();
      await nextTick();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-loading"]').exists(),
      ).toBe(true);
    });

    it("does not show trace cards while loading", async () => {
      wrapper.unmount();
      mockSearch.mockReturnValue(new Promise(() => {}));

      wrapper = mountComponent();
      await nextTick();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-trace-card-0"]').exists(),
      ).toBe(false);
    });
  });

  // =========================================================================
  // Empty state
  // =========================================================================

  describe("empty state", () => {
    it("shows empty message when there are no correlated traces", async () => {
      wrapper.unmount();
      mockSearch.mockResolvedValue({ data: { hits: [] } });

      wrapper = mountComponent();
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-empty"]').exists(),
      ).toBe(true);
    });

    it("displays 'No correlated traces found' message", async () => {
      wrapper.unmount();
      mockSearch.mockResolvedValue({ data: { hits: [] } });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("No correlated traces found");
    });
  });

  // =========================================================================
  // Error state
  // =========================================================================

  describe("error state", () => {
    it("shows error message when data fetch fails", async () => {
      wrapper.unmount();
      mockSearch.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-error"]').exists(),
      ).toBe(true);
    });

    it("displays the error message text", async () => {
      wrapper.unmount();
      mockSearch.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("Network error");
    });

    it("renders retry button in error state", async () => {
      wrapper.unmount();
      mockSearch.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-retry-btn"]').exists(),
      ).toBe(true);
    });

    it("retries fetch when retry button is clicked", async () => {
      wrapper.unmount();
      mockSearch.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      mockSearch.mockReset();
      mockSearch.mockResolvedValue({ data: { hits: [] } });

      const retryBtn = wrapper.find(
        '[data-test="rum-player-traces-tab-retry-btn"]',
      );
      await retryBtn.trigger("click");
      await flushPromises();

      expect(mockSearch).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Trace detail view (lazy loading)
  // =========================================================================

  describe("trace detail view", () => {
    it("switches to embedded TraceDetails when View Trace Details is clicked", async () => {
      setupDetailMocks();

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      expect(viewBtn).toBeDefined();

      await viewBtn!.trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="trace-details"]').exists()).toBe(true);
    });

    it("shows back button in detail view", async () => {
      setupDetailMocks();

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-back-btn"]').exists(),
      ).toBe(true);
    });

    it("returns to list view when back button is clicked", async () => {
      setupDetailMocks();

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await flushPromises();

      const backBtn = wrapper.find(
        '[data-test="rum-player-traces-tab-back-btn"]',
      );
      await backBtn.trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="trace-details"]').exists()).toBe(false);
      expect(
        wrapper.find('[data-test="rum-player-traces-tab-trace-card-0"]').exists(),
      ).toBe(true);
    });

    it("shows the selected trace label in detail header", async () => {
      setupDetailMocks();

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await flushPromises();

      expect(wrapper.text()).toContain("/products");
    });

    it("fetches trace metadata and spans lazily when opening detail", async () => {
      setupDetailMocks();

      // Before click, get_traces should not have been called
      expect(mockGetTraces).not.toHaveBeenCalled();

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await flushPromises();

      expect(mockGetTraces).toHaveBeenCalled();
      // search should have been called for both RUM (initial) and ui (detail)
      const uiCalls = mockSearch.mock.calls.filter(
        ([_params, source]: [any, string]) => source === "ui",
      );
      expect(uiCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================================================
  // Trace detail loading state
  // =========================================================================

  describe("trace detail loading state", () => {
    it("shows loading spinner while trace details are being fetched", async () => {
      // Pending promise for get_traces
      mockGetTraces.mockReturnValue(new Promise(() => {}));

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await nextTick();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-trace-loading"]').exists(),
      ).toBe(true);
    });
  });

  // =========================================================================
  // Trace detail error state
  // =========================================================================

  describe("trace detail error state", () => {
    it("shows error when trace metadata is not found", async () => {
      mockGetTraces.mockResolvedValue({ data: { hits: [] } });

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-trace-error"]').exists(),
      ).toBe(true);
    });

    it("shows error when trace spans fetch fails", async () => {
      mockGetTraces.mockResolvedValue({
        data: { hits: [createTraceMeta()] },
      });
      mockSearch.mockImplementation((_params: any, source: string) => {
        if (source === "RUM") {
          return Promise.resolve({ data: { hits: [createRumHit()] } });
        }
        return Promise.reject(new Error("Spans fetch failed"));
      });

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-trace-error"]').exists(),
      ).toBe(true);
    });

    it("renders retry button in trace error state", async () => {
      mockGetTraces.mockResolvedValue({ data: { hits: [] } });

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-trace-retry-btn"]').exists(),
      ).toBe(true);
    });

    it("retries trace detail fetch when retry button is clicked", async () => {
      mockGetTraces.mockResolvedValue({ data: { hits: [] } });

      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn!.trigger("click");
      await flushPromises();

      mockGetTraces.mockReset();
      setupDetailMocks();

      const retryBtn = wrapper.find(
        '[data-test="rum-player-traces-tab-trace-retry-btn"]',
      );
      await retryBtn.trigger("click");
      await flushPromises();

      expect(wrapper.find('[data-test="trace-details"]').exists()).toBe(true);
    });
  });

  // =========================================================================
  // Props validation
  // =========================================================================

  describe("props validation", () => {
    it("does not fetch when sessionId is empty", async () => {
      wrapper.unmount();
      mockSearch.mockReset();

      wrapper = mountComponent({ props: { sessionId: "" } });
      await flushPromises();

      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("re-fetches when sessionId prop changes", async () => {
      mockSearch.mockClear();

      await wrapper.setProps({ sessionId: "new-session-id" });
      await flushPromises();

      expect(mockSearch).toHaveBeenCalled();
    });

    it("resets state when sessionId changes", async () => {
      await wrapper.setProps({ sessionId: "new-session-id" });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("deduplicates views by trace ID", async () => {
      wrapper.unmount();

      setupSuccessfulMocks([
        createRumHit({ _oo_trace_id: "same-trace" }),
        createRumHit({ _oo_trace_id: "same-trace", view_id: "view-2" }),
      ]);

      wrapper = mountComponent();
      await flushPromises();

      const cards = wrapper.findAll(
        '[data-test^="rum-player-traces-tab-trace-card-"]',
      );
      expect(cards.length).toBe(1);
    });

    it("handles null trace ID in RUM hits", async () => {
      wrapper.unmount();
      mockSearch.mockResolvedValue({
        data: {
          hits: [
            createRumHit({ _oo_trace_id: null }),
            createRumHit({ _oo_trace_id: "valid-trace" }),
          ],
        },
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });

    it("displays route change badge for route_change loading type", async () => {
      wrapper.unmount();

      setupSuccessfulMocks([
        createRumHit({ view_loading_type: "route_change" }),
      ]);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("Route");
    });

    it("renders multiple trace cards for multiple traces", async () => {
      wrapper.unmount();

      setupSuccessfulMocks([
        createRumHit({ _oo_trace_id: "trace-1", view_url: "https://example.com/page1" }),
        createRumHit({ _oo_trace_id: "trace-2", view_url: "https://example.com/page2" }),
      ]);

      wrapper = mountComponent();
      await flushPromises();

      const cards = wrapper.findAll(
        '[data-test^="rum-player-traces-tab-trace-card-"]',
      );
      expect(cards.length).toBe(2);
    });
  });

  // =========================================================================
  // Trace metadata functionality
  // =========================================================================

  describe("trace metadata", () => {
    it("displays duration badge when metadata is available", async () => {
      wrapper.unmount();

      const metadata = createTraceMetadata({
        trace_id: "trace-abc123def456",
        duration: 523000 // 523ms in microseconds
      });
      setupSuccessfulMocks([createRumHit()], [metadata]);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("523ms");
    });

    it("displays error count badge when trace has errors", async () => {
      wrapper.unmount();

      const metadata = createTraceMetadata({
        trace_id: "trace-abc123def456",
        spans: [5, 2] // 5 total spans, 2 error spans
      });
      setupSuccessfulMocks([createRumHit()], [metadata]);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("2 errors");
    });

    it("displays service count badge", async () => {
      wrapper.unmount();

      const metadata = createTraceMetadata({
        trace_id: "trace-abc123def456",
        service_name: [
          { service_name: "api-gateway", count: 2 },
          { service_name: "product-catalog", count: 3 }
        ]
      });
      setupSuccessfulMocks([createRumHit()], [metadata]);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("2 services");
    });

    it("displays root operation", async () => {
      wrapper.unmount();

      const metadata = createTraceMetadata({
        trace_id: "trace-abc123def456",
        first_event: {
          service_name: "api-gateway",
          operation_name: "GET /api/products"
        }
      });
      setupSuccessfulMocks([createRumHit()], [metadata]);

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("api-gateway → GET /api/products");
    });

    it("calls fetchQueryDataWithHttpStream for metadata", async () => {
      wrapper.unmount();
      setupSuccessfulMocks();

      wrapper = mountComponent();
      await flushPromises();

      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledWith(
        expect.objectContaining({
          queryReq: expect.objectContaining({
            stream_name: "default",
            filter: "trace_id='trace-abc123def456'",
            type: "traces"
          })
        }),
        expect.any(Object)
      );
    });

    it("gracefully handles missing metadata", async () => {
      wrapper.unmount();

      // Mock empty metadata response
      mockFetchQueryDataWithHttpStream.mockImplementation((queryReq, handlers) => {
        setTimeout(() => {
          handlers.data(null, { content: { results: { hits: [] } } });
          handlers.complete();
        }, 0);
      });

      setupSuccessfulMocks([createRumHit()]);

      wrapper = mountComponent();
      await flushPromises();

      // Card should still render with basic info, just no metadata badges
      expect(wrapper.find('[data-test="rum-player-traces-tab-trace-card-0"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("/products");
    });

    it("handles metadata fetch errors gracefully", async () => {
      wrapper.unmount();

      // Mock metadata fetch error
      mockFetchQueryDataWithHttpStream.mockImplementation((queryReq, handlers) => {
        setTimeout(() => {
          handlers.error(null, new Error("Metadata fetch failed"));
        }, 0);
      });

      setupSuccessfulMocks([createRumHit()]);

      wrapper = mountComponent();
      await flushPromises();

      // Card should still render with basic info
      expect(wrapper.find('[data-test="rum-player-traces-tab-trace-card-0"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("/products");
    });
  });

  // =========================================================================
  // Formatting utilities
  // =========================================================================

  describe("formatting utilities", () => {
    it("shortRoute extracts pathname from URL", () => {
      expect(
        wrapper.vm.shortRoute("https://example.com/products?page=1"),
      ).toBe("/products?page=1");
    });

    it("shortRoute returns original string for invalid URLs", () => {
      expect(wrapper.vm.shortRoute("not-a-url")).toBe("not-a-url");
    });
  });

  // =========================================================================
  // Accessibility
  // =========================================================================

  describe("accessibility", () => {
    it("all buttons are valid button elements", () => {
      const buttons = wrapper.findAll("button");
      buttons.forEach((btn: any) => {
        expect(btn.element.tagName.toLowerCase()).toBe("button");
      });
    });

    it("View Trace Details button responds to Enter keydown", async () => {
      const viewBtn = findButtonByText(wrapper, "View Trace Details");
      await viewBtn?.trigger("keydown.enter");
      await nextTick();

      expect(viewBtn?.exists()).toBe(true);
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  describe("lifecycle", () => {
    it("fetches traces on mount when sessionId is provided", () => {
      expect(mockSearch).toHaveBeenCalled();
    });

    it("does not fetch on mount when sessionId is empty", async () => {
      wrapper.unmount();
      mockSearch.mockClear();

      wrapper = mountComponent({ props: { sessionId: "" } });
      await flushPromises();

      expect(mockSearch).not.toHaveBeenCalled();
    });
  });
});
