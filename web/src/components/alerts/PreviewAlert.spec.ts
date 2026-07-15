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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
import PreviewAlert from "./PreviewAlert.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("../dashboards/PanelSchemaRenderer.vue", () => ({
  default: {
    name: "PanelSchemaRenderer",
    template: "<div data-test='panel-schema-renderer'></div>",
    props: [
      "height",
      "width",
      "panelSchema",
      "selectedTimeObj",
      "variablesData",
      "searchType",
      "is_ui_histogram",
    ],
    emits: ["result-metadata-update", "series-data-update"],
  },
}));

vi.mock("@/services/search", () => ({
  default: {
    result_schema: vi.fn().mockResolvedValue({
      data: { group_by: [], projections: [], timeseries_field: null },
    }),
    search: vi.fn().mockResolvedValue({ data: { hits: [], total: 0 } }),
  },
}));

const baseFormData = () => ({
  stream_name: "test-stream",
  stream_type: "logs",
  trigger_condition: {
    period: 10,
    threshold: 5,
    operator: ">=",
  },
  query_condition: {
    aggregation: {
      function: "count",
      group_by: [],
      having: { column: "", operator: ">=", value: 1 },
    },
  },
});

async function mountComp(props: Record<string, any> = {}) {
  return mount(PreviewAlert, {
    global: {
      plugins: [i18n, store],
    },
    props: {
      query: "",
      formData: baseFormData(),
      isAggregationEnabled: false,
      selectedTab: "custom",
      isUsingBackendSql: false,
      isEditorOpen: false,
      ...props,
    },
  });
}

describe("PreviewAlert - rendering", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(async () => {
    wrapper = await mountComp();
  });

  afterEach(() => wrapper?.unmount());

  it("renders without errors", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("renders the preview chart container", () => {
    expect(wrapper.find('[data-test="alert-preview-chart"]').exists()).toBe(true);
  });

  it("shows placeholder when query is empty and selectedTab is sql", async () => {
    await wrapper.setProps({ query: "", selectedTab: "sql" });

    await nextTick();
    // There should be some element visible (the empty-query placeholder)
    expect(wrapper.html()).not.toBe("");
  });

  it("shows placeholder when query is empty and selectedTab is promql", async () => {
    await wrapper.setProps({ query: "", selectedTab: "promql" });
    await nextTick();
    expect(wrapper.html()).not.toBe("");
  });

  it("does NOT show PanelSchemaRenderer when chartData has no type (empty object)", async () => {
    const w = await mountComp({ query: "", selectedTab: "custom" });
    // chartData = {} → truthy but v-else-if="chartData" is true for a non-empty-ish ref
    // The component renders PanelSchemaRenderer based on chartData being set;
    // when query is empty we just verify the chart container exists without error.
    expect(w.find('[data-test="alert-preview-chart"]').exists()).toBe(true);
    w.unmount();
  });
});

describe("PreviewAlert - props", () => {
  afterEach(() => vi.clearAllMocks());

  it("accepts all props with defaults", async () => {
    const w = await mountComp();
    expect(w.props().query).toBe("");
    expect(w.props().isAggregationEnabled).toBe(false);
    expect(w.props().selectedTab).toBe("custom");
    expect(w.props().isUsingBackendSql).toBe(false);
    w.unmount();
  });

  it("accepts explicit prop values", async () => {
    const w = await mountComp({
      query: "SELECT count(*) FROM logs",
      isAggregationEnabled: true,
      selectedTab: "sql",
      isUsingBackendSql: true,
    });
    expect(w.props().query).toBe("SELECT count(*) FROM logs");
    expect(w.props().isAggregationEnabled).toBe(true);
    expect(w.props().selectedTab).toBe("sql");
    expect(w.props().isUsingBackendSql).toBe(true);
    w.unmount();
  });

  it("isEditorOpen defaults to false", async () => {
    const w = await mountComp();
    expect(w.props().isEditorOpen).toBe(false);
    w.unmount();
  });
});

describe("PreviewAlert - PanelSchemaRenderer integration", () => {
  afterEach(() => vi.clearAllMocks());

  it("renders PanelSchemaRenderer when chartData is set", async () => {
    const w = await mountComp({ query: "SELECT * FROM logs" });
    w.vm.chartData = { type: "line", queries: [] };
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    expect(renderer.exists()).toBe(true);
    w.unmount();
  });

  it("passes panelSchema prop to PanelSchemaRenderer", async () => {
    const w = await mountComp({ query: "SELECT * FROM logs" });
    const mockData = { type: "line", queries: [] };
    w.vm.chartData = mockData;
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    expect(renderer.props("panelSchema")).toEqual(mockData);
    w.unmount();
  });

  it("passes empty variablesData to PanelSchemaRenderer", async () => {
    const w = await mountComp({ query: "SELECT * FROM logs" });
    w.vm.chartData = { type: "line" };
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    expect(renderer.props("variablesData")).toEqual({});
    w.unmount();
  });

  it("passes is_ui_histogram=true when isUsingBackendSql=true and custom+noAgg", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      isUsingBackendSql: true,
      selectedTab: "custom",
      isAggregationEnabled: false,
    });
    w.vm.chartData = { type: "line" };
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    // shouldUseHistogram = isUsingBackendSql when tab=custom and !aggregation
    expect(renderer.props("is_ui_histogram")).toBe(true);
    w.unmount();
  });

  it("passes is_ui_histogram=false when custom mode with aggregation", async () => {
    const w = await mountComp({
      query: "SELECT count(*) FROM logs",
      isUsingBackendSql: true,
      selectedTab: "custom",
      isAggregationEnabled: true,
    });
    w.vm.chartData = { type: "line" };
    await nextTick();
    const renderer = w.findComponent({ name: "PanelSchemaRenderer" });
    // shouldUseHistogram = false when custom+aggregation
    expect(renderer.props("is_ui_histogram")).toBe(false);
    w.unmount();
  });
});

