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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import { nextTick, reactive } from "vue";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import FilterBuilder from "@/components/filterBar/FilterBuilder.vue";
import { buildCondition } from "@/utils/dashboard/dashboardAutoQueryBuilder";
import { requestFieldValues } from "@/composables/fieldValueStore";
import DashboardFiltersOption from "./DashboardFiltersOption.vue";

vi.mock("@/composables/fieldValueStore", () => ({
  requestFieldValues: vi.fn(async () => ["warn", "error"]),
}));

let panelData: any;

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    get dashboardPanelData() {
      return panelData;
    },
    getStreamNameFromStreamAlias: (alias: string) =>
      panelData.data.queries[panelData.layout.currentQueryIndex].joins.find(
        (join: any) => join.streamAlias === alias,
      )?.stream,
  })),
}));

const leaf = (
  field: unknown,
  operator: string | null,
  value: unknown,
  logicalOperator = "AND",
) => ({
  type: "condition",
  values: [],
  column: field,
  operator,
  value,
  logicalOperator,
  filterType: "condition",
});

// Saved the way the old builder and the field list wrote panels: list leaves, $variables, joins, nested groups.
const savedFilter = () => ({
  filterType: "group",
  logicalOperator: "AND",
  conditions: [
    {
      type: "list",
      values: ["error", "warn"],
      column: { field: "level", streamAlias: null },
      operator: null,
      value: null,
      logicalOperator: "AND",
      filterType: "condition",
    },
    leaf({ field: "service", streamAlias: "b" }, "=", "$service", "OR"),
    {
      filterType: "group",
      logicalOperator: "AND",
      conditions: [
        leaf({ field: "status" }, ">=", "500"),
        leaf({ field: "message" }, "str_match", "timeout", "OR"),
        leaf({ field: "host" }, "Is Not Null", ""),
      ],
    },
    {
      type: "list",
      values: [],
      column: { field: "level" },
      operator: null,
      value: null,
      logicalOperator: "AND",
      filterType: "condition",
    },
  ],
});

const query = (filter: unknown) => ({
  customQuery: false,
  fields: { stream: "app_logs", stream_type: "logs", filter },
  joins: [{ stream: "other_logs", streamAlias: "b" }],
});

const makePanelData = () =>
  reactive({
    data: { queryType: "sql", queries: [query(savedFilter()), query(null)] },
    layout: { currentQueryIndex: 0 },
    meta: {
      dateTime: { start_time: new Date(1000), end_time: new Date(2000) },
      streamFields: {
        groupedFields: [
          {
            name: "app_logs",
            stream_alias: undefined,
            schema: [
              { name: "level", type: "Utf8" },
              { name: "status", type: "Int64" },
            ],
          },
          { name: "other_logs", stream_alias: "b", schema: [{ name: "service", type: "Utf8" }] },
        ],
      },
    },
  });

const dashboardData = {
  variables: {
    list: [
      { name: "global_var", multiSelect: false },
      { name: "multi_var", multiSelect: true },
      { name: "tab_var", tabs: ["tab1"] },
      { name: "other_tab_var", tabs: ["tab2"] },
      { name: "panel_var", panels: ["current_panel"] },
    ],
  },
};

let wrapper: VueWrapper | null = null;

async function mountOption(props: Record<string, unknown> = { dashboardData }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  await router.push({ path: "/", query: { tab: "tab1" } });
  wrapper = mount(DashboardFiltersOption, {
    attachTo: document.body,
    props,
    global: { plugins: [i18n, store, router] },
  });
  await flushPromises();
  return wrapper;
}

const builder = () => wrapper!.findComponent(FilterBuilder);

