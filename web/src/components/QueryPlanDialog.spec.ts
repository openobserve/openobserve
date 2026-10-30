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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import { AGG_LOGICAL_PLAN, AGG_PHYSICAL_PLAN } from "@/utils/__fixtures__/queryProfile.fixture";

const mockGetSearchQueryPayload = vi.fn();

vi.mock("@/composables/useLogs/useSearchStream", () => ({
  useSearchStream: () => ({
    getSearchQueryPayload: mockGetSearchQueryPayload,
  }),
}));

vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: { data: { stream: { streamType: "logs" }, query: "SELECT * FROM logs" } },
  }),
}));

const mockStreamingSearch = vi.fn();
const mockCancelStream = vi.fn();
vi.mock("@/services/streaming_search", () => ({
  default: {
    search: (...args: unknown[]) => mockStreamingSearch(...args),
    cancelStream: (...args: unknown[]) => mockCancelStream(...args),
  },
}));

let traceSeq = 0;
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, generateTraceContext: vi.fn(() => ({ traceId: `trace-${++traceSeq}` })) };
});

const mockToast = vi.fn();
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

import QueryPlanDialog from "./QueryPlanDialog.vue";

const SQL = "SELECT k8s_namespace_name,\n  count(*) AS cnt\nFROM app_logs";

const SEARCH_OBJ = {
  data: {
    query: SQL,
    stream: { streamType: "logs", selectedStream: ["app_logs"] },
    datetime: { type: "relative", relativeTimePeriod: "15m", startTime: 1, endTime: 2 },
    queryResults: { took: 1840 },
  },
};

const oDialogStub = {
  name: "ODialog",
  inheritAttrs: false,
  template: `<div data-test="o-dialog" v-if="open">
    <div data-test="o-dialog-title">{{ title }}</div>
    <slot name="header-left" /><slot name="header-right" /><slot />
  </div>`,
  props: ["open", "size", "title"],
  emits: ["update:open"],
};

const oButtonStub = {
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
  props: ["variant", "size", "disabled", "iconLeft", "iconRight"],
  emits: ["click"],
};

const oToggleGroupStub = {
  name: "OToggleGroup",
  template: '<div data-test="query-plan-mode" :data-value="modelValue"><slot /></div>',
  props: ["modelValue", "type"],
  emits: ["update:modelValue"],
};

const stub = (name: string, dataTest: string, props: string[]) => ({
  name,
  template: `<div data-test="${dataTest}" />`,
  props,
});

function sse(payload: unknown) {
  return `event: search_response_hits\ndata: ${JSON.stringify(payload)}\n\n`;
}

const STREAM_ERROR_SSE = `event: error\ndata: ${JSON.stringify({ code: 500, message: "Resources exhausted: Failed to allocate 512 MB", error_detail: null })}\n\n`;

const EXPLAIN_SSE = sse({
  hits: [
    { plan_type: "logical_plan", plan: AGG_LOGICAL_PLAN },
    { plan_type: "physical_plan", plan: AGG_PHYSICAL_PLAN },
  ],
});

const OLD_ANALYZE_SSE = sse({
  hits: [
    { phase: 1, plan: "DataSourceExec: metrics=[output_rows=5]\n" },
    { phase: 0, plan: "RemoteScanExec: metrics=[output_rows=5]\n" },
  ],
});

const PROFILE = {
  version: 1,
  node_name: "q-0",
  node_address: "10.0.0.1:5081",
  start_us: 1,
  end_us: 2,
  output_rows: 1,
  plan: {
    name: "RemoteScanExec",
    detail: "RemoteScanExec",
    partitions: 2,
    remote: ["q-1", "i-0"].map((node_name, partition) => ({
      partition,
      node_name,
      node_address: "",
      role: node_name.startsWith("q") ? "querier" : "ingester",
      start_us: 1,
      end_us: 2,
      first_batch_us: 0,
      output_rows: 1,
    })),
  },
};

const PROFILE_SSE = `event: search_response_metadata\ndata: ${JSON.stringify({
  results: { took: 2500, hits: [], total: 1 },
})}\n\n${sse({
  hits: [
    { phase: 0, plan: "ProjectionExec\n", profile: JSON.stringify(PROFILE) },
    { phase: 1, plan: "DataSourceExec\n", profile: null },
  ],
})}`;

function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(QueryPlanDialog, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ODialog: oDialogStub,
        OButton: oButtonStub,
        OToggleGroup: oToggleGroupStub,
        OToggleGroupItem: {
          template: '<span class="toggle-item"><slot /></span>',
          props: ["value", "size"],
        },
        QueryPlanView: {
          name: "QueryPlanView",
          template: '<div data-test="query-plan-view-stub" @click="$emit(\'analyze\')" />',
          props: ["model"],
          emits: ["analyze"],
        },
        QueryProfileView: stub("QueryProfileView", "query-profile-view", ["model", "stream"]),
        QueryPlanText: stub("QueryPlanText", "query-plan-text", [
          "physicalPlan",
          "logicalPlan",
          "analyzePlan",
        ]),
        QueryPlanTree: stub("QueryPlanTree", "query-plan-tree", ["tree", "isAnalyze"]),
        MetricsSummaryCard: stub("MetricsSummaryCard", "metrics-summary-card", ["metrics"]),
      },
    },
    props: { modelValue: false, searchObj: SEARCH_OBJ, ...props },
  });
}

async function openDialog(props: Record<string, unknown> = {}) {
  const wrapper = mountDialog(props);
  await wrapper.setProps({ modelValue: true });
  await flushPromises();
  return wrapper;
}

async function selectMode(wrapper: VueWrapper, mode: string) {
  wrapper.findComponent({ name: "OToggleGroup" }).vm.$emit("update:modelValue", mode);
  await flushPromises();
}

function sentSql(call: number) {
  return mockStreamingSearch.mock.calls[call][0].query.query.sql;
}

function find(wrapper: VueWrapper, dataTest: string) {
  return wrapper.find(`[data-test="${dataTest}"]`);
}

async function click(wrapper: VueWrapper, dataTest: string) {
  await find(wrapper, dataTest).trigger("click");
  await flushPromises();
}

async function tick(wrapper: VueWrapper, ms: number) {
  vi.advanceTimersByTime(ms);
  await wrapper.vm.$nextTick();
}

async function openAndRun(response: string | Promise<unknown>) {
  const wrapper = await openDialog();
  await selectMode(wrapper, "analyze");
  mockStreamingSearch.mockReturnValue(
    typeof response === "string" ? Promise.resolve({ data: response }) : response,
  );
  await click(wrapper, "query-plan-analyze-run");
  return wrapper;
}

describe("QueryPlanDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    mockGetSearchQueryPayload.mockReset();
    mockStreamingSearch.mockReset();
    mockCancelStream.mockReset();
    mockCancelStream.mockResolvedValue({});
    mockGetSearchQueryPayload.mockReturnValue({ query: { sql: "SELECT * FROM logs" } });
    mockStreamingSearch.mockResolvedValue({ data: EXPLAIN_SSE });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  describe("header", () => {
    it("renders nothing while closed", () => {
      wrapper = mountDialog();
      expect(find(wrapper, "o-dialog").exists()).toBe(false);
    });

    it("shows the title and the SQL on one line that expands on click", async () => {
      wrapper = await openDialog();
      expect(find(wrapper, "o-dialog-title").text()).toBe("Query plan");
      const toggle = find(wrapper, "query-plan-sql-toggle");
      expect(toggle.text()).toBe("SELECT k8s_namespace_name, count(*) AS cnt FROM app_logs");
      expect(find(wrapper, "query-plan-sql-full").exists()).toBe(false);
      await toggle.trigger("click");
      expect(find(wrapper, "query-plan-sql-full").text()).toBe(SQL);
    });

    it("orders the tabs Plan, Text, Analyze and has no run button", async () => {
      wrapper = await openDialog();
      expect(wrapper.findAll(".toggle-item").map((i) => i.text())).toEqual([
        "Plan",
        "Text",
        "Analyze",
      ]);
      expect(find(wrapper, "query-plan-run-btn").exists()).toBe(false);
    });
  });

  describe("plan mode", () => {
    it("opens on the plan, built from the plain EXPLAIN physical plan", async () => {
      wrapper = await openDialog();
      expect(mockStreamingSearch).toHaveBeenCalledTimes(1);
      expect(sentSql(0)).toBe("EXPLAIN SELECT * FROM logs");
      expect(find(wrapper, "query-plan-mode").attributes("data-value")).toBe("plan");
      const view = wrapper.findComponent({ name: "QueryPlanView" });
      expect(view.props("model").profile.plan.name).toBe("SortPreservingMergeExec");
    });

    it("moves to the Analyze tab from the plan's call to action without running", async () => {
      wrapper = await openDialog();
      await click(wrapper, "query-plan-view-stub");
      expect(find(wrapper, "query-plan-mode").attributes("data-value")).toBe("analyze");
      expect(find(wrapper, "query-plan-analyze-start").exists()).toBe(true);
      expect(mockStreamingSearch).toHaveBeenCalledTimes(1);
    });

    it("shows an error when the query has no SQL", async () => {
      mockGetSearchQueryPayload.mockReturnValue({ query: { sql: "" } });
      wrapper = await openDialog();
      expect(mockStreamingSearch).not.toHaveBeenCalled();
      expect(find(wrapper, "query-plan-error").exists()).toBe(true);
    });

    it("shows the request error", async () => {
      mockStreamingSearch.mockRejectedValue(new Error("network down"));
      wrapper = await openDialog();
      expect(find(wrapper, "query-plan-error").text()).toContain("network down");
    });

    it("shows the error the stream reports instead of a generic one", async () => {
      mockStreamingSearch.mockResolvedValue({ data: STREAM_ERROR_SSE });
      wrapper = await openDialog();
      expect(find(wrapper, "query-plan-error").text()).toContain("Resources exhausted");
    });
  });

  describe("analyze tab", () => {
    it("never sends a request when the tab is picked and shows the start card", async () => {
      wrapper = await openDialog();
      await selectMode(wrapper, "analyze");
      await selectMode(wrapper, "text");
      await selectMode(wrapper, "analyze");
      expect(mockStreamingSearch).toHaveBeenCalledTimes(1);
      expect(find(wrapper, "query-plan-analyze-fact-stream").text()).toContain("app_logs");
      expect(find(wrapper, "query-plan-analyze-fact-range").text()).toContain("Past 15 Minutes");
      expect(find(wrapper, "query-plan-analyze-fact-took").text()).toContain("1.84s");
      expect(find(wrapper, "query-plan-analyze-fact-nodes").text()).toContain("All nodes");
      expect(find(wrapper, "query-plan-analyze-run").text()).toBe("Run EXPLAIN ANALYZE");
      expect(find(wrapper, "query-plan-analyze-notice").exists()).toBe(false);
    });

    it("hides the last-search tile when the logs page has no timing", async () => {
      wrapper = await openDialog({ searchObj: { data: { query: SQL } } });
      await selectMode(wrapper, "analyze");
      expect(find(wrapper, "query-plan-analyze-fact-took").exists()).toBe(false);
      expect(find(wrapper, "query-plan-analyze-fact-range").exists()).toBe(false);
    });

    it("runs EXPLAIN ANALYZE and ticks the elapsed clock in the card and the tab", async () => {
      const pending = deferred();
      wrapper = await openAndRun(pending.promise);
      expect(sentSql(1)).toBe("EXPLAIN ANALYZE SELECT * FROM logs");
      expect(find(wrapper, "query-plan-analyze-elapsed").text()).toBe("0:00");
      expect(find(wrapper, "query-plan-analyze-running").text()).toContain(
        "elapsed · results on the page took 1.84s",
      );
      await tick(wrapper, 65_000);
      expect(find(wrapper, "query-plan-analyze-elapsed").text()).toBe("1:05");
      expect(find(wrapper, "query-plan-mode-analyze-elapsed").text()).toBe("1:05");
      expect(find(wrapper, "query-plan-analyze-cancel").exists()).toBe(true);

      await selectMode(wrapper, "plan");
      expect(find(wrapper, "query-plan-view-stub").exists()).toBe(true);
      expect(find(wrapper, "query-plan-mode-analyze-elapsed").exists()).toBe(true);
    });

    it("cancels on the server with the run's trace id and ignores the late response", async () => {
      const pending = deferred();
      wrapper = await openAndRun(pending.promise);
      const traceId = mockStreamingSearch.mock.calls[1][0].traceId;
      await tick(wrapper, 7_000);
      await click(wrapper, "query-plan-analyze-cancel");
      expect(mockCancelStream).toHaveBeenCalledWith({
        org_identifier: store.state.selectedOrganization.identifier,
        traceId,
      });
      expect(find(wrapper, "query-plan-analyze-notice").text()).toBe(
        "Cancelled after 0:07. The query was stopped on every node.",
      );
      expect(vi.getTimerCount()).toBe(0);

      pending.resolve({ data: PROFILE_SSE });
      await flushPromises();
      expect(find(wrapper, "query-profile-view").exists()).toBe(false);
      expect(find(wrapper, "query-plan-analyze-start").exists()).toBe(true);
    });

    it("leaves the elapsed time out of a cancel under a second", async () => {
      wrapper = await openAndRun(deferred().promise);
      await tick(wrapper, 200);
      await click(wrapper, "query-plan-analyze-cancel");
      expect(find(wrapper, "query-plan-analyze-notice").text()).toBe(
        "Cancelled. The query was stopped on every node.",
      );
    });

    it("aborts the analyze request itself on cancel", async () => {
      wrapper = await openAndRun(deferred().promise);
      const signal = mockStreamingSearch.mock.calls[1][0].signal as AbortSignal;
      expect(signal.aborted).toBe(false);
      await click(wrapper, "query-plan-analyze-cancel");
      expect(signal.aborted).toBe(true);
    });

    it("shows the error the analyze stream reports", async () => {
      const pending = deferred();
      wrapper = await openAndRun(pending.promise);
      await tick(wrapper, 3_000);
      pending.resolve({ data: STREAM_ERROR_SSE });
      await flushPromises();
      expect(find(wrapper, "query-plan-analyze-notice").text()).toContain(
        "Failed after 0:03: Resources exhausted",
      );
    });

    it("leaves the elapsed time out of a failure under a second", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pending = deferred();
      wrapper = await openAndRun(pending.promise);
      await tick(wrapper, 300);
      pending.reject(new Error("bad SQL"));
      await flushPromises();
      expect(find(wrapper, "query-plan-analyze-notice").text()).not.toContain("0:00");
      expect(find(wrapper, "query-plan-analyze-notice").text()).toContain("bad SQL");
      errorSpy.mockRestore();
    });

    it("still lands in cancelled when the cancel call itself fails", async () => {
      mockCancelStream.mockRejectedValue(new Error("cancel failed"));
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      wrapper = await openAndRun(deferred().promise);
      await click(wrapper, "query-plan-analyze-cancel");
      expect(find(wrapper, "query-plan-analyze-notice").text()).toContain("Cancelled");
      errorSpy.mockRestore();
    });

    it("shows the server error, a hint and Try again on failure", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const pending = deferred();
      wrapper = await openAndRun(pending.promise);
      await tick(wrapper, 41_000);
      pending.reject({ response: { data: { message: "query exceeded the memory limit." } } });
      await flushPromises();
      expect(find(wrapper, "query-plan-analyze-notice").text()).toBe(
        "Failed after 0:41: query exceeded the memory limit. Narrow the time range or add filters, then try again.",
      );
      expect(find(wrapper, "query-plan-analyze-run").text()).toBe("Try again");
      expect(find(wrapper, "query-plan-mode-analyze-failed").exists()).toBe(true);
      errorSpy.mockRestore();
    });

    it("shows the results with the info bar and Re-run once done", async () => {
      wrapper = await openAndRun(PROFILE_SSE);
      expect(find(wrapper, "query-profile-view").exists()).toBe(true);
      const summary = find(wrapper, "query-plan-analyze-bar-summary").text();
      expect(summary).toMatch(/^Ran \d\d:\d\d:\d\d · took 2.50s · 2 nodes$/);
      expect(find(wrapper, "query-plan-analyze-rerun").text()).toBe("Re-run");
      expect(find(wrapper, "query-plan-mode-analyze-done").exists()).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("falls back to the metrics card and tree when the server sends no profile", async () => {
      wrapper = await openAndRun(OLD_ANALYZE_SSE);
      expect(find(wrapper, "query-plan-analyze-fallback").exists()).toBe(true);
      expect(find(wrapper, "metrics-summary-card").exists()).toBe(true);
      expect(find(wrapper, "query-plan-tree").exists()).toBe(true);
      expect(find(wrapper, "query-profile-view").exists()).toBe(false);
    });

    it("dims the previous results while re-running and keeps them when cancelled", async () => {
      wrapper = await openAndRun(PROFILE_SSE);
      const pending = deferred();
      mockStreamingSearch.mockReturnValue(pending.promise);
      await click(wrapper, "query-plan-analyze-rerun");
      expect(find(wrapper, "query-plan-analyze-results").classes()).toContain("opacity-35");
      expect(find(wrapper, "query-plan-analyze-running").text()).toContain(
        "Re-running EXPLAIN ANALYZE",
      );
      expect(find(wrapper, "query-plan-analyze-running").text()).toContain(
        "previous run took 2.50s",
      );
      await tick(wrapper, 3_000);
      await click(wrapper, "query-plan-analyze-cancel");
      expect(mockCancelStream).toHaveBeenCalledTimes(1);
      expect(find(wrapper, "query-plan-analyze-results").classes()).not.toContain("opacity-35");
      expect(find(wrapper, "query-profile-view").exists()).toBe(true);
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Re-run cancelled after 0:03. Showing the previous results.",
        }),
      );

      pending.resolve({ data: OLD_ANALYZE_SSE });
      await flushPromises();
      expect(find(wrapper, "query-profile-view").exists()).toBe(true);
    });
  });

  describe("closing", () => {
    it("cancels a running analyze on the server and reopens fresh", async () => {
      const pending = deferred();
      wrapper = await openAndRun(pending.promise);
      const traceId = mockStreamingSearch.mock.calls[1][0].traceId;
      wrapper.findComponent({ name: "ODialog" }).vm.$emit("update:open", false);
      expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual([false]);
      await wrapper.setProps({ modelValue: false });
      expect(mockCancelStream).toHaveBeenCalledWith(expect.objectContaining({ traceId }));
      expect(vi.getTimerCount()).toBe(0);

      mockStreamingSearch.mockResolvedValue({ data: EXPLAIN_SSE });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();
      pending.resolve({ data: PROFILE_SSE });
      await flushPromises();
      expect(find(wrapper, "query-plan-mode").attributes("data-value")).toBe("plan");
      await selectMode(wrapper, "analyze");
      expect(find(wrapper, "query-plan-analyze-start").exists()).toBe(true);
    });

    it("does not call cancel when nothing is running", async () => {
      wrapper = await openAndRun(PROFILE_SSE);
      await wrapper.setProps({ modelValue: false });
      expect(mockCancelStream).not.toHaveBeenCalled();
    });

    it("cancels a running analyze when the dialog unmounts", async () => {
      wrapper = await openAndRun(deferred().promise);
      wrapper.unmount();
      await flushPromises();
      expect(mockCancelStream).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("text mode", () => {
    it("adds the analyze output only after a run is done, in phase order", async () => {
      wrapper = await openDialog();
      await selectMode(wrapper, "text");
      const text = () => wrapper.findComponent({ name: "QueryPlanText" });
      expect(text().props("physicalPlan")).toBe(AGG_PHYSICAL_PLAN);
      expect(text().props("logicalPlan")).toBe(AGG_LOGICAL_PLAN);
      expect(text().props("analyzePlan")).toBeNull();

      await selectMode(wrapper, "analyze");
      mockStreamingSearch.mockResolvedValue({ data: OLD_ANALYZE_SSE });
      await click(wrapper, "query-plan-analyze-run");
      await selectMode(wrapper, "text");
      expect(text().props("analyzePlan")).toBe(
        "RemoteScanExec: metrics=[output_rows=5]\nDataSourceExec: metrics=[output_rows=5]",
      );
    });
  });
});
