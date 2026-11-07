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

vi.mock("@/services/search", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  return overlayServiceMock(await importOriginal(), {
    default: {
      search: (...args: any[]) => mockSearch(...args),
    },
  });
});

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
    fetchQueryDataWithHttpStream: (...args: any[]) => mockFetchQueryDataWithHttpStream(...args),
    cancelStreamQueryBasedOnRequestId: vi.fn(),
  }),
}));

// Stream discovery: default resolves nothing so every row falls back to the
// default stream and the pre-discovery tests keep their single-call shape;
// individual tests override with per-id locations.
const mockResolveTraceLocationsBulk = vi.fn().mockResolvedValue({});
const mockFallbackTracesStream = vi.fn().mockResolvedValue("default");
vi.mock("@/composables/rum/useCorrelatedTracesStream", () => ({
  default: () => ({
    resolveTraceLocationsBulk: mockResolveTraceLocationsBulk,
    fallbackTracesStream: mockFallbackTracesStream,
    cancel: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

// Fix 4: component reads SQL-aliased fields (_view_url, _view_loading_type, _date).
function createRumHit(overrides: Record<string, any> = {}) {
  return {
    _trace_id: "trace-abc123def456",
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
    duration: 5_000, // µs, as latest_stream returns it
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
function setupSuccessfulMocks(rumHits?: any[], traceMetadataHits?: any[], operationHits?: any[]) {
  mockSearch.mockReset();
  mockFetchQueryDataWithHttpStream.mockReset();

  const hits = rumHits ?? [createRumHit()];
  const metadata = traceMetadataHits ?? [createTraceMetadata()];

  mockSearch.mockImplementation((params: any, source: string) => {
    if (source === "RUM") {
      if (params.page_type === "traces") {
        return Promise.resolve({
          data: {
            hits:
              operationHits ??
              metadata.map((hit) => ({
                trace_id: hit.trace_id,
                operation_name: hit.first_event?.operation_name,
              })),
          },
        });
      }
      return Promise.resolve({ data: { hits } });
    }
    return Promise.resolve({ data: { hits: [] } });
  });

  mockFetchQueryDataWithHttpStream.mockImplementation((_queryReq: any, handlers: any) => {
    handlers.data(null, { content: { results: { hits: metadata } } });
    handlers.complete();
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
    template: "<span :data-test=\"'icon-' + name\" />",
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
  // Stub OTable so row clicks and scoped-slot content (route, duration) can be
  // exercised without mounting the real component.
  OTable: {
    name: "OTable",
    props: ["data", "columns", "rowHeight", "defaultColumns", "enableColumnReorder", "rowClass"],
    emits: ["row-click"],
    template: `
      <div>
        <div
          v-for="(row, i) in data"
          :key="i"
          :data-test="'table-row-' + i"
          @click="$emit('row-click', row)"
        >
          <slot name="cell-timestamp" :row="row" :value="null" :column="{}" />
          <slot name="cell-page"      :row="row" :value="null" :column="{}" />
          <slot name="cell-route"     :row="row" :value="null" :column="{}" />
          <slot name="cell-duration"  :row="row" :value="null" :column="{}" />
          <slot name="cell-status"    :row="row" :value="null" :column="{}" />
        </div>
      </div>
    `,
  },
  TraceStatusCell: {
    name: "TraceStatusCell",
    template: '<span data-test="trace-status-cell" />',
    props: ["item"],
  },
  // Lists its options; tests pick values by emitting update:modelValue.
  OSelect: {
    name: "OSelect",
    template: `
      <div v-bind="$attrs">
        <span v-for="option in options" :key="option.value" data-test="select-option">{{ option.label }}</span>
      </div>
    `,
    inheritAttrs: false,
    props: [
      "modelValue",
      "options",
      "multiple",
      "searchable",
      "clearable",
      "labelKey",
      "valueKey",
      "placeholder",
    ],
    emits: ["update:modelValue"],
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

// The composable now asks the stream schema which trace-id namespaces exist (`_o2_` vs
// `_oo_`) before building SQL, so getStream must be mocked or every call hangs.
// Reports the legacy spelling, matching data ingested before the namespace migration.
// It serves both the RUM and the traces stream; `http_route` is a traces column the route-name query needs.
const mockGetStream = vi.fn().mockResolvedValue({
  schema: [{ name: "_oo_trace_id" }, { name: "_oo_span_id" }, { name: "http_route" }],
});

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStream: mockGetStream,
  }),
}));

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
      expect(wrapper.find('[data-test="rum-player-traces-tab-table"]').exists()).toBe(true);
    });

    it("should display the HTTP server operation in the table row", () => {
      expect(wrapper.text()).toContain("GET /api/products");
    });

    it("gives each row its own stream and fetches metadata per distinct stream", async () => {
      const P1 = "01a034c1aabc72f78880daf6c9755cff"; // → payments_traces
      const C1 = "01a038ddccc770b9bba3b2df20c12415"; // → checkout_traces
      mockResolveTraceLocationsBulk.mockResolvedValueOnce({
        [P1]: { stream: "payments_traces" },
        [C1]: { stream: "checkout_traces" },
      });

      // RUM hits for both ids; metadata mock answers per queried stream.
      mockSearch.mockReset();
      mockFetchQueryDataWithHttpStream.mockReset();
      mockSearch.mockImplementation((params: any, source: string) =>
        Promise.resolve(
          source === "RUM"
            ? params.page_type === "traces"
              ? {
                  data: {
                    hits: [
                      { trace_id: P1, operation_name: "POST /api/payments" },
                      { trace_id: C1, operation_name: "POST /api/checkout" },
                    ],
                  },
                }
              : {
                  data: {
                    hits: [
                      createRumHit({ _trace_id: P1, _view_url: "https://example.com/pay" }),
                      createRumHit({ _trace_id: C1, _view_url: "https://example.com/checkout" }),
                    ],
                  },
                }
            : { data: { hits: [] } },
        ),
      );
      mockFetchQueryDataWithHttpStream.mockImplementation((args: any, handlers: any) => {
        const stream = args.queryReq.stream_name;
        const id = stream === "payments_traces" ? P1 : C1;
        handlers.data(null, {
          content: { results: { hits: [createTraceMetadata({ trace_id: id })] } },
        });
        handlers.complete();
      });

      wrapper.unmount();
      wrapper = mountComponent();
      await flushPromises();

      // metadata fetched once per distinct stream
      const streamsQueried = mockFetchQueryDataWithHttpStream.mock.calls.map(
        ([args]: any[]) => args.queryReq.stream_name,
      );
      expect(streamsQueried.sort()).toEqual(["checkout_traces", "payments_traces"]);

      // both rows render, each carrying its own stream context
      expect(wrapper.text()).toContain("POST /api/payments");
      expect(wrapper.text()).toContain("POST /api/checkout");

      // clicking the checkout row opens the embedded view against ITS stream
      const rows = wrapper.findAll('[data-test^="table-row-"]');
      const checkoutRow = rows.find((r: any) => r.text().includes("POST /api/checkout"));
      expect(checkoutRow).toBeDefined();
      await checkoutRow!.trigger("click");
      await flushPromises();

      const traceDetails = wrapper.findComponent({ name: "TraceDetails" });
      expect(traceDetails.exists()).toBe(true);
      expect(traceDetails.props("streamNameProp")).toBe("checkout_traces");
      expect(traceDetails.props("traceIdProp")).toBe(C1);
    });

    it("fetches nothing for an id found in no stream when the org has no default stream", async () => {
      mockFallbackTracesStream.mockResolvedValueOnce(null);
      setupSuccessfulMocks();
      wrapper.unmount();
      wrapper = mountComponent();
      await flushPromises();

      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="rum-player-traces-tab-empty"]').exists()).toBe(true);
    });

    it("keeps the found traces when another id is in no stream and the org has no default", async () => {
      const P1 = "01a034c1aabc72f78880daf6c9755cff"; // → qms_uat
      const U1 = "01a038ddccc770b9bba3b2df20c12415"; // in no stream
      mockResolveTraceLocationsBulk.mockResolvedValueOnce({ [P1]: { stream: "qms_uat" } });
      mockFallbackTracesStream.mockResolvedValueOnce(null);
      setupSuccessfulMocks(
        [createRumHit({ _trace_id: P1 }), createRumHit({ _trace_id: U1 })],
        [createTraceMetadata({ trace_id: P1 })],
      );
      wrapper.unmount();
      wrapper = mountComponent();
      await flushPromises();

      const streamsQueried = mockFetchQueryDataWithHttpStream.mock.calls.map(
        ([args]: any[]) => args.queryReq.stream_name,
      );
      expect(streamsQueried).toEqual(["qms_uat"]);
      expect(wrapper.findAll('[data-test^="table-row-"]')).toHaveLength(1);
      expect(wrapper.text()).toContain("GET /api/products");
    });

    it("bounds the metadata query by the indexed ranges instead of the session window", async () => {
      const P1 = "01a034c1aabc72f78880daf6c9755cff";
      mockResolveTraceLocationsBulk.mockResolvedValueOnce({
        [P1]: {
          stream: "default",
          range: { start_time: 1_700_000_000_000_000, end_time: 1_700_000_090_000_000 },
        },
      });
      setupSuccessfulMocks(
        [createRumHit({ _trace_id: P1 })],
        [createTraceMetadata({ trace_id: P1 })],
      );
      wrapper.unmount();
      wrapper = mountComponent();
      await flushPromises();

      const queryReq = mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq;
      expect(queryReq.start_time).toBe(1_700_000_000_000_000 - 60_000_000);
      expect(queryReq.end_time).toBe(1_700_000_090_000_000 + 60_000_000);
    });

    it("keeps the session window when a trace has no indexed range", async () => {
      const P1 = "01a034c1aabc72f78880daf6c9755cff";
      mockResolveTraceLocationsBulk.mockResolvedValueOnce({ [P1]: { stream: "default" } });
      setupSuccessfulMocks(
        [createRumHit({ _trace_id: P1 })],
        [createTraceMetadata({ trace_id: P1 })],
      );
      wrapper.unmount();
      wrapper = mountComponent();
      await flushPromises();

      const queryReq = mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq;
      // the component's default props: startTime 1000 ms, endTime 2000 ms
      expect(queryReq.start_time).toBe(1000 * 1000);
      expect(queryReq.end_time).toBe(2000 * 1000);
    });

    it("opens a row over its indexed range when the metadata carries no timings", async () => {
      const P1 = "01a034c1aabc72f78880daf6c9755cff";
      mockResolveTraceLocationsBulk.mockResolvedValueOnce({
        [P1]: {
          stream: "default",
          range: { start_time: 1_700_000_000_000_000, end_time: 1_700_000_090_000_000 },
        },
      });
      setupSuccessfulMocks(
        [createRumHit({ _trace_id: P1 })],
        [createTraceMetadata({ trace_id: P1, start_time: undefined, end_time: undefined })],
      );
      wrapper.unmount();
      wrapper = mountComponent();
      await flushPromises();

      const rows = wrapper.findAll('[data-test^="table-row-"]');
      await rows[0].trigger("click");
      await flushPromises();

      const traceDetails = wrapper.findComponent({ name: "TraceDetails" });
      expect(traceDetails.props("startTimeProp")).toBe(1_700_000_000_000_000 - 60_000_000);
      expect(traceDetails.props("endTimeProp")).toBe(1_700_000_090_000_000 + 60_000_000);
    });

    it("joins legacy zero-stripped RUM ids with padded traces-stream metadata", async () => {
      // SDK 0.4.x stored the id zero-stripped (31 hex chars) in _rumdata while
      // the traces stream stores the padded 32-char form — the join must still hit.
      setupSuccessfulMocks(
        [createRumHit({ _trace_id: "1a034c1aabc72f78880daf6c9755cff" })],
        [createTraceMetadata({ trace_id: "01a034c1aabc72f78880daf6c9755cff" })],
      );
      wrapper.unmount();
      wrapper = mountComponent();
      await flushPromises();

      // Row survives the metadata filter (previously dropped: raw 31-char key
      // never matched the 32-char metadata key)
      expect(wrapper.find('[data-test="rum-player-traces-tab-table"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("GET /api/products");

      // The traces-stream metadata query was filtered on the padded id
      const queryReq = mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq;
      expect(queryReq.filter).toContain("01a034c1aabc72f78880daf6c9755cff");
      expect(queryReq.stream_name).toBe("default");
    });

    it("should display trace count badge in filter bar", () => {
      const badge = wrapper.find('[data-test="rum-player-traces-tab-count-badge"]');
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

      expect(wrapper.find('[data-test="rum-player-traces-tab-loading"]').exists()).toBe(true);
    });

    it("should not show the trace table while loading", async () => {
      wrapper.unmount();
      mockSearch.mockReturnValue(new Promise(() => {}));

      wrapper = mountComponent();
      await nextTick();

      expect(wrapper.find('[data-test="rum-player-traces-tab-table"]').exists()).toBe(false);
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

      expect(wrapper.find('[data-test="rum-player-traces-tab-empty"]').exists()).toBe(true);
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

      expect(wrapper.find('[data-test="rum-player-traces-tab-error"]').exists()).toBe(true);
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

      expect(wrapper.find('[data-test="rum-player-traces-tab-retry-btn"]').exists()).toBe(true);
    });

    it("should retry fetch when retry button is clicked", async () => {
      wrapper.unmount();
      mockSearch.mockRejectedValue(new Error("Network error"));

      wrapper = mountComponent();
      await flushPromises();

      mockSearch.mockReset();
      mockSearch.mockResolvedValue({ data: { hits: [] } });

      const retryBtn = wrapper.find('[data-test="rum-player-traces-tab-retry-btn"]');
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

      expect(wrapper.find('[data-test="rum-player-traces-tab-back-btn"]').exists()).toBe(true);
    });

    it("should return to list view when back button is clicked", async () => {
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      await wrapper.find('[data-test="rum-player-traces-tab-back-btn"]').trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="trace-details"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-player-traces-tab-table"]').exists()).toBe(true);
    });

    it("should show the selected HTTP server operation in detail header", async () => {
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect(wrapper.text()).toContain("GET /api/products");
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
          createRumHit({ _trace_id: traceId }),
          createRumHit({ _trace_id: traceId, _view_id: "view-2" }),
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
          hits: [createRumHit({ _trace_id: null }), createRumHit({ _trace_id: "valid-trace" })],
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
            _trace_id: "trace-1",
            _view_url: "https://example.com/page1",
          }),
          createRumHit({
            _trace_id: "trace-2",
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
    it("replaces an internal trace summary with the HTTP server operation", async () => {
      wrapper.unmount();
      setupSuccessfulMocks(
        [createRumHit()],
        [
          createTraceMetadata({
            first_event: {
              service_name: "product-catalog",
              operation_name: "middleware - query",
            },
          }),
        ],
        [
          {
            trace_id: "trace-abc123def456",
            operation_name: "POST /api/products",
          },
        ],
      );

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("POST /api/products");
      expect(wrapper.text()).not.toContain("middleware - query");
    });

    it("falls back to the trace summary when operation enrichment fails", async () => {
      wrapper.unmount();
      setupSuccessfulMocks();
      mockSearch.mockImplementation((params: any) => {
        if (params.page_type === "traces") {
          return Promise.reject(new Error("Operation search failed"));
        }
        return Promise.resolve({ data: { hits: [createRumHit()] } });
      });
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("GET /api/products");
      expect(warnSpy).toHaveBeenCalledWith(
        "HTTP server operation fetch failed:",
        expect.any(Error),
      );
    });

    it("queries the earliest routed server operation for all displayed trace IDs", async () => {
      wrapper.unmount();
      setupSuccessfulMocks(
        [createRumHit({ _trace_id: "trace-1" }), createRumHit({ _trace_id: "trace-2" })],
        [
          createTraceMetadata({ trace_id: "trace-1" }),
          createTraceMetadata({ trace_id: "trace-2" }),
        ],
      );

      wrapper = mountComponent();
      await flushPromises();

      const operationSearch = mockSearch.mock.calls.find(
        ([params]) => params.page_type === "traces",
      );
      const sql = operationSearch?.[0].query.query.sql;
      expect(sql).toContain("trace_id IN ('trace-1','trace-2')");
      expect(sql).toContain("first_value(operation_name ORDER BY _timestamp ASC)");
      expect(sql).toContain("span_kind='2'");
      expect(sql).toContain("http_route IS NOT NULL");
      expect(
        mockSearch.mock.calls.filter(([params]) => params.page_type === "traces"),
      ).toHaveLength(1);
    });

    describe("browser duration and HTTP status", () => {
      const DEFAULT_SCHEMA = {
        schema: [{ name: "_oo_trace_id" }, { name: "_oo_span_id" }, { name: "http_route" }],
      };
      const RUM_SCHEMA = {
        schema: [
          { name: "_oo_trace_id" },
          { name: "session_id" },
          { name: "resource_duration" },
          { name: "resource_status_code" },
        ],
      };

      // The traces stream's schema has `traceColumns`; the RUM stream's has the browser columns.
      // The traces stream has `traceColumns` (and `http_route` unless `route` is false).
      const withSchemas = (traceColumns: string[], route = true) =>
        mockGetStream.mockImplementation((_name: string, type: string) =>
          Promise.resolve(
            type === "traces"
              ? {
                  schema: [
                    { name: "trace_id" },
                    ...(route ? [{ name: "http_route" }] : []),
                    ...traceColumns.map((name) => ({ name })),
                  ],
                }
              : RUM_SCHEMA,
          ),
        );

      const traceSqls = (): string[] =>
        mockSearch.mock.calls
          .filter(([params]) => params.page_type === "traces")
          .map(([params]) => params.query.query.sql);

      const statusItem = (index = 0) =>
        wrapper
          .find(`[data-test="table-row-${index}"]`)
          .findComponent({ name: "TraceStatusCell" })
          .props("item");

      afterEach(() => {
        mockGetStream.mockReset();
        mockGetStream.mockResolvedValue(DEFAULT_SCHEMA);
      });

      it("shows the browser's own request time though the device clock is ahead of the server", async () => {
        wrapper.unmount();
        // The device clock is 2.5 s ahead: its date is after the trace end. The old "browser start to trace
        // end" showed 0us; the browser's resource_duration (ns) is the request's real time.
        setupSuccessfulMocks(
          [createRumHit({ _date: 3_500, _resource_duration: 270_000_000 })],
          [createTraceMetadata({ end_time: 1_005_000_000 })],
        );
        wrapper = mountComponent();
        await flushPromises();

        const row = wrapper.find('[data-test="table-row-0"]');
        // The spec mocks formatTimeWithSuffix (µs in): 270 ms.
        expect(row.text()).toContain("270ms");
        expect(row.text()).not.toContain("0us");
      });

      it("falls back to the trace's span length without a browser timing when the clocks disagree", async () => {
        wrapper.unmount();
        // No resource_duration, and the device's date is after the trace end: the span's own 523 ms.
        setupSuccessfulMocks(
          [createRumHit({ _date: 9_999_999 })],
          [createTraceMetadata({ start_time: 1_000_000_000, end_time: 1_523_000_000 })],
        );
        wrapper = mountComponent();
        await flushPromises();

        const row = wrapper.find('[data-test="table-row-0"]');
        expect(row.text()).toContain("523ms");
        expect(row.text()).not.toContain("0us");
      });

      it("reads the browser timing and status in the session query", async () => {
        wrapper.unmount();
        withSchemas([]);
        setupSuccessfulMocks();
        wrapper = mountComponent();
        await flushPromises();

        const rumSql = mockSearch.mock.calls.find(([params]) => params.page_type === "logs")?.[0]
          .query.query.sql;
        expect(rumSql).toContain("max(resource_duration) as _resource_duration");
        expect(rumSql).toContain("max(resource_status_code) as _status_code");
      });

      it("keeps the route-only query when the traces stream has no status column", () => {
        // The shared mount uses a schema with neither status column.
        expect(traceSqls()).toHaveLength(1);
        expect(traceSqls()[0]).not.toContain("server_status");
        expect(traceSqls()[0]).toContain("http_route IS NOT NULL");
      });

      it("asks every server span for the status, both columns, and only routed spans for the name", async () => {
        wrapper.unmount();
        withSchemas(["http_response_status_code", "http_status_code"]);
        setupSuccessfulMocks();
        wrapper = mountComponent();
        await flushPromises();

        const sql = traceSqls()[0];
        const routed =
          "http_route IS NOT NULL AND operation_name IS NOT NULL AND operation_name != ''";
        // The name: the earliest routed span's (routed first, then by time; null when none is routed).
        expect(sql).toContain(
          `first_value(CASE WHEN ${routed} THEN operation_name END ORDER BY CASE WHEN ${routed} THEN 0 ELSE 1 END ASC, _timestamp ASC) AS operation_name`,
        );
        // The status: the earliest server span with one (the entry point), per column.
        // One span answers for both columns: the earliest with either, newer convention first.
        const status =
          "COALESCE(CAST(http_response_status_code AS VARCHAR), CAST(http_status_code AS VARCHAR))";
        expect(sql).toContain(
          `first_value(${status} ORDER BY CASE WHEN ${status} IS NOT NULL THEN 0 ELSE 1 END ASC, _timestamp ASC) AS server_status`,
        );
        // Not limited to routed spans: a 401 or an unmatched 404 has no route.
        expect(sql).toMatch(/WHERE .* AND span_kind='2' GROUP BY trace_id$/);
      });

      it("asks the status without naming http_route on a stream that lacks it", async () => {
        wrapper.unmount();
        withSchemas(["http_status_code"], false);
        setupSuccessfulMocks(
          [createRumHit({ _status_code: 0 })],
          [createTraceMetadata({ spans: [5, 0] })],
          [{ trace_id: "trace-abc123def456", operation_name: null, server_status: "403" }],
        );
        wrapper = mountComponent();
        await flushPromises();

        expect(traceSqls()).toHaveLength(1);
        expect(traceSqls()[0]).toContain("NULL AS operation_name");
        expect(traceSqls()[0]).not.toContain("http_route");
        expect(statusItem()).toEqual({ errors: 1 });
      });

      it("asks the route names as before when the schema cannot be read", async () => {
        wrapper.unmount();
        mockGetStream.mockImplementation((_name: string, type: string) =>
          type === "traces"
            ? Promise.reject(new Error("schema failed"))
            : Promise.resolve(RUM_SCHEMA),
        );
        setupSuccessfulMocks();
        wrapper = mountComponent();
        await flushPromises();

        expect(traceSqls()).toHaveLength(1);
        expect(traceSqls()[0]).toContain("http_route IS NOT NULL");
        expect(traceSqls()[0]).not.toContain("server_status");
        expect(wrapper.find('[data-test="table-row-0"]').text()).toContain("GET /api/products");
      });

      it("reads the schema once per stream, not once per batch", async () => {
        wrapper.unmount();
        withSchemas(["http_response_status_code"]);
        const ids = Array.from({ length: 90 }, (_, i) => i.toString(16).padStart(32, "0"));
        setupSuccessfulMocks(
          ids.map((id) => createRumHit({ _trace_id: id })),
          ids.map((id) => createTraceMetadata({ trace_id: id })),
        );
        wrapper = mountComponent();
        await flushPromises();

        expect(traceSqls()).toHaveLength(3); // 90 ids in batches of 40
        // One schema read of the traces stream per fetch (one per RUM schema read), not one per batch.
        const reads = (type: string) =>
          mockGetStream.mock.calls.filter(([, callType]) => callType === type).length;
        expect(reads("traces")).toBe(reads("logs"));
        expect(reads("traces")).toBeLessThan(traceSqls().length);
      });

      it("keeps the route names when the status query fails", async () => {
        wrapper.unmount();
        withSchemas(["http_response_status_code"]);
        setupSuccessfulMocks(
          [createRumHit()],
          [createTraceMetadata({ first_event: { service_name: "svc", operation_name: "root" } })],
        );
        const routed = vi.fn((params: any, source: string) => {
          if (source === "RUM" && params.page_type === "traces") {
            if (params.query.query.sql.includes("server_status")) {
              return Promise.reject(new Error("status column failed"));
            }
            return Promise.resolve({
              data: { hits: [{ trace_id: "trace-abc123def456", operation_name: "GET /api/x" }] },
            });
          }
          return Promise.resolve({ data: { hits: [createRumHit()] } });
        });
        mockSearch.mockImplementation(routed);
        wrapper = mountComponent();
        await flushPromises();

        expect(traceSqls()).toHaveLength(2);
        expect(traceSqls()[1]).not.toContain("server_status");
        expect(wrapper.find('[data-test="table-row-0"]').text()).toContain("GET /api/x");
      });

      it("marks a 4xx request as an error though its spans are UNSET", async () => {
        wrapper.unmount();
        setupSuccessfulMocks(
          [createRumHit({ _status_code: 404 })],
          [createTraceMetadata({ spans: [5, 0] })],
        );
        wrapper = mountComponent();
        await flushPromises();

        expect(statusItem()).toEqual({ errors: 1 });
        const view = (wrapper.vm as any).correlatedViews[0];
        expect((wrapper.vm as any).traceRowClass(view)).toBe("trace-row--error");
        await wrapper.find('[data-test="table-row-0"]').trigger("click");
        await nextTick();
        expect(wrapper.find('[data-test="rum-player-traces-tab-http-status"]').text()).toContain(
          "HTTP 404",
        );
      });

      it("marks an error from the server span's status (a string) when the browser saw 0", async () => {
        wrapper.unmount();
        withSchemas(["http_response_status_code"]);
        setupSuccessfulMocks(
          [createRumHit({ _status_code: 0 })],
          [createTraceMetadata({ spans: [5, 0] })],
          [
            {
              trace_id: "trace-abc123def456",
              operation_name: "GET /api/x",
              server_status: "403",
            },
          ],
        );
        wrapper = mountComponent();
        await flushPromises();

        expect(statusItem()).toEqual({ errors: 1 });
      });

      it("reads the entry span's status whichever column carries it", async () => {
        wrapper.unmount();
        withSchemas(["http_response_status_code", "http_status_code"]);
        setupSuccessfulMocks(
          [createRumHit({ _status_code: 0 })],
          [createTraceMetadata({ spans: [5, 0] })],
          [
            {
              trace_id: "trace-abc123def456",
              operation_name: "GET /api/x",
              server_status: "500",
            },
          ],
        );
        wrapper = mountComponent();
        await flushPromises();

        expect(statusItem()).toEqual({ errors: 1 });
      });

      it("keeps a request the browser saw as 0 a success when the server answered 200", async () => {
        wrapper.unmount();
        withSchemas(["http_response_status_code"]);
        setupSuccessfulMocks(
          [createRumHit({ _status_code: 0 })],
          [createTraceMetadata({ spans: [5, 0] })],
          [
            {
              trace_id: "trace-abc123def456",
              operation_name: "GET /api/x",
              server_status: "200",
            },
          ],
        );
        wrapper = mountComponent();
        await flushPromises();

        expect(statusItem()).toEqual({ errors: 0 });
      });

      it("shows the trace's ERROR span count in the pill, not just 1", async () => {
        wrapper.unmount();
        setupSuccessfulMocks(
          [createRumHit({ _status_code: 500 })],
          [createTraceMetadata({ spans: [5, 3] })],
        );
        wrapper = mountComponent();
        await flushPromises();

        expect(statusItem()).toEqual({ errors: 3 });
      });

      it("shows a dash, not 0us, for a trace whose duration is zero and no browser timing", async () => {
        wrapper.unmount();
        setupSuccessfulMocks(
          [createRumHit()],
          [
            createTraceMetadata({
              start_time: 1_000_000_000,
              end_time: 1_000_000_000,
              duration: 0,
            }),
          ],
        );
        wrapper = mountComponent();
        await flushPromises();

        const row = wrapper.find('[data-test="table-row-0"]');
        expect(row.text()).toContain("—");
        expect(row.text()).not.toContain("0us");
      });

      it("keeps a 2xx request without error spans a success", async () => {
        wrapper.unmount();
        setupSuccessfulMocks(
          [createRumHit({ _status_code: 200 })],
          [createTraceMetadata({ spans: [5, 0] })],
        );
        wrapper = mountComponent();
        await flushPromises();

        expect(statusItem()).toEqual({ errors: 0 });
      });

      it("shows the browser's time and failure on a row whose trace details did not load", async () => {
        wrapper.unmount();
        setupSuccessfulMocks([
          createRumHit({ _status_code: 503, _resource_duration: 1_200_000_000 }),
        ]);
        mockFetchQueryDataWithHttpStream.mockImplementation((_request: any, handlers: any) => {
          handlers.error(null, new Error("Request failed with status code 403"));
        });
        wrapper = mountComponent();
        await flushPromises();

        const row = wrapper.find('[data-test="table-row-0"]');
        expect(row.text()).toContain("1s");
        expect(statusItem()).toEqual({ errors: 1 });
        const view = (wrapper.vm as any).correlatedViews[0];
        expect(view.metadata).toBeUndefined();
        expect((wrapper.vm as any).traceRowClass(view)).toBe("trace-row--error");
        // A slow failure: the Error filter alone keeps it, and so does the Slow filter alone.
        (wrapper.vm as any).selectedTraceStatuses = ["error"];
        await nextTick();
        expect((wrapper.vm as any).visibleViews).toHaveLength(1);
        (wrapper.vm as any).selectedTraceStatuses = ["slow"];
        await nextTick();
        expect((wrapper.vm as any).visibleViews).toHaveLength(1);
        (wrapper.vm as any).selectedTraceStatuses = ["success"];
        await nextTick();
        expect((wrapper.vm as any).visibleViews).toHaveLength(0);
      });
    });

    it("should fall back to the span duration when the trace ends before the RUM request", async () => {
      wrapper.unmount();

      // _date = 5000ms but the trace ended at 1150ms (clock skew); span lasted 150ms.
      setupSuccessfulMocks(
        [createRumHit({ _date: 5000 })],
        [createTraceMetadata({ start_time: 1_000_000_000, end_time: 1_150_000_000 })],
      );

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("150ms");
      expect(wrapper.text()).not.toContain("0us");

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();
      expect(wrapper.text()).toContain("150ms");
    });

    it("should show a dash and no timer chip when the trace has no usable duration", async () => {
      wrapper.unmount();

      // Trace ended before the RUM request and the span has zero length.
      setupSuccessfulMocks(
        [createRumHit({ _date: 5000 })],
        [createTraceMetadata({ start_time: 1_000_000_000, end_time: 1_000_000_000 })],
      );

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="table-row-0"]').text()).toContain("—");

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();
      expect(wrapper.find('[data-test="rum-player-traces-tab-seek-btn"]').exists()).toBe(true);
      expect(wrapper.html()).not.toContain('name="timer"');
    });

    it("should match the Slow filter on the span duration when the trace ends before the RUM request", async () => {
      wrapper.unmount();

      setupSuccessfulMocks(
        [createRumHit({ _date: 9000 })],
        [createTraceMetadata({ start_time: 1_000_000_000, end_time: 2_500_000_000 })],
      );

      wrapper = mountComponent();
      await flushPromises();

      const status = wrapper
        .findAllComponents({ name: "OSelect" })
        .find(
          (select) => select.attributes("data-test") === "rum-player-traces-tab-status-filter",
        )!;
      status.vm.$emit("update:modelValue", ["slow"]);
      await flushPromises();

      expect(wrapper.findAll('[data-test^="table-row-"]')).toHaveLength(1);
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
      mockFetchQueryDataWithHttpStream.mockImplementation((_queryReq: any, handlers: any) => {
        handlers.data(null, { content: { results: { hits: [] } } });
        handlers.complete();
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="rum-player-traces-tab-empty"]').exists()).toBe(true);
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the hash-routed page of each row", async () => {
      wrapper.unmount();

      mockSearch.mockImplementation((_params: any, source: string) => {
        if (source === "RUM") {
          return Promise.resolve({
            data: { hits: [createRumHit({ _view_url: "https://app.example.com/#/file-manager" })] },
          });
        }
        return Promise.resolve({ data: { hits: [] } });
      });
      mockFetchQueryDataWithHttpStream.mockImplementation((_queryReq: any, handlers: any) => {
        handlers.error(null, new Error("Metadata fetch failed"));
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.text()).toContain("/#/file-manager");
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
      mockFetchQueryDataWithHttpStream.mockImplementation((_queryReq: any, handlers: any) => {
        handlers.error(null, new Error("Metadata fetch failed"));
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="rum-player-traces-tab-table"]').exists()).toBe(true);
      expect(wrapper.text()).toContain("/products");
    });

    it("still lists ids found in no stream when the metadata fetch errors", async () => {
      const P1 = "01a034c1aabc72f78880daf6c9755cff";
      const U1 = "01a038ddccc770b9bba3b2df20c12415";
      wrapper.unmount();
      mockResolveTraceLocationsBulk.mockResolvedValueOnce({ [P1]: { stream: "qms_uat" } });
      mockFallbackTracesStream.mockResolvedValueOnce(null);
      setupSuccessfulMocks([
        createRumHit({ _trace_id: P1, _view_url: "https://example.com/orders" }),
        createRumHit({ _trace_id: U1, _view_url: "https://example.com/audit" }),
      ]);
      mockFetchQueryDataWithHttpStream.mockImplementation((_queryReq: any, handlers: any) => {
        handlers.error(null, new Error("Metadata fetch failed"));
      });

      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.findAll('[data-test^="table-row-"]')).toHaveLength(2);
      expect(wrapper.text()).toContain("/audit");
    });
  });

  // =========================================================================
  // Formatting utilities
  // =========================================================================

  describe("formatting utilities", () => {
    it("should extract pathname from a full URL", () => {
      expect((wrapper.vm as any).shortRoute("https://example.com/products?page=1")).toBe(
        "/products?page=1",
      );
    });

    it("should keep the hash route of a hash-routed SPA", () => {
      expect((wrapper.vm as any).shortRoute("https://app.example.com/#/file-manager")).toBe(
        "/#/file-manager",
      );
      expect((wrapper.vm as any).shortRoute("https://example.com/app/#/orders?tab=2")).toBe(
        "/app/#/orders?tab=2",
      );
    });

    it("should ignore an in-page anchor that is not a route", () => {
      expect((wrapper.vm as any).shortRoute("https://example.com/docs#install")).toBe("/docs");
    });

    it("should label each row with its browser page, separately from the request", () => {
      const row = {
        route: "https://app.example.com/#/PatientCharts",
        metadata: { httpOperation: "GET /api/v1/patients" },
      };
      expect((wrapper.vm as any).pageRoute(row)).toBe("/#/PatientCharts");
      expect((wrapper.vm as any).traceDisplayName(row)).toBe("GET /api/v1/patients");
      expect((wrapper.vm as any).pageRoute({ route: "" })).toBe("");
    });

    it("should return the original string for an invalid URL", () => {
      expect((wrapper.vm as any).shortRoute("not-a-url")).toBe("not-a-url");
    });

    it("falls back to the browser route when operation metadata is unavailable", () => {
      expect(
        (wrapper.vm as any).traceDisplayName({
          route: "https://example.com/products",
          metadata: { rootOperation: "unknown" },
        }),
      ).toBe("/products");
    });
  });

  // =========================================================================
  // Seek button and event emits
  // =========================================================================

  describe("seek button and event emits", () => {
    it("should show seek button in detail header when trace has a start_time and startTime prop > 0", async () => {
      // Default mount has startTime: 1000 and metadata with start_time: 1_000_000_000.
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="rum-player-traces-tab-seek-btn"]').exists()).toBe(true);
    });

    it("should not show seek button when startTime prop is 0", async () => {
      wrapper.unmount();
      setupSuccessfulMocks();
      wrapper = mountComponent({ props: { startTime: 0 } });
      await flushPromises();

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="rum-player-traces-tab-seek-btn"]').exists()).toBe(false);
    });

    it("should emit event-emitted with trace-seek when seek button is clicked", async () => {
      // startTime: 1000 ms, trace start_time: 1_000_000_000 ns → 1000 ms → offset = 0 ms
      // The component emits when relativeTimeMs >= 0, so offset 0 still fires.
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      const seekBtn = wrapper.find('[data-test="rum-player-traces-tab-seek-btn"]');
      expect(seekBtn.exists()).toBe(true);
      await seekBtn.trigger("click");

      const emitted = wrapper.emitted("event-emitted");
      expect(emitted).toBeTruthy();
      const seekEvents = (emitted as any[]).filter((args) => args[0] === "trace-seek");
      expect(seekEvents.length).toBeGreaterThan(0);
      expect(seekEvents[0][1]).toHaveProperty("relativeTime");
    });

    it("should emit event-emitted with trace-row-click when a row with start_time > 0 offset is clicked", async () => {
      wrapper.unmount();

      // startTime: 1000 ms, trace start_time: 2_000_000_000 ns → 2000 ms → offset = 1000 ms (> 0)
      setupSuccessfulMocks([createRumHit()], [createTraceMetadata({ start_time: 2_000_000_000 })]);
      wrapper = mountComponent({ props: { startTime: 1000 } });
      await flushPromises();

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      const emitted = wrapper.emitted("event-emitted");
      expect(emitted).toBeTruthy();
      const rowClickEvents = (emitted as any[]).filter((args) => args[0] === "trace-row-click");
      expect(rowClickEvents.length).toBe(1);
      expect(rowClickEvents[0][1]).toEqual({ relativeTime: 1000 });
    });

    it("should not emit trace-row-click when relativeTime is 0", async () => {
      // startTime: 1000 ms, trace start_time: 1_000_000_000 ns → offset = 0 ms → no emit
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      const emitted = wrapper.emitted("event-emitted") ?? [];
      const rowClickEvents = (emitted as any[]).filter((args) => args[0] === "trace-row-click");
      expect(rowClickEvents.length).toBe(0);
    });
  });

  // =========================================================================
  // Detail header metadata chips
  // =========================================================================

  describe("detail header metadata chips", () => {
    it("should show span count in detail header when spanCount is set", async () => {
      wrapper.unmount();

      setupSuccessfulMocks(
        [createRumHit()],
        [createTraceMetadata({ spans: [7, 0] })], // spanCount = 7, errorCount = 0
      );
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect(wrapper.text()).toContain("7");
      expect(wrapper.text()).toContain("spans");
    });

    it("should use singular 'span' when spanCount is 1", async () => {
      wrapper.unmount();

      setupSuccessfulMocks([createRumHit()], [createTraceMetadata({ spans: [1, 0] })]);
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      // Should contain "1 span" not "1 spans"
      expect(wrapper.text()).toContain("1");
      expect(wrapper.text()).toMatch(/\b1\s+span\b/);
    });

    it("should use singular 'Error' when errorCount is 1", async () => {
      wrapper.unmount();

      setupSuccessfulMocks(
        [createRumHit()],
        [createTraceMetadata({ spans: [5, 1] })], // 1 error span
      );
      wrapper = mountComponent();
      await flushPromises();

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      // rum.error = "Error" (singular), rum.errors = "Errors" (plural)
      expect(wrapper.text()).toMatch(/\b1\s+Error\b/);
    });

    it("should show open-in-full-view button in detail header", async () => {
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect(wrapper.find('[data-test="rum-player-traces-tab-open-full-btn"]').exists()).toBe(true);
    });

    it("should not show error count chip when trace has no errors", async () => {
      // Default metadata has spans: [5, 0] → errorCount = 0 → no error chip
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      // The error chip span has no data-test but its text contains "Error(s)".
      // Verify the component renders without error badge content.
      const detailText = wrapper.find('[data-test="trace-details"]');
      expect(detailText.exists()).toBe(true);
      // The error count span is only present when errorCount > 0
      expect(wrapper.text()).not.toMatch(/\b0\s+Error/);
    });
  });

  // =========================================================================
  // Error count badge in list view
  // =========================================================================

  describe("error count badge in list view", () => {
    it("should show error count badge when at least one trace has errors", async () => {
      wrapper.unmount();

      setupSuccessfulMocks(
        [createRumHit()],
        [createTraceMetadata({ spans: [5, 3] })], // errorCount = 3
      );
      wrapper = mountComponent();
      await flushPromises();

      const badge = wrapper.find('[data-test="rum-player-traces-tab-error-count-badge"]');
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("1"); // 1 trace with errors
    });

    it("should not show error count badge when no traces have errors", () => {
      // Default metadata has spans: [5, 0] → totalErrorCount = 0
      expect(wrapper.find('[data-test="rum-player-traces-tab-error-count-badge"]').exists()).toBe(
        false,
      );
    });
  });

  // =========================================================================
  // Search bar
  // =========================================================================

  describe("search bar", () => {
    beforeEach(async () => {
      wrapper.unmount();
      setupSuccessfulMocks(
        [
          createRumHit(),
          createRumHit({
            _trace_id: "trace-0f9e8d7c6b5a",
            _view_url: "https://example.com/checkout",
            _view_id: "view-2",
          }),
        ],
        [
          createTraceMetadata(),
          createTraceMetadata({
            trace_id: "trace-0f9e8d7c6b5a",
            start_time: 1_010_000_000,
            end_time: 1_012_000_000,
            spans: [4, 1],
            first_event: { service_name: "checkout", operation_name: "POST /api/orders" },
          }),
        ],
      );
      wrapper = mountComponent();
      await flushPromises();
    });

    const search = async (value: string) => {
      await wrapper.find('[data-test="rum-player-traces-tab-search"] input').setValue(value);
      await flushPromises();
    };

    const rowCount = () => wrapper.findAll('[data-test^="table-row-"]').length;

    it("should list every trace while the search is empty", () => {
      expect(wrapper.find('[data-test="rum-player-traces-tab-search"]').exists()).toBe(true);
      expect(rowCount()).toBe(2);
    });

    it("should filter by request name, ignoring case", async () => {
      await search("post /API/orders");
      expect(rowCount()).toBe(1);
      expect(wrapper.text()).toContain("POST /api/orders");
      expect(wrapper.text()).not.toContain("GET /api/products");
    });

    it("should filter by page and by trace id", async () => {
      await search("/products");
      expect(rowCount()).toBe(1);
      expect(wrapper.text()).toContain("GET /api/products");

      await search("0f9e8d7c");
      expect(rowCount()).toBe(1);
      expect(wrapper.text()).toContain("POST /api/orders");
    });

    it("should count only the matching traces and their errors", async () => {
      const countBadge = () => wrapper.find('[data-test="rum-player-traces-tab-count-badge"]');
      const errorBadge = () =>
        wrapper.find('[data-test="rum-player-traces-tab-error-count-badge"]');
      expect(countBadge().text()).toContain("2");
      expect(errorBadge().exists()).toBe(true);

      await search("products");
      expect(countBadge().text()).toContain("1");
      expect(errorBadge().exists()).toBe(false);
    });

    it("should show no rows when nothing matches, and all again once cleared", async () => {
      await search("no-such-request");
      expect(rowCount()).toBe(0);

      await search("");
      expect(rowCount()).toBe(2);
    });
  });

  // =========================================================================
  // Status and page filters
  // =========================================================================

  describe("status and page filters", () => {
    // Three traces: a fast success and a slow success on /products, a fast error on /checkout.
    // The duration is the browser's own timing of the request (resource_duration, ns).
    beforeEach(async () => {
      wrapper.unmount();
      setupSuccessfulMocks(
        [
          createRumHit({ _date: 1_000, _resource_duration: 5_000_000 }),
          createRumHit({
            _trace_id: "trace-0f9e8d7c6b5a",
            _view_url: "https://example.com/checkout",
            _view_id: "view-2",
            _date: 1_010,
            _resource_duration: 2_000_000,
          }),
          createRumHit({
            _trace_id: "trace-5a5a5a5a5a5a",
            _view_id: "view-3",
            _date: 20,
            _resource_duration: 1_500_000_000,
          }),
        ],
        [
          createTraceMetadata(),
          createTraceMetadata({
            trace_id: "trace-0f9e8d7c6b5a",
            start_time: 1_010_000_000,
            end_time: 1_012_000_000,
            spans: [4, 1],
            first_event: { service_name: "checkout", operation_name: "POST /api/orders" },
          }),
          createTraceMetadata({
            trace_id: "trace-5a5a5a5a5a5a",
            start_time: 1_020_000_000,
            end_time: 1_025_000_000,
            first_event: { service_name: "reports", operation_name: "GET /api/report" },
          }),
        ],
      );
      wrapper = mountComponent();
      await flushPromises();
    });

    const filter = (name: "status" | "page") =>
      wrapper
        .findAllComponents({ name: "OSelect" })
        .find(
          (select) => select.attributes("data-test") === `rum-player-traces-tab-${name}-filter`,
        )!;

    const choose = async (name: "status" | "page", values: string[]) => {
      filter(name).vm.$emit("update:modelValue", values);
      await flushPromises();
    };

    const rowCount = () => wrapper.findAll('[data-test^="table-row-"]').length;

    it("should check every status by default and list every trace", () => {
      expect(filter("status").props("modelValue")).toEqual(["error", "success", "slow"]);
      expect(filter("status").text()).toContain("Slow (≥ 1 s)");
      expect(rowCount()).toBe(3);
    });

    it("should show only failed traces when only Error is checked", async () => {
      await choose("status", ["error"]);
      expect(rowCount()).toBe(1);
      expect(wrapper.text()).toContain("POST /api/orders");
    });

    it("should show only traces of a second or more when only Slow is checked", async () => {
      await choose("status", ["slow"]);
      expect(rowCount()).toBe(1);
      expect(wrapper.text()).toContain("GET /api/report");
    });

    it("should keep failed and slow traces when Success is unchecked", async () => {
      await choose("status", ["error", "slow"]);
      expect(rowCount()).toBe(2);
      expect(wrapper.text()).not.toContain("GET /api/products");
    });

    it("should show every trace when no status is checked", async () => {
      await choose("status", []);
      expect(rowCount()).toBe(3);
    });

    it("should offer each visited page once, in visit order", () => {
      const options = filter("page")
        .findAll('[data-test="select-option"]')
        .map((option) => option.text());
      expect(options).toEqual(["/products", "/checkout"]);
    });

    it("should combine the page, status and search filters, and count only the matches", async () => {
      const countBadge = () => wrapper.find('[data-test="rum-player-traces-tab-count-badge"]');

      await choose("page", ["/products"]);
      expect(rowCount()).toBe(2);
      expect(countBadge().text()).toContain("2");
      expect(wrapper.find('[data-test="rum-player-traces-tab-error-count-badge"]').exists()).toBe(
        false,
      );

      await wrapper.find('[data-test="rum-player-traces-tab-search"] input').setValue("report");
      await flushPromises();
      expect(rowCount()).toBe(1);
      expect(wrapper.text()).toContain("GET /api/report");

      await choose("status", ["error"]);
      expect(rowCount()).toBe(0);
    });

    it("should clear the page selection when the session changes", async () => {
      await choose("page", ["/checkout"]);
      expect(rowCount()).toBe(1);

      await wrapper.setProps({ sessionId: "another-session" });
      await flushPromises();
      expect(filter("page").props("modelValue")).toEqual([]);
      expect(rowCount()).toBe(3);
    });
  });

  // =========================================================================
  // Formatting utilities — additional coverage
  // =========================================================================

  describe("formatting utilities — additional coverage", () => {
    it("should return em-dash for formatTraceTimestamp when startTimeNs is 0", () => {
      expect((wrapper.vm as any).formatTraceTimestamp(0)).toBe("—");
    });

    it("should return em-dash for formatTraceTimestamp when startTime prop is 0", async () => {
      wrapper.unmount();
      setupSuccessfulMocks();
      wrapper = mountComponent({ props: { startTime: 0 } });
      await flushPromises();

      expect((wrapper.vm as any).formatTraceTimestamp(1_000_000_000)).toBe("—");
    });

    it("should return empty string for traceTimeOffset when startTime prop is 0", async () => {
      wrapper.unmount();
      setupSuccessfulMocks();
      wrapper = mountComponent({ props: { startTime: 0 } });
      await flushPromises();

      expect((wrapper.vm as any).traceTimeOffset(1_000_000_000)).toBe("");
    });

    it("should format trace timestamp as MM:SS relative to session startTime", () => {
      // startTime: 1000 ms, trace start_time = 1_061_000_000_000 ns = 1_061_000 ms → offset = 1_060_000 ms = 1060 s → 17:40
      expect((wrapper.vm as any).formatTraceTimestamp(1_061_000_000_000)).toBe("17:40");
    });

    it("should return 0 for traceRelativeTimeMs when startTimeNs is 0", () => {
      expect((wrapper.vm as any).traceRelativeTimeMs(0)).toBe(0);
    });

    it("should clamp traceRelativeTimeMs to 0 when trace starts before session", () => {
      // startTime: 1000 ms, trace start_time = 500_000_000 ns = 500 ms → clamped to 0
      expect((wrapper.vm as any).traceRelativeTimeMs(500_000_000)).toBe(0);
    });

    it("should return correct relative ms when trace starts after session", () => {
      // startTime: 1000 ms, trace start_time = 3_000_000_000 ns = 3000 ms → offset = 2000 ms
      expect((wrapper.vm as any).traceRelativeTimeMs(3_000_000_000)).toBe(2000);
    });

    it("should assign empty class for traceRowClass when errorCount is 0", () => {
      expect((wrapper.vm as any).traceRowClass({ metadata: { errorCount: 0 } })).toBe("");
    });

    it("should assign error class for traceRowClass when errorCount > 0", () => {
      expect((wrapper.vm as any).traceRowClass({ metadata: { errorCount: 2 } })).toBe(
        "trace-row--error",
      );
    });
  });

  // =========================================================================
  // openTraceDetail fallback time range
  // =========================================================================

  describe("openTraceDetail time range", () => {
    it("should set time range from metadata when metadata has start_time and end_time", async () => {
      // metadata: start_time=1_000_000_000 ns, end_time=1_005_000_000 ns
      // selectedTraceStartTime = floor(1_000_000_000/1000) - 60_000_000 = 1_000_000 - 60_000_000 = -59_999_000
      // selectedTraceEndTime   = ceil(1_005_000_000/1000) + 60_000_000 = 1_005_000 + 60_000_000 = 61_005_000
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      expect((wrapper.vm as any).selectedTraceStartTime).toBe(
        Math.floor(1_000_000_000 / 1000) - 60_000_000,
      );
      expect((wrapper.vm as any).selectedTraceEndTime).toBe(
        Math.ceil(1_005_000_000 / 1000) + 60_000_000,
      );
    });

    it("should use fallback time range when trace metadata is missing start/end times", async () => {
      wrapper.unmount();

      // metadata without start_time / end_time → fallback path
      setupSuccessfulMocks(
        [createRumHit()],
        [
          createTraceMetadata({
            start_time: undefined,
            end_time: undefined,
          }),
        ],
      );
      wrapper = mountComponent({
        props: { startTime: 1000, endTime: 2000 },
      });
      await flushPromises();

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      // fallback: startTime * 1000 = 1_000_000, endTime * 1000 = 2_000_000
      expect((wrapper.vm as any).selectedTraceStartTime).toBe(1_000_000);
      expect((wrapper.vm as any).selectedTraceEndTime).toBe(2_000_000);
    });

    it("should reset selectedTraceStartTime and selectedTraceEndTime to 0 on closeTraceDetail", async () => {
      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await nextTick();

      await wrapper.find('[data-test="rum-player-traces-tab-back-btn"]').trigger("click");
      await nextTick();

      expect((wrapper.vm as any).selectedTraceStartTime).toBe(0);
      expect((wrapper.vm as any).selectedTraceEndTime).toBe(0);
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

  // =========================================================================
  // SQL is schema-guarded so a mobile stream never 400s
  //
  // =========================================================================

  describe("schema-guarded SQL", () => {
    function lastRumSql(): string {
      const call = mockSearch.mock.calls.find((c: any[]) => c[1] === "RUM");
      return call?.[0]?.query?.query?.sql ?? "";
    }

    it("omits browser-only fields and filters on a mobile schema", async () => {
      wrapper.unmount();
      mockSearch.mockClear();
      mockGetStream.mockResolvedValueOnce({
        schema: [
          { name: "_o2_trace_id" },
          { name: "session_id" },
          { name: "view_url" },
          { name: "view_id" },
          { name: "type" },
          { name: "date" },
        ],
      });

      // Act
      wrapper = mountComponent();
      await flushPromises();

      // Assert: query ran (no early return), references neither absent column.
      const sql = lastRumSql();
      expect(sql).not.toBe("");
      expect(sql).not.toContain("max(view_loading_type)");
      expect(sql).toContain("NULL as _view_loading_type");
      expect(sql).not.toContain("action_id is not null");
      expect(sql).not.toContain("resource_url");
      expect(sql).toContain("_o2_trace_id");
      expect(sql).toContain("max(view_url)");
    });

    it("includes unlinked traces and filters Socket.IO groups on a browser schema", async () => {
      // Arrange: browser schema carries every column.
      wrapper.unmount();
      mockSearch.mockClear();
      mockGetStream.mockResolvedValueOnce({
        schema: [
          { name: "_oo_trace_id" },
          { name: "session_id" },
          { name: "view_url" },
          { name: "view_id" },
          { name: "view_loading_type" },
          { name: "type" },
          { name: "date" },
          { name: "action_id" },
          { name: "resource_url" },
        ],
      });

      // Act
      wrapper = mountComponent();
      await flushPromises();

      // Assert
      const sql = lastRumSql();
      expect(sql).toContain("max(view_loading_type) as _view_loading_type");
      expect(sql).not.toContain("action_id is not null");
      expect(sql).toContain(
        "HAVING MAX(CASE WHEN resource_url LIKE '%/socket.io/%' AND resource_url LIKE '%transport=polling%' THEN 1 ELSE 0 END) = 0",
      );
    });

    it("keeps null resource URLs while excluding a trace containing Socket.IO polling", async () => {
      wrapper.unmount();
      mockSearch.mockClear();
      mockGetStream.mockResolvedValueOnce({
        schema: [{ name: "_oo_trace_id" }, { name: "session_id" }, { name: "resource_url" }],
      });

      wrapper = mountComponent();
      await flushPromises();

      const sql = lastRumSql();
      expect(sql).not.toContain("resource_url NOT LIKE");
      expect(sql).toContain("resource_url LIKE '%/socket.io/%'");
      expect(sql).toContain("resource_url LIKE '%transport=polling%'");
    });

    it("does not query at all when the stream has no trace_id column", async () => {
      // Arrange: neither namespace present → nothing to correlate.
      wrapper.unmount();
      mockGetStream.mockResolvedValueOnce({
        schema: [{ name: "session_id" }, { name: "view_url" }],
      });
      mockSearch.mockClear();

      // Act
      wrapper = mountComponent();
      await flushPromises();

      // Assert: early return, no search issued, empty state shown.
      expect(mockSearch).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="rum-player-traces-tab-empty"]').exists()).toBe(true);
    });
  });

  // =========================================================================
  // Events-only sessions search `_rumdata` by server arrival, not device clock
  // =========================================================================

  describe("arrival-time window (rumWindowUs)", () => {
    const START_MS = 1_700_000_000_000;
    const END_MS = 1_700_000_100_000;
    const DAY_US = 86_400_000_000;
    const RUM_WINDOW = { start: START_MS * 1000 - DAY_US, end: END_MS * 1000 + DAY_US };
    const PAD = 60_000_000;

    function rumCalls(): any[] {
      return mockSearch.mock.calls.filter(
        (c: any[]) => c[1] === "RUM" && c[0].page_type === "logs",
      );
    }

    async function remount(props: Record<string, any>, rumHits: any[], metaHits?: any[]) {
      wrapper.unmount();
      vi.clearAllMocks();
      setupSuccessfulMocks(rumHits, metaHits);
      wrapper = mountComponent({ props: { startTime: START_MS, endTime: END_MS, ...props } });
      await flushPromises();
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("queries _rumdata from the prop start to at least the prop end", async () => {
      vi.spyOn(Date, "now").mockReturnValue(END_MS);
      await remount({ rumWindowUs: RUM_WINDOW }, [createRumHit()]);

      const query = rumCalls()[0][0].query.query;
      expect(query.start_time).toBe(RUM_WINDOW.start);
      expect(query.end_time).toBeGreaterThanOrEqual(RUM_WINDOW.end);
      expect(query.sql).toContain("min(_timestamp) as _first_ts");
      expect(query.sql).toContain("max(_timestamp) as _last_ts");
    });

    it("resolves stream locations, metadata and the row detail over the padded arrival window", async () => {
      const first = START_MS * 1000 + 1_000_000;
      const last = END_MS * 1000 + 5_000_000;
      await remount(
        { rumWindowUs: RUM_WINDOW },
        [createRumHit({ _first_ts: first, _last_ts: last })],
        [createTraceMetadata({ start_time: undefined, end_time: undefined })],
      );

      const bulk = mockResolveTraceLocationsBulk.mock.calls[0];
      expect(bulk[1]).toBe(START_MS * 1000 - PAD);
      expect(bulk[2]).toBe(last + PAD);

      const queryReq = mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq;
      expect(queryReq.start_time).toBe(START_MS * 1000 - PAD);
      expect(queryReq.end_time).toBe(last + PAD);

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await flushPromises();
      const traceDetails = wrapper.findComponent({ name: "TraceDetails" });
      expect(traceDetails.props("startTimeProp")).toBe(START_MS * 1000 - PAD);
      expect(traceDetails.props("endTimeProp")).toBe(last + PAD);
    });

    it("keeps the device start when every row arrived 5 min after its device time", async () => {
      const lag = 300_000_000;
      await remount(
        { rumWindowUs: RUM_WINDOW },
        [createRumHit({ _first_ts: START_MS * 1000 + lag, _last_ts: END_MS * 1000 + lag })],
        [createTraceMetadata({ start_time: undefined, end_time: undefined })],
      );

      const bulk = mockResolveTraceLocationsBulk.mock.calls[0];
      expect(bulk[1]).toBe(START_MS * 1000 - PAD);
      expect(bulk[2]).toBe(END_MS * 1000 + lag + PAD);

      const queryReq = mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq;
      expect(queryReq.start_time).toBe(START_MS * 1000 - PAD);
      expect(queryReq.end_time).toBe(END_MS * 1000 + lag + PAD);

      await wrapper.find('[data-test="table-row-0"]').trigger("click");
      await flushPromises();
      const traceDetails = wrapper.findComponent({ name: "TraceDetails" });
      expect(traceDetails.props("startTimeProp")).toBe(START_MS * 1000 - PAD);
      expect(traceDetails.props("endTimeProp")).toBe(END_MS * 1000 + lag + PAD);
    });

    it("spans both windows when the device clock runs hours ahead", async () => {
      const H = 3_600_000_000;
      await remount({ rumWindowUs: RUM_WINDOW }, [
        createRumHit({ _first_ts: START_MS * 1000 - 3 * H, _last_ts: END_MS * 1000 - 3 * H }),
      ]);

      const bulk = mockResolveTraceLocationsBulk.mock.calls[0];
      expect(bulk[1]).toBe(START_MS * 1000 - 3 * H - PAD);
      expect(bulk[2]).toBe(END_MS * 1000);

      const queryReq = mockFetchQueryDataWithHttpStream.mock.calls[0][0].queryReq;
      expect(queryReq.start_time).toBe(START_MS * 1000 - 3 * H - PAD);
      expect(queryReq.end_time).toBe(END_MS * 1000);
    });

    it("falls back to the device window when no hit carries a usable _first_ts", async () => {
      await remount({ rumWindowUs: RUM_WINDOW }, [createRumHit({ _first_ts: null, _last_ts: "" })]);

      const bulk = mockResolveTraceLocationsBulk.mock.calls[0];
      expect(bulk[1]).toBe(START_MS * 1000);
      expect(bulk[2]).toBe(END_MS * 1000);
    });

    it("keeps a trace that arrived 20 s after the last device-clock event inside the window", async () => {
      const last = END_MS * 1000 + 20_000_000;
      await remount({ rumWindowUs: RUM_WINDOW }, [
        createRumHit({ _first_ts: START_MS * 1000, _last_ts: last }),
      ]);

      const bulk = mockResolveTraceLocationsBulk.mock.calls[0];
      expect(bulk[2]).toBeGreaterThanOrEqual(last + PAD);
    });

    it("extends end_time to the current time on a later re-fetch", async () => {
      const nowSpy = vi.spyOn(Date, "now").mockReturnValue(END_MS + DAY_US / 1000 + 1_000);
      await remount({ rumWindowUs: RUM_WINDOW }, [createRumHit()]);
      const firstEnd = rumCalls()[0][0].query.query.end_time;

      nowSpy.mockReturnValue(END_MS + DAY_US / 1000 + 600_000);
      await wrapper.setProps({ sessionId: "test-session-456" });
      await flushPromises();

      const secondEnd = rumCalls()[1][0].query.query.end_time;
      expect(firstEnd).toBe((END_MS + DAY_US / 1000 + 1_000) * 1000);
      expect(secondEnd).toBeGreaterThan(firstEnd);
    });

    it("leaves the query untouched without the prop", async () => {
      await remount({}, [createRumHit({ _first_ts: START_MS * 1000, _last_ts: END_MS * 1000 })]);

      const query = rumCalls()[0][0].query.query;
      expect(query.sql).not.toContain("_first_ts");
      expect(query.start_time).toBe(START_MS * 1000);
      expect(query.end_time).toBe(END_MS * 1000);
      const bulk = mockResolveTraceLocationsBulk.mock.calls[0];
      expect(bulk[1]).toBe(START_MS * 1000);
      expect(bulk[2]).toBe(END_MS * 1000);
    });

    it("starts at the device start when the arrival window starts later", async () => {
      // A RUM batch can arrive before the first replay row, whose arrival starts the window.
      const late = { start: START_MS * 1000 + 40_000_000, end: END_MS * 1000 + PAD };
      await remount({ rumWindowUs: late }, [createRumHit()]);

      expect(rumCalls()[0][0].query.query.start_time).toBe(START_MS * 1000);
    });

    it("fetches again when the arrival window comes in after the tab opened", async () => {
      await remount({}, [createRumHit()]);
      expect(rumCalls()).toHaveLength(1);
      expect(rumCalls()[0][0].query.query.end_time).toBe(END_MS * 1000);

      vi.spyOn(Date, "now").mockReturnValue(END_MS + 600_000);
      await wrapper.setProps({ rumWindowUs: RUM_WINDOW });
      await flushPromises();
      expect(rumCalls()).toHaveLength(2);
      expect(rumCalls()[1][0].query.query.sql).toContain("_first_ts");
      expect(rumCalls()[1][0].query.query.end_time).toBeGreaterThanOrEqual(RUM_WINDOW.end);

      // The same bounds in a new object do not fetch again.
      await wrapper.setProps({ rumWindowUs: { ...RUM_WINDOW } });
      await flushPromises();
      expect(rumCalls()).toHaveLength(2);
    });

    it("keeps the newer result when the replaced fetch answers last", async () => {
      await remount({}, [createRumHit()]);
      const normal = mockSearch.getMockImplementation()!;
      let releaseFirst: (value: any) => void = () => {};
      let first = true;
      // The first _rumdata query (no window yet) answers only when released, with no rows.
      mockSearch.mockImplementation((params: any, source: string) => {
        if (first && source === "RUM" && params.page_type === "logs") {
          first = false;
          return new Promise((resolve) => {
            releaseFirst = resolve;
          });
        }
        return normal(params, source);
      });
      wrapper.unmount();
      wrapper = mountComponent({ props: { startTime: START_MS, endTime: END_MS } });
      await flushPromises();

      await wrapper.setProps({ rumWindowUs: RUM_WINDOW });
      await flushPromises();
      expect(wrapper.findAll('[data-test^="table-row-"]')).toHaveLength(1);

      releaseFirst({ data: { hits: [] } });
      await flushPromises();
      expect(wrapper.findAll('[data-test^="table-row-"]')).toHaveLength(1);
    });
  });

  // =========================================================================
  // Long sessions: paged RUM rows and URL-safe metadata batches
  // =========================================================================

  describe("long sessions", () => {
    const hexId = (index: number) => index.toString(16).padStart(32, "0");
    const idsInFilter = (filter: string): string[] => filter.match(/[0-9a-f]{32}/g) ?? [];
    const rumCalls = () =>
      mockSearch.mock.calls.filter(
        ([params, source]) => source === "RUM" && params.page_type === "logs",
      );
    const metadataFilters = (): string[] =>
      mockFetchQueryDataWithHttpStream.mock.calls.map(([request]) => request.queryReq.filter);

    function setupLongSession(total: number, failBatch?: (ids: string[]) => boolean) {
      mockSearch.mockReset();
      mockFetchQueryDataWithHttpStream.mockReset();
      mockSearch.mockImplementation((params: any, source: string) => {
        if (source !== "RUM" || params.page_type === "traces") {
          return Promise.resolve({ data: { hits: [] } });
        }
        const { from, size } = params.query.query;
        const count = Math.max(0, Math.min(size, total - from));
        return Promise.resolve({
          data: {
            hits: Array.from({ length: count }, (_, i) =>
              createRumHit({ _trace_id: hexId(from + i), _date: from + i + 1 }),
            ),
          },
        });
      });
      mockFetchQueryDataWithHttpStream.mockImplementation((request: any, handlers: any) => {
        const ids = idsInFilter(request.queryReq.filter);
        if (failBatch?.(ids)) {
          handlers.error(null, new Error("Request failed with status code 403"));
          return;
        }
        handlers.data(null, {
          content: {
            results: {
              hits: ids.map((id, i) =>
                createTraceMetadata({
                  trace_id: id,
                  start_time: (i + 1) * 1e9,
                  end_time: (i + 2) * 1e9,
                }),
              ),
            },
          },
        });
        handlers.complete();
      });
    }

    async function mountLongSession(total: number, failBatch?: (ids: string[]) => boolean) {
      wrapper.unmount();
      setupLongSession(total, failBatch);
      wrapper = mountComponent();
      await flushPromises();
    }

    it("reads every page of the session instead of stopping at 250 rows", async () => {
      await mountLongSession(1050);

      const pages = rumCalls().map(([params]) => [
        params.query.query.from,
        params.query.query.size,
      ]);
      expect(pages).toEqual([
        [0, 1000],
        [1000, 1000],
      ]);
      expect((wrapper.vm as any).correlatedViews).toHaveLength(1050);
    });

    it("stops after one page when the session has fewer rows than a page", async () => {
      await mountLongSession(12);

      expect(rumCalls()).toHaveLength(1);
      expect((wrapper.vm as any).correlatedViews).toHaveLength(12);
    });

    it("fetches metadata in batches of at most 40 ids, each under the 2,048-byte query-string limit", async () => {
      await mountLongSession(130);

      const filters = metadataFilters();
      expect(filters).toHaveLength(4);
      const requested = filters.flatMap(idsInFilter);
      expect(new Set(requested).size).toBe(130);
      for (const filter of filters) {
        expect(idsInFilter(filter).length).toBeLessThanOrEqual(40);
        // The filter travels as one query-string parameter beside the window and paging ones.
        expect(encodeURIComponent(filter).length).toBeLessThan(1800);
      }
      expect((wrapper.vm as any).correlatedViews.every((view: any) => view.metadata)).toBe(true);
    });

    it("keeps a row no stream claimed when one batch fails, and drops it when none does", async () => {
      const streamless = hexId(99);
      const claimAllButLast = (ids: string[]) =>
        Promise.resolve(
          Object.fromEntries(
            ids.filter((id) => id !== streamless).map((id) => [id, { stream: "default" }]),
          ),
        );

      mockResolveTraceLocationsBulk.mockImplementationOnce(claimAllButLast);
      mockFallbackTracesStream.mockResolvedValueOnce(null);
      await mountLongSession(100, (ids) => ids.includes(hexId(0)));
      let views = (wrapper.vm as any).correlatedViews;
      expect(views.some((view: any) => view.traceId === streamless)).toBe(true);

      mockResolveTraceLocationsBulk.mockImplementationOnce(claimAllButLast);
      mockFallbackTracesStream.mockResolvedValueOnce(null);
      await mountLongSession(100);
      views = (wrapper.vm as any).correlatedViews;
      expect(views.some((view: any) => view.traceId === streamless)).toBe(false);
      expect(views).toHaveLength(99);
    });

    it("keeps a failed batch's rows without metadata and shows a dash for their duration and status", async () => {
      await mountLongSession(100, (ids) => ids.includes(hexId(0)));

      const views = (wrapper.vm as any).correlatedViews;
      expect(views).toHaveLength(100);
      expect(views.filter((view: any) => view.metadata)).toHaveLength(60);
      expect((wrapper.vm as any).metadataError).toContain("403");

      const failedIndex = views.findIndex((view: any) => !view.metadata);
      const row = wrapper.find(`[data-test="table-row-${failedIndex}"]`);
      expect(row.text()).toContain("—");
      expect(row.text()).not.toContain("0us");
      expect(row.find('[data-test="trace-status-cell"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rum-player-traces-tab-metadata-error"]').exists()).toBe(
        true,
      );
    });

    it("orders the paged rows by device time and then trace id, so ties keep their place across pages", async () => {
      await mountLongSession(3);

      expect(rumCalls()[0][0].query.query.sql).toMatch(/ORDER BY _date ASC, _trace_id ASC$/);
      expect(wrapper.find('[data-test="rum-player-traces-tab-metadata-error"]').exists()).toBe(
        false,
      );
    });

    it("keeps the rows a partial metadata answer lacks, without metadata, and flags them", async () => {
      wrapper.unmount();
      setupLongSession(10);
      mockFetchQueryDataWithHttpStream.mockImplementation((request: any, handlers: any) => {
        const ids = idsInFilter(request.queryReq.filter).slice(0, 6);
        handlers.data(null, {
          content: {
            results: {
              is_partial: true,
              hits: ids.map((id) => createTraceMetadata({ trace_id: id })),
            },
          },
        });
        handlers.complete();
      });
      wrapper = mountComponent();
      await flushPromises();

      const views = (wrapper.vm as any).correlatedViews;
      expect(views).toHaveLength(10);
      expect(views.filter((view: any) => view.metadata)).toHaveLength(6);
      expect(wrapper.find('[data-test="rum-player-traces-tab-metadata-error"]').exists()).toBe(
        true,
      );
    });

    it("runs at most 4 metadata lookups at once and starts no more after unmount", async () => {
      wrapper.unmount();
      setupLongSession(400);
      // Streams that answer only when the test says so, so the first 4 batches stay in flight.
      const pendingHandlers: any[] = [];
      mockFetchQueryDataWithHttpStream.mockImplementation((_request: any, handlers: any) => {
        pendingHandlers.push(handlers);
      });
      wrapper = mountComponent();
      await flushPromises();
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(4);

      wrapper.unmount();
      // The cancelled streams answer late; no worker may move on to the next batch.
      pendingHandlers.forEach((handlers) => {
        handlers.data(null, { content: { results: { hits: [] } } });
        handlers.complete();
      });
      await flushPromises();
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(4);
    });

    it("loads a new session fully while the old session's metadata lookups are still pending", async () => {
      wrapper.unmount();
      mockSearch.mockReset();
      mockFetchQueryDataWithHttpStream.mockReset();
      const sessionIds = (sql: string) =>
        sql.includes("'session-a'")
          ? Array.from({ length: 400 }, (_, i) => hexId(i))
          : Array.from({ length: 10 }, (_, i) => hexId(5000 + i));
      mockSearch.mockImplementation(async (params: any, source: string) => {
        if (source !== "RUM" || params.page_type === "traces") return { data: { hits: [] } };
        const { sql, from } = params.query.query;
        const ids = from === 0 ? sessionIds(sql) : [];
        return {
          data: { hits: ids.map((id, i) => createRumHit({ _trace_id: id, _date: i + 1 })) },
        };
      });
      const sessionAIds = new Set(Array.from({ length: 400 }, (_, i) => hexId(i)));
      mockFetchQueryDataWithHttpStream.mockImplementation((request: any, handlers: any) => {
        const ids = idsInFilter(request.queryReq.filter);
        if (ids.some((id) => sessionAIds.has(id))) return; // session A's lookups never answer
        handlers.data(null, {
          content: { results: { hits: ids.map((id) => createTraceMetadata({ trace_id: id })) } },
        });
        handlers.complete();
      });

      wrapper = mountComponent({ props: { sessionId: "session-a" } });
      await flushPromises();
      expect(mockFetchQueryDataWithHttpStream).toHaveBeenCalledTimes(4);

      await wrapper.setProps({ sessionId: "session-b" });
      await flushPromises();

      const views = (wrapper.vm as any).correlatedViews;
      expect(views).toHaveLength(10);
      expect(views.every((view: any) => view.metadata)).toBe(true);
      expect((wrapper.vm as any).loading).toBe(false);
      // Session A started no batch beyond its first 4.
      const aCalls = metadataFilters().filter((filter) =>
        idsInFilter(filter).some((id) => sessionAIds.has(id)),
      );
      expect(aCalls).toHaveLength(4);
    });

    it("shows no partial-results chip for a session of exactly one full page", async () => {
      await mountLongSession(1000);

      expect(rumCalls()).toHaveLength(2);
      expect(wrapper.find('[data-test="rum-player-traces-tab-partial"]').exists()).toBe(false);
    });

    it("shows a partial-results chip when every page up to the 10,000 cap came back full", async () => {
      await mountLongSession(12000);

      expect(rumCalls()).toHaveLength(10);
      expect((wrapper.vm as any).correlatedViews).toHaveLength(10000);
      expect(wrapper.find('[data-test="rum-player-traces-tab-partial"]').exists()).toBe(true);
    }, 30_000);

    it("shows a partial-results chip for an is_partial page, also when no row came back", async () => {
      wrapper.unmount();
      setupLongSession(0);
      mockSearch.mockImplementation(async (params: any, source: string) => {
        if (source !== "RUM" || params.page_type === "traces") return { data: { hits: [] } };
        return { data: { is_partial: true, hits: [] } };
      });
      wrapper = mountComponent();
      await flushPromises();

      expect(wrapper.find('[data-test="rum-player-traces-tab-empty"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rum-player-traces-tab-partial-empty"]').exists()).toBe(true);
    });

    it("passes the fetch's abort signal to the operation-name lookup", async () => {
      await mountLongSession(3);

      const operationCalls = mockSearch.mock.calls.filter(
        ([params, source]) => source === "RUM" && params.page_type === "traces",
      );
      expect(operationCalls.length).toBeGreaterThan(0);
      const signal = operationCalls[0][0].signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);

      wrapper.unmount();
      expect(signal.aborted).toBe(true);
    });

    function setupGatedSessions() {
      mockSearch.mockReset();
      mockFetchQueryDataWithHttpStream.mockReset();
      let releaseA: () => void = () => {};
      const gateA = new Promise<void>((resolve) => (releaseA = resolve));
      mockSearch.mockImplementation(async (params: any, source: string) => {
        if (source !== "RUM" || params.page_type === "traces") return { data: { hits: [] } };
        if (params.query.query.sql.includes("'session-a'")) {
          await gateA;
          return { data: { hits: [createRumHit({ _trace_id: hexId(1) })] } };
        }
        return { data: { hits: [createRumHit({ _trace_id: hexId(2) })] } };
      });
      mockFetchQueryDataWithHttpStream.mockImplementation((request: any, handlers: any) => {
        const ids = idsInFilter(request.queryReq.filter);
        handlers.data(null, {
          content: { results: { hits: ids.map((id) => createTraceMetadata({ trace_id: id })) } },
        });
        handlers.complete();
      });
      return () => releaseA();
    }

    it("drops a superseded session's results when the session changes mid-load", async () => {
      wrapper.unmount();
      const releaseA = setupGatedSessions();
      wrapper = mountComponent({ props: { sessionId: "session-a" } });
      await flushPromises();

      await wrapper.setProps({ sessionId: "session-b" });
      await flushPromises();
      releaseA();
      await flushPromises();

      const views = (wrapper.vm as any).correlatedViews;
      expect(views.map((view: any) => view.traceId)).toEqual([hexId(2)]);
      expect((wrapper.vm as any).loading).toBe(false);
      const looked = metadataFilters().flatMap(idsInFilter);
      expect(looked).not.toContain(hexId(1));
    });

    it("starts no trace lookup after the tab unmounts mid-load", async () => {
      wrapper.unmount();
      const releaseA = setupGatedSessions();
      mockResolveTraceLocationsBulk.mockClear();
      wrapper = mountComponent({ props: { sessionId: "session-a" } });
      await flushPromises();

      wrapper.unmount();
      releaseA();
      await flushPromises();

      expect(mockResolveTraceLocationsBulk).not.toHaveBeenCalled();
      expect(mockFetchQueryDataWithHttpStream).not.toHaveBeenCalled();
    });
  });
});
