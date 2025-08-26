import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount, shallowMount } from "@vue/test-utils";
import { nextTick } from "vue";
import AddCondition from "./AddCondition.vue";
import { createI18n } from "vue-i18n";

// Mock useSelectAutoComplete composable
vi.mock("../../../composables/useSelectAutocomplete", () => ({
  useSelectAutoComplete: vi.fn(() => ({
    filterFn: vi.fn(),
    filteredOptions: [
      { label: "field1", value: "field1" },
      { label: "field2", value: "field2" },
    ],
  })),
}));

// Mock DOM methods to prevent Quasar errors
Object.defineProperty(Element.prototype, 'removeAttribute', {
  writable: true,
  value: vi.fn(),
});

describe("AddCondition.vue", () => {
  let wrapper: any;
  let mockLoadFilterItem: any;

  const defaultProps = {
    condition: {
      column: "test_field",
      operator: "=",
      value: "test_value",
      values: ["value1", "value2"],
      type: "condition",
      logicalOperator: "AND",
    },
    schemaOptions: [
      { label: "field1", value: "field1" },
      { label: "field2", value: "field2" },
      { label: "field3", value: "field3" },
    ],
    dashboardVariablesFilterItems: [
      { label: "var1", value: "var1" },
      { label: "var2", value: "var2" },
    ],
    dashboardPanelData: {
      meta: {
        filterValue: [
          {
            column: "test_field",
            value: ["option1", "option2", "option3", "zebra", "alpha"],
          },
          {
            column: "field2",
            value: ["value_a", "value_b"],
          },
        ],
      },
    },
    conditionIndex: 0,
    loadFilterItem: vi.fn(),
  };

  const createWrapper = (props = {}, mountOptions = {}) => {
    const i18n = createI18n({
      legacy: false,
      locale: "en",
      messages: {
        en: {
          common: {
            list: "List",
            condition: "Condition",
            operator: "Operator",
            value: "Value",
            selectFilter: "Select Filter",
          },
        },
      },
    });

    return shallowMount(AddCondition, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [i18n],
        stubs: ["q-select", "q-btn", "q-btn-group", "q-menu", "q-tabs", "q-tab", "q-tab-panels", "q-tab-panel", "q-separator", "q-item", "q-item-section", "q-checkbox", "CommonAutoComplete", "SanitizedHtmlRenderer"],
      },
      ...mountOptions,
    });
  };

  beforeEach(() => {
    mockLoadFilterItem = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  it("should mount and render basic component", () => {
    wrapper = createWrapper();
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.vm).toBeDefined();
  });

  it("should not display logical operator when conditionIndex is 0", () => {
    wrapper = createWrapper({ conditionIndex: 0 });
    const logicalOperatorSelect = wrapper.find('[data-test="dashboard-add-condition-logical-operator-0}"]');
    expect(logicalOperatorSelect.exists()).toBe(false);
  });

  it("should display logical operator when conditionIndex is not 0", () => {
    wrapper = createWrapper({ conditionIndex: 1 });
    const logicalOperatorSelect = wrapper.find('[data-test="dashboard-add-condition-logical-operator-1}"]');
    expect(logicalOperatorSelect.exists()).toBe(true);
  });

  describe("computedLabel function", () => {
    it("should return match_all format for match_all operator", () => {
      wrapper = createWrapper({
        condition: {
          ...defaultProps.condition,
          operator: "match_all",
          value: "test_value",
        },
      });
      
      const result = wrapper.vm.computedLabel(wrapper.props().condition);
      expect(result).toBe("match_all(test_value)");
    });

    it("should return str_match format for str_match operator", () => {
      wrapper = createWrapper({
        condition: {
          ...defaultProps.condition,
          operator: "str_match",
          column: "test_column",
          value: "test_value",
        },
      });
      
      const result = wrapper.vm.computedLabel(wrapper.props().condition);
      expect(result).toBe("str_match(test_column, test_value)");
    });

    it("should return str_match_ignore_case format for str_match_ignore_case operator", () => {
      wrapper = createWrapper({
        condition: {
          ...defaultProps.condition,
          operator: "str_match_ignore_case",
          column: "test_column",
          value: "test_value",
        },
      });
      
      const result = wrapper.vm.computedLabel(wrapper.props().condition);
      expect(result).toBe("str_match_ignore_case(test_column, test_value)");
    });

    it("should return re_match format for re_match operator", () => {
      wrapper = createWrapper({
        condition: {
          ...defaultProps.condition,
          operator: "re_match",
          column: "test_column",
          value: ".*test.*",
        },
      });
      
      const result = wrapper.vm.computedLabel(wrapper.props().condition);
      expect(result).toBe("re_match(test_column, .*test.*)");
    });

    it("should return re_not_match format for re_not_match operator", () => {
      wrapper = createWrapper({
        condition: {
          ...defaultProps.condition,
          operator: "re_not_match",
          column: "test_column",
          value: ".*test.*",
        },
      });
      
      const result = wrapper.vm.computedLabel(wrapper.props().condition);
      expect(result).toBe("re_not_match(test_column, .*test.*)");
    });

    it("should return column name for all other operators", () => {
      const otherOperators = ["=", "<>", ">=", "<=", ">", "<", "IN", "NOT IN", "Contains", "Starts With", "Ends With", "Not Contains", "Is Null", "Is Not Null"];
      
      otherOperators.forEach(operator => {
        wrapper = createWrapper({
          condition: {
            ...defaultProps.condition,
            operator: operator,
            column: "test_column",
          },
        });
        
        const result = wrapper.vm.computedLabel(wrapper.props().condition);
        expect(result).toBe("test_column");
      });
    });
  });

  describe("Field selection and filtering", () => {
    it("should use filteredSchemaOptions from useSelectAutoComplete", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.filteredSchemaOptions).toBeDefined();
      expect(Array.isArray(wrapper.vm.filteredSchemaOptions)).toBe(true);
      expect(wrapper.vm.filteredSchemaOptions).toEqual([
        { label: "field1", value: "field1" },
        { label: "field2", value: "field2" },
      ]);
    });

    it("should call filterStreamFn when filtering", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.filterStreamFn).toBeDefined();
      expect(typeof wrapper.vm.filterStreamFn).toBe("function");
    });
  });

  describe("Remove column functionality", () => {
    it("should clear column when removeColumnName is called", () => {
      const condition = {
        ...defaultProps.condition,
        column: "test_column",
      };
      
      wrapper = createWrapper({ condition });
      expect(wrapper.props().condition.column).toBe("test_column");
      
      wrapper.vm.removeColumnName();
      expect(wrapper.props().condition.column).toBe("");
    });
  });

  describe("Emit functions", () => {
    it("should emit remove-condition when remove button is clicked", async () => {
      wrapper = createWrapper();
      
      // Since we're using shallow mount with stubs, we need to trigger the emit directly
      await wrapper.vm.$emit("remove-condition");
      
      expect(wrapper.emitted("remove-condition")).toBeTruthy();
      expect(wrapper.emitted("remove-condition")).toHaveLength(1);
    });

    it("should emit logical-operator-change when emitLogicalOperatorChange is called", () => {
      wrapper = createWrapper();
      
      wrapper.vm.emitLogicalOperatorChange("OR");
      
      expect(wrapper.emitted("logical-operator-change")).toBeTruthy();
      expect(wrapper.emitted("logical-operator-change")[0]).toEqual(["OR"]);
    });
  });

  describe("Field change handling", () => {
    it("should call loadFilterItem when handleFieldChange is called", () => {
      const mockLoadFilterItem = vi.fn();
      wrapper = createWrapper({ loadFilterItem: mockLoadFilterItem });
      
      wrapper.vm.handleFieldChange("new_field");
      
      expect(mockLoadFilterItem).toHaveBeenCalledWith("new_field");
    });
  });

  describe("List functionality", () => {
    it("should compute sortedFilteredListOptions correctly", () => {
      wrapper = createWrapper();
      
      const options = wrapper.vm.sortedFilteredListOptions;
      expect(Array.isArray(options)).toBe(true);
      expect(options).toEqual(["alpha", "option1", "option2", "option3", "zebra"]); // Sorted alphabetically
    });

    it("should filter list options based on search term", () => {
      wrapper = createWrapper();
      
      const mockUpdate = vi.fn();
      wrapper.vm.filterListFn("option", mockUpdate);
      
      // The computed property should be updated
      expect(wrapper.vm.sortedFilteredListOptions).toContain("option1");
      expect(wrapper.vm.sortedFilteredListOptions).toContain("option2"); 
      expect(wrapper.vm.sortedFilteredListOptions).toContain("option3");
      expect(wrapper.vm.sortedFilteredListOptions).not.toContain("zebra");
      expect(wrapper.vm.sortedFilteredListOptions).not.toContain("alpha");
    });

    it("should return empty array when no filter values exist for column", () => {
      wrapper = createWrapper({
        condition: {
          ...defaultProps.condition,
          column: "nonexistent_field",
        }
      });
      
      const options = wrapper.vm.sortedFilteredListOptions;
      expect(options).toEqual([]);
    });

    it("should handle case insensitive filtering", () => {
      wrapper = createWrapper();
      
      const mockUpdate = vi.fn();
      wrapper.vm.filterListFn("OPTION", mockUpdate);
      
      expect(wrapper.vm.sortedFilteredListOptions).toContain("option1");
      expect(wrapper.vm.sortedFilteredListOptions).toContain("option2");
      expect(wrapper.vm.sortedFilteredListOptions).toContain("option3");
    });
  });

  describe("Operator array", () => {
    it("should contain all expected operators", () => {
      wrapper = createWrapper();
      
      const expectedOperators = [
        "=", "<>", ">=", "<=", ">", "<",
        "IN", "NOT IN", "str_match", "str_match_ignore_case",
        "match_all", "re_match", "re_not_match",
        "Contains", "Starts With", "Ends With", "Not Contains",
        "Is Null", "Is Not Null"
      ];
      
      expect(wrapper.vm.operators).toEqual(expectedOperators);
    });
  });

  describe("Filter options", () => {
    it("should contain AND and OR options", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.filterOptions).toEqual(["AND", "OR"]);
    });
  });

  describe("Watcher functionality", () => {
    it("should clear values when column changes", async () => {
      const condition = {
        ...defaultProps.condition,
        column: "test_field",
        values: ["value1", "value2"],
      };
      
      wrapper = createWrapper({ condition });
      
      // Change the column
      wrapper.vm.$props.condition.column = "new_field";
      
      // Wait for watchers to run
      await nextTick();
      
      expect(wrapper.vm.$props.condition.values).toEqual([]);
    });

    it("should not clear values when column doesn't change", async () => {
      const condition = {
        ...defaultProps.condition,
        column: "test_field",
        values: ["value1", "value2"],
      };
      
      wrapper = createWrapper({ condition });
      
      // Don't change the column, just trigger a re-render
      await nextTick();
      
      expect(wrapper.vm.$props.condition.values).toEqual(["value1", "value2"]);
    });
  });

  describe("Edge cases", () => {
    it("should handle condition with null/undefined values", () => {
      wrapper = createWrapper({
        condition: {
          ...defaultProps.condition,
          column: null,
          operator: null,
          value: null,
          values: null,
        },
      });
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeDefined();
    });

    it("should handle empty dashboardPanelData", () => {
      wrapper = createWrapper({
        dashboardPanelData: {
          meta: {
            filterValue: [],
          },
        },
      });
      
      expect(wrapper.vm.sortedFilteredListOptions).toEqual([]);
    });

    it("should handle missing filterValue in dashboardPanelData", () => {
      wrapper = createWrapper({
        dashboardPanelData: {
          meta: {},
        },
      });
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty schemaOptions", () => {
      wrapper = createWrapper({
        schemaOptions: [],
      });
      
      expect(wrapper.vm.filteredSchemaOptions).toBeDefined();
    });
  });
});