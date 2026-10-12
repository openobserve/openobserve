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
import { ref } from "vue";
import TraceDetails from "@/plugins/traces/TraceDetails.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

const mocks = vi.hoisted(() => ({
  getTraceDetails: vi.fn(),
  fetchRum: vi.fn(),
  formatRum: vi.fn(),
  notifyError: vi.fn(),
}));

vi.mock("@/services/search", async (importOriginal) => {
  const actual = (await importOriginal()) as { default: Record<string, unknown> };
  return { default: { ...actual.default, get_trace_details: mocks.getTraceDetails } };
});

vi.mock("@/composables/rum/useRumSpanBuilder", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    default: () => ({
      fetchRumEventsForTrace: mocks.fetchRum,
      formatRumEventsAsSpans: mocks.formatRum,
    }),
  };
});

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({ showErrorNotification: mocks.notifyError }),
}));

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

vi.mock("@/composables/useStreams", () => ({
  default: () => ({
    getStreams: vi.fn().mockResolvedValue({ list: [{ name: "test-stream" }] }),
    getStream: vi.fn().mockResolvedValue({ name: "test-stream", schema: [] }),
  }),
}));

vi.mock("@/composables/useServiceCorrelation", () => ({
  useServiceCorrelation: () => ({ loadKeyFields: vi.fn().mockResolvedValue({}) }),
  TRACE_SERVICE_DETECTION_KEY: Symbol("traceServiceDetection"),
  initServiceCorrelationProviders: vi.fn(),
}));

const node = document.createElement("div");
node.setAttribute("id", "app");
node.style.height = "1024px";
document.body.appendChild(node);

const BASE_NS = 1_755_853_746_000_000_000;

function span(id: string, parent: string, offsetUs: number, service = "svc-a", extra = {}) {
  const start = BASE_NS + offsetUs * 1_000;
  return {
    _timestamp: Math.floor(start / 1_000),
    trace_id: "trace-a",
    span_id: id,
    reference_parent_span_id: parent,
    start_time: start,
    end_time: start + 1_000_000,
    duration: 1_000,
    operation_name: `op-${id}`,
    service_name: service,
    span_kind: "2",
    span_status: "OK",
    ...extra,
  };
}

