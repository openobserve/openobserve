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
import { nextTick } from "vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

// ── Module mocks (hoisted) ───────────────────────────────────────────────────

const mockGetSearchQueryPayload = vi.fn();

vi.mock("@/composables/useLogs/useSearchStream", () => ({
  useSearchStream: () => ({
    getSearchQueryPayload: mockGetSearchQueryPayload,
  }),
}));

vi.mock("@/composables/useLogs/searchState", () => ({
  searchState: () => ({
    searchObj: {
      data: {
        stream: { streamType: "logs" },
        query: "SELECT * FROM logs",
      },
    },
  }),
}));

const mockStreamingSearch = vi.fn();
vi.mock("@/services/streaming_search", () => ({
  default: {
    search: (...args: any[]) => mockStreamingSearch(...args),
  },
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    generateTraceContext: vi.fn(() => ({ traceId: "mock-trace" })),
  };
});

vi.mock("@/utils/queryPlanParser", () => ({
  parseQueryPlanTree: vi.fn((text: string) => ({
    name: "RootNode",
    label: text || "empty",
    metrics: {},
    children: [],
  })),
  calculateSummaryMetrics: vi.fn(() => ({
    totalRows: 100,
    totalTime: "1.2s",
  })),
  findRemoteExecNode: vi.fn(() => null),
}));

// Component import must come after all vi.mock() declarations.
import QueryPlanDialog from "./QueryPlanDialog.vue";

installQuasar();

// ── Stubs ────────────────────────────────────────────────────────────────────

const oDialogStub = {
  inheritAttrs: false,
  template: '<div data-test="o-dialog" v-if="open"><slot /></div>',
  props: ["open", "size", "title"],
  emits: ["update:open"],
};

const queryPlanTreeStub = {
  template: '<div data-test="query-plan-tree" />',
  props: ["tree", "isAnalyze"],
};

const metricsSummaryCardStub = {
  template: '<div data-test="metrics-summary-card" />',
  props: ["metrics"],
};

const oButtonStub = {
  template:
    '<button data-test="o-button" :disabled="loading" @click="$emit(\'click\')"><slot /></button>',
  props: ["variant", "size", "loading"],
  emits: ["click"],
};

const oTabsStub = {
  template: '<div data-test="o-tabs"><slot /></div>',
  props: ["modelValue", "dense", "align"],
  emits: ["update:modelValue"],
};

const oTabStub = {
  template: '<div data-test="o-tab">{{ label }}</div>',
  props: ["name", "label"],
};

const oTabPanelsStub = {
  template: '<div data-test="o-tab-panels"><slot /></div>',
  props: ["modelValue", "animated"],
};

const oTabPanelStub = {
  template: '<div data-test="o-tab-panel"><slot /></div>',
  props: ["name"],
};

// ── Mount factory ────────────────────────────────────────────────────────────

