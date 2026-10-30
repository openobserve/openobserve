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
vi.mock("@/services/streaming_search", () => ({
  default: { search: (...args: unknown[]) => mockStreamingSearch(...args) },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, generateTraceContext: vi.fn(() => ({ traceId: "mock-trace" })) };
});

import QueryPlanDialog from "./QueryPlanDialog.vue";

const SQL = "SELECT k8s_namespace_name,\n  count(*) AS cnt\nFROM app_logs";

const oDialogStub = {
  inheritAttrs: false,
  template: `<div data-test="o-dialog" v-if="open">
    <div data-test="o-dialog-title">{{ title }}</div>
    <slot name="header-left" /><slot name="header-right" /><slot />
  </div>`,
  props: ["open", "size", "title"],
  emits: ["update:open"],
};

const oButtonStub = {
  template: '<button :disabled="loading" @click="$emit(\'click\')"><slot /></button>',
  props: ["variant", "size", "loading", "iconLeft", "iconRight"],
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
  plan: { name: "ProjectionExec", detail: "ProjectionExec", partitions: 1 },
};

const PROFILE_SSE = sse({
  hits: [
    { phase: 0, plan: "ProjectionExec\n", profile: JSON.stringify(PROFILE) },
    { phase: 1, plan: "DataSourceExec\n", profile: null },
  ],
});

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(QueryPlanDialog, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ODialog: oDialogStub,
        OButton: oButtonStub,
        OToggleGroup: oToggleGroupStub,
        OToggleGroupItem: { template: "<span><slot /></span>", props: ["value", "size"] },
        OTooltip: true,
        QueryPlanView: {
          name: "QueryPlanView",
          template: '<div data-test="query-plan-view-stub" @click="$emit(\'run\')" />',
          props: ["profile", "running"],
          emits: ["run"],
        },
        QueryProfileView: stub("QueryProfileView", "query-profile-view", [
          "profile",
          "stream",
          "sql",
        ]),
        QueryPlanText: stub("QueryPlanText", "query-plan-text", [
          "physicalPlan",
          "logicalPlan",
          "analyzePlan",
        ]),
        QueryPlanTree: stub("QueryPlanTree", "query-plan-tree", ["tree", "isAnalyze"]),
        MetricsSummaryCard: stub("MetricsSummaryCard", "metrics-summary-card", ["metrics"]),
      },
    },
    props: {
      modelValue: false,
      searchObj: { data: { query: SQL, stream: { streamType: "logs" } } },
      ...props,
    },
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