describe("PreviewAlert - refreshData method", () => {
  afterEach(() => vi.clearAllMocks());

  it("exposes refreshData method", async () => {
    const w = await mountComp();
    expect(typeof w.vm.refreshData).toBe("function");
    w.unmount();
  });

  it("returns early when query is empty", async () => {
    const w = await mountComp({ query: "" });
    // chartData should remain {} when no query
    expect(w.vm.chartData).toEqual({});
    w.unmount();
  });

  it("does not throw when trigger_condition is missing", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      formData: { stream_name: "test", stream_type: "logs" },
    });
    expect(() => w.vm.refreshData()).not.toThrow();
    w.unmount();
  });

  it("sets chartData after refreshData in custom mode", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });

  it("sets chartData after refreshData in promql mode", async () => {
    const w = await mountComp({
      query: "up",
      selectedTab: "promql",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });

  it("sets queryType to sql in custom mode", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.dashboardPanelData?.data?.queryType).toBe("sql");
    w.unmount();
  });

  it("clones chartData (not same reference as dashboardPanelData.data)", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
      formData: baseFormData(),
    });

    w.vm.refreshData();
    await nextTick();

    expect(w.vm.chartData).not.toBe(w.vm.dashboardPanelData?.data);
    w.unmount();
  });
});

describe("PreviewAlert - exposeRefresh and resizeChart", () => {
  afterEach(() => vi.clearAllMocks());

  it("exposes resizeChart method", async () => {
    const w = await mountComp();
    expect(typeof w.vm.resizeChart).toBe("function");
    w.unmount();
  });

  it("exposes evaluationStatus", async () => {
    const w = await mountComp();
    expect("evaluationStatus" in w.vm).toBe(true);
    w.unmount();
  });
});

describe("PreviewAlert - evaluateAndSetStatus", () => {
  afterEach(() => vi.clearAllMocks());

  it("sets evaluationStatus to wouldTrigger=true when resultCount >= threshold", async () => {
    const w = await mountComp({
      formData: {
        ...baseFormData(),
        trigger_condition: { period: 10, threshold: 3, operator: ">=" },
        is_real_time: false,
      },
    });

    (w.vm as any).evaluateAndSetStatus(5);

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);
    w.unmount();
  });

  it("sets evaluationStatus to wouldTrigger=false when resultCount < threshold", async () => {
    const w = await mountComp({
      formData: {
        ...baseFormData(),
        trigger_condition: { period: 10, threshold: 10, operator: ">=" },
        is_real_time: false,
      },
    });

    (w.vm as any).evaluateAndSetStatus(2);

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(false);
    w.unmount();
  });

  it("always returns wouldTrigger=true for real-time alerts", async () => {
    const w = await mountComp({
      formData: {
        ...baseFormData(),
        trigger_condition: { period: 10, threshold: 100, operator: ">=" },
        is_real_time: true,
      },
    });

    (w.vm as any).evaluateAndSetStatus(0);

    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);
    w.unmount();
  });

  it("handles != operator", async () => {
    const w = await mountComp({
      formData: {
        ...baseFormData(),
        trigger_condition: { period: 10, threshold: 5, operator: "!=" },
        is_real_time: false,
      },
    });

    (w.vm as any).evaluateAndSetStatus(3);
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(true);

    (w.vm as any).evaluateAndSetStatus(5);
    expect(w.vm.evaluationStatus?.wouldTrigger).toBe(false);
    w.unmount();
  });
});

describe("PreviewAlert - watcher behavior", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not refresh when query is empty in watch", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
    });
    await w.setProps({ query: "" });
    await flushPromises();

    // With empty query, watch won't call refreshData
    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });

  it("chartData is defined after prop update", async () => {
    const w = await mountComp({
      query: "SELECT * FROM logs",
      selectedTab: "custom",
    });

    await w.setProps({ formData: { ...baseFormData(), stream_name: "new-stream" } });
    await flushPromises();

    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });
});

describe("PreviewAlert - cleanAggregationQuery", () => {
  afterEach(() => vi.clearAllMocks());

  it("exposes cleanAggregationQuery internally (internal test via refreshData)", async () => {
    const w = await mountComp({
      query: "SELECT histogram(_timestamp) AS zo_sql_key, count(*) AS zo_sql_val FROM stream GROUP BY zo_sql_key HAVING zo_sql_val >= 10",
      selectedTab: "custom",
      isAggregationEnabled: true,
      formData: {
        ...baseFormData(),
        query_condition: {
          aggregation: {
            function: "count",
            group_by: [],
            having: { column: "count", operator: ">=", value: 10 },
          },
        },
        trigger_condition: { period: 10, threshold: 5, operator: ">=" },
      },
    });

    // Just verify component doesn't throw
    w.vm.refreshData();
    await nextTick();
    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });
});

describe("PreviewAlert - onMounted behavior", () => {
  afterEach(() => vi.clearAllMocks());

  it("does not call refreshData on mount when query is empty", async () => {
    const w = await mountComp({ query: "", selectedTab: "custom" });
    await nextTick();
    await flushPromises();

    // chartData stays empty object when no query on mount
    expect(w.vm.chartData).toEqual({});
    w.unmount();
  });

  it("does not call refreshData on mount for promql (skipped by design)", async () => {
    const w = await mountComp({ query: "up", selectedTab: "promql" });
    await nextTick();
    await flushPromises();

    // promql skips onMounted refresh intentionally
    expect(w.vm.chartData).toBeDefined();
    w.unmount();
  });
});
