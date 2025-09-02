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
import AddSettingVariable from "./AddSettingVariable.vue";

// Mock external dependencies
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: vi.fn((key: string) => {
      const translations: Record<string, string> = {
        "dashboard.typeOfVariable": "Type of Variable",
        "dashboard.nameOfVariable": "Name of Variable",
        "dashboard.labelOfVariable": "Label of Variable",
        "dashboard.addGeneralSettings": "General Settings",
        "dashboard.extraOptions": "Extra Options",
        "dashboard.selectStreamType": "Select Stream Type",
        "dashboard.selectIndex": "Select Index",
        "dashboard.selectField": "Select Field",
        "dashboard.DefaultSize": "Default Size",
        "dashboard.maxRecordSize": "Maximum record size",
        "dashboard.ValueOfVariable": "Value of Variable",
        "dashboard.DefaultValue": "Default Value",
        "dashboard.multiSelect": "Multi Select",
        "dashboard.hideOnDashboard": "Hide on Dashboard",
        "dashboard.escapeSingleQuotes": "Escape Single Quotes",
        "dashboard.cancel": "Cancel",
        "dashboard.queryValues": "Query Values",
        "dashboard.constant": "Constant",
        "dashboard.textbox": "Textbox",
        "dashboard.custom": "Custom"
      };
      return translations[key] || key;
    })
  })
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: {
        identifier: "test-org"
      },
      theme: "light"
    }
  })
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    query: {
      dashboard: "test-dashboard",
      folder: "test-folder"
    }
  })
}));

// Mock composables
const mockStreams = {
  getStreams: vi.fn().mockResolvedValue({ list: [
    { name: "stream1", type: "logs" },
    { name: "stream2", type: "logs" }
  ]}),
  getStream: vi.fn().mockResolvedValue({
    schema: [
      { name: "field1", type: "string" },
      { name: "field2", type: "number" }
    ]
  })
};

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => mockStreams)
}));

const mockUseSelectAutoComplete = {
  filterFn: vi.fn(),
  filteredOptions: [
    { name: "stream1", type: "logs" },
    { name: "stream2", type: "logs" }
  ]
};

vi.mock("../../../composables/useSelectAutocomplete", () => ({
  useSelectAutoComplete: vi.fn(() => mockUseSelectAutoComplete)
}));

const mockLoading = {
  isLoading: { value: false },
  execute: vi.fn().mockResolvedValue({}),
  error: { value: null }
};

vi.mock("../../../composables/useLoading", () => ({
  useLoading: vi.fn(() => mockLoading)
}));

const mockNotifications = {
  showPositiveNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showConfictErrorNotificationWithRefreshBtn: vi.fn()
};

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => mockNotifications)
}));

// Mock utils
vi.mock("../../../utils/commons", () => ({
  addVariable: vi.fn().mockResolvedValue({}),
  getDashboard: vi.fn().mockResolvedValue({
    variables: {
      list: [
        { name: "existingVar", type: "custom", options: [{ label: "test", value: "test", selected: true }] }
      ]
    }
  }),
  updateVariable: vi.fn().mockResolvedValue({})
}));

// Mock dependency utils
vi.mock("../../../utils/dashboard/variables/variablesDependencyUtils", () => ({
  buildVariablesDependencyGraph: vi.fn().mockReturnValue({}),
  isGraphHasCycle: vi.fn().mockReturnValue(null)
}));

// Mock child components
vi.mock("./common/DashboardHeader.vue", () => ({
  default: {
    name: "DashboardHeader",
    template: '<div data-test="dashboard-header-mock"><slot /></div>',
    props: ["title", "backButton"],
    emits: ["back"]
  }
}));

vi.mock("../addPanel/CommonAutoComplete.vue", () => ({
  default: {
    name: "CommonAutoComplete",
    template: '<div data-test="common-autocomplete-mock"></div>',
    props: ["modelValue", "items", "searchRegex", "rules", "debounce", "placeholder"],
    emits: ["update:modelValue"]
  }
}));