describe("QueryPlanDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    mockGetSearchQueryPayload.mockReset();
    mockStreamingSearch.mockReset();
    mockGetSearchQueryPayload.mockReturnValue({ query: { sql: "SELECT * FROM logs" } });
    mockStreamingSearch.mockResolvedValue({ data: EXPLAIN_SSE });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("header", () => {
    it("renders nothing while closed", () => {
      wrapper = mountDialog();
      expect(wrapper.find('[data-test="o-dialog"]').exists()).toBe(false);
    });

    it("shows the title and the SQL on one line that expands on click", async () => {
      wrapper = await openDialog();
      expect(wrapper.find('[data-test="o-dialog-title"]').text()).toBe("Query plan");
      const toggle = wrapper.find('[data-test="query-plan-sql-toggle"]');
      expect(toggle.text()).toBe("SELECT k8s_namespace_name, count(*) AS cnt FROM app_logs");
      expect(wrapper.find('[data-test="query-plan-sql-full"]').exists()).toBe(false);
      await toggle.trigger("click");
      expect(wrapper.find('[data-test="query-plan-sql-full"]').text()).toBe(SQL);
    });

    it("emits update:modelValue when the dialog closes", async () => {
      wrapper = await openDialog();
      wrapper.findComponent(oDialogStub).vm.$emit("update:open", false);
      expect(wrapper.emitted("update:modelValue")!.at(-1)).toEqual([false]);
    });
  });

  describe("plan mode", () => {
    it("opens on the plan, built from the plain EXPLAIN physical plan", async () => {
      wrapper = await openDialog();
      expect(mockStreamingSearch).toHaveBeenCalledTimes(1);
      expect(sentSql(0)).toBe("EXPLAIN SELECT * FROM logs");
      expect(wrapper.find('[data-test="query-plan-mode"]').attributes("data-value")).toBe("plan");
      const view = wrapper.findComponent({ name: "QueryPlanView" });
      expect(view.exists()).toBe(true);
      expect(view.props("profile").plan.name).toBe("SortPreservingMergeExec");
      expect(wrapper.find('[data-test="query-plan-run-btn"]').text()).toBe("Analyze");
    });

    it("shows an error when the query has no SQL", async () => {
      mockGetSearchQueryPayload.mockReturnValue({ query: { sql: "" } });
      wrapper = await openDialog();
      expect(mockStreamingSearch).not.toHaveBeenCalled();
      expect(wrapper.find('[data-test="query-plan-error"]').exists()).toBe(true);
    });

    it("shows the request error", async () => {
      mockStreamingSearch.mockRejectedValue(new Error("network down"));
      wrapper = await openDialog();
      expect(wrapper.find('[data-test="query-plan-error"]').text()).toContain("network down");
    });

    it("reports a missing plan when the response has none", async () => {
      mockStreamingSearch.mockResolvedValue({ data: "event: progress\n\n" });
      wrapper = await openDialog();
      expect(wrapper.find('[data-test="query-plan-error"]').text()).toContain(
        "No query plan found",
      );
    });
  });

  describe("analyze mode", () => {
    it("runs EXPLAIN ANALYZE from the Analyze button and shows the profile view", async () => {
      wrapper = await openDialog();
      mockStreamingSearch.mockResolvedValue({ data: PROFILE_SSE });
      await wrapper.find('[data-test="query-plan-run-btn"]').trigger("click");
      await flushPromises();
      expect(sentSql(1)).toBe("EXPLAIN ANALYZE SELECT * FROM logs");
      expect(wrapper.find('[data-test="query-plan-mode"]').attributes("data-value")).toBe(
        "analyze",
      );
      expect(wrapper.find('[data-test="query-profile-view"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-summary-card"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="query-plan-run-btn"]').text()).toBe("Re-run");
    });

    it("starts a run from the plan view's call to action", async () => {
      wrapper = await openDialog();
      mockStreamingSearch.mockResolvedValue({ data: PROFILE_SSE });
      await wrapper.find('[data-test="query-plan-view-stub"]').trigger("click");
      await flushPromises();
      expect(sentSql(1)).toBe("EXPLAIN ANALYZE SELECT * FROM logs");
      expect(wrapper.find('[data-test="query-profile-view"]').exists()).toBe(true);
    });

    it("runs EXPLAIN ANALYZE when the Analyze mode is picked, keeping Plan usable meanwhile", async () => {
      wrapper = await openDialog();
      let resolve!: (v: unknown) => void;
      mockStreamingSearch.mockReturnValue(new Promise((r) => (resolve = r)));
      await selectMode(wrapper, "analyze");
      expect(mockStreamingSearch).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="query-plan-loading"]').exists()).toBe(true);

      await selectMode(wrapper, "plan");
      expect(wrapper.find('[data-test="query-plan-view-stub"]').exists()).toBe(true);

      resolve({ data: PROFILE_SSE });
      await flushPromises();
      await selectMode(wrapper, "analyze");
      expect(mockStreamingSearch).toHaveBeenCalledTimes(2);
      expect(wrapper.find('[data-test="query-profile-view"]').exists()).toBe(true);
    });

    it("falls back to the metrics card and tree when the server sends no profile", async () => {
      wrapper = await openDialog();
      mockStreamingSearch.mockResolvedValue({ data: OLD_ANALYZE_SSE });
      await wrapper.find('[data-test="query-plan-run-btn"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="query-plan-analyze-fallback"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="metrics-summary-card"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="query-plan-tree"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="query-profile-view"]').exists()).toBe(false);
    });

    it("shows the analyze error in the profile body only", async () => {
      wrapper = await openDialog();
      mockStreamingSearch.mockRejectedValue(new Error("boom"));
      await wrapper.find('[data-test="query-plan-run-btn"]').trigger("click");
      await flushPromises();
      expect(wrapper.find('[data-test="query-plan-error"]').text()).toContain("boom");
      await selectMode(wrapper, "plan");
      expect(wrapper.find('[data-test="query-plan-error"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="query-plan-view-stub"]').exists()).toBe(true);
    });
  });

  describe("text mode", () => {
    it("passes both plans and, after a run, the analyze output in phase order", async () => {
      wrapper = await openDialog();
      await selectMode(wrapper, "text");
      const text = () => wrapper.findComponent({ name: "QueryPlanText" });
      expect(text().props("physicalPlan")).toBe(AGG_PHYSICAL_PLAN);
      expect(text().props("logicalPlan")).toBe(AGG_LOGICAL_PLAN);
      expect(text().props("analyzePlan")).toBeNull();

      mockStreamingSearch.mockResolvedValue({ data: OLD_ANALYZE_SSE });
      await wrapper.find('[data-test="query-plan-run-btn"]').trigger("click");
      await flushPromises();
      await selectMode(wrapper, "text");
      expect(text().props("analyzePlan")).toBe(
        "RemoteScanExec: metrics=[output_rows=5]\nDataSourceExec: metrics=[output_rows=5]",
      );
    });
  });

  describe("reopening", () => {
    it("returns to plan mode and drops the previous run", async () => {
      wrapper = await openDialog();
      mockStreamingSearch.mockResolvedValue({ data: PROFILE_SSE });
      await wrapper.find('[data-test="query-plan-run-btn"]').trigger("click");
      await flushPromises();
      await wrapper.setProps({ modelValue: false });
      mockStreamingSearch.mockResolvedValue({ data: EXPLAIN_SSE });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();
      expect(wrapper.find('[data-test="query-plan-mode"]').attributes("data-value")).toBe("plan");
      expect(wrapper.find('[data-test="query-plan-run-btn"]').text()).toBe("Analyze");
    });

    it("ignores a run that finishes after the dialog was reopened", async () => {
      wrapper = await openDialog();
      let resolve!: (v: unknown) => void;
      mockStreamingSearch.mockReturnValue(new Promise((r) => (resolve = r)));
      await wrapper.find('[data-test="query-plan-run-btn"]').trigger("click");
      await wrapper.setProps({ modelValue: false });
      mockStreamingSearch.mockResolvedValue({ data: EXPLAIN_SSE });
      await wrapper.setProps({ modelValue: true });
      await flushPromises();
      resolve({ data: PROFILE_SSE });
      await flushPromises();
      expect(wrapper.find('[data-test="query-plan-run-btn"]').text()).toBe("Analyze");
      expect(wrapper.findComponent({ name: "QueryPlanView" }).exists()).toBe(true);
    });
  });
});
