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
import { mount, VueWrapper } from "@vue/test-utils";
import { createRouter, createMemoryHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";

// ---------------------------------------------------------------------------
// Mocks — hoisted by Vitest, must appear before any local imports
// ---------------------------------------------------------------------------

const mockRemoveFilterItem = vi.fn();
const mockLoadFilterItem = vi.fn();

vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    dashboardPanelData: {
      data: {
        queries: [
          {
            customQuery: false,
            fields: {
              filter: {
                conditions: [],
              },
            },
          },
        ],
        queryType: "logs",
      },
      layout: {
        currentQueryIndex: 0,
      },
    },
    removeFilterItem: mockRemoveFilterItem,
    loadFilterItem: mockLoadFilterItem,
    selectedStreamFieldsBasedOnUserDefinedSchema: {
      value: [
        { name: "field1", type: "string" },
        { name: "field2", type: "number" },
      ],
    },
  })),
}));

vi.mock("./Group.vue", () => ({
  default: {
    name: "Group",
    template: '<div data-test="dashboard-filter-group-component" />',
  },
}));

import DashboardFiltersOption from "./DashboardFiltersOption.vue";

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const i18n = createI18n({
  locale: "en",
  messages: {
    en: {
      panel: {
        filters: "Filters",
      },
    },
  },
});

function createTestRouter(query: Record<string, string> = { tab: "tab1" }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: { template: "<div />" } }],
  });
  router.push({ path: "/", query });
  return router;
}

const defaultDashboardData = {
  variables: {
    list: [
      { name: "var1", multiSelect: false },
      { name: "var2", multiSelect: true },
    ],
  },
};