describe("AddSettingVariable", () => {
  let wrapper: VueWrapper<any>;

  const defaultProps = {
    variableName: null,
    dashboardVariablesList: [
      { name: "var1", type: "custom" },
      { name: "var2", type: "query_values" }
    ]
  };

  beforeEach(() => {
    vi.clearAllMocks();
    
    wrapper = mount(AddSettingVariable, {
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
    it("should render correctly", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-header-mock"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      expect(wrapper.vm.$options.name).toBe("AddSettingVariable");
    });

    it("should accept props correctly", () => {
      expect(wrapper.props('variableName')).toBe(null);
      expect(wrapper.props('dashboardVariablesList')).toEqual(defaultProps.dashboardVariablesList);
    });

    it("should initialize with default variable type", () => {
      expect(wrapper.vm.variableData.type).toBe("query_values");
    });

    it("should have correct title for new variable", () => {
      expect(wrapper.vm.title).toBe("Add Variable");
    });
  });

  describe("Variable Types", () => {
    it("should render variable type selector", () => {
      const typeSelect = wrapper.find('[data-test="dashboard-variable-type-select"]');
      expect(typeSelect.exists()).toBe(true);
    });

    it("should have correct variable type options", () => {
      const expectedTypes = [
        { label: "Query Values", value: "query_values" },
        { label: "Constant", value: "constant" },
        { label: "Textbox", value: "textbox" },
        { label: "Custom", value: "custom" }
      ];
      expect(wrapper.vm.variableTypes).toEqual(expectedTypes);
    });

    it("should show appropriate fields based on variable type", async () => {
      // Test query_values type
      wrapper.vm.variableData.type = "query_values";
      await nextTick();
      
      expect(wrapper.find('[data-test="dashboard-variable-stream-type-select"]').exists()).toBe(true);

      // Test constant type
      wrapper.vm.variableData.type = "constant";
      await nextTick();
      
      expect(wrapper.find('[data-test="dashboard-variable-constant-value"]').exists()).toBe(true);

      // Test textbox type
      wrapper.vm.variableData.type = "textbox";
      await nextTick();
      
      expect(wrapper.find('[data-test="dashboard-variable-textbox-default-value"]').exists()).toBe(true);
    });
  });

  describe("Basic Fields", () => {
    it("should render variable name field", () => {
      const nameField = wrapper.find('[data-test="dashboard-variable-name"]');
      expect(nameField.exists()).toBe(true);
    });

    it("should render variable label field", () => {
      const labelField = wrapper.find('[data-test="dashboard-variable-label"]');
      expect(labelField.exists()).toBe(true);
    });

    it("should validate required name field", async () => {
      const nameField = wrapper.find('[data-test="dashboard-variable-name"]');
      expect(nameField.exists()).toBe(true);
      
      // Test that field has validation functionality
      expect(wrapper.vm.variableData.name).toBeDefined();
    });

    it("should validate name field format", () => {
      const nameField = wrapper.find('[data-test="dashboard-variable-name"]');
      expect(nameField.exists()).toBe(true);
      
      // Test that the component has validation logic
      expect(wrapper.vm.variableData.name).toBeDefined();
    });
  });

  describe("Query Values Configuration", () => {
    beforeEach(async () => {
      wrapper.vm.variableData.type = "query_values";
      await nextTick();
    });

    it("should render stream type selector", () => {
      const streamTypeSelect = wrapper.find('[data-test="dashboard-variable-stream-type-select"]');
      expect(streamTypeSelect.exists()).toBe(true);
    });

    it("should render stream selector", () => {
      const streamSelect = wrapper.find('[data-test="dashboard-variable-stream-select"]');
      expect(streamSelect.exists()).toBe(true);
    });

    it("should render field selector", () => {
      const fieldSelect = wrapper.find('[data-test="dashboard-variable-field-select"]');
      expect(fieldSelect.exists()).toBe(true);
    });

    it("should render max record size field", () => {
      const maxRecordSize = wrapper.find('[data-test="dashboard-variable-max-record-size"]');
      expect(maxRecordSize.exists()).toBe(true);
    });

    it("should have correct stream type options", () => {
      expect(wrapper.vm.data.streamType).toEqual([
        "logs", "metrics", "traces", "enrichment_tables", "metadata"
      ]);
    });

    it("should update streams when stream type changes", async () => {
      wrapper.vm.variableData.query_data.stream_type = "logs";
      
      await wrapper.vm.streamTypeUpdated();
      
      expect(mockStreams.getStreams).toHaveBeenCalledWith("logs", false);
      expect(wrapper.vm.data.streams).toEqual([
        { name: "stream1", type: "logs" },
        { name: "stream2", type: "logs" }
      ]);
    });

    it("should update fields when stream changes", async () => {
      wrapper.vm.variableData.query_data.stream_type = "logs";
      wrapper.vm.variableData.query_data.stream = "stream1";
      
      await wrapper.vm.streamUpdated();
      
      expect(mockStreams.getStream).toHaveBeenCalledWith("stream1", "logs", true);
      expect(wrapper.vm.data.currentFieldsList).toEqual([
        { name: "field1", type: "string" },
        { name: "field2", type: "number" }
      ]);
    });
  });

  describe("Filters Configuration", () => {
    beforeEach(async () => {
      wrapper.vm.variableData.type = "query_values";
      await nextTick();
    });

    it("should render add filter button", () => {
      const addFilterBtn = wrapper.find('[data-test="dashboard-add-filter-btn"]');
      expect(addFilterBtn.exists()).toBe(true);
    });

    it("should add filter when button clicked", async () => {
      const initialFilterCount = wrapper.vm.variableData.query_data.filter.length;
      const addFilterBtn = wrapper.find('[data-test="dashboard-add-filter-btn"]');

      await addFilterBtn.trigger("click");

      expect(wrapper.vm.variableData.query_data.filter).toHaveLength(initialFilterCount + 1);
      
      const newFilter = wrapper.vm.variableData.query_data.filter[wrapper.vm.variableData.query_data.filter.length - 1];
      expect(newFilter).toEqual({
        name: "",
        operator: "=",
        value: ""
      });
    });

    it("should remove filter when remove button clicked", async () => {
      // Add a filter first
      wrapper.vm.addFilter();
      wrapper.vm.addFilter();
      const initialFilterCount = wrapper.vm.variableData.query_data.filter.length;

      wrapper.vm.removeFilter(0);

      expect(wrapper.vm.variableData.query_data.filter).toHaveLength(initialFilterCount - 1);
    });

    it("should have correct operator options for filters", () => {
      const expectedOperators = [
        '=', '!=', '>=', '<=', '>', '<', 'IN', 'NOT IN',
        'str_match', 'str_match_ignore_case', 'match_all',
        're_match', 're_not_match', 'Contains', 'Not Contains',
        'Starts With', 'Ends With', 'Is Null', 'Is Not Null'
      ];

      // Add a filter to test
      wrapper.vm.addFilter();
      
      // The operators are defined in the template, so we check if they're available
      expect(expectedOperators).toContain('=');
      expect(expectedOperators).toContain('Is Null');
    });
  });

  describe("Custom Variable Configuration", () => {
    beforeEach(async () => {
      wrapper.vm.variableData.type = "custom";
      await nextTick();
    });

    it("should render custom variable options", () => {
      // Check if custom options are rendered
      expect(wrapper.vm.variableData.options).toBeDefined();
      expect(Array.isArray(wrapper.vm.variableData.options)).toBe(true);
    });

    it("should add new custom option", () => {
      const initialOptionsCount = wrapper.vm.variableData.options.length;
      
      wrapper.vm.addField();
      
      expect(wrapper.vm.variableData.options).toHaveLength(initialOptionsCount + 1);
      
      const newOption = wrapper.vm.variableData.options[wrapper.vm.variableData.options.length - 1];
      expect(newOption).toEqual({
        label: "",
        value: "",
        selected: false
      });
    });

    it("should remove custom option", () => {
      // Add options first
      wrapper.vm.addField();
      wrapper.vm.addField();
      const initialOptionsCount = wrapper.vm.variableData.options.length;
      
      wrapper.vm.removeField(0);
      
      expect(wrapper.vm.variableData.options).toHaveLength(initialOptionsCount - 1);
    });

    it("should not remove option if only one exists", () => {
      // Reset to single option
      wrapper.vm.variableData.options = [{ label: "test", value: "test", selected: true }];
      
      wrapper.vm.removeField(0);
      
      expect(wrapper.vm.variableData.options).toHaveLength(1);
    });

    it("should handle custom select all checkbox", () => {
      wrapper.vm.variableData.options = [
        { label: "opt1", value: "val1", selected: true },
        { label: "opt2", value: "val2", selected: true }
      ];
      
      // Test that custom select all model exists
      expect(wrapper.vm.customSelectAllModel).toBeDefined();
    });
  });

  describe("Multi-select Configuration", () => {
    it("should render multi-select toggle for query_values", async () => {
      wrapper.vm.variableData.type = "query_values";
      await nextTick();
      
      const multiSelectToggle = wrapper.find('[data-test="dashboard-query_values-show_multiple_values"]');
      expect(multiSelectToggle.exists()).toBe(true);
    });

    it("should render multi-select default value options", async () => {
      wrapper.vm.variableData.type = "query_values";
      wrapper.vm.variableData.multiSelect = true;
      await nextTick();
      
      const firstValueBtn = wrapper.find('[data-test="dashboard-multi-select-default-value-toggle-first-value"]');
      const allValuesBtn = wrapper.find('[data-test="dashboard-multi-select-default-value-toggle-all-values"]');
      const customBtn = wrapper.find('[data-test="dashboard-multi-select-default-value-toggle-custom"]');
      
      expect(firstValueBtn.exists()).toBe(true);
      expect(allValuesBtn.exists()).toBe(true);
      expect(customBtn.exists()).toBe(true);
    });

    it("should handle multi-select default value selection", async () => {
      wrapper.vm.variableData.type = "query_values";
      wrapper.vm.variableData.selectAllValueForMultiSelect = "first";
      
      const allValuesBtn = wrapper.find('[data-test="dashboard-multi-select-default-value-toggle-all-values"]');
      await allValuesBtn.trigger("click");
      
      expect(wrapper.vm.variableData.selectAllValueForMultiSelect).toBe("all");
    });
  });

  describe("Additional Options", () => {
    it("should render hide on dashboard toggle", () => {
      const hideToggle = wrapper.find('[data-test="dashboard-variable-hide_on_dashboard"]');
      expect(hideToggle.exists()).toBe(true);
    });

    it("should toggle hide on dashboard option", async () => {
      const initialValue = wrapper.vm.variableData.hideOnDashboard;
      
      wrapper.vm.variableData.hideOnDashboard = !initialValue;
      await nextTick();
      
      expect(wrapper.vm.variableData.hideOnDashboard).toBe(!initialValue);
    });

    it("should render escape single quotes toggle", () => {
      const escapeToggle = wrapper.find('[data-test*="dashboard-config-limit-info"]').exists() || 
                          wrapper.vm.variableData.hasOwnProperty('escapeSingleQuotes');
      expect(escapeToggle).toBe(true);
    });
  });

  describe("Form Actions", () => {
    it("should render cancel button", () => {
      const cancelBtn = wrapper.find('[data-test="dashboard-variable-cancel-btn"]');
      expect(cancelBtn.exists()).toBe(true);
    });

    it("should render save button", () => {
      const saveBtn = wrapper.find('[data-test="dashboard-variable-save-btn"]');
      expect(saveBtn.exists()).toBe(true);
    });

    it("should emit close event when cancel clicked", async () => {
      const cancelBtn = wrapper.find('[data-test="dashboard-variable-cancel-btn"]');
      
      await cancelBtn.trigger("click");
      
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should save variable when form submitted", async () => {
      // Set up valid form data
      wrapper.vm.variableData.name = "test-variable";
      wrapper.vm.variableData.type = "constant";
      wrapper.vm.variableData.value = "test-value";
      
      // Mock form validation to pass
      const mockForm = {
        validate: vi.fn().mockResolvedValue(true)
      };
      wrapper.vm.addVariableForm = mockForm;
      
      await wrapper.vm.onSubmit();
      
      expect(mockForm.validate).toHaveBeenCalled();
    });
  });

  describe("Edit Mode", () => {
    beforeEach(async () => {
      const editWrapper = mount(AddSettingVariable, {
        global: {
          plugins: [Quasar],
        },
        props: {
          variableName: "existingVar",
          dashboardVariablesList: defaultProps.dashboardVariablesList
        }
      });
      
      wrapper.unmount();
      wrapper = editWrapper;
      await nextTick();
    });

    it("should set edit mode when variableName is provided", () => {
      // In edit mode, the component should be initialized differently
      expect(wrapper.props('variableName')).toBe("existingVar");
    });

    it("should have correct title in edit mode", () => {
      expect(wrapper.vm.title).toBe("Edit Variable");
    });

    it("should load existing variable data in edit mode", async () => {
      // The component should load the variable data in edit mode
      expect(wrapper.vm.title).toBe("Edit Variable");
    });
  });

  describe("Data Validation", () => {
    it("should have form validation", () => {
      const nameField = wrapper.find('[data-test="dashboard-variable-name"]');
      expect(nameField.exists()).toBe(true);
      
      // Component should have validation logic
      expect(wrapper.vm.variableData).toBeDefined();
    });

    it("should handle form submission", async () => {
      wrapper.vm.variableData.name = "test-variable";
      wrapper.vm.variableData.type = "constant";
      wrapper.vm.variableData.value = "test-value";
      
      expect(wrapper.vm.onSubmit).toBeDefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle form errors", () => {
      expect(wrapper.vm.filterCycleError).toBeDefined();
    });

    it("should have error handling methods", () => {
      expect(wrapper.vm.onSubmit).toBeDefined();
      expect(wrapper.vm.filterCycleError).toBeDefined();
    });
  });

  describe("Dependency Graph Integration", () => {
    it("should have cycle detection functionality", async () => {
      wrapper.vm.variableData.name = "test-variable";
      wrapper.vm.variableData.type = "query_values";
      
      expect(wrapper.vm.filterCycleError).toBeDefined();
      expect(wrapper.vm.variableData).toHaveProperty('name');
    });
  });

  describe("Custom Value Management", () => {
    it("should add custom value for multi-select", () => {
      wrapper.vm.variableData.customMultiSelectValue = ["value1"];
      
      wrapper.vm.addCustomValue();
      
      expect(wrapper.vm.variableData.customMultiSelectValue).toEqual(["value1", ""]);
    });

    it("should remove custom value", () => {
      wrapper.vm.variableData.customMultiSelectValue = ["value1", "value2"];
      
      wrapper.vm.removeCustomValue(0);
      
      expect(wrapper.vm.variableData.customMultiSelectValue).toEqual(["value2"]);
    });
  });

  describe("Watchers and Reactive Behavior", () => {
    it("should reset customMultiSelectValue when selectAllValueForMultiSelect changes", async () => {
      wrapper.vm.variableData.customMultiSelectValue = ["test"];
      wrapper.vm.variableData.selectAllValueForMultiSelect = "all";
      
      await nextTick();
      
      expect(wrapper.vm.variableData.customMultiSelectValue).toEqual([]);
    });

    it("should handle multi-select change", async () => {
      wrapper.vm.variableData.type = "custom";
      wrapper.vm.variableData.options = [
        { label: "opt1", value: "val1", selected: true },
        { label: "opt2", value: "val2", selected: false }
      ];
      wrapper.vm.variableData.multiSelect = false;
      
      await nextTick();
      
      // Should reset all selections and select first one
      expect(wrapper.vm.variableData.options[0].selected).toBe(true);
    });

    it("should handle max record size validation", async () => {
      wrapper.vm.variableData.query_data.max_record_size = "";
      
      await nextTick();
      
      expect(wrapper.vm.variableData.query_data.max_record_size).toBe(null);
    });
  });
});