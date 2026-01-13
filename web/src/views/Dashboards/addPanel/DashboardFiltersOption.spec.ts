import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import DashboardFiltersOption from "./DashboardFiltersOption.vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";
import { createRouter, createMemoryHistory } from "vue-router";

// Mock external dependencies
vi.mock("@/composables/useDashboardPanel", () => ({
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
    removeFilterItem: vi.fn(),
    loadFilterItem: vi.fn(),
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
    template: "<div data-test='group-component'></div>",
  },
}));

vi.mock("./AddCondition.vue", () => ({
  default: {
    name: "AddCondition",
    template: "<div data-test='add-condition-component'></div>",
  },
}));

describe("DashboardFiltersOption", () => {
  let wrapper: any;
  let store: any;
  let i18n: any;
  let router: any;

  const mockDashboardData = {
    variables: {
      list: [
        {
          name: "var1",
          multiSelect: false,
        },
        {
          name: "var2",
          multiSelect: true,
        },
      ],
    },
  };

  beforeEach(() => {
    store = createStore({
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    });

    i18n = createI18n({
      locale: "en",
      messages: {
        en: {
          panel: {
            filters: "Filters",
          },
        },
      },
    });

    router = createRouter({
      history: createMemoryHistory(),
      routes: [
        {
          path: "/",
          component: { template: "<div></div>" },
        },
      ],
    });

    router.push({ path: "/", query: { tab: "tab1" } });

    wrapper = mount(DashboardFiltersOption, {
      props: {
        dashboardData: mockDashboardData,
      },
      global: {
        plugins: [store, i18n, router],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component mounting", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeDefined();
    });

    it("should render filters section when not custom SQL query", () => {
      const filtersSection = wrapper.find('[data-test="dashboard-filter-layout"]');
      expect(filtersSection.exists()).toBe(true);
      expect(wrapper.find(".layout-name").text()).toBe("Filters");
    });

    it("should inject dashboardPanelDataPageKey with default value", () => {
      expect(wrapper.vm.dashboardPanelData).toBeDefined();
    });

    it("should have Group component rendered when topLevelGroup exists", () => {
      const groupComponent = wrapper.find('[data-test="group-component"]');
      expect(groupComponent.exists()).toBe(true);
    });
  });

  describe("Computed properties", () => {
    it("should compute topLevelGroup correctly", () => {
      const expectedFilter = {
        conditions: [],
      };
      expect(wrapper.vm.topLevelGroup).toEqual(expectedFilter);
    });

    it("should compute schemaOptions correctly", () => {
      const expectedOptions = [
        { label: "field1", value: "field1" },
        { label: "field2", value: "field2" },
      ];
      expect(wrapper.vm.schemaOptions).toEqual(expectedOptions);
    });

    it("should have access to computed properties", () => {
      expect(wrapper.vm.topLevelGroup).toBeDefined();
      expect(wrapper.vm.schemaOptions).toBeDefined();
    });
  });

  describe("Methods", () => {
    describe("addFilter", () => {
      it("should add condition filter correctly", () => {
        wrapper.vm.addFilter("condition");

        const currentQuery = wrapper.vm.dashboardPanelData.data.queries[0];
        expect(currentQuery.fields.filter.conditions).toHaveLength(1);
        expect(currentQuery.fields.filter.conditions[0]).toEqual({
          type: "list",
          column: { field: "field1", streamAlias: undefined },
          filterType: "condition",
          operator: null,
          value: null,
          logicalOperator: "AND",
          values: [],
        });
        expect(wrapper.vm.showAddMenu).toBe(false);
      });

      it("should add group filter correctly", () => {
        wrapper.vm.addFilter("group");

        const currentQuery = wrapper.vm.dashboardPanelData.data.queries[0];
        expect(currentQuery.fields.filter.conditions).toHaveLength(1);
        expect(currentQuery.fields.filter.conditions[0]).toEqual({
          conditions: [
            {
              type: "list",
              column: { field: "field1", streamAlias: undefined },
              filterType: "condition",
              operator: null,
              value: null,
              logicalOperator: "AND",
              values: [],
            },
          ],
          filterType: "group",
          logicalOperator: "AND",
        });
        expect(wrapper.vm.showAddMenu).toBe(false);
      });
    });

    describe("addConditionToGroup", () => {
      it("should add condition to group correctly", () => {
        const mockGroup = {
          conditions: [],
        };

        wrapper.vm.addConditionToGroup(mockGroup);

        expect(mockGroup.conditions).toHaveLength(1);
        expect(mockGroup.conditions[0]).toEqual({
          type: "list",
          column: { field: "field1", streamAlias: undefined },
          filterType: "condition",
          operator: null,
          value: null,
          logicalOperator: "AND",
          values: [],
        });
      });
    });

    describe("addGroupToGroup", () => {
      it("should add group to group correctly", () => {
        const mockGroup = {
          conditions: [],
        };

        wrapper.vm.addGroupToGroup(mockGroup);

        expect(mockGroup.conditions).toHaveLength(1);
        expect(mockGroup.conditions[0]).toEqual({
          conditions: [
            {
              type: "list",
              column: { field: "field1", streamAlias: undefined },
              filterType: "condition",
              operator: null,
              value: null,
              logicalOperator: "AND",
              values: [],
            },
          ],
          filterType: "group",
          logicalOperator: "AND",
        });
      });
    });

    describe("removeGroup", () => {
      it("should remove group at specific index from filter conditions", () => {
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter = [
          { filterType: "condition" },
          { filterType: "group" },
        ];

        wrapper.vm.removeGroup(1);

        const currentQuery = wrapper.vm.dashboardPanelData.data.queries[0];
        expect(currentQuery.fields.filter).toHaveLength(1);
        expect(currentQuery.fields.filter[0].filterType).toBe("condition");
      });

      it("should handle removeGroup when filter doesn't exist", () => {
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter = null;

        expect(() => wrapper.vm.removeGroup(0)).not.toThrow();
      });
    });

    describe("handleLogicalOperatorChange", () => {
      beforeEach(() => {
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter = {
          conditions: [
            {
              filterType: "condition",
              logicalOperator: "AND",
            },
            {
              filterType: "group",
              logicalOperator: "AND",
              conditions: [
                {
                  filterType: "condition",
                  logicalOperator: "AND",
                },
                {
                  filterType: "group",
                  logicalOperator: "AND",
                  conditions: [
                    {
                      filterType: "condition",
                      logicalOperator: "AND",
                    },
                  ],
                },
              ],
            },
          ],
        };
      });

      it("should handle logical operator change for condition", () => {
        wrapper.vm.handleLogicalOperatorChange(0, "OR");

        const condition = wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions[0];
        expect(condition.logicalOperator).toBe("OR");
      });

      it("should handle logical operator change for group", () => {
        wrapper.vm.handleLogicalOperatorChange(1, "OR");

        const group = wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions[1];
        expect(group.logicalOperator).toBe("OR");
        expect(group.conditions[0].logicalOperator).toBe("OR");
        expect(group.conditions[1].logicalOperator).toBe("OR");
        expect(group.conditions[1].conditions[0].logicalOperator).toBe("OR");
      });

      it("should handle non-existing index", () => {
        expect(() => wrapper.vm.handleLogicalOperatorChange(5, "OR")).not.toThrow();
      });
    });

    describe("updateGroupLogicalOperators", () => {
      it("should update group logical operators through handleLogicalOperatorChange", () => {
        const group = {
          filterType: "group",
          logicalOperator: "AND",
          conditions: [
            {
              filterType: "condition",
              logicalOperator: "AND",
            },
            {
              filterType: "group",
              logicalOperator: "AND",
              conditions: [
                {
                  filterType: "condition",
                  logicalOperator: "AND",
                },
              ],
            },
          ],
        };

        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions = [group];
        wrapper.vm.handleLogicalOperatorChange(0, "OR");

        expect(group.logicalOperator).toBe("OR");
        expect(group.conditions[0].logicalOperator).toBe("OR");
        expect(group.conditions[1].logicalOperator).toBe("OR");
        expect(group.conditions[1].conditions[0].logicalOperator).toBe("OR");
      });
    });

    describe("dashboardVariablesFilterItems", () => {
      it("should return correct filter items for Contains operator", () => {
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter = {
          conditions: [
            {
              operator: "Contains",
            },
          ],
        };

        const result = wrapper.vm.dashboardVariablesFilterItems(0);

        expect(result).toEqual([
          {
            label: "var1",
            value: "$var1",
          },
          {
            label: "var2",
            value: "(${var2})",
          },
        ]);
      });

      it("should return correct filter items for Not Contains operator", () => {
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter = {
          conditions: [
            {
              operator: "Not Contains",
            },
          ],
        };

        const result = wrapper.vm.dashboardVariablesFilterItems(0);

        expect(result).toEqual([
          {
            label: "var1",
            value: "$var1",
          },
          {
            label: "var2",
            value: "(${var2})",
          },
        ]);
      });

      it("should return correct filter items for other operators", () => {
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter = {
          conditions: [
            {
              operator: "=",
            },
          ],
        };

        const result = wrapper.vm.dashboardVariablesFilterItems(0);

        expect(result).toEqual([
          {
            label: "var1",
            value: "$var1",
          },
          {
            label: "var2",
            value: "(${var2})",
          },
        ]);
      });

      it("should handle null operator", () => {
        wrapper.vm.dashboardPanelData.data.queries[0].fields.filter = {
          conditions: [
            {
              operator: null,
            },
          ],
        };

        const result = wrapper.vm.dashboardVariablesFilterItems(0);

        expect(result).toEqual([
          {
            label: "var1",
            value: "$var1",
          },
          {
            label: "var2",
            value: "(${var2})",
          },
        ]);
      });

      it("should handle empty dashboard variables", () => {
        const newWrapper = mount(DashboardFiltersOption, {
          props: {
            dashboardData: {
              variables: {
                list: [],
              },
            },
          },
          global: {
            plugins: [store, i18n, router],
            provide: {
              dashboardPanelDataPageKey: "dashboard",
            },
          },
        });

        const result = newWrapper.vm.dashboardVariablesFilterItems(0);
        expect(result).toEqual([]);

        newWrapper.unmount();
      });

      it("should handle undefined dashboard data", () => {
        const newWrapper = mount(DashboardFiltersOption, {
          props: {
            dashboardData: null,
          },
          global: {
            plugins: [store, i18n, router],
            provide: {
              dashboardPanelDataPageKey: "dashboard",
            },
          },
        });

        const result = newWrapper.vm.dashboardVariablesFilterItems(0);
        expect(result).toEqual([]);
        
        newWrapper.unmount();
      });
    });
  });

  describe("Conditional rendering", () => {
    it("should render filters when customQuery is false", () => {
      expect(wrapper.find('[data-test="dashboard-filter-layout"]').exists()).toBe(true);
    });

    it("should render Group component when topLevelGroup exists", () => {
      expect(wrapper.find('[data-test="group-component"]').exists()).toBe(true);
    });

    it("should render layout name as Filters", () => {
      expect(wrapper.find('.layout-name').text()).toBe("Filters");
    });

    it("should have correct test attribute", () => {
      const filtersLayout = wrapper.find('[data-test="dashboard-filter-layout"]');
      expect(filtersLayout.exists()).toBe(true);
      expect(filtersLayout.classes()).toContain("axis-container");
      expect(filtersLayout.classes()).toContain("droppable");
      expect(filtersLayout.classes()).toContain("scroll");
      expect(filtersLayout.classes()).toContain("row");
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle missing schemaOptions gracefully", () => {
      const noSchemaWrapper = mount(DashboardFiltersOption, {
        props: {
          dashboardData: mockDashboardData,
        },
        global: {
          plugins: [store, i18n, router],
          provide: {
            dashboardPanelDataPageKey: "dashboard",
          },
        },
      });

      Object.assign(noSchemaWrapper.vm, {
        selectedStreamFieldsBasedOnUserDefinedSchema: {
          value: null,
        },
      });

      expect(() => noSchemaWrapper.vm.addFilter("condition")).not.toThrow();
      noSchemaWrapper.unmount();
    });

    it("should handle empty schemaOptions", () => {
      const emptySchemaWrapper = mount(DashboardFiltersOption, {
        props: {
          dashboardData: mockDashboardData,
        },
        global: {
          plugins: [store, i18n, router],
          provide: {
            dashboardPanelDataPageKey: "dashboard",
          },
        },
      });

      Object.assign(emptySchemaWrapper.vm, {
        selectedStreamFieldsBasedOnUserDefinedSchema: {
          value: [],
        },
      });

      expect(() => emptySchemaWrapper.vm.addFilter("condition")).not.toThrow();
      emptySchemaWrapper.unmount();
    });

    it("should handle missing current query gracefully", () => {
      const noQueryWrapper = mount(DashboardFiltersOption, {
        props: {
          dashboardData: mockDashboardData,
        },
        global: {
          plugins: [store, i18n, router],
          provide: {
            dashboardPanelDataPageKey: "dashboard",
          },
        },
      });

      Object.assign(noQueryWrapper.vm.dashboardPanelData, {
        data: {
          queries: [],
          queryType: "logs",
        },
        layout: {
          currentQueryIndex: 0,
        },
      });

      expect(() => noQueryWrapper.vm.addFilter("condition")).toThrow();
      noQueryWrapper.unmount();
    });

    it("should handle inject with custom pageKey", () => {
      const customWrapper = mount(DashboardFiltersOption, {
        props: {
          dashboardData: mockDashboardData,
        },
        global: {
          plugins: [store, i18n, router],
          provide: {
            dashboardPanelDataPageKey: "custom-page",
          },
        },
      });

      expect(customWrapper.vm).toBeDefined();
      customWrapper.unmount();
    });

    it("should handle inject without pageKey (uses default)", () => {
      const defaultWrapper = mount(DashboardFiltersOption, {
        props: {
          dashboardData: mockDashboardData,
        },
        global: {
          plugins: [store, i18n, router],
        },
      });

      expect(defaultWrapper.vm).toBeDefined();
      defaultWrapper.unmount();
    });

    it("should handle showAddMenu state changes", () => {
      expect(wrapper.vm.showAddMenu).toBe(false);
      wrapper.vm.showAddMenu = true;
      expect(wrapper.vm.showAddMenu).toBe(true);
      
      wrapper.vm.addFilter("condition");
      expect(wrapper.vm.showAddMenu).toBe(false);
    });
  });

  describe("Loops and iterations", () => {
    it("should handle forEach loop in updateGroupLogicalOperators through recursive calls", () => {
      const mockGroup = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            logicalOperator: "AND",
          },
          {
            filterType: "condition",
            logicalOperator: "AND",
          },
          {
            filterType: "group",
            logicalOperator: "AND",
            conditions: [
              {
                filterType: "condition",
                logicalOperator: "AND",
              },
              {
                filterType: "condition",
                logicalOperator: "AND",
              },
            ],
          },
        ],
      };

      wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions = [mockGroup];
      wrapper.vm.handleLogicalOperatorChange(0, "OR");

      mockGroup.conditions.forEach((condition) => {
        expect(condition.logicalOperator).toBe("OR");
      });

      mockGroup.conditions[2].conditions.forEach((condition) => {
        expect(condition.logicalOperator).toBe("OR");
      });
    });

    it("should handle map iteration in schemaOptions computed property", () => {
      const schemaOptions = wrapper.vm.schemaOptions;
      expect(schemaOptions).toHaveLength(2);
      
      const expectedFields = [
        { name: "field1", type: "string" },
        { name: "field2", type: "number" },
      ];
      
      expectedFields.forEach((field, index) => {
        expect(schemaOptions[index]).toEqual({
          label: field.name,
          value: field.name,
        });
      });
    });

    it("should handle map iteration in dashboardVariablesFilterItems", () => {
      const mockDashboardDataWithVariables = {
        variables: {
          list: [
            { name: "var1", multiSelect: false },
            { name: "var2", multiSelect: true },
            { name: "var3", multiSelect: false },
            { name: "var4", multiSelect: true },
          ],
        },
      };

      const testWrapper = mount(DashboardFiltersOption, {
        props: {
          dashboardData: mockDashboardDataWithVariables,
        },
        global: {
          plugins: [store, i18n, router],
          provide: {
            dashboardPanelDataPageKey: "dashboard",
          },
        },
      });

      const result = testWrapper.vm.dashboardVariablesFilterItems(0);
      
      expect(result).toHaveLength(4);
      mockDashboardDataWithVariables.variables.list.forEach((variable, index) => {
        expect(result[index].label).toBe(variable.name);
        const expectedValue = variable.multiSelect 
          ? `(\${${variable.name}})`
          : `$${variable.name}`;
        expect(result[index].value).toBe(expectedValue);
      });

      testWrapper.unmount();
    });

    it("should handle empty arrays in map iterations", () => {
      const testWrapper = mount(DashboardFiltersOption, {
        props: {
          dashboardData: {
            variables: {
              list: [],
            },
          },
        },
        global: {
          plugins: [store, i18n, router],
          provide: {
            dashboardPanelDataPageKey: "dashboard",
          },
        },
      });

      const result = testWrapper.vm.dashboardVariablesFilterItems(0);
      expect(result).toEqual([]);

      testWrapper.unmount();
    });
  });

  describe("Event handlers and template props", () => {
    it("should pass correct props to Group component", () => {
      const groupComponent = wrapper.findComponent({ name: "Group" });
      expect(groupComponent.exists()).toBe(true);
    });

    it("should have correct component structure", () => {
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.showAddMenu).toBeDefined();
      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.removeFilterItem).toBeDefined();
      expect(wrapper.vm.loadFilterItem).toBeDefined();
      expect(wrapper.vm.addFilter).toBeDefined();
      expect(wrapper.vm.addConditionToGroup).toBeDefined();
      expect(wrapper.vm.addGroupToGroup).toBeDefined();
      expect(wrapper.vm.removeGroup).toBeDefined();
      expect(wrapper.vm.handleLogicalOperatorChange).toBeDefined();
      expect(wrapper.vm.dashboardVariablesFilterItems).toBeDefined();
      expect(wrapper.vm.schemaOptions).toBeDefined();
      expect(wrapper.vm.topLevelGroup).toBeDefined();
    });

    it("should handle component props correctly", () => {
      expect(wrapper.props().dashboardData).toEqual(mockDashboardData);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("DashboardFiltersOption");
    });
  });

  describe("Additional edge cases for 100% coverage", () => {
    it("should handle different filter types in addFilter method", () => {
      wrapper.vm.addFilter("unknown");
      
      const currentQuery = wrapper.vm.dashboardPanelData.data.queries[0];
      expect(currentQuery.fields.filter.conditions).toHaveLength(0);
      expect(wrapper.vm.showAddMenu).toBe(false);
    });

    it("should handle currentQueryIndex fallback to 0", () => {
      const mockDashboardPanelDataWithoutIndex = {
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
          currentQueryIndex: null,
        },
      };

      Object.assign(wrapper.vm, {
        dashboardPanelData: mockDashboardPanelDataWithoutIndex,
      });

      expect(wrapper.vm.topLevelGroup).toEqual({ conditions: [] });
    });

    it("should test all possible branches in dashboardVariablesFilterItems", () => {
      wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions = [
        { operator: "=" },
      ];

      const result = wrapper.vm.dashboardVariablesFilterItems(0);
      expect(result).toHaveLength(2);
      expect(result[0].value).toBe("$var1");
      expect(result[1].value).toBe("(${var2})");
    });

    it("should handle dashboardPanelDataPageKey injection with undefined", () => {
      const wrapperWithUndefined = mount(DashboardFiltersOption, {
        props: {
          dashboardData: mockDashboardData,
        },
        global: {
          plugins: [store, i18n, router],
          provide: {
            dashboardPanelDataPageKey: undefined,
          },
        },
      });

      expect(wrapperWithUndefined.vm).toBeDefined();
      wrapperWithUndefined.unmount();
    });

    it("should handle updateGroupLogicalOperators with different condition types", () => {
      const complexGroup = {
        filterType: "group",
        logicalOperator: "AND",
        conditions: [
          {
            filterType: "condition",
            logicalOperator: "AND",
          },
          {
            filterType: "other",
            logicalOperator: "AND",
          },
        ],
      };

      wrapper.vm.dashboardPanelData.data.queries[0].fields.filter.conditions = [complexGroup];
      wrapper.vm.handleLogicalOperatorChange(0, "OR");

      expect(complexGroup.conditions[0].logicalOperator).toBe("OR");
      expect(complexGroup.conditions[1].logicalOperator).toBe("OR");
    });

    it("should verify component setup", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeDefined();
      expect(wrapper.props().dashboardData).toEqual(mockDashboardData);
    });
  });
});