beforeEach(() => {
  panelData = makePanelData();
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("DashboardFiltersOption", () => {
  it("edits the current query's filter with the horizontal dashboard-panel builder", async () => {
    await mountOption();
    expect(builder().props("profile")).toBe("dashboard-panel");
    expect(builder().props("dataTest")).toBe("dashboard-filter-builder");
    expect(builder().props("modelValue")).toEqual(savedFilter());
  });

  it("hides the filters for a custom SQL query", async () => {
    panelData.data.queries[0].customQuery = true;
    await mountOption();
    expect(builder().exists()).toBe(false);
  });

  it("publishes the number of leaf conditions, nested ones included", async () => {
    await mountOption();
    const layout = wrapper!.find('[data-test="dashboard-filter-layout"]');
    expect(layout.attributes("data-condition-count")).toBe("6");
  });

  it("names joined-stream columns alias.field and keeps the column as the payload", async () => {
    await mountOption();
    expect(builder().props("fields")).toEqual([
      { name: "level", type: "string", payload: { field: "level", streamAlias: undefined } },
      { name: "status", type: "number", payload: { field: "status", streamAlias: undefined } },
      { name: "b.service", type: "string", payload: { field: "service", streamAlias: "b" } },
    ]);
  });

  it("chips every saved leaf, the joined one by alias", async () => {
    await mountOption();
    for (const key of ["level", "b.service", "status", "message", "host"]) {
      expect(
        wrapper!.find(`[data-test="dashboard-filter-builder-chip-${key}"]`).exists(),
        key,
      ).toBe(true);
    }
  });

  it("writes the builder's tree into the current query only", async () => {
    panelData.layout.currentQueryIndex = 1;
    await mountOption();
    const next = { filterType: "group", logicalOperator: "AND", conditions: [] };
    builder().vm.$emit("update:modelValue", next);
    await nextTick();
    expect(panelData.data.queries[1].fields.filter).toEqual(next);
    expect(panelData.data.queries[0].fields.filter).toEqual(savedFilter());
  });

  it("follows the query tabs", async () => {
    await mountOption();
    panelData.layout.currentQueryIndex = 1;
    await nextTick();
    expect(builder().props("modelValue")).toBeNull();
  });

  it("shows a filter the field list pushes into the saved tree in place", async () => {
    await mountOption();
    panelData.data.queries[0].fields.filter.conditions.push({
      type: "list",
      values: [],
      column: { field: "status" },
      operator: null,
      value: null,
      logicalOperator: "AND",
      filterType: "condition",
    });
    await nextTick();
    expect((builder().props("modelValue") as any).conditions).toHaveLength(5);
  });

  it("keeps a filter the field list adds after an edit made in the builder", async () => {
    await mountOption();
    await wrapper!.find('[data-test="dashboard-filter-builder-connector-2"]').trigger("click");
    await flushPromises();
    panelData.data.queries[0].fields.filter.conditions.push({
      type: "list",
      values: [],
      column: { field: "status" },
      operator: null,
      value: null,
      logicalOperator: "AND",
      filterType: "condition",
    });
    await flushPromises();
    expect(wrapper!.find('[data-test="dashboard-filter-builder-chip-status"]').exists()).toBe(true);
    await wrapper!.find('[data-test="dashboard-filter-builder-connector-1"]').trigger("click");
    await flushPromises();
    const conditions = panelData.data.queries[0].fields.filter.conditions;
    expect(conditions).toHaveLength(5);
    expect(conditions[4].column).toEqual({ field: "status" });
  });

  it("toggling the connector before a nested group changes only that group's operator", async () => {
    await mountOption();
    await wrapper!.find('[data-test="dashboard-filter-builder-connector-2"]').trigger("click");
    await flushPromises();
    const expected = savedFilter();
    expected.conditions[2].logicalOperator = "OR";
    expect(JSON.stringify(panelData.data.queries[0].fields.filter)).toBe(JSON.stringify(expected));
  });

  it("toggling a connector inside a nested group reaches the SQL", async () => {
    await mountOption();
    await wrapper!.find('[data-test="dashboard-filter-builder-connector-2-1"]').trigger("click");
    await flushPromises();
    const group = panelData.data.queries[0].fields.filter.conditions[2];
    expect(group.conditions[1].logicalOperator).toBe("AND");
    expect(buildCondition(group, { ...panelData, data: { queries: [query(null)] } })).toBe(
      "(app_logs.status >= 500 AND str_match(app_logs.message, 'timeout') AND app_logs.host IS NOT NULL)",
    );
  });

  it("offers global, this tab's and this new panel's variables, multi-selects in parentheses", async () => {
    await mountOption();
    expect(builder().props("extraValueSuggestions")!("level")).toEqual([
      "$global_var",
      "(${multi_var})",
      "$tab_var",
      "$panel_var",
    ]);
  });

  it("loads values from the column's own stream in the panel's time range", async () => {
    await mountOption();
    const values = await builder().props("loadValues")!("b.service", "ser");
    expect(values).toEqual(["error", "warn"]);
    expect(requestFieldValues).toHaveBeenCalledWith(
      { org: expect.any(String), streamType: "logs", streamName: "other_logs" },
      "service",
      { timeRange: { startTime: 1000, endTime: 2000 }, keyword: "ser" },
    );
  });

  it("an Escape that closes the field list stays inside the builder", async () => {
    await mountOption();
    const input = wrapper!.find('[data-test="dashboard-filter-builder-input"]');
    await input.trigger("click");
    await flushPromises();
    const onWindow = vi.fn();
    window.addEventListener("keydown", onWindow);
    await input.trigger("keydown", { key: "Escape" });
    window.removeEventListener("keydown", onWindow);
    expect(onWindow).not.toHaveBeenCalled();
  });

  it("loads main-stream values without a keyword before anything is typed", async () => {
    await mountOption();
    await builder().props("loadValues")!("level", "");
    expect(requestFieldValues).toHaveBeenCalledWith(
      expect.objectContaining({ streamName: "app_logs" }),
      "level",
      expect.objectContaining({ keyword: undefined }),
    );
  });
});
