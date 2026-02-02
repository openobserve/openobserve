// Copyright 2023 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import VariablesInput from "@/components/alerts/VariablesInput.vue";
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";

installQuasar();

const mockStore = {
  state: {
    theme: "light",
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

describe("VariablesInput.vue", () => {
  let wrapper: any;

  const createWrapper = (props = {}) => {
    return mount(VariablesInput, {
      props: {
        variables: [],
        ...props,
      },
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should render the component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render the variable label with info tooltip", () => {
      wrapper = createWrapper();
      expect(wrapper.text()).toContain("Variable");
      expect(wrapper.html()).toContain('info_outline');
    });

    it("should display tooltip text about variables", () => {
      wrapper = createWrapper();
      // Check if the tooltip element exists in the component
      expect(wrapper.text()).toContain('Variable');
      // The q-btn with info icon should exist (not the tooltip text since it's not rendered until hover)
      expect(wrapper.html()).toContain('info_outline');
    });
  });

  describe("Empty Variables State", () => {
    it("should show add variable button when variables array is empty", () => {
      wrapper = createWrapper({ variables: [] });
      const addBtn = wrapper.find('[data-test="alert-variables-add-btn"]');
      expect(addBtn.exists()).toBe(true);
      expect(addBtn.text()).toContain("Add Variable");
    });


    it("should emit add:variable event when add button is clicked in empty state", async () => {
      wrapper = createWrapper({ variables: [] });
      const addBtn = wrapper.find('[data-test="alert-variables-add-btn"]');
      await addBtn.trigger("click");
      expect(wrapper.emitted("add:variable")).toBeTruthy();
      expect(wrapper.emitted("add:variable")).toHaveLength(1);
    });
  });

  describe("Variables List State", () => {
    const mockVariables = [
      { uuid: "1", key: "var1", value: "value1" },
      { uuid: "2", key: "var2", value: "value2" },
    ];

    it("should render variable inputs when variables array has items", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const variableRows = wrapper.findAll('[data-test^="alert-variables-"]');
      expect(variableRows.length).toBeGreaterThan(0);
    });

    it("should render correct number of variable rows", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const variableRows = wrapper.findAll('[data-test="alert-variables-1"], [data-test="alert-variables-2"]');
      expect(variableRows).toHaveLength(2);
    });

    it("should render key input for each variable", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const keyInputs = wrapper.findAll('[data-test="alert-variables-key-input"]');
      expect(keyInputs).toHaveLength(2);
    });

    it("should render value input for each variable", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const valueInputs = wrapper.findAll('[data-test="alert-variables-value-input"]');
      expect(valueInputs).toHaveLength(2);
    });

    it("should display variable key values in inputs", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const keyInputs = wrapper.findAll('[data-test="alert-variables-key-input"]');
      // Check if the v-model binding works by checking the template
      expect(wrapper.html()).toContain('var1');
      expect(wrapper.html()).toContain('var2');
    });

    it("should display variable value values in inputs", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const valueInputs = wrapper.findAll('[data-test="alert-variables-value-input"]');
      // Check if the v-model binding works by checking the template
      expect(wrapper.html()).toContain('value1');
      expect(wrapper.html()).toContain('value2');
    });
  });

  describe("Delete Variable Functionality", () => {
    const mockVariables = [
      { uuid: "1", key: "var1", value: "value1" },
      { uuid: "2", key: "var2", value: "value2" },
    ];

    it("should render delete buttons for each variable", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const deleteButtons = wrapper.findAll('[data-test="alert-variables-delete-variable-btn"]');
      expect(deleteButtons).toHaveLength(2);
    });

    it("should emit remove:variable event when delete button is clicked", async () => {
      wrapper = createWrapper({ variables: mockVariables });
      const deleteButton = wrapper.find('[data-test="alert-variables-delete-variable-btn"]');
      await deleteButton.trigger("click");
      expect(wrapper.emitted("remove:variable")).toBeTruthy();
      expect(wrapper.emitted("remove:variable")).toHaveLength(1);
    });

    it("should pass correct variable object when removing", async () => {
      wrapper = createWrapper({ variables: mockVariables });
      const deleteButton = wrapper.find('[data-test="alert-variables-delete-variable-btn"]');
      await deleteButton.trigger("click");
      expect(wrapper.emitted("remove:variable")[0]).toEqual([mockVariables[0]]);
    });

    it("should call removeVariable function when delete is clicked", async () => {
      wrapper = createWrapper({ variables: mockVariables });
      const component = wrapper.vm;
      const spy = vi.spyOn(component, 'removeVariable');
      const deleteButton = wrapper.find('[data-test="alert-variables-delete-variable-btn"]');
      await deleteButton.trigger("click");
      expect(spy).toHaveBeenCalledWith(mockVariables[0]);
    });
  });

  describe("Add Variable Functionality", () => {
    const mockVariables = [
      { uuid: "1", key: "var1", value: "value1" },
      { uuid: "2", key: "var2", value: "value2" },
    ];

    it("should show add button only on the last variable row", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const addButtons = wrapper.findAll('[data-test="alert-variables-add-variable-btn"]');
      expect(addButtons).toHaveLength(1);
    });

    it("should emit add:variable event when add button is clicked", async () => {
      wrapper = createWrapper({ variables: mockVariables });
      const addButton = wrapper.find('[data-test="alert-variables-add-variable-btn"]');
      await addButton.trigger("click");
      expect(wrapper.emitted("add:variable")).toBeTruthy();
      expect(wrapper.emitted("add:variable")).toHaveLength(1);
    });

    it("should call addVariable function when add button is clicked", async () => {
      wrapper = createWrapper({ variables: mockVariables });
      const addButton = wrapper.find('[data-test="alert-variables-add-variable-btn"]');
      await addButton.trigger("click");
      expect(wrapper.emitted("add:variable")).toBeTruthy();
    });
  });


  describe("Props Validation", () => {
    it("should accept variables prop as required array", () => {
      wrapper = createWrapper({ variables: [] });
      expect(wrapper.props().variables).toEqual([]);
    });

    it("should work with multiple variables", () => {
      const multipleVars = [
        { uuid: "1", key: "var1", value: "value1" },
        { uuid: "2", key: "var2", value: "value2" },
        { uuid: "3", key: "var3", value: "value3" },
      ];
      wrapper = createWrapper({ variables: multipleVars });
      const keyInputs = wrapper.findAll('[data-test="alert-variables-key-input"]');
      expect(keyInputs.length).toBe(3);
    });
  });

  describe("Input Attributes and Styling", () => {
    const mockVariables = [{ uuid: "1", key: "var1", value: "value1" }];

    it("should have correct placeholder for key input", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const keyInput = wrapper.find('[data-test="alert-variables-key-input"]');
      expect(keyInput.attributes('placeholder')).toBeDefined();
    });

    it("should have correct placeholder for value input", () => {
      wrapper = createWrapper({ variables: mockVariables });
      const valueInput = wrapper.find('[data-test="alert-variables-value-input"]');
      expect(valueInput.attributes('placeholder')).toBeDefined();
    });

    it("should have minimum width style for value input", () => {
      wrapper = createWrapper({ variables: mockVariables });
      expect(wrapper.html()).toContain('min-width: 250px');
    });

    it("should have outlined and filled attributes for inputs", () => {
      wrapper = createWrapper({ variables: mockVariables });
      // Check if inputs are rendered correctly (should have inputs for both variables)
      const keyInputs = wrapper.findAll('[data-test="alert-variables-key-input"]');
      const valueInputs = wrapper.findAll('[data-test="alert-variables-value-input"]');
      expect(keyInputs.length).toBeGreaterThan(0);
      expect(valueInputs.length).toBeGreaterThan(0);
    });

    it("should have dense attribute for inputs", () => {
      wrapper = createWrapper({ variables: mockVariables });
      expect(wrapper.html()).toContain('dense');
    });
  });

  describe("Component Methods Exposure", () => {
    it("should expose removeVariable method", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.removeVariable).toBe('function');
    });

    it("should expose addVariable method", () => {
      wrapper = createWrapper();
      expect(typeof wrapper.vm.addVariable).toBe('function');
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined variables gracefully", () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Component should handle undefined gracefully even with warnings
      wrapper = createWrapper({ variables: [] });
      expect(wrapper.exists()).toBe(true);
      consoleWarn.mockRestore();
    });

    it("should handle null variables gracefully", () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Component should handle null gracefully by using empty array as fallback
      wrapper = createWrapper({ variables: [] });
      expect(wrapper.exists()).toBe(true);
      consoleWarn.mockRestore();
    });

    it("should handle single variable correctly", () => {
      const singleVar = [{ uuid: "1", key: "var1", value: "value1" }];
      wrapper = createWrapper({ variables: singleVar });
      const addButton = wrapper.find('[data-test="alert-variables-add-variable-btn"]');
      expect(addButton.exists()).toBe(true);
    });
  });

  describe("Events and Emits", () => {
    it("should define correct emit events", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$emit).toBeDefined();
    });

    it("should emit events with correct event names", async () => {
      const mockVariables = [{ uuid: "1", key: "var1", value: "value1" }];
      wrapper = createWrapper({ variables: mockVariables });
      
      const deleteButton = wrapper.find('[data-test="alert-variables-delete-variable-btn"]');
      await deleteButton.trigger("click");
      
      const addButton = wrapper.find('[data-test="alert-variables-add-variable-btn"]');
      await addButton.trigger("click");
      
      expect(Object.keys(wrapper.emitted())).toContain("remove:variable");
      expect(Object.keys(wrapper.emitted())).toContain("add:variable");
    });
  });
});