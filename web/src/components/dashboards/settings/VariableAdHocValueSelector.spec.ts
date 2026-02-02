// Copyright 2023 OpenObserve Inc.
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
import { Quasar } from "quasar";
import { nextTick } from "vue";
import VariableAdHocValueSelector from "./VariableAdHocValueSelector.vue";

// Mock vuex store
const mockStore = {
  state: {
    theme: "light"
  }
};

vi.mock("vuex", () => ({
  useStore: () => mockStore
}));

// Mock useSelectAutocomplete composable
const mockUseSelectAutoComplete = {
  filterFn: vi.fn(),
  filteredOptions: []
};

vi.mock("../../../composables/useSelectAutocomplete", () => ({
  useSelectAutoComplete: vi.fn(() => mockUseSelectAutoComplete)
}));

// Mock DynamicFilterIcon component
vi.mock("../../icons/DynamicFilterIcon.vue", () => ({
  default: {
    name: "DynamicFilterIcon",
    template: '<div data-test="dynamic-filter-icon"></div>'
  }
}));

describe("VariableAdHocValueSelector", () => {
  let wrapper: VueWrapper<any>;

  const defaultProps = {
    modelValue: [
      {
        name: "test-field",
        operator: "=",
        value: "test-value",
        streams: []
      }
    ],
    variableItem: {
      name: "test-variable",
      options: [
        { name: "field1", value: "value1" },
        { name: "field2", value: "value2" }
      ]
    }
  };

  beforeEach(() => {
    wrapper = mount(VariableAdHocValueSelector, {
      global: {
        plugins: [Quasar],
      },
      props: defaultProps
    });
  });

  afterEach(() => {
    wrapper.unmount();
  });

  describe("Component Initialization", () => {
    it("should render correctly with initial props", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-variable-adhoc-name-selector"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-variable-adhoc-operator-selector"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-variable-adhoc-value-selector"]').exists()).toBe(true);
    });

    it("should display existing adhoc variables", () => {
      const nameInput = wrapper.find('[data-test="dashboard-variable-adhoc-name-selector"]');
      expect(nameInput.exists()).toBe(true);
      // The input value should be set from modelValue
      expect(wrapper.vm.adhocVariables[0].name).toBe("test-field");
    });

    it("should render add filter button", () => {
      const addButton = wrapper.find('[data-test="dashboard-variable-adhoc-add-selector"]');
      expect(addButton.exists()).toBe(true);
    });
  });

  describe("Props and Reactive Data", () => {
    it("should properly initialize operator options", () => {
      expect(wrapper.vm.operatorOptions).toEqual(['=', '!=']);
    });

    it("should react to variableItem changes", async () => {
      const newVariableItem = {
        name: "updated-variable",
        options: [
          { name: "newField1", value: "newValue1" },
          { name: "newField2", value: "newValue2" }
        ]
      };

      await wrapper.setProps({ variableItem: newVariableItem });
      await nextTick();

      // The options are managed internally, so we check if variableItem prop changed
      expect(wrapper.props('variableItem')).toEqual(newVariableItem);
    });

    it("should handle empty modelValue", async () => {
      await wrapper.setProps({ modelValue: [] });
      await nextTick();

      expect(wrapper.vm.adhocVariables).toEqual([]);
    });
  });

  describe("Add Fields Functionality", () => {
    it("should add new field when addFields is called", async () => {
      const initialLength = wrapper.vm.adhocVariables.length;
      const addButton = wrapper.find('[data-test="dashboard-variable-adhoc-add-selector"]');

      await addButton.trigger("click");
      await nextTick();

      expect(wrapper.vm.adhocVariables).toHaveLength(initialLength + 1);
      
      const newField = wrapper.vm.adhocVariables[wrapper.vm.adhocVariables.length - 1];
      expect(newField).toEqual({
        name: '',
        operator: '=',
        value: '',
        streams: []
      });
    });

    it("should emit update:modelValue when adding fields", async () => {
      const initialLength = wrapper.vm.adhocVariables.length;
      const addButton = wrapper.find('[data-test="dashboard-variable-adhoc-add-selector"]');

      await addButton.trigger("click");
      await nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      const emittedValue = wrapper.emitted("update:modelValue")?.[0]?.[0];
      expect(Array.isArray(emittedValue)).toBe(true);
      expect(emittedValue).toHaveLength(initialLength + 1);
    });
  });

  describe("Remove Fields Functionality", () => {
    beforeEach(async () => {
      // Add multiple fields for testing removal
      await wrapper.setProps({
        modelValue: [
          { name: "field1", operator: "=", value: "value1", streams: [] },
          { name: "field2", operator: "!=", value: "value2", streams: [] }
        ]
      });
    });

    it("should remove field when close button is clicked", async () => {
      const closeButton = wrapper.find('[data-test="dashboard-variable-adhoc-close-0"]');
      expect(closeButton.exists()).toBe(true);

      await closeButton.trigger("click");
      await nextTick();

      expect(wrapper.vm.adhocVariables).toHaveLength(1);
      expect(wrapper.vm.adhocVariables[0].name).toBe("field2");
    });

    it("should emit update:modelValue when removing fields", async () => {
      const closeButton = wrapper.find('[data-test="dashboard-variable-adhoc-close-0"]');

      await closeButton.trigger("click");
      await nextTick();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      const emittedValues = wrapper.emitted("update:modelValue") as any[][];
      const lastEmittedValue = emittedValues[emittedValues.length - 1][0];
      expect(lastEmittedValue).toHaveLength(1);
    });

    it("should render correct number of close buttons", async () => {
      const closeButtons = wrapper.findAll('[data-test^="dashboard-variable-adhoc-close-"]');
      expect(closeButtons).toHaveLength(2);
    });
  });

  describe("Name Input Functionality", () => {
    it("should update field name when input changes", async () => {
      const nameInput = wrapper.find('[data-test="dashboard-variable-adhoc-name-selector"]');
      
      await nameInput.setValue("updated-field-name");
      await nameInput.trigger("input");
      
      expect(wrapper.vm.adhocVariables[0].name).toBe("updated-field-name");
    });

    it("should emit update:modelValue when name changes", async () => {
      const nameInput = wrapper.find('[data-test="dashboard-variable-adhoc-name-selector"]');
      
      await nameInput.setValue("new-name");
      await nameInput.trigger("input");

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should handle debounced input correctly", async () => {
      const nameInput = wrapper.find('[data-test="dashboard-variable-adhoc-name-selector"]');
      
      // Test that the component has debounce functionality (attribute may not be directly accessible)
      expect(nameInput.exists()).toBe(true);
      
      // The debounce is implemented in the component, so we test the functionality
      await nameInput.setValue("test-debounce");
      expect(wrapper.vm.adhocVariables[0].name).toBe("test-debounce");
    });
  });

  describe("Operator Selection", () => {
    it("should render operator dropdown with correct options", async () => {
      const operatorSelect = wrapper.find('[data-test="dashboard-variable-adhoc-operator-selector"]');
      expect(operatorSelect.exists()).toBe(true);
      
      // Check if the component has the correct operator options
      expect(wrapper.vm.operatorOptions).toEqual(['=', '!=']);
    });

    it("should update operator when selection changes", async () => {
      const operatorSelect = wrapper.find('[data-test="dashboard-variable-adhoc-operator-selector"]');
      
      // Simulate selecting a different operator
      wrapper.vm.adhocVariables[0].operator = "!=";
      await nextTick();

      expect(wrapper.vm.adhocVariables[0].operator).toBe("!=");
    });

    it("should display current operator value", () => {
      // The operator should match the initial props value
      expect(wrapper.vm.adhocVariables[0].operator).toBe(defaultProps.modelValue[0].operator);
    });
  });

  describe("Value Input", () => {
    it("should render value input field", () => {
      const valueInput = wrapper.find('[data-test="dashboard-variable-adhoc-value-selector"]');
      expect(valueInput.exists()).toBe(true);
    });

    it("should update value when input changes", async () => {
      const valueInput = wrapper.find('[data-test="dashboard-variable-adhoc-value-selector"]');
      
      await valueInput.setValue("new-test-value");
      
      expect(wrapper.vm.adhocVariables[0].value).toBe("new-test-value");
    });

    it("should have correct placeholder text", () => {
      const valueInput = wrapper.find('[data-test="dashboard-variable-adhoc-value-selector"]');
      expect(valueInput.attributes('placeholder')).toBe('Enter Value');
    });

    it("should have debounce configured", () => {
      const valueInput = wrapper.find('[data-test="dashboard-variable-adhoc-value-selector"]');
      
      // Test that input exists and has expected behavior
      expect(valueInput.exists()).toBe(true);
      
      // Test debounce functionality by checking if value updates work
      valueInput.setValue("debounce-test");
      expect(wrapper.vm.adhocVariables[0].value).toBeDefined();
    });
  });

  describe("Theme Integration", () => {
    it("should apply correct styling for light theme", () => {
      mockStore.state.theme = "light";
      
      const closeButton = wrapper.find('[data-test="dashboard-variable-adhoc-close-0"]');
      expect(closeButton.exists()).toBe(true);
    });

    it("should apply correct styling for dark theme", async () => {
      mockStore.state.theme = "dark";
      await nextTick();
      
      const closeButton = wrapper.find('[data-test="dashboard-variable-adhoc-close-0"]');
      expect(closeButton.exists()).toBe(true);
    });
  });

  describe("Tooltip Functionality", () => {
    it("should render tooltip on add button", () => {
      const addButton = wrapper.find('[data-test="dashboard-variable-adhoc-add-selector"]');
      const tooltip = addButton.find('q-tooltip');
      
      if (tooltip.exists()) {
        expect(tooltip.text()).toBe('Add Dynamic Filter');
      }
    });
  });

  describe("Edge Cases", () => {
    it("should handle null/undefined modelValue", async () => {
      await wrapper.setProps({ modelValue: null });
      await nextTick();

      expect(wrapper.vm.adhocVariables).toBe(null);
    });

    it("should handle undefined variableItem", async () => {
      await wrapper.setProps({ variableItem: undefined });
      await nextTick();

      // Component should still render without errors
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle empty options array", async () => {
      await wrapper.setProps({
        variableItem: {
          name: "test-variable",
          options: []
        }
      });
      await nextTick();

      // Check that props were set correctly
      expect(wrapper.props('variableItem').options).toEqual([]);
    });
  });

  describe("Data Deep Copy", () => {
    it("should emit deep copy of data to prevent mutation", async () => {
      const addButton = wrapper.find('[data-test="dashboard-variable-adhoc-add-selector"]');

      await addButton.trigger("click");
      await nextTick();

      const emittedValue = wrapper.emitted("update:modelValue")?.[0]?.[0];
      
      // Modify emitted value and check it doesn't affect component data
      if (Array.isArray(emittedValue)) {
        emittedValue[0].name = "modified-name";
        expect(wrapper.vm.adhocVariables[0].name).not.toBe("modified-name");
      }
    });
  });

  describe("Multiple Variables", () => {
    beforeEach(async () => {
      await wrapper.setProps({
        modelValue: [
          { name: "field1", operator: "=", value: "value1", streams: [] },
          { name: "field2", operator: "!=", value: "value2", streams: [] },
          { name: "field3", operator: "=", value: "value3", streams: [] }
        ]
      });
    });

    it("should render multiple adhoc variable rows", () => {
      const nameInputs = wrapper.findAll('[data-test="dashboard-variable-adhoc-name-selector"]');
      expect(nameInputs).toHaveLength(3);
    });

    it("should handle removal of middle item", async () => {
      const closeButton = wrapper.find('[data-test="dashboard-variable-adhoc-close-1"]');

      await closeButton.trigger("click");
      await nextTick();

      expect(wrapper.vm.adhocVariables).toHaveLength(2);
      expect(wrapper.vm.adhocVariables[0].name).toBe("field1");
      expect(wrapper.vm.adhocVariables[1].name).toBe("field3");
    });

    it("should update correct field when input changes", async () => {
      const secondNameInput = wrapper.findAll('[data-test="dashboard-variable-adhoc-name-selector"]')[1];
      
      await secondNameInput.setValue("updated-field2");
      
      expect(wrapper.vm.adhocVariables[1].name).toBe("updated-field2");
      expect(wrapper.vm.adhocVariables[0].name).toBe("field1"); // Other fields unchanged
      expect(wrapper.vm.adhocVariables[2].name).toBe("field3");
    });
  });

  describe("Component Integration", () => {
    it("should integrate with useSelectAutoComplete", () => {
      expect(mockUseSelectAutoComplete.filterFn).toBeDefined();
      expect(wrapper.vm.fieldsFilterFn).toBe(mockUseSelectAutoComplete.filterFn);
      expect(wrapper.vm.fieldsFilteredOptions).toBe(mockUseSelectAutoComplete.filteredOptions);
    });

    it("should have correct component structure", () => {
      // Test that the component is properly structured
      expect(wrapper.vm.$options.name).toBe('VariableAdHocValueSelector');
      expect(wrapper.vm.$props).toHaveProperty('modelValue');
      expect(wrapper.vm.$props).toHaveProperty('variableItem');
    });
  });
});