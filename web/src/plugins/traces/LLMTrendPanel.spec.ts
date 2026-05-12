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

// @vitest-environment jsdom
//
// SFC-level tests for `LLMTrendPanel.vue`. Pure helpers (`intervalToMs`,
// `formatCompact`, `formatLatencyMs`, `formatCostCell`, etc.) are
// tested in `llmTrendPanel.utils.spec.ts`; the chart-option builders
// (`buildStackedAreaOption`, etc.) are heavy on echarts internals and
// remain unit-untested by design. This file pins the wiring:
//   • fetch lifecycle (guards, lazy load, dual-query for histograms)
//   • render-state transitions (skeleton → error → empty → data)
//   • table rendering + view-trace emit
//   • IntersectionObserver setup + teardown
//   • props watcher → re-fetch

// ---------------------------------------------------------------------------
// vi.mock() — hoisted above imports.
// ---------------------------------------------------------------------------

const mockExecuteQuery = vi.fn();

vi.mock("./composables/useLLMStreamQuery", () => ({
  useLLMStreamQuery: () => ({
    executeQuery: mockExecuteQuery,
    cancelAll: vi.fn(),
  }),
}));

vi.mock("vuex", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    useStore: () => ({
      state: { theme: "light" },
    }),
  };
});

// Capture IntersectionObserver instances so tests can drive
// visibility changes manually.
const observers: any[] = [];
class MockIntersectionObserver {
  callback: any;
  options: any;
  observed: Element[] = [];
  constructor(cb: any, opts: any) {
    this.callback = cb;
    this.options = opts;
    observers.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  unobserve() {}
  disconnect = vi.fn();
  /** Test helper: emit a visibility change. */
  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting }]);
  }
}

// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import LLMTrendPanel from "./LLMTrendPanel.vue";
import type { LLMPanelDef } from "./config/llmInsightsPanels";

const baseStartTime = 1_700_000_000_000_000;
const baseEndTime = 1_700_001_000_000_000;

/** Minimal stacked-area panel def for fetch-flow tests. */
const stackedAreaPanel: LLMPanelDef = {
  id: "test-area",
  title: "Test Area Panel",
  subtitle: "for unit tests",
  type: "stacked-area",
  layout: { colSpan: 1 },
  query: {
    sql: "SELECT * FROM {{stream}}",
    timeField: "ts",
    valueField: "value",
  },
};

/** Histogram-with-thresholds panel — fires TWO queries on load. */
const histogramPanel: LLMPanelDef = {
  id: "test-histo",
  title: "Histogram Panel",
  type: "histogram-with-thresholds",
  layout: { colSpan: 1 },
  query: { sql: "SELECT duration FROM {{stream}}", valueField: "duration" },
  thresholdsQuery: { sql: "SELECT p99_ms FROM {{stream}}" },
  thresholds: [{ field: "p99_ms", label: "p99", color: "#ef4444" }],
};

/** Table panel — used to test the recent-errors render path. */
const tablePanel: LLMPanelDef = {
  id: "test-table",
  title: "Recent Errors",
  subtitle: "last failed spans",
  type: "table",
  layout: { colSpan: 2 },
  emptyStateText: "No errors in this time range",
  query: { sql: "SELECT _timestamp, trace_id FROM {{stream}} LIMIT 10" },
  columns: [
    { field: "_timestamp", label: "Time", format: "time" },
    { field: "trace_id", label: "Trace ID", format: "text" },
    { field: "trace_id", label: "", format: "view-link", align: "right" },
  ],
};