function page(hits: any[], hasMore: boolean, extra: Record<string, unknown> = {}) {
  const last = hits[hits.length - 1];
  return {
    data: {
      hits,
      total: hits.length,
      has_more: hasMore,
      next_after: hasMore ? { start_time: String(last.start_time), span_id: last.span_id } : null,
      ...extra,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const STUBS = {
  "chart-renderer": { template: "<div />", props: ["data", "id"] },
  "trace-tree": {
    template: '<div data-test="trace-tree" />',
    props: ["collapseMapping", "spans", "baseTracePosition", "spanDimensions", "spanMap"],
    methods: { nextMatch: vi.fn(), prevMatch: vi.fn(), cancelScroll: vi.fn() },
  },
  "trace-header": { template: "<div />", props: ["baseTracePosition", "splitterWidth"] },
  "trace-details-sidebar": { template: "<div />", props: ["span"] },
};

const TRUNCATED = '[data-test="trace-details-truncated-banner"]';
const PARTIAL = '[data-test="trace-details-partial-banner"]';
const LOAD_MORE = '[data-test="trace-details-load-more-btn"]';

// A ref, so a route change reaches computeds that read the current route, as navigation would.
const currentRoute = ref<any>(null);

function setRoute(traceId: string) {
  currentRoute.value = {
    query: {
      trace_id: traceId,
      from: "1755853740000000",
      to: "1755853750000000",
      stream: "test-stream",
      org_identifier: "default",
    },
    name: "traceDetails",
  };
  vi.spyOn(router, "currentRoute", "get").mockReturnValue(currentRoute as any);
}

const spanIds = (wrapper: any) => wrapper.vm.spanList.map((s: any) => s.span_id).sort();

describe("TraceDetails - keyset paging", () => {
  let wrapper: any;

  async function mountDetails() {
    wrapper = mount(TraceDetails, {
      attachTo: "#app",
      props: { traceId: "trace-a" },
      global: { plugins: [i18n, router], provide: { store }, stubs: STUBS },
    });
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.vm.spanList.length).toBeGreaterThan(0));
    await flushPromises();
  }

  beforeEach(() => {
    localStorage.removeItem("o2_trace_active_tab");
    localStorage.removeItem("o2_trace_tab_order");
    mocks.getTraceDetails.mockReset();
    mocks.fetchRum.mockReset();
    mocks.formatRum.mockReset();
    mocks.notifyError.mockReset();
    mocks.fetchRum.mockResolvedValue({
      tracedResources: [],
      viewEvents: [],
      actionEvents: [],
      allViewEvents: [],
    });
    mocks.formatRum.mockReturnValue([]);
    setRoute("trace-a");
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  it("shows the truncation banner and a load-more button while the trace has more spans", async () => {
    mocks.getTraceDetails.mockResolvedValueOnce(
      page([span("r", "", 0), span("a", "r", 10), span("b", "r", 20)], true),
    );
    await mountDetails();

    expect(wrapper.find(TRUNCATED).text()).toContain("Showing the first 3 spans of this trace");
    expect(wrapper.find(LOAD_MORE).text()).toContain("Load next 3 spans");
    expect(wrapper.find(PARTIAL).exists()).toBe(false);
  });

  it("hides the banner when the first page is the whole trace", async () => {
    mocks.getTraceDetails.mockResolvedValueOnce(
      page([span("r", "", 0), span("a", "r", 10)], false),
    );
    await mountDetails();

    expect(wrapper.find(TRUNCATED).exists()).toBe(false);
    expect(wrapper.find(LOAD_MORE).exists()).toBe(false);
  });

  it("loads the next page by cursor, deduplicates it and re-parents an orphan", async () => {
    // x starts before its parent p, so it arrives on page 1 and p on page 2.
    mocks.getTraceDetails
      .mockResolvedValueOnce(page([span("r", "", 0), span("x", "p", 5)], true))
      .mockResolvedValueOnce(page([span("x", "p", 5), span("p", "r", 6)], false));
    await mountDetails();
    expect(wrapper.vm.traceTree.map((s: any) => s.spanId)).toEqual(["r", "x"]);

    await wrapper.find(LOAD_MORE).trigger("click");
    await flushPromises();

    expect(mocks.getTraceDetails).toHaveBeenCalledTimes(2);
    expect(mocks.getTraceDetails.mock.calls[1][0]).toMatchObject({
      trace_id: "trace-a",
      after_start_time: String(BASE_NS + 5_000),
      after_span_id: "x",
    });
    expect(spanIds(wrapper)).toEqual(["p", "r", "x"]);
    const [root] = wrapper.vm.traceTree;
    expect(wrapper.vm.traceTree).toHaveLength(1);
    expect(root.spanId).toBe("r");
    expect(root.spans[0].spanId).toBe("p");
    expect(root.spans[0].spans[0].spanId).toBe("x");
    expect(wrapper.find(TRUNCATED).exists()).toBe(false);
  });

  it("shows the partial banner for a partial page, even when it is short and final", async () => {
    mocks.getTraceDetails.mockResolvedValueOnce(
      page([span("r", "", 0)], false, { is_partial: true }),
    );
    await mountDetails();

    expect(wrapper.find(PARTIAL).text()).toContain(
      "Some spans of this trace could not be read. The waterfall may be incomplete.",
    );
    expect(wrapper.find(TRUNCATED).exists()).toBe(false);
  });

  it("never appends a late page of trace A to trace B", async () => {
    const lateA = deferred<any>();
    let firstPages = 0;
    mocks.getTraceDetails.mockImplementation((args: any) => {
      if (args.after_span_id) return lateA.promise;
      firstPages++;
      return Promise.resolve(
        firstPages === 1
          ? page([span("r", "", 0), span("a", "r", 10)], true)
          : page([span("b1", "", 0, "svc-b"), span("b2", "b1", 10, "svc-b")], false),
      );
    });
    await mountDetails();

    await wrapper.find(LOAD_MORE).trigger("click");
    // Opening a trace link resets the shared trace state and loads the new trace.
    setRoute("trace-b");
    await wrapper.vm.openTraceLink();
    await flushPromises();
    expect(mocks.getTraceDetails.mock.calls.at(-1)[0].trace_id).toBe("trace-b");
    expect(spanIds(wrapper)).toEqual(["b1", "b2"]);

    lateA.resolve(page([span("z", "a", 20)], false));
    await flushPromises();

    expect(spanIds(wrapper)).toEqual(["b1", "b2"]);
    expect(wrapper.vm.traceTree.map((s: any) => s.spanId)).toEqual(["b1"]);
  });

  it("drops a late page of trace A once its view unmounts and trace B mounts", async () => {
    const lateA = deferred<any>();
    mocks.getTraceDetails.mockImplementation((args: any) => {
      if (args.after_span_id) return lateA.promise;
      return Promise.resolve(
        args.trace_id === "trace-a"
          ? page([span("r", "", 0), span("a", "r", 10)], true)
          : page([span("b1", "", 0, "svc-b"), span("b2", "b1", 10, "svc-b")], false),
      );
    });
    await mountDetails();
    await wrapper.find(LOAD_MORE).trigger("click");
    wrapper.unmount();

    setRoute("trace-b");
    await mountDetails();
    expect(spanIds(wrapper)).toEqual(["b1", "b2"]);

    lateA.resolve(page([span("z", "a", 20)], false));
    await flushPromises();

    expect(spanIds(wrapper)).toEqual(["b1", "b2"]);
  });

  it("enriches with RUM once, after the page that first brings a dangling parent", async () => {
    mocks.getTraceDetails
      .mockResolvedValueOnce(page([span("r", "", 0), span("a", "r", 10)], true))
      .mockResolvedValueOnce(page([span("b", "browser-req", 20)], false));
    await mountDetails();
    expect(mocks.fetchRum).not.toHaveBeenCalled();

    await wrapper.find(LOAD_MORE).trigger("click");
    await flushPromises();

    expect(mocks.fetchRum).toHaveBeenCalledTimes(1);
    const [traceId, spans] = mocks.fetchRum.mock.calls[0];
    expect(traceId).toBe("trace-a");
    expect(spans.map((s: any) => s.span_id)).toEqual(["r", "a", "b"]);
  });

  it("tries RUM again on a later page while it has found nothing for a dangling parent", async () => {
    mocks.getTraceDetails
      .mockResolvedValueOnce(page([span("r", "", 0), span("x", "q", 5)], true))
      .mockResolvedValueOnce(page([span("y", "w", 6)], false));
    await mountDetails();
    expect(mocks.fetchRum).toHaveBeenCalledTimes(1);

    await wrapper.find(LOAD_MORE).trigger("click");
    await flushPromises();

    expect(mocks.fetchRum).toHaveBeenCalledTimes(2);
    expect(mocks.fetchRum.mock.calls[1][1].map((s: any) => s.span_id)).toEqual(["r", "x", "y"]);
  });

  it("tells the user when the next page fails to load, and keeps Load more", async () => {
    mocks.getTraceDetails
      .mockResolvedValueOnce(page([span("r", "", 0), span("a", "r", 10)], true))
      .mockRejectedValueOnce(new Error("network down"));
    await mountDetails();

    await wrapper.find(LOAD_MORE).trigger("click");
    await flushPromises();

    expect(mocks.notifyError).toHaveBeenCalledWith(
      i18n.global.t("traces.traceDetails.loadMoreFailed"),
    );
    expect(wrapper.find(LOAD_MORE).exists()).toBe(true);
    expect(spanIds(wrapper)).toEqual(["a", "r"]);
  });

  it("replaces a synthetic RUM span with the native span a later page brings", async () => {
    mocks.getTraceDetails
      .mockResolvedValueOnce(page([span("r", "", 0), span("x", "q", 5)], true))
      .mockResolvedValueOnce(page([span("q", "r", 6)], false));
    mocks.formatRum.mockReturnValue([span("q", "r", 4, "Frontend", { _is_trace_bridge: true })]);
    await mountDetails();
    expect(wrapper.vm.spanList.find((s: any) => s.span_id === "q")._is_trace_bridge).toBe(true);

    await wrapper.find(LOAD_MORE).trigger("click");
    await flushPromises();

    expect(mocks.fetchRum).toHaveBeenCalledTimes(1);
    const q = wrapper.vm.spanList.filter((s: any) => s.span_id === "q");
    expect(q).toHaveLength(1);
    expect(q[0]._is_trace_bridge).toBeUndefined();
    expect(q[0].service_name).toBe("svc-a");
  });
});

describe("TraceDetails - large and deep traces", () => {
  let wrapper: any;

  beforeEach(() => {
    localStorage.removeItem("o2_trace_active_tab");
    localStorage.removeItem("o2_trace_tab_order");
    mocks.getTraceDetails.mockReset();
    mocks.fetchRum.mockReset();
    mocks.formatRum.mockReset();
    mocks.notifyError.mockReset();
    mocks.fetchRum.mockResolvedValue({
      tracedResources: [],
      viewEvents: [],
      actionEvents: [],
      allViewEvents: [],
    });
    mocks.formatRum.mockReturnValue([]);
    setRoute("trace-a");
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.restoreAllMocks();
  });

  async function mountWith(hits: any[]) {
    mocks.getTraceDetails.mockResolvedValueOnce(page(hits, false));
    wrapper = mount(TraceDetails, {
      attachTo: "#app",
      props: { traceId: "trace-a" },
      global: { plugins: [i18n, router], provide: { store }, stubs: STUBS },
    });
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.vm.spanList.length).toBe(hits.length), {
      timeout: 30_000,
    });
    await flushPromises();
  }

  it("builds the waterfall and service tree of a 20,000-level chain", async () => {
    const chain = Array.from({ length: 20_000 }, (_, i) =>
      span(`s${i}`, i === 0 ? "" : `s${i - 1}`, i, i % 2 ? "svc-b" : "svc-a"),
    );
    await mountWith(chain);

    const positions = wrapper.vm.spanPositionList;
    expect(positions).toHaveLength(20_000);
    expect(positions.every((s: any, i: number) => s.depth === i && s.spanId === `s${i}`)).toBe(
      true,
    );
    let depth = 0;
    let level = wrapper.vm.traceServiceMap.options.series[0].data;
    while (level?.length) {
      depth++;
      level = level[0].children;
    }
    expect(depth).toBe(20_000);
  }, 60_000);

  it("keeps the waterfall rows and totals of a branching trace", async () => {
    await mountWith([
      span("r", "", 0),
      span("a", "r", 10),
      span("b", "a", 20, "svc-b"),
      span("c", "r", 30, "svc-b"),
      span("d", "c", 40),
    ]);

    expect(
      wrapper.vm.spanPositionList.map((s: any) => [s.spanId, s.depth, s.currentIndex]),
    ).toEqual([
      ["r", 0, 0],
      ["a", 1, 1],
      ["b", 2, 2],
      ["c", 1, 3],
      ["d", 2, 4],
    ]);
    const byId = Object.fromEntries(wrapper.vm.spanPositionList.map((s: any) => [s.spanId, s]));
    expect(byId.r.totalSpans).toBe(4);
    expect(byId.a.totalSpans).toBe(1);
    expect(byId.d.totalSpans).toBe(0);
    const names = (nodes: any[]): any[] =>
      nodes.map((n) => [n.name.split(" ")[0], names(n.children)]);
    expect(names(wrapper.vm.traceServiceMap.options.series[0].data)).toEqual([
      [
        "svc-a",
        [
          ["svc-b", []],
          ["svc-b", [["svc-a", []]]],
        ],
      ],
    ]);
  });

  it("computes the trace bounds of 200,000 spans without a RangeError", async () => {
    await mountWith([span("r", "", 0), span("a", "r", 10)]);
    const big = Array.from({ length: 200_000 }, (_, i) => ({
      ...span(`s${i}`, "r", i),
      end_time: BASE_NS + i * 1_000 + 5_000,
    }));
    wrapper.vm.searchObj.data.traceDetails.spanList = big;
    await flushPromises();

    const lastEnd = BASE_NS + 199_999 * 1_000 + 5_000;
    expect(wrapper.vm.traceStartTime).toBe(BASE_NS);
    expect(wrapper.vm.traceMetadata).toMatchObject({
      total_spans: 200_000,
      start_time: BASE_NS,
      end_time: lastEnd,
    });
    expect(wrapper.vm.traceEvaluationRange).toEqual({
      startTime: Math.floor(BASE_NS / 1_000) - 1,
      endTime: Math.ceil(lastEnd / 1_000) + 1,
    });
  }, 60_000);
});