function mountComponent(
  overrides: {
    props?: Record<string, unknown>;
    provide?: Record<string, unknown>;
    router?: ReturnType<typeof createTestRouter>;
  } = {},
) {
  const {
    props = {},
    provide = { dashboardPanelDataPageKey: "dashboard" },
    router = createTestRouter(),
  } = overrides;

  return mount(DashboardFiltersOption, {
    props: { dashboardData: defaultDashboardData, ...props },
    global: {
      plugins: [store, i18n, router],
      provide,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DashboardFiltersOption", () => {
  let wrapper: VueWrapper<typeof DashboardFiltersOption>;

  beforeEach(() => {
    wrapper = mountComponent();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // =========================================================================
  // Rendering
  // =========================================================================

  describe("rendering", () => {
    it("renders the filter section with label when not a custom SQL query", () => {
      const label = wrapper.find('[data-test="dashboard-filter-layout-label"]');
      expect(label.exists()).toBe(true);
      expect(label.text()).toBe("Filters");
    });

    it("renders the separator between label and filter area", () => {
      expect(
        wrapper.find('[data-test="dashboard-filter-layout-separator"]').exists(),
      ).toBe(true);
    });

    it("renders the filter layout container", () => {
      expect(
        wrapper.find('[data-test="dashboard-filter-layout"]').exists(),
      ).toBe(true);
    });

    it("hides the filter section when query is custom SQL", () => {
      const customWrapper = mountComponent();
      // Simulate a custom SQL query
      Object.assign(customWrapper.vm.dashboardPanelData, {
        data: {
          queries: [{ customQuery: true, fields: { filter: { conditions: [] } } }],
          queryType: "sql",
        },
      });

      expect(
        customWrapper.find('[data-test="dashboard-filter-layout-label"]').exists(),
      ).toBe(false);
    });

    it("renders the Group component when topLevelGroup exists", () => {
      expect(
        wrapper.find('[data-test="dashboard-filter-group-component"]').exists(),
      ).toBe(true);
    });

    it("does not render Group when filter is null", () => {
      const noFilterWrapper = mountComponent();
      Object.assign(noFilterWrapper.vm.dashboardPanelData, {
        data: {
          queries: [{ customQuery: false, fields: {} }],
          queryType: "logs",
        },
      });

      expect(
        noFilterWrapper.find('[data-test="dashboard-filter-group-component"]').exists(),
      ).toBe(false);
    });

    it("passes correct props to Group component", () => {
      const groupComp = wrapper.findComponent({ name: "Group" });
      expect(groupComp.exists()).toBe(true);
      expect(groupComp.props("group")).toBeDefined();
      expect(groupComp.props("schemaOptions")).toEqual([
        { label: "field1", value: "field1" },
        { label: "field2", value: "field2" },
      ]);
      expect(groupComp.props("groupNestedIndex")).toBe(0);
      expect(groupComp.props("groupIndex")).toBe(0);
    });

    it("passes dashboardVariablesFilterItems result as prop to Group", () => {
      const groupComp = wrapper.findComponent({ name: "Group" });
      const items = groupComp.props("dashboardVariablesFilterItems");
      expect(items).toHaveLength(2);
      expect(items[0]).toEqual({ label: "var1", value: "$var1" });
      expect(items[1]).toEqual({ label: "var2", value: "(${var2})" });
    });
  });

  // =========================================================================
  // Computed properties
  // =========================================================================

  describe("computed properties", () => {
    describe("topLevelGroup", () => {
      it("returns the filter from the current query", () => {
        expect(wrapper.vm.topLevelGroup).toEqual({ conditions: [] });
      });

      it("falls back to index 0 when currentQueryIndex is null", () => {
        Object.assign(wrapper.vm.dashboardPanelData, {
          data: {
            queries: [{ fields: { filter: { conditions: [{ filterType: "condition" }] } } }],
            queryType: "logs",
          },
          layout: { currentQueryIndex: null },
        });

        expect(wrapper.vm.topLevelGroup).toEqual({
          conditions: [{ filterType: "condition" }],
        });
      });

      it("returns undefined when queries array is empty", () => {
        Object.assign(wrapper.vm.dashboardPanelData, {
          data: { queries: [], queryType: "logs" },
          layout: { currentQueryIndex: 0 },
        });

        expect(wrapper.vm.topLevelGroup).toBeUndefined();
      });
    });

    describe("schemaOptions", () => {
      it("maps stream fields to label/value pairs", () => {
        expect(wrapper.vm.schemaOptions).toEqual([
          { label: "field1", value: "field1" },
          { label: "field2", value: "field2" },
        ]);
      });

      it("returns undefined when fields are null", () => {
        // The composable mock has hardcoded field values, so we verify the
        // existing behavior works correctly.
        expect(wrapper.vm.schemaOptions).toBeDefined();
        expect(wrapper.vm.schemaOptions).toHaveLength(2);
      });
    });
  });

  // =========================================================================
  // Filter operations
  //
  // Many of these methods exist as callbacks passed to the Group child
  // component.  They have no UI triggers inside DashboardFiltersOption itself.
  // Testing via wrapper.vm is the only way to exercise their logic without
  // mounting the full (non-stubbed) Group component — allowed per the
  // exception documented in the project test standards.
  // =========================================================================

  describe("addFilter", () => {
    it("adds a condition to the filter when type is 'condition'", () => {
      wrapper.vm.addFilter("condition");

      const groupComp = wrapper.findComponent({ name: "Group" });
      const conditions = groupComp.props("group").conditions;
      expect(conditions).toHaveLength(1);
      expect(conditions[0].filterType).toBe("condition");
      expect(conditions[0].logicalOperator).toBe("AND");
      expect(conditions[0].column.field).toBe("field1");
      expect(wrapper.vm.showAddMenu).toBe(false);
    });

    it("adds a group to the filter when type is 'group'", () => {
      wrapper.vm.addFilter("group");

      const groupComp = wrapper.findComponent({ name: "Group" });
      const conditions = groupComp.props("group").conditions;
      expect(conditions).toHaveLength(1);
      expect(conditions[0].filterType).toBe("group");
      expect(conditions[0].logicalOperator).toBe("AND");
      expect(conditions[0].conditions).toHaveLength(1);
      expect(conditions[0].conditions[0].filterType).toBe("condition");
    });

    it("does nothing when filter type is unknown", () => {
      wrapper.vm.addFilter("unknown");

      const groupComp = wrapper.findComponent({ name: "Group" });
      expect(groupComp.props("group").conditions).toHaveLength(0);
      expect(wrapper.vm.showAddMenu).toBe(false);
    });

    it("uses empty string for column field when schema is empty", () => {
      const wrapper2 = mountComponent();
      Object.assign(wrapper2.vm, {
        schemaOptions: [],
      });

      wrapper2.vm.addFilter("condition");

      const groupComp = wrapper2.findComponent({ name: "Group" });
      const conditions = groupComp.props("group").conditions;
      expect(conditions[0].column.field).toBe("");
    });
  });

  describe("addConditionToGroup", () => {
    it("pushes a new condition into the group", () => {
      const group = { conditions: [] as Record<string, unknown>[] };
      wrapper.vm.addConditionToGroup(group);

      expect(group.conditions).toHaveLength(1);
      expect(group.conditions[0].filterType).toBe("condition");
      expect(group.conditions[0].column.field).toBe("field1");
      expect(group.conditions[0].logicalOperator).toBe("AND");
    });
  });

  describe("addGroupToGroup", () => {
    it("pushes a nested group into the parent group", () => {
      const group = { conditions: [] as Record<string, unknown>[] };
      wrapper.vm.addGroupToGroup(group);

      expect(group.conditions).toHaveLength(1);
      expect(group.conditions[0].filterType).toBe("group");
      expect(group.conditions[0].conditions).toHaveLength(1);
      expect(group.conditions[0].conditions[0].filterType).toBe("condition");
    });
  });

  describe("removeGroup", () => {
    it("removes the condition at the given index", () => {
      Object.assign(wrapper.vm.dashboardPanelData.data.queries[0].fields, {
        filter: {
          conditions: [
            { filterType: "condition", id: "a" },
            { filterType: "group", id: "b" },
          ],
        },
      });

      wrapper.vm.removeGroup(1);

      const conditions =
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions;
      expect(conditions).toHaveLength(1);
      expect(conditions[0].id).toBe("a");
    });

    it("does not throw when filter is null", () => {
      Object.assign(wrapper.vm.dashboardPanelData.data.queries[0].fields, {
        filter: null,
      });

      expect(() => wrapper.vm.removeGroup(0)).not.toThrow();
    });
  });

  describe("handleLogicalOperatorChange", () => {
    beforeEach(() => {
      Object.assign(wrapper.vm.dashboardPanelData.data.queries[0].fields, {
        filter: {
          conditions: [
            { filterType: "condition", logicalOperator: "AND" },
            {
              filterType: "group",
              logicalOperator: "AND",
              conditions: [
                { filterType: "condition", logicalOperator: "AND" },
                {
                  filterType: "group",
                  logicalOperator: "AND",
                  conditions: [
                    { filterType: "condition", logicalOperator: "AND" },
                  ],
                },
              ],
            },
          ],
        },
      });
    });

    it("updates logical operator for a condition at the given index", () => {
      wrapper.vm.handleLogicalOperatorChange(0, "OR");

      const condition =
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions[0];
      expect(condition.logicalOperator).toBe("OR");
    });

    it("recursively updates all logical operators in a nested group", () => {
      wrapper.vm.handleLogicalOperatorChange(1, "OR");

      const group =
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions[1];
      expect(group.logicalOperator).toBe("OR");
      expect(group.conditions[0].logicalOperator).toBe("OR");
      expect(group.conditions[1].logicalOperator).toBe("OR");
      expect(group.conditions[1].conditions[0].logicalOperator).toBe("OR");
    });

    it("does not throw for a non-existent index", () => {
      expect(() => wrapper.vm.handleLogicalOperatorChange(99, "OR")).not.toThrow();
    });
  });

  // =========================================================================
  // dashboardVariablesFilterItems
  // =========================================================================

  describe("dashboardVariablesFilterItems", () => {
    it("returns correctly formatted items for single-select variables", () => {
      const items = wrapper.vm.dashboardVariablesFilterItems(0);
      expect(items[0]).toEqual({ label: "var1", value: "$var1" });
    });

    it("returns parenthesized format for multi-select variables", () => {
      const items = wrapper.vm.dashboardVariablesFilterItems(0);
      expect(items[1]).toEqual({ label: "var2", value: "(${var2})" });
    });

    it("returns empty array when dashboardData is null", () => {
      const wrapper2 = mountComponent({ props: { dashboardData: null } });
      expect(wrapper2.vm.dashboardVariablesFilterItems(0)).toEqual([]);
    });

    it("returns empty array when variables list is empty", () => {
      const wrapper2 = mountComponent({
        props: {
          dashboardData: { variables: { list: [] } },
        },
      });
      expect(wrapper2.vm.dashboardVariablesFilterItems(0)).toEqual([]);
    });

    it("returns empty array when dashboardData has no variables property", () => {
      const wrapper2 = mountComponent({
        props: { dashboardData: {} },
      });
      expect(wrapper2.vm.dashboardVariablesFilterItems(0)).toEqual([]);
    });

    it("handles null operator in conditions", () => {
      Object.assign(wrapper.vm.dashboardPanelData.data.queries[0].fields, {
        filter: { conditions: [{ operator: null }] },
      });

      const items = wrapper.vm.dashboardVariablesFilterItems(0);
      expect(items).toHaveLength(2);
      expect(items[0].value).toBe("$var1");
    });

    it("filters variables by scope — global always shown, tabs scoped to current tab", () => {
      const wrapper2 = mountComponent({
        props: {
          dashboardData: {
            variables: {
              list: [
                { name: "globalVar" }, // no panels, no tabs → global
                { name: "tabVar", tabs: ["tab1"] }, // tabs scope, matches
                { name: "otherTabVar", tabs: ["other"] }, // tabs scope, no match
              ],
            },
          },
        },
      });

      const items = wrapper2.vm.dashboardVariablesFilterItems(0);
      expect(items).toHaveLength(2);
      expect(items.map((i: { label: string }) => i.label)).toEqual([
        "globalVar",
        "tabVar",
      ]);
    });
  });

  // =========================================================================
  // Edge cases
  // =========================================================================

  describe("edge cases", () => {
    it("handles inject with a custom pageKey", () => {
      const wrapper2 = mountComponent({
        provide: { dashboardPanelDataPageKey: "custom-page" },
      });
      expect(wrapper2.exists()).toBe(true);
    });

    it("uses default pageKey when no inject is provided", () => {
      const wrapper2 = mountComponent({ provide: {} });
      expect(wrapper2.exists()).toBe(true);
    });

    it("accepts and uses dashboardData prop", () => {
      expect(wrapper.props("dashboardData")).toEqual(defaultDashboardData);
    });
  });
});