function mountPanel(panel: LLMPanelDef, propsOverrides = {}) {
  return mount(LLMTrendPanel, {
    props: {
      panel,
      streamName: "default",
      startTime: baseStartTime,
      endTime: baseEndTime,
      ...propsOverrides,
    },
    global: {
      stubs: {
        ChartRenderer: { template: "<div data-test=\"chart-renderer\" />" },
        SkeletonBox: {
          template: "<div data-test=\"skeleton-box\" />",
          props: ["width", "height", "rounded"],
        },
      },
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  observers.length = 0;
  // @ts-expect-error — jsdom doesn't ship IntersectionObserver.
  global.IntersectionObserver = MockIntersectionObserver;
});

afterEach(() => {
  observers.length = 0;
});

// ===========================================================================
// Render: title + subtitle
// ===========================================================================

describe("LLMTrendPanel — header", () => {
  it("renders the panel title", () => {
    const wrapper = mountPanel(stackedAreaPanel);
    expect(wrapper.text()).toContain("Test Area Panel");
  });

  it("renders the subtitle when provided", () => {
    const wrapper = mountPanel(stackedAreaPanel);
    expect(wrapper.text()).toContain("for unit tests");
  });

  // Subtitle is gated by `v-if="panel.subtitle"` — verify the gate.
  it("does not render the subtitle element when omitted", () => {
    const wrapper = mountPanel({ ...stackedAreaPanel, subtitle: undefined });
    expect(wrapper.text()).not.toContain("for unit tests");
  });
});

// ===========================================================================
// Fetch lifecycle — guards
// ===========================================================================

describe("LLMTrendPanel — fetch guards", () => {
  // Lazy-load: panel defers fetching until it scrolls into view. After
  // mount but before the IntersectionObserver fires visible=true, no
  // query should run.
  it("defers the fetch until the panel becomes visible", async () => {
    mountPanel(stackedAreaPanel);
    await flushPromises();
    expect(mockExecuteQuery).not.toHaveBeenCalled();
  });

  // Once the observer reports the panel as visible, the main query
  // fires. For stacked-area panels there's no thresholds query so
  // exactly one call.
  it("fires the main query when the panel becomes visible", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    mountPanel(stackedAreaPanel);
    await flushPromises();
    // Drive visibility — wait for the setTimeout in onMounted.
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
  });

  // Histogram panel runs both the main raw-duration query AND the
  // separate thresholds query in parallel. Verify both fire.
  it("fires both queries for histogram-with-thresholds panels", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    mountPanel(histogramPanel);
    await flushPromises();
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  // The SQL template's {{stream}} placeholder is filled in via
  // renderPanelSql — verify the substituted SQL reaches executeQuery.
  it("renders the SQL template before fetching", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    mountPanel(stackedAreaPanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    const [sql, start, end] = mockExecuteQuery.mock.calls[0];
    expect(sql).toContain(`"default"`); // stream substituted + quoted
    expect(start).toBe(baseStartTime);
    expect(end).toBe(baseEndTime);
  });
});

// ===========================================================================
// Render-state transitions
// ===========================================================================

describe("LLMTrendPanel — render state", () => {
  // Loading skeleton renders while a fetch is in-flight (and on the
  // first load before hasLoadedOnce is set). The skeleton's *contents*
  // vary by panel type (SVG for stacked-area, bar shapes for
  // horizontal-bar, row skeletons for tables) so we assert the
  // wrapper class is present rather than a specific inner element.
  it("renders the skeleton when loading", async () => {
    // Make executeQuery hang so loading stays true.
    mockExecuteQuery.mockImplementation(() => new Promise(() => {}));
    const wrapper = mountPanel(stackedAreaPanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    expect(wrapper.find(".llm-panel-skeleton").exists()).toBe(true);
  });

  // After a successful empty fetch (hits = []), the empty state renders
  // with the panel-defined fallback text.
  it("renders the empty state when fetch returns no rows", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const wrapper = mountPanel(stackedAreaPanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    expect(wrapper.text()).toContain("No data");
  });

  // Table panels can override the empty-state text via `emptyStateText`.
  it("renders the panel's custom emptyStateText when set", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const wrapper = mountPanel(tablePanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    expect(wrapper.text()).toContain("No errors in this time range");
  });

  // Error path: executeQuery rejects → errorMsg populated → error
  // text rendered in place of the chart.
  it("renders the error message when the query fails", async () => {
    mockExecuteQuery.mockRejectedValue(new Error("schema error"));
    const wrapper = mountPanel(stackedAreaPanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    expect(wrapper.text()).toContain("schema error");
  });

  // When the query rejects without a usable message, the panel falls
  // back to a generic string.
  it("falls back to a generic error string for empty rejections", async () => {
    mockExecuteQuery.mockRejectedValue({});
    const wrapper = mountPanel(stackedAreaPanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    expect(wrapper.text()).toContain("Failed to load panel");
  });
});

// ===========================================================================
// Table rendering
// ===========================================================================

describe("LLMTrendPanel — table rendering", () => {
  // The table renders one <tr> per row from hits. Each column resolves
  // via row[col.field] except for view-link which is a button cell.
  it("renders one row per hit with column values", async () => {
    mockExecuteQuery.mockResolvedValue([
      { _timestamp: 1_700_000_000_000_000, trace_id: "trace-A" },
      { _timestamp: 1_700_000_500_000_000, trace_id: "trace-B" },
    ]);
    const wrapper = mountPanel(tablePanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();

    expect(wrapper.text()).toContain("trace-A");
    expect(wrapper.text()).toContain("trace-B");
  });

  // The "view-link" column renders a clickable anchor that emits
  // `view-trace` with the row's trace_id. This is what wires the
  // recent-errors row into the dashboard's onViewTrace handler.
  it("emits view-trace with the row's trace_id when the link is clicked", async () => {
    mockExecuteQuery.mockResolvedValue([
      { _timestamp: 1_700_000_000_000_000, trace_id: "trace-clicked" },
    ]);
    const wrapper = mountPanel(tablePanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();

    // Find and click the "View →" link
    const viewLink = wrapper
      .findAll("a")
      .find((a) => a.text().includes("View"));
    expect(viewLink).toBeDefined();
    await viewLink!.trigger("click");

    const emitted = wrapper.emitted("view-trace");
    expect(emitted).toBeTruthy();
    expect(emitted![0]).toEqual(["trace-clicked"]);
  });

  // Defensive: empty trace_id still emits, recipient (dashboard's
  // onViewTrace) has its own guard. But verify the cell renders.
  it("renders the View link even when the value is empty", async () => {
    mockExecuteQuery.mockResolvedValue([{ _timestamp: 1, trace_id: "" }]);
    const wrapper = mountPanel(tablePanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();

    const viewLink = wrapper
      .findAll("a")
      .find((a) => a.text().includes("View"));
    expect(viewLink).toBeDefined();
  });
});

// ===========================================================================
// Props watcher — re-fetch on input changes
// ===========================================================================

describe("LLMTrendPanel — props watcher", () => {
  // Time-range change should trigger a re-fetch (after visibility).
  // Verify a second executeQuery call fires.
  it("re-fetches when startTime changes", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const wrapper = mountPanel(stackedAreaPanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);

    // Change the window — the watcher should fire loadPanel again.
    await wrapper.setProps({ startTime: baseStartTime + 100 });
    await flushPromises();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when streamName changes", async () => {
    mockExecuteQuery.mockResolvedValue([]);
    const wrapper = mountPanel(stackedAreaPanel);
    await new Promise((r) => setTimeout(r, 10));
    observers[0]?.trigger(true);
    await flushPromises();
    mockExecuteQuery.mockClear();

    await wrapper.setProps({ streamName: "other-stream" });
    await flushPromises();
    expect(mockExecuteQuery).toHaveBeenCalledTimes(1);
    const [sql] = mockExecuteQuery.mock.calls[0];
    expect(sql).toContain(`"other-stream"`);
  });
});

// ===========================================================================
// IntersectionObserver lifecycle
// ===========================================================================

describe("LLMTrendPanel — IntersectionObserver lifecycle", () => {
  // The observer is created in onMounted with the documented rootMargin.
  // We deliberately want this margin so panels start loading 200px
  // before they scroll into view.
  it("creates an IntersectionObserver with 200px rootMargin", async () => {
    mountPanel(stackedAreaPanel);
    await flushPromises();
    expect(observers.length).toBe(1);
    expect(observers[0].options.rootMargin).toBe("200px");
  });

  // onUnmounted disconnects the observer — without this, observers
  // would leak across panel remounts (e.g., on time-range refresh).
  it("disconnects the observer on unmount", async () => {
    const wrapper = mountPanel(stackedAreaPanel);
    await flushPromises();
    const observer = observers[0];
    wrapper.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
  });
});