function mountDialog(props: Record<string, unknown> = {}) {
  return mount(QueryPlanDialog, {
    global: {
      plugins: [store, i18n],
      stubs: {
        ODialog: oDialogStub,
        OButton: oButtonStub,
        OTabs: oTabsStub,
        OTab: oTabStub,
        OTabPanels: oTabPanelsStub,
        OTabPanel: oTabPanelStub,
        QueryPlanTree: queryPlanTreeStub,
        MetricsSummaryCard: metricsSummaryCardStub,
        "q-splitter": {
          template:
            '<div data-test="q-splitter"><slot name="before" /><slot name="after" /></div>',
        },
        "q-separator": true,
        "OIcon": true,
        "q-space": true,
        "q-tooltip": true,
        "q-spinner-dots": true,
        "q-banner": { template: "<div><slot /></div>" },
        "q-card": { template: "<div><slot /></div>" },
        "q-card-section": { template: "<div><slot /></div>" },
      },
    },
    props: {
      modelValue: true,
      searchObj: {
        data: {
          query: "SELECT * FROM logs",
          stream: { streamType: "logs" },
        },
      },
      ...props,
    },
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("QueryPlanDialog", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    mockGetSearchQueryPayload.mockReset();
    mockStreamingSearch.mockReset();
    mockGetSearchQueryPayload.mockReturnValue({
      query: { sql: "SELECT * FROM logs" },
    });
    mockStreamingSearch.mockResolvedValue({ data: "" });
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("mounting", () => {
    it("should render the dialog when modelValue is true", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();
      expect(wrapper.find('[data-test="o-dialog"]').exists()).toBe(true);
    });

    it("should not render dialog body when modelValue is false", async () => {
      wrapper = mountDialog({ modelValue: false });
      await flushPromises();
      expect(wrapper.find('[data-test="o-dialog"]').exists()).toBe(false);
    });

    it("should have correct component name", () => {
      wrapper = mountDialog();
      expect(wrapper.vm.$options.name).toBe("QueryPlanDialog");
    });

    it("should expose key refs and methods on instance", () => {
      wrapper = mountDialog();
      const vm: any = wrapper.vm;
      expect(typeof vm.runAnalyze).toBe("function");
      expect(typeof vm.onClose).toBe("function");
      expect(vm.activeTab).toBe("logical");
      expect(vm.isAnalyzing).toBe(false);
      expect(vm.showAnalyzeResults).toBe(false);
    });
  });

  describe("sqlQuery computed", () => {
    it("should return the searchObj query string", () => {
      wrapper = mountDialog({
        searchObj: {
          data: { query: "SELECT a FROM b", stream: { streamType: "logs" } },
        },
      });
      expect((wrapper.vm as any).sqlQuery).toBe("SELECT a FROM b");
    });

    it("should return empty string when searchObj has no query", () => {
      wrapper = mountDialog({
        searchObj: { data: { stream: { streamType: "logs" } } },
      });
      expect((wrapper.vm as any).sqlQuery).toBe("");
    });

    it("should return empty string when searchObj.data is undefined", () => {
      wrapper = mountDialog({ searchObj: {} });
      expect((wrapper.vm as any).sqlQuery).toBe("");
    });
  });

  describe("onClose", () => {
    it("should emit update:modelValue false when onClose is called", () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).onClose();
      const emitted = wrapper.emitted("update:modelValue");
      expect(emitted).toBeTruthy();
      expect(emitted![emitted!.length - 1]).toEqual([false]);
    });
  });

  describe("showDialog v-model", () => {
    it("should emit update:modelValue when showDialog is set", async () => {
      wrapper = mountDialog({ modelValue: true });
      (wrapper.vm as any).showDialog = false;
      await nextTick();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("fetchExplainPlan (auto-triggered on open)", () => {
    it("should call streamingSearch.search when modelValue toggles to true", async () => {
      wrapper = mountDialog({ modelValue: false });
      await nextTick();
      mockStreamingSearch.mockResolvedValue({ data: "" });

      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect(mockStreamingSearch).toHaveBeenCalledTimes(1);
      const callArg = mockStreamingSearch.mock.calls[0][0];
      expect(callArg.query.query.sql).toBe("EXPLAIN SELECT * FROM logs");
      expect(callArg.search_type).toBe("ui");
    });

    it("should set error when query payload has no sql", async () => {
      mockGetSearchQueryPayload.mockReturnValue({ query: { sql: "" } });
      wrapper = mountDialog({ modelValue: false });
      await nextTick();
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect((wrapper.vm as any).error).toBeTruthy();
      expect((wrapper.vm as any).loading).toBe(false);
    });

    it("should set error when SSE response has no parseable data", async () => {
      mockStreamingSearch.mockResolvedValue({ data: "event: progress\n\n" });
      wrapper = mountDialog({ modelValue: false });
      await nextTick();
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect((wrapper.vm as any).error).toBeTruthy();
    });

    it("should populate plans on a valid SSE response containing logical_plan", async () => {
      const sse =
        "event: search_result\ndata: " +
        JSON.stringify({
          hits: [
            { plan_type: "logical_plan", plan: "Scan\n  Filter\n" },
            { plan_type: "physical_plan", plan: "RemoteScanExec\n" },
          ],
        }) +
        "\n\n";
      mockStreamingSearch.mockResolvedValue({ data: sse });

      wrapper = mountDialog({ modelValue: false });
      await nextTick();
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect((wrapper.vm as any).error).toBe("");
      expect((wrapper.vm as any).logicalPlanTree).not.toBeNull();
      expect((wrapper.vm as any).physicalPlanTree).not.toBeNull();
    });

    it("should set error when fetch throws", async () => {
      mockStreamingSearch.mockRejectedValue(new Error("network down"));
      wrapper = mountDialog({ modelValue: false });
      await nextTick();
      await wrapper.setProps({ modelValue: true });
      await flushPromises();

      expect((wrapper.vm as any).error).toBe("network down");
      expect((wrapper.vm as any).loading).toBe(false);
    });

    it("should reset activeTab to logical when opening", async () => {
      wrapper = mountDialog({ modelValue: false });
      (wrapper.vm as any).activeTab = "physical";
      await nextTick();
      await wrapper.setProps({ modelValue: true });
      await flushPromises();
      expect((wrapper.vm as any).activeTab).toBe("logical");
    });
  });

  describe("runAnalyze", () => {
    it("should send EXPLAIN ANALYZE query to streamingSearch.search", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();
      mockStreamingSearch.mockClear();
      mockStreamingSearch.mockResolvedValue({ data: "" });

      await (wrapper.vm as any).runAnalyze();
      await flushPromises();

      expect(mockStreamingSearch).toHaveBeenCalledTimes(1);
      const callArg = mockStreamingSearch.mock.calls[0][0];
      expect(callArg.query.query.sql).toBe("EXPLAIN ANALYZE SELECT * FROM logs");
    });

    it("should set showAnalyzeResults true when analyze response is valid", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();

      const sse =
        "event: search_result\ndata: " +
        JSON.stringify({
          hits: [
            { phase: 0, plan: "RemoteScanExec\n" },
            { phase: 1, plan: "ParquetScan\n" },
          ],
        }) +
        "\n\n";
      mockStreamingSearch.mockResolvedValue({ data: sse });

      await (wrapper.vm as any).runAnalyze();
      await flushPromises();

      expect((wrapper.vm as any).showAnalyzeResults).toBe(true);
      expect((wrapper.vm as any).error).toBe("");
      expect((wrapper.vm as any).isAnalyzing).toBe(false);
    });

    it("should set error when analyze response has no parseable data", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();
      mockStreamingSearch.mockResolvedValue({ data: "" });

      await (wrapper.vm as any).runAnalyze();
      await flushPromises();

      expect((wrapper.vm as any).error).toBeTruthy();
      expect((wrapper.vm as any).showAnalyzeResults).toBe(false);
    });

    it("should set error and reset isAnalyzing when search rejects", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();
      mockStreamingSearch.mockRejectedValue(new Error("boom"));

      await (wrapper.vm as any).runAnalyze();
      await flushPromises();

      expect((wrapper.vm as any).error).toBe("boom");
      expect((wrapper.vm as any).isAnalyzing).toBe(false);
      expect((wrapper.vm as any).loading).toBe(false);
    });

    it("should short-circuit when query payload has no sql", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();
      mockStreamingSearch.mockClear();
      mockGetSearchQueryPayload.mockReturnValue({ query: { sql: "" } });

      await (wrapper.vm as any).runAnalyze();
      await flushPromises();

      expect(mockStreamingSearch).not.toHaveBeenCalled();
      expect((wrapper.vm as any).error).toBeTruthy();
      expect((wrapper.vm as any).isAnalyzing).toBe(false);
    });
  });

  describe("watch showAnalyzeResults", () => {
    it("should reset activeTab to logical when switching back from analyze", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();
      (wrapper.vm as any).showAnalyzeResults = true;
      (wrapper.vm as any).activeTab = "physical";
      await nextTick();

      (wrapper.vm as any).showAnalyzeResults = false;
      await nextTick();

      expect((wrapper.vm as any).activeTab).toBe("logical");
    });
  });

  describe("conditional rendering", () => {
    it("should render MetricsSummaryCard when showAnalyzeResults and summaryMetrics", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();

      const sse =
        "event: search_result\ndata: " +
        JSON.stringify({
          hits: [
            { phase: 0, plan: "RemoteScanExec\n" },
            { phase: 1, plan: "ParquetScan\n" },
          ],
        }) +
        "\n\n";
      mockStreamingSearch.mockResolvedValue({ data: sse });

      await (wrapper.vm as any).runAnalyze();
      await flushPromises();
      await nextTick();

      expect(wrapper.find('[data-test="metrics-summary-card"]').exists()).toBe(
        true,
      );
    });

    it("should render OTabs for logical/physical when not in analyze mode", async () => {
      wrapper = mountDialog({ modelValue: true });
      await flushPromises();
      expect((wrapper.vm as any).showAnalyzeResults).toBe(false);
      expect(wrapper.find('[data-test="o-tabs"]').exists()).toBe(true);
    });
  });
});
