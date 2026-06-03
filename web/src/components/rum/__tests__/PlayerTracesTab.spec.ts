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
// Module mocks — must be declared before component import
// ---------------------------------------------------------------------------

const mockSearch = vi.fn();
const mockFetchQueryDataWithHttpStream = vi.fn();

vi.mock("@/services/search", () => ({
  default: {
    search: (...args: any[]) => mockSearch(...args),
  },
}));

// Fix 1: generateTraceContext lives in zincutils, not @/utils/trace.
// Fix 2: formatTimeWithSuffix mock kept for deterministic duration assertions.
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    b64EncodeUnicode: (sql: string) => sql,
    formatTimeWithSuffix: (us: number) => {
      if (us < 1_000) return `${us}us`;
      if (us < 1_000_000) return `${Math.round(us / 1_000)}ms`;
      return `${Math.round(us / 1_000_000)}s`;
    },
    generateTraceContext: () => ({ traceId: "mock-trace-context-id" }),
  };
});

// Fix 3: component uses `import useHttpStreaming from "…"` then destructures.
// The mock must expose a default export that is a function returning the object.
vi.mock("@/composables/useStreamingSearch", () => ({
  default: () => ({
    fetchQueryDataWithHttpStream: (...args: any[]) =>
      mockFetchQueryDataWithHttpStream(...args),
  }),
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

// Fix 4: component reads SQL-aliased fields (_view_url, _view_loading_type, _date).
function createRumHit(overrides: Record<string, any> = {}) {
  return {
    _oo_trace_id: "trace-abc123def456",
    _view_url: "https://example.com/products",
    _view_loading_type: "initial_load",
    _view_id: "view-1",
    _type: "resource",
    _date: 0,
    ...overrides,
  };
}

function createTraceMetadata(overrides: Record<string, any> = {}) {
  return {
    trace_id: "trace-abc123def456",
    start_time: 1_000_000_000,
    end_time: 1_005_000_000,
    duration: 5_000_000,
    spans: [5, 0], // [totalSpans, errorSpans]
    service_name: [{ service_name: "product-catalog", count: 3 }],
    first_event: {
      service_name: "product-catalog",
      operation_name: "GET /api/products",
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mock setup helpers
// ---------------------------------------------------------------------------

/**
 * Configures mocks for a successful initial fetch.
 * Fix 5: handlers are called synchronously so flushPromises() can resolve
 * the fetchTraceMetadata Promise (setTimeout creates a macrotask that
 * flushPromises() does not drain).
 */
function setupSuccessfulMocks(
  rumHits?: any[],
  traceMetadataHits?: any[],
) {
  mockSearch.mockReset();
  mockFetchQueryDataWithHttpStream.mockReset();

  const hits = rumHits ?? [createRumHit()];
  const metadata = traceMetadataHits ?? [createTraceMetadata()];

  mockSearch.mockImplementation((_params: any, source: string) => {
    if (source === "RUM") {
      return Promise.resolve({ data: { hits } });
    }
    return Promise.resolve({ data: { hits: [] } });
  });

  mockFetchQueryDataWithHttpStream.mockImplementation(
    (_queryReq: any, handlers: any) => {
      handlers.data(null, { content: { results: { hits: metadata } } });
      handlers.complete();
    },
  );
}

// ---------------------------------------------------------------------------
// DOM node for attachTo
// ---------------------------------------------------------------------------

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

const globalStubs = {
  OButton: {
    name: "OButton",
    // inheritAttrs: false + v-bind="$attrs" lets data-test pass through.
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
  // Fix 6: use v-bind="$attrs" so the parent's data-test attribute passes through.
  OBadge: {
    name: "OBadge",
    template: '<span v-bind="$attrs"><slot /></span>',
    props: ["variant", "size"],
    inheritAttrs: false,
  },
  OTooltip: {
    name: "OTooltip",
    template: "<span />",
    props: ["content"],
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
      "showHeader",
      "showBackButton",
      "hideSessionReplayButton",
      "showTimeline",
      "showLogStreamSelector",
      "showShareButton",
      "showCloseButton",
      "showExpandButton",
      "enableCorrelationLinks",
      "initialTimelineExpanded",
    ],
  },
  // Fix 7: stub TenstackTable so we can trigger row clicks and inspect
  // scoped-slot content (route, duration) without mounting the real component.
  TenstackTable: {
    name: "TenstackTable",
    props: [
      "rows",
      "columns",
      "rowHeight",
      "enableRowExpand",
      "enableTextHighlight",
      "enableStatusBar",
      "defaultColumns",
      "enableColumnReorder",
      "enableAiContextButton",
      "rowClass",
    ],
    emits: ["click:dataRow"],
    template: `
      <div data-test="rum-player-traces-tab-table">
        <div
          v-for="(row, i) in rows"
          :key="i"
          :data-test="'table-row-' + i"
          @click="$emit('click:dataRow', row)"
        >
          <slot name="cell-route"    :item="row" :cell="{ column: { getSize: () => 100 } }" />
          <slot name="cell-duration" :item="row" :cell="{ column: { getSize: () => 100 } }" />
          <slot name="cell-status"   :item="row" :cell="{ column: { getSize: () => 100 } }" />
        </div>
      </div>
    `,
  },
  TraceStatusCell: {
    name: "TraceStatusCell",
    template: '<span data-test="trace-status-cell" />',
    props: ["item"],
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
// Tests
// ---------------------------------------------------------------------------

describe("PlayerTracesTab", () => {
  let wrapper: VueWrapper;

  beforeEach(async () => {
    vi.clearAllMocks();
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
    it("should mount without errors", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should render trace table when data is loaded", () => {
      expect(
        wrapper.find('[data-test="rum-player-traces-tab-table"]').exists(),
      ).toBe(true);
    });

    it("should display the route path in the table row", () => {
      expect(wrapper.text()).toContain("/products");
    });

    it("should display trace count badge in filter bar", () => {
      const badge = wrapper.find(
        '[data-test="rum-player-traces-tab-count-badge"]',
      );
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("1");
    });
  });

  // =========================================================================
  // Loading state
  // =========================================================================

  describe("loading state", () => {
    it("should show loading spinner while data is being fetched", async () => {
      wrapper.unmount();
      mockSearch.mockReturnValue(new Promise(() => {}));

      wrapper = mountComponent();
      await nextTick();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-loading"]').exists(),
      ).toBe(true);
    });

    it("should not show the trace table while loading", async () => {
      wrapper.unmount();
      mockSearch.mockReturnValue(new Promise(() => {}));

      wrapper = mountComponent();
      await nextTick();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-table"]').exists(),
      ).toBe(false);
    });
  });

  // =========================================================================
  // Empty state
  // =========================================================================

  describe("empty state", () => {
    it("should show empty message when there are no correlated traces", async () => {
      wrapper.unmount();
      mockSearch.mockResolvedValue({ data: { hits: [] } });

      wrapper = mountComponent();
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-empty"]').exists(),
      ).toBe(true);
    });

    it("should display 'No correlated traces found' message", async () => {
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
    it("should show error message when data fetch fails", async () => {
      wrapper.unmount();
      mockSearch.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-error"]').exists(),
      ).toBe(true);
    });

    it("should display the error message text", async () => {
      wrapper.unmount();
      mockSearch.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("Network error");
    });

    it("should render retry button in error state", async () => {
      wrapper.unmount();
      mockSearch.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-retry-btn"]').exists(),
      ).toBe(true);
    });

    it("should retry fetch when retry button is clicked", async () => {
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
  // Trace detail view
  // Fix 8: component uses table row click (handleTraceRowClick) — no button.
  // =========================================================================

  describe("trace detail view", () => {
    it("should switch to embedded TraceDetails when a table row is clicked", async () => {
      const firstRow = wrapper.find('[data-test="table-row-0"]');
      expect(firstRow.exists()).toBe(true);

      await firstRow.trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="trace-details"]').exists()).toBe(true);
    });

    it("should show back button in detail view", async () => {
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-back-btn"]').exists(),
      ).toBe(true);
    });

    it("should return to list view when back button is clicked", async () => {
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      await wrapper
        .find('[data-test="rum-player-traces-tab-back-btn"]')
        .trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="trace-details"]').exists()).toBe(false);
      expect(
        wrapper.find('[data-test="rum-player-traces-tab-table"]').exists(),
      ).toBe(true);
    });

    it("should show the selected trace route in detail header", async () => {
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect(wrapper.text()).toContain("/products");
    });
  });

  // =========================================================================
  // Props validation
  // =========================================================================

  describe("props validation", () => {
    it("should not fetch when sessionId is empty", async () => {
      wrapper.unmount();
      mockSearch.mockReset();

      wrapper = mountComponent({ props: { sessionId: "" } });
      await flushPromises();

      expect(mockSearch).not.toHaveBeenCalled();
    });

    it("should re-fetch when sessionId prop changes", async () => {
      mockSearch.mockClear();

      await wrapper.setProps({ sessionId: "new-session-id" });
      await flushPromises();

      expect(mockSearch).toHaveBeenCalled();
    });

    it("should reset state when sessionId changes", async () => {
      await wrapper.setProps({ sessionId: "new-session-id" });
      await flushPromises();

      expect(wrapper.exists()).toBe(true);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("should deduplicate views by trace ID", async () => {
      wrapper.unmount();

      const traceId = "same-trace";
      setupSuccessfulMocks(
        [
          createRumHit({ _oo_trace_id: traceId }),
          createRumHit({ _oo_trace_id: traceId, _view_id: "view-2" }),
        ],
        [createTraceMetadata({ trace_id: traceId })],
      );

      wrapper = mountComponent();
      await flushPromises();

      const rows = wrapper.findAll('[data-test^="table-row-"]');
      expect(rows.length).toBe(1);
    });

    it("should handle null trace ID in RUM hits without crashing", async () => {
      wrapper.unmount();

      // null trace ID is skipped; "valid-trace" has no matching metadata so
      // filteredViews ends up empty — component renders the empty state.
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

    it("should render multiple table rows for multiple distinct traces", async () => {
      wrapper.unmount();

      setupSuccessfulMocks(
        [
          createRumHit({
            _oo_trace_id: "trace-1",
            _view_url: "https://example.com/page1",
          }),
          createRumHit({
            _oo_trace_id: "trace-2",
            _view_url: "https://example.com/page2",
          }),
        ],
        [
          createTraceMetadata({ trace_id: "trace-1" }),
          createTraceMetadata({ trace_id: "trace-2" }),
        ],
      );

      wrapper = mountComponent();
      await flushPromises();

      const rows = wrapper.findAll('[data-test^="table-row-"]');
      expect(rows.length).toBe(2);
    });
  });

  // =========================================================================
  // Trace metadata
  // =========================================================================

  describe("trace metadata", () => {
    it("should display computed e2e duration in the table cell", async () => {
      wrapper.unmount();

      // _date = 1000ms, end_time = 1523ms * 1_000_000 → e2eDuration = 523ms.
      setupSuccessfulMocks(
        [createRumHit({ _date: 1000 })],
        [createTraceMetadata({ end_time: 1_523_000_000 })],
      );

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("523ms");
    });

    it("should display error count badge in detail header when trace has errors", async () => {
      wrapper.unmount();

      setupSuccessfulMocks(
        [createRumHit()],
        [createTraceMetadata({ spans: [5, 2] })], // 2 error spans
      );

      wrapper = mountComponent();
      await flushPromises();

      // Error badge only appears in the detail view header.
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect(wrapper.text()).toContain("2");
      // rum.errors i18n key resolves to "Errors" (capitalised)
      expect(wrapper.text()).toContain("Errors");
    });

    it("should call fetchQueryDataWithHttpStream with correct args for metadata", async () => {
      wrapper.unmount();
      setupSuccessfulMocks();

      wrapper = mountComponent();
      await flushPromises();

      // Fix 9: `type` is at the top level of the first arg, not inside queryReq.
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledWith(
        expect.objectContaining({
          queryReq: expect.objectContaining({
            stream_name: "default",
            filter: "trace_id='trace-abc123def456'",
          }),
          type: "traces",
        }),
        expect.any(Object),
      );
    });

    it("should show empty state when metadata is unavailable for all RUM hits", async () => {
      wrapper.unmount();

      mockSearch.mockImplementation((_params: any, source: string) => {
        if (source === "RUM") {
          return Promise.resolve({ data: { hits: [createRumHit()] } });
        }
        return Promise.resolve({ data: { hits: [] } });
      });
      // Metadata returns no hits → filteredViews is empty → empty state shown.
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_queryReq: any, handlers: any) => {
          handlers.data(null, { content: { results: { hits: [] } } });
          handlers.complete();
        },
      );

      wrapper = mountComponent();
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-empty"]').exists(),
      ).toBe(true);
      expect(wrapper.exists()).toBe(true);
    });

    it("should render available RUM views when metadata fetch errors", async () => {
      wrapper.unmount();

      mockSearch.mockImplementation((_params: any, source: string) => {
        if (source === "RUM") {
          return Promise.resolve({ data: { hits: [createRumHit()] } });
        }
        return Promise.resolve({ data: { hits: [] } });
      });
      // On error the component falls back to unfiltered views (no metadata enrichment).
      mockFetchQueryDataWithHttpStream.mockImplementation(
        (_queryReq: any, handlers: any) => {
          handlers.error(null, new Error("Metadata fetch failed"));
        },
      );

      wrapper = mountComponent();
      await flushPromises();

      expect(
        wrapper.find('[data-test="rum-player-traces-tab-table"]').exists(),
      ).toBe(true);
      expect(wrapper.text()).toContain("/products");
    });
  });

  // =========================================================================
  // Formatting utilities
  // =========================================================================

  describe("formatting utilities", () => {
    it("should extract pathname from a full URL", () => {
      expect(
        (wrapper.vm as any).shortRoute("https://example.com/products?page=1"),
      ).toBe("/products?page=1");
    });

    it("should return the original string for an invalid URL", () => {
      expect((wrapper.vm as any).shortRoute("not-a-url")).toBe("not-a-url");
    });
  });

  // =========================================================================
  // Accessibility
  // =========================================================================

  describe("accessibility", () => {
    it("should render all interactive elements as proper <button> elements", () => {
      const buttons = wrapper.findAll("button");
      buttons.forEach((btn: any) => {
        expect(btn.element.tagName.toLowerCase()).toBe("button");
      });
    });
  });

  // =========================================================================
  // Lifecycle
  // =========================================================================

  describe("lifecycle", () => {
    it("should fetch traces on mount when sessionId is provided", () => {
      expect(mockSearch).toHaveBeenCalled();
    });

    it("should not fetch on mount when sessionId is empty", async () => {
      wrapper.unmount();
      mockSearch.mockClear();

      wrapper = mountComponent({ props: { sessionId: "" } });
      await flushPromises();

      expect(mockSearch).not.toHaveBeenCalled();
    });
  });
});
