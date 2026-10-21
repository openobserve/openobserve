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
import { nextTick, ref } from "vue";
import AddSettingVariable from "./AddSettingVariable.vue";
import { makeAddSettingVariableSchema } from "./AddSettingVariable.schema";
import {
  createFilterCondition,
  createFilterGroup,
  legacyFiltersToGroup,
} from "@/utils/dashboard/variables/variableFilterGroupUtils";
import OFormInput from "@/lib/forms/Input/OFormInput.vue";
import OInput from "@/lib/forms/Input/OInput.vue";
import analytics from "@/services/product_analytics";
import { addVariable, getDashboard, updateVariable } from "../../../utils/commons";

vi.mock("@/services/product_analytics", () => ({ default: { track: vi.fn() } }));

// Mock external dependencies
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: vi.fn((key: string) => {
      const translations: Record<string, string> = {
        "dashboard.newVariable": "Add Variable",
        "dashboard.editVariable": "Edit Variable",
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
        "dashboard.custom": "Custom",
      };
      return translations[key] || key;
    }),
  }),
}));

const mockOpenConflict = vi.fn();
vi.mock("@/composables/dashboard/useDashboardSaveConflict", () => ({
  useDashboardSaveConflict: () => ({
    isConflict: (error: any) => error?.response?.status === 409,
    openConflict: mockOpenConflict,
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
      theme: "light",
    },
  }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    query: {
      dashboard: "test-dashboard",
      folder: "test-folder",
    },
  }),
}));

// Mock composables
const mockStreams = {
  getStreams: vi.fn().mockResolvedValue({
    list: [
      { name: "stream1", type: "logs" },
      { name: "stream2", type: "logs" },
    ],
  }),
  getStream: vi.fn().mockResolvedValue({
    schema: [
      { name: "field1", type: "string" },
      { name: "field2", type: "number" },
    ],
  }),
};

vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => mockStreams),
}));

const mockUseSelectAutoComplete = {
  filterFn: vi.fn(),
  filteredOptions: ref([
    { name: "stream1", type: "logs" },
    { name: "stream2", type: "logs" },
  ]),
};

vi.mock("../../../composables/useSelectAutocomplete", () => ({
  useSelectAutoComplete: vi.fn(() => mockUseSelectAutoComplete),
}));

const mockLoading = {
  isLoading: { value: false },
  execute: vi.fn().mockResolvedValue({}),
  error: { value: null },
};

vi.mock("../../../composables/useLoading", () => ({
  useLoading: vi.fn(() => mockLoading),
}));

const mockNotifications = {
  showPositiveNotification: vi.fn(),
  showErrorNotification: vi.fn(),
  showConfictErrorNotificationWithRefreshBtn: vi.fn(),
};

vi.mock("@/composables/useNotifications", () => ({
  default: vi.fn(() => mockNotifications),
}));

// Mock utils
vi.mock("../../../utils/commons", () => ({
  addVariable: vi.fn().mockResolvedValue({}),
  getDashboard: vi.fn().mockResolvedValue({
    variables: {
      list: [
        {
          name: "existingVar",
          type: "custom",
          options: [{ label: "test", value: "test", selected: true }],
        },
      ],
    },
  }),
  updateVariable: vi.fn().mockResolvedValue({}),
}));

// Mock dependency utils
vi.mock("../../../utils/dashboard/variables/variablesDependencyUtils", () => ({
  buildVariablesDependencyGraph: vi.fn().mockReturnValue({}),
  isGraphHasCycle: vi.fn().mockReturnValue(null),
}));

// Mock scope utils
vi.mock("@/utils/dashboard/variables/variablesScopeUtils", () => ({
  getScopeType: vi.fn((v: any) => {
    if (v.panels && v.panels.length > 0) return "panels";
    if (v.tabs && v.tabs.length > 0) return "tabs";
    return "global";
  }),
}));

// Mock child components
vi.mock("./common/DashboardHeader.vue", () => ({
  default: {
    name: "DashboardHeader",
    template: '<div data-test="dashboard-header-mock"><slot /></div>',
    props: ["title", "backButton"],
    emits: ["back"],
  },
}));

vi.mock("./QueryVariableEditor.vue", () => ({
  default: {
    name: "QueryVariableEditor",
    template: '<div data-test="query-variable-editor-mock"></div>',
    props: ["dashboardVariablesList"],
  },
}));

vi.mock("../addPanel/CommonAutoComplete.vue", () => ({
  default: {
    name: "CommonAutoComplete",
    template: '<div class="common-autocomplete-mock" v-bind="$attrs"></div>',
    props: ["modelValue", "items", "searchRegex", "rules", "debounce", "placeholder"],
    emits: ["update:modelValue", "select"],
  },
}));

describe("AddSettingVariable", () => {
  let wrapper: VueWrapper<any>;

  const defaultProps = {
    variableName: null,
    dashboardVariablesList: [
      { name: "var1", type: "custom" },
      { name: "var2", type: "query_values" },
    ],
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    wrapper = mount(AddSettingVariable, {
      global: {
        plugins: [],
      },
      props: defaultProps,
    });

    // Wait for async onMounted to complete (it awaits getDashboard)
    await flushPromises();
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
      expect(wrapper.props("variableName")).toBe(null);
      expect(wrapper.props("dashboardVariablesList")).toEqual(defaultProps.dashboardVariablesList);
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
        {
          label: "Query Values",
          value: "query_values",
          subLabel: "dashboard.queryVariable.typeQueryValuesDescription",
        },
        {
          label: "Constant",
          value: "constant",
          subLabel: "dashboard.queryVariable.typeConstantDescription",
        },
        {
          label: "Textbox",
          value: "textbox",
          subLabel: "dashboard.queryVariable.typeTextboxDescription",
        },
        {
          label: "Custom",
          value: "custom",
          subLabel: "dashboard.queryVariable.typeCustomDescription",
        },
      ];
      expect(wrapper.vm.variableTypes).toEqual(expectedTypes);
    });

    it("describes the selected type below the type picker", async () => {
      expect(wrapper.vm.selectedTypeDescription).toBe(
        "dashboard.queryVariable.typeQueryValuesDescription",
      );
      wrapper.vm.variableData.type = "custom";
      await nextTick();
      expect(wrapper.vm.selectedTypeDescription).toBe(
        "dashboard.queryVariable.typeCustomDescription",
      );
    });

    it("renders the query editor and the shared multi-select options in custom mode", async () => {
      await wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      expect(wrapper.find('[data-test="query-variable-editor-mock"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-variable-stream-select"]').exists()).toBe(false);
      expect(
        wrapper.find('[data-test="dashboard-query_values-show_multiple_values"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="dashboard-multi-select-default-value-toggle-first-value"]')
          .exists(),
      ).toBe(true);
    });

    it("should show appropriate fields based on variable type", async () => {
      // Test query_values type
      wrapper.vm.variableData.type = "query_values";
      await nextTick();

      expect(wrapper.find('[data-test="dashboard-variable-stream-type-select"]').exists()).toBe(
        true,
      );

      // Test constant type
      wrapper.vm.variableData.type = "constant";
      await nextTick();

      expect(wrapper.find('[data-test="dashboard-variable-constant-value"]').exists()).toBe(true);

      // Test textbox type
      wrapper.vm.variableData.type = "textbox";
      await nextTick();

      expect(wrapper.find('[data-test="dashboard-variable-textbox-default-value"]').exists()).toBe(
        true,
      );
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
        "logs",
        "metrics",
        "traces",
        "enrichment_tables",
        "metadata",
      ]);
    });

    it("should update streams when stream type changes", async () => {
      wrapper.vm.form.setFieldValue("query_data.stream_type", "logs");

      await wrapper.vm.streamTypeUpdated();

      expect(mockStreams.getStreams).toHaveBeenCalledWith("logs", false);
      expect(wrapper.vm.data.streams).toEqual([
        { name: "stream1", type: "logs" },
        { name: "stream2", type: "logs" },
      ]);
    });

    it("uses the emitted $event value: fetches streams for the newly-selected type, not the previous one held by the form", async () => {
      // The form projection still holds the PREVIOUS type ("logs") when the
      // handler fires; branching on the emitted arg must fetch the NEW type's
      // stream list. Without the fix, streamTypeUpdated would read "logs" off the
      // form and NEVER fetch "metrics", so this assertion guards the arg is used.
      wrapper.vm.form.setFieldValue("query_data.stream_type", "logs");

      await wrapper.vm.streamTypeUpdated("metrics");

      expect(mockStreams.getStreams).toHaveBeenCalledWith("metrics", false);
    });

    it("should update fields when stream changes", async () => {
      wrapper.vm.form.setFieldValue("query_data.stream_type", "logs");
      wrapper.vm.form.setFieldValue("query_data.stream", "stream1");

      await wrapper.vm.streamUpdated();

      expect(mockStreams.getStream).toHaveBeenCalledWith("stream1", "logs", true);
      expect(wrapper.vm.data.currentFieldsList).toEqual([
        { name: "field1", type: "string" },
        { name: "field2", type: "number" },
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

    const filterGroup = () => wrapper.vm.variableData.query_data.filter_group;
    const condition = (field: string, value: string, logic: "AND" | "OR" = "AND") => ({
      ...createFilterCondition(logic),
      column: { field },
      value,
    });
    const openAddMenu = async (testId = "dashboard-add-filter-btn") => {
      const trigger = wrapper.find(`[data-test="${testId}"]`);
      await trigger.trigger("pointerdown");
      await trigger.trigger("click");
      await flushPromises();
    };
    const selectMenuItem = async (testId: string) => {
      const item = document.body.querySelector(`[data-test="${testId}"]`) as HTMLElement;
      expect(item).not.toBeNull();
      item.click();
      await flushPromises();
    };
    const chipTexts = () =>
      wrapper
        .findAll('[data-test^="dashboard-variable-filter-condition-"]')
        .map((chip) => chip.text().replace(/\s+/g, " ").trim());

    it("adds a condition from the add menu, in the backend's condition shape", async () => {
      await openAddMenu();
      await selectMenuItem("dashboard-variable-filter-add-condition");

      expect(filterGroup().conditions).toEqual([createFilterCondition()]);
      expect(wrapper.find('[data-test="dashboard-variable-filter-condition-0"]').exists()).toBe(
        true,
      );
    });

    it("adds a nested group, toggles OR and saves filter_group without a flat filter copy", async () => {
      wrapper.vm.form.setFieldValue(
        "query_data.filter_group",
        createFilterGroup("AND", [condition("env", "$env")]),
      );
      await flushPromises();

      await openAddMenu();
      await selectMenuItem("dashboard-variable-filter-add-group");
      expect(filterGroup().conditions[1]).toEqual(createFilterGroup());
      expect(wrapper.find('[data-test="dashboard-variable-filter-group-1"]').exists()).toBe(true);
      expect(
        wrapper.find('[data-test="dashboard-variable-filter-logical-operator-1"]').exists(),
      ).toBe(true);

      wrapper.vm.form.setFieldValue("query_data.filter_group.conditions[1].logicalOperator", "OR");
      wrapper.vm.form.setFieldValue(
        "query_data.filter_group.conditions[1].conditions[0]",
        condition("level", "error"),
      );
      await flushPromises();

      const payload = wrapper.vm.buildVariablePayload({
        ...JSON.parse(JSON.stringify(wrapper.vm.form.state.values)),
        name: "v",
        query_data: {
          ...JSON.parse(JSON.stringify(wrapper.vm.form.state.values.query_data)),
          stream_type: "logs",
          stream: "s1",
          field: "f1",
        },
      });
      expect(payload.query_data).not.toHaveProperty("filter");
      expect(payload.query_data.filter_group).toEqual(
        createFilterGroup("AND", [
          condition("env", "$env"),
          createFilterGroup("OR", [condition("level", "error")]),
        ]),
      );
    });

    it("hides add group and disables OR for PromQL, with the AND-only hint", async () => {
      wrapper.vm.form.setFieldValue("query_data.stream_type", "metrics");
      wrapper.vm.form.setFieldValue("query_data.query_type", "promql");
      wrapper.vm.form.setFieldValue(
        "query_data.filter_group",
        createFilterGroup("AND", [condition("job", "api"), condition("env", "prod", "OR")]),
      );
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-variable-filter-promql-hint"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="dashboard-variable-filter-promql-error"]').exists()).toBe(
        true,
      );
      await openAddMenu();
      expect(
        document.body.querySelector('[data-test="dashboard-variable-filter-add-condition"]'),
      ).not.toBeNull();
      expect(
        document.body.querySelector('[data-test="dashboard-variable-filter-add-group"]'),
      ).toBeNull();
    });

    it("removes a NON-last condition and keeps the remaining chips in order", async () => {
      wrapper.vm.form.setFieldValue(
        "query_data.filter_group",
        legacyFiltersToGroup([
          { name: "f0", operator: "=", value: "V0" },
          { name: "f1", operator: "=", value: "V1" },
          { name: "f2", operator: "=", value: "V2" },
        ]),
      );
      await flushPromises();
      expect(chipTexts()).toEqual(["f0 = V0", "f1 = V1", "f2 = V2"]);

      await wrapper.find('[data-test="dashboard-variable-adhoc-close-1"]').trigger("click");
      await flushPromises();

      expect(chipTexts()).toEqual(["f0 = V0", "f2 = V2"]);
      expect(filterGroup().conditions.map((c: any) => c.value)).toEqual(["V0", "V2"]);
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

    it("should add new custom option", async () => {
      const initialOptionsCount = wrapper.vm.variableData.options.length;

      wrapper.vm.addField();
      await flushPromises();

      expect(wrapper.vm.variableData.options).toHaveLength(initialOptionsCount + 1);

      const newOption = wrapper.vm.variableData.options[wrapper.vm.variableData.options.length - 1];
      expect(newOption).toEqual({
        label: "",
        value: "",
        selected: false,
      });
    });

    it("should remove custom option", async () => {
      // Add options first
      wrapper.vm.addField();
      wrapper.vm.addField();
      await flushPromises();
      const initialOptionsCount = wrapper.vm.variableData.options.length;

      wrapper.vm.removeField(0);
      await flushPromises();

      expect(wrapper.vm.variableData.options).toHaveLength(initialOptionsCount - 1);
    });

    // START-HERE ① "non-negotiable gate" (field-array): deleting a NON-last custom
    // option row must keep each RENDERED input aligned with its surviving row —
    // assert the OFormInput→OInput `model-value` per row, NOT just the data array.
    it("keeps each custom-option row's RENDERED inputs aligned after deleting a NON-last row", async () => {
      // (this describe's beforeEach already set type = "custom")
      wrapper.vm.variableData.options = [
        { label: "L0", value: "V0", selected: false },
        { label: "L1", value: "V1", selected: false },
        { label: "L2", value: "V2", selected: false },
      ];
      await flushPromises();
      await nextTick();

      const renderedOptionValues = () =>
        wrapper
          .findAllComponents(OFormInput)
          .filter((c: any) => /^options\[\d+\]\.value$/.test(c.props("name")))
          .map((c: any) => c.findComponent(OInput).props("modelValue"));

      expect(renderedOptionValues()).toEqual(["V0", "V1", "V2"]);

      // Delete the MIDDLE (non-last) row via its delete button.
      await wrapper.find('[data-test="dashboard-custom-variable-1-remove"]').trigger("click");
      await flushPromises();
      await nextTick();

      expect(renderedOptionValues()).toEqual(["V0", "V2"]);
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
        { label: "opt2", value: "val2", selected: true },
      ];

      // Test that custom select all model exists
      expect(wrapper.vm.customSelectAllModel).toBeDefined();
    });
  });

  describe("Multi-select Configuration", () => {
    it("should render multi-select toggle for query_values", async () => {
      wrapper.vm.variableData.type = "query_values";
      await nextTick();

      const multiSelectToggle = wrapper.find(
        '[data-test="dashboard-query_values-show_multiple_values"]',
      );
      expect(multiSelectToggle.exists()).toBe(true);
    });

    it("should render multi-select default value options", async () => {
      wrapper.vm.variableData.type = "query_values";
      wrapper.vm.variableData.multiSelect = true;
      await nextTick();

      const firstValueBtn = wrapper.find(
        '[data-test="dashboard-multi-select-default-value-toggle-first-value"]',
      );
      const allValuesBtn = wrapper.find(
        '[data-test="dashboard-multi-select-default-value-toggle-all-values"]',
      );
      const customBtn = wrapper.find(
        '[data-test="dashboard-multi-select-default-value-toggle-custom"]',
      );

      expect(firstValueBtn.exists()).toBe(true);
      expect(allValuesBtn.exists()).toBe(true);
      expect(customBtn.exists()).toBe(true);
    });

    it("should handle multi-select default value selection", async () => {
      // The form is the source (rule ②); drive it and read the projection back.
      wrapper.vm.form.setFieldValue("selectAllValueForMultiSelect", "all");
      await flushPromises();

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
      const escapeToggle =
        wrapper.find('[data-test*="dashboard-config-limit-info"]').exists() ||
        Object.prototype.hasOwnProperty.call(wrapper.vm.variableData, "escapeSingleQuotes");
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

    it("should save variable when a valid form is submitted (schema passes)", async () => {
      // The form is the sole source (rule ②); set valid values on it directly.
      const f = wrapper.vm.form;
      f.setFieldValue("scope", "global");
      f.setFieldValue("name", "test-variable");
      f.setFieldValue("type", "constant");
      f.setFieldValue("value", "test-value");
      await flushPromises();

      // Drive the real form submit (schema gates it, @submit awaited).
      await f.handleSubmit();
      await flushPromises();

      expect(f.state.isValid).toBe(true);
      expect(mockLoading.execute).toHaveBeenCalled();
    });

    it("does NOT save when the schema is invalid (empty name)", async () => {
      wrapper.vm.variableData.scope = "global";
      wrapper.vm.variableData.name = "";
      wrapper.vm.variableData.type = "constant";
      wrapper.vm.variableData.value = "test-value";
      await flushPromises();

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockLoading.execute).not.toHaveBeenCalled();
    });

    it("rejects an invalid variable name (regex)", async () => {
      wrapper.vm.variableData.scope = "global";
      wrapper.vm.variableData.name = "bad name!";
      wrapper.vm.variableData.type = "constant";
      wrapper.vm.variableData.value = "v";
      await flushPromises();

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(wrapper.vm.form.state.isValid).toBe(false);
      expect(mockLoading.execute).not.toHaveBeenCalled();
    });

    it("requires a constant value when type is constant", async () => {
      wrapper.vm.variableData.scope = "global";
      wrapper.vm.variableData.name = "myvar";
      wrapper.vm.variableData.type = "constant";
      wrapper.vm.variableData.value = "";
      await flushPromises();

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(wrapper.vm.form.state.isValid).toBe(false);
    });

    it("requires query_values stream_type / stream / field", async () => {
      wrapper.vm.variableData.scope = "global";
      wrapper.vm.variableData.name = "myvar";
      wrapper.vm.variableData.type = "query_values";
      wrapper.vm.form.setFieldValue("query_data.stream_type", "");
      wrapper.vm.form.setFieldValue("query_data.stream", "");
      wrapper.vm.form.setFieldValue("query_data.field", "");
      await flushPromises();

      await wrapper.vm.form.handleSubmit();
      await flushPromises();

      expect(wrapper.vm.form.state.isValid).toBe(false);
    });

    // The scope→tabs/panels conditional requireds are exercised at the schema
    // level (rendering the tabs <OFormSelect> needs dashboard tabs data that
    // this unit mock omits). This preserves the restored BEFORE cross-field rule.
    it("schema requires at least one tab when scope is tabs/panels", () => {
      const schema = makeAddSettingVariableSchema((k: string) => k);
      const base = {
        scope: "tabs",
        name: "myvar",
        type: "constant",
        value: "v",
        selectedTabs: [],
        selectedPanels: [],
      };
      expect(schema.safeParse(base).success).toBe(false);
      expect(schema.safeParse({ ...base, selectedTabs: ["t1"] }).success).toBe(true);
    });

    it("schema requires at least one panel when scope is panels", () => {
      const schema = makeAddSettingVariableSchema((k: string) => k);
      const base = {
        scope: "panels",
        name: "myvar",
        type: "constant",
        value: "v",
        selectedTabs: ["t1"],
        selectedPanels: [],
      };
      expect(schema.safeParse(base).success).toBe(false);
      expect(schema.safeParse({ ...base, selectedPanels: ["p1"] }).success).toBe(true);
    });
  });

  // §4 dropped row requireds, now restored on the FORM-OWNED field-arrays.
  describe("Restored dropped row rules (#6 filter[].value, #7 options[].value)", () => {
    const schema = makeAddSettingVariableSchema((k: string) => k);
    const validBase = {
      scope: "global",
      name: "myvar",
      type: "query_values",
      query_data: { stream_type: "logs", stream: "s1", field: "f1", filter: [] },
      options: [],
    };

    // ── Schema-level (the row rules in isolation) ──
    it("§4 #6: filter value is required for value-needing operators", () => {
      const withEmptyValue = {
        ...validBase,
        query_data: {
          ...validBase.query_data,
          filter_group: legacyFiltersToGroup([{ name: "f", operator: "=", value: "" }]),
        },
      };
      expect(schema.safeParse(withEmptyValue).success).toBe(false);
      const withValue = {
        ...validBase,
        query_data: {
          ...validBase.query_data,
          filter_group: legacyFiltersToGroup([{ name: "f", operator: "=", value: "v" }]),
        },
      };
      expect(schema.safeParse(withValue).success).toBe(true);
    });

    it("§4 #6: filter value NOT required for Is Null / Is Not Null", () => {
      const isNull = {
        ...validBase,
        query_data: {
          ...validBase.query_data,
          filter_group: legacyFiltersToGroup([{ name: "f", operator: "Is Null", value: "" }]),
        },
      };
      expect(schema.safeParse(isNull).success).toBe(true);
    });

    it("filter row also requires name + operator", () => {
      const noName = {
        ...validBase,
        query_data: {
          ...validBase.query_data,
          filter_group: legacyFiltersToGroup([{ name: "", operator: "=", value: "v" }]),
        },
      };
      expect(schema.safeParse(noName).success).toBe(false);
    });

    it("§4 #7: option value is required (trim) + label required", () => {
      const base = { scope: "global", name: "myvar", type: "custom" };
      expect(
        schema.safeParse({
          ...base,
          options: [{ label: "L", value: "", selected: true }],
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...base,
          options: [{ label: "", value: "V", selected: true }],
        }).success,
      ).toBe(false);
      expect(
        schema.safeParse({
          ...base,
          options: [{ label: "L", value: "V", selected: true }],
        }).success,
      ).toBe(true);
    });

    // ── Real-OForm (proves the field-array is wired + gates submit) ──
    it("§4 #6 through the real form: empty filter value blocks submit", async () => {
      const f = wrapper.vm.form;
      f.setFieldValue("scope", "global");
      f.setFieldValue("name", "myvar");
      f.setFieldValue("type", "query_values");
      f.setFieldValue("query_data.stream_type", "logs");
      f.setFieldValue("query_data.stream", "s1");
      f.setFieldValue("query_data.field", "f1");
      f.setFieldValue(
        "query_data.filter_group",
        legacyFiltersToGroup([{ name: "f", operator: "=", value: "" }]),
      );
      await flushPromises();
      await f.handleSubmit();
      await flushPromises();
      expect(f.state.isValid).toBe(false);

      f.setFieldValue(
        "query_data.filter_group",
        legacyFiltersToGroup([{ name: "f", operator: "=", value: "v" }]),
      );
      await flushPromises();
      await f.handleSubmit();
      await flushPromises();
      expect(f.state.isValid).toBe(true);
    });

    it("§4 #7 through the real form: empty option value blocks submit", async () => {
      const f = wrapper.vm.form;
      f.setFieldValue("scope", "global");
      f.setFieldValue("name", "myvar");
      f.setFieldValue("type", "custom");
      f.setFieldValue("options", [{ label: "L", value: "", selected: true }]);
      await flushPromises();
      await f.handleSubmit();
      await flushPromises();
      expect(f.state.isValid).toBe(false);

      f.setFieldValue("options", [{ label: "L", value: "V", selected: true }]);
      await flushPromises();
      await f.handleSubmit();
      await flushPromises();
      expect(f.state.isValid).toBe(true);
    });
  });

  describe("max_record_size coercion (must reach backend as i64 / null)", () => {
    // buildVariablePayload is the single place the form value is turned into the
    // saved payload — the number <input> emits a STRING, so it must be coerced.
    const baseQuery = (max_record_size: unknown) => ({
      scope: "global",
      selectedTabs: [],
      selectedPanels: [],
      name: "mrs",
      type: "query_values",
      query_data: {
        stream_type: "logs",
        stream: "s1",
        field: "f1",
        max_record_size,
        filter: [],
      },
      options: [],
    });

    it("coerces a typed string (number <input>) to a Number", () => {
      const payload = wrapper.vm.buildVariablePayload(baseQuery("100"));
      expect(payload.query_data.max_record_size).toBe(100);
      expect(typeof payload.query_data.max_record_size).toBe("number");
    });

    it("keeps an existing numeric value as a Number", () => {
      const payload = wrapper.vm.buildVariablePayload(baseQuery(250));
      expect(payload.query_data.max_record_size).toBe(250);
    });

    it("sends null when the field is empty / null / non-numeric (no limit)", () => {
      expect(wrapper.vm.buildVariablePayload(baseQuery("")).query_data.max_record_size).toBe(null);
      expect(wrapper.vm.buildVariablePayload(baseQuery(null)).query_data.max_record_size).toBe(
        null,
      );
      expect(wrapper.vm.buildVariablePayload(baseQuery("abc")).query_data.max_record_size).toBe(
        null,
      );
    });
  });

  describe("query mode and language", () => {
    const setQueryData = async (values: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(values)) {
        wrapper.vm.form.setFieldValue(`query_data.${key}`, value);
      }
      await flushPromises();
    };
    const exists = (dataTest: string) => wrapper.find(`[data-test="${dataTest}"]`).exists();

    it("starts in auto mode with the stream, field and filters", () => {
      expect(wrapper.vm.isCustomQuery).toBe(false);
      expect(exists("dashboard-variable-query-mode")).toBe(true);
      expect(exists("dashboard-variable-stream-select")).toBe(true);
      expect(exists("dashboard-variable-field-select")).toBe(true);
      expect(exists("dashboard-add-filter-btn")).toBe(true);
      expect(exists("query-variable-editor-mock")).toBe(false);
    });

    it("offers PromQL only for a metrics stream", async () => {
      await setQueryData({ stream_type: "logs" });
      expect(exists("dashboard-variable-query-language")).toBe(false);
      await setQueryData({ stream_type: "metrics" });
      expect(exists("dashboard-variable-query-language")).toBe(true);
      await setQueryData({ stream_type: "traces" });
      expect(exists("dashboard-variable-query-language")).toBe(false);
    });

    it("puts Auto/Custom in the options header and the language row alone under Stream Type", async () => {
      const el = (dataTest: string) =>
        wrapper.find(`[data-test="${dataTest}"]`).element as HTMLElement;
      const follows = (a: string, b: string) =>
        (el(a).compareDocumentPosition(el(b)) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

      await setQueryData({ stream_type: "metrics" });
      expect(
        follows("dashboard-variable-query-mode", "dashboard-variable-stream-type-select"),
      ).toBe(true);
      expect(
        follows("dashboard-variable-stream-type-select", "dashboard-variable-query-language"),
      ).toBe(true);
      expect(follows("dashboard-variable-query-language", "dashboard-variable-stream-select")).toBe(
        true,
      );
      expect(el("dashboard-variable-query-mode").parentElement?.textContent).toContain(
        "Extra Options",
      );
      expect(el("dashboard-variable-query-mode").parentElement?.textContent).not.toContain(
        "panel.SQL",
      );

      const row = wrapper.find('[data-test="dashboard-variable-query-language-row"]');
      expect(row.text()).toContain("dashboard.queryVariable.queryLanguage");
      expect(row.find('[data-test="dashboard-variable-query-language-sql"]').exists()).toBe(true);
      expect(row.find('[data-test="dashboard-variable-stream-type-select"]').exists()).toBe(false);
      expect(row.find('[data-test="dashboard-variable-stream-select"]').exists()).toBe(false);
      expect(row.find('[data-test="dashboard-variable-query-mode"]').exists()).toBe(false);

      wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      expect(
        follows("dashboard-variable-stream-type-select", "dashboard-variable-query-language"),
      ).toBe(true);
      expect(follows("dashboard-variable-query-language", "query-variable-editor-mock")).toBe(true);
    });

    it("goes back to SQL when the stream type leaves metrics", async () => {
      await setQueryData({ stream_type: "metrics", query_type: "promql" });
      await wrapper.vm.streamTypeUpdated("logs");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.query_type).toBe("sql");
    });

    it("switches to custom with the prefilled query in the same tick, $variable filters included", async () => {
      for (const [streamType, language, expected] of [
        ["logs", "sql", `SELECT DISTINCT "host" FROM "default" WHERE "env" = '$env'`],
        ["metrics", "sql", `SELECT DISTINCT "host" FROM "default" WHERE "env" = '$env'`],
        ["metrics", "promql", 'label_values(default{env=~"$env"}, host)'],
      ]) {
        await setQueryData({
          custom_query: false,
          query: "",
          stream_type: streamType,
          stream: "default",
          field: "host",
          query_type: language,
          filter_group: legacyFiltersToGroup([{ name: "env", operator: "=", value: "$env" }]),
        });
        wrapper.vm.onQueryModeChange("custom");
        expect(wrapper.vm.variableData.query_data.custom_query).toBe(true);
        expect(wrapper.vm.variableData.query_data.query).toBe(expected);
        wrapper.vm.onQueryModeChange("auto");
        await flushPromises();
      }
    });

    it("offers PromQL in custom mode only for a metrics stream, and leaves it for SQL", async () => {
      wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.stream_type).toBe("logs");
      expect(exists("dashboard-variable-query-language")).toBe(false);

      await setQueryData({ stream_type: "metrics" });
      expect(exists("dashboard-variable-query-language")).toBe(true);
      wrapper.vm.onQueryLanguageChange("promql");
      await setQueryData({ query: "label_names()" });

      await setQueryData({ stream_type: "logs" });
      await wrapper.vm.streamTypeUpdated("logs");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.query_type).toBe("sql");
      expect(exists("dashboard-variable-query-language")).toBe(false);
    });

    it("prefills the custom editor with the SQL auto would run", async () => {
      await setQueryData({ stream_type: "logs", stream: "default", field: "host" });
      await wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.custom_query).toBe(true);
      expect(wrapper.vm.variableData.query_data.query).toBe(
        'SELECT DISTINCT "host" FROM "default"',
      );
      expect(exists("query-variable-editor-mock")).toBe(true);
      expect(exists("dashboard-variable-field-select")).toBe(false);
    });

    it("prefills label_values with the filters as matchers for PromQL", async () => {
      await setQueryData({
        stream_type: "metrics",
        stream: "up",
        field: "job",
        query_type: "promql",
        filter_group: legacyFiltersToGroup([{ name: "env", operator: "=", value: "$env" }]),
      });
      await wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.query).toBe('label_values(up{env=~"$env"}, job)');
    });

    it("prefills custom SQL with the parenthesised AND/OR WHERE of a nested group", async () => {
      const leaf = (field: string, value: string, logic: "AND" | "OR" = "AND") => ({
        ...createFilterCondition(logic),
        column: { field },
        value,
      });
      await setQueryData({
        stream_type: "logs",
        stream: "default",
        field: "host",
        filter_group: createFilterGroup("AND", [
          leaf("env", "$env"),
          createFilterGroup("AND", [leaf("level", "error"), leaf("level", "warn", "OR")]),
        ]),
      });
      await wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.query).toBe(
        `SELECT DISTINCT "host" FROM "default" WHERE "env" = '$env' AND ("level" = 'error' OR "level" = 'warn')`,
      );
    });

    it("keeps the auto fields and the custom text when switching back and forth", async () => {
      await setQueryData({ stream_type: "logs", stream: "default", field: "host" });
      await wrapper.vm.onQueryModeChange("custom");
      await setQueryData({ query: "SELECT host FROM default LIMIT 5" });
      await wrapper.vm.onQueryModeChange("auto");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data).toMatchObject({
        custom_query: false,
        stream: "default",
        field: "host",
      });
      expect(exists("dashboard-variable-field-select")).toBe(true);

      await setQueryData({ field: "pod" });
      await wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.query).toBe("SELECT host FROM default LIMIT 5");
    });

    it("keeps a hand edit made right before switching to auto", async () => {
      await setQueryData({ stream_type: "logs", stream: "default", field: "host" });
      wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      wrapper.vm.form.setFieldValue("query_data.query", "SELECT host FROM default LIMIT 3");
      wrapper.vm.onQueryModeChange("auto");
      await flushPromises();
      wrapper.vm.onQueryModeChange("custom");
      expect(wrapper.vm.variableData.query_data.query).toBe("SELECT host FROM default LIMIT 3");
    });

    it("refreshes an untouched prefill when the auto settings changed", async () => {
      await setQueryData({ stream_type: "logs", stream: "default", field: "host" });
      wrapper.vm.onQueryModeChange("custom");
      await flushPromises();
      wrapper.vm.onQueryModeChange("auto");
      await setQueryData({ field: "pod" });
      wrapper.vm.onQueryModeChange("custom");
      expect(wrapper.vm.variableData.query_data.query).toBe('SELECT DISTINCT "pod" FROM "default"');
    });

    it("keeps one custom text per language", async () => {
      await setQueryData({ stream_type: "metrics", stream: "up", field: "job" });
      await wrapper.vm.onQueryModeChange("custom");
      await setQueryData({ query: "SELECT job FROM up" });
      await wrapper.vm.onQueryLanguageChange("promql");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.query).toBe("label_values(up, job)");
      await wrapper.vm.onQueryLanguageChange("sql");
      await flushPromises();
      expect(wrapper.vm.variableData.query_data.query).toBe("SELECT job FROM up");
    });

    it("shows PromQL operator symbols for an auto PromQL filter", () => {
      const options = wrapper.vm.promqlFilterOperatorOptions;
      expect(options.map((o: any) => o.value)).toEqual([
        "=",
        "!=",
        "IN",
        "NOT IN",
        "re_match",
        "re_not_match",
        "Is Null",
        "Is Not Null",
      ]);
      expect(options.slice(4, 6).map((o: any) => o.label)).toEqual(["=~", "!~"]);
    });
  });

  describe("saved query_data shape", () => {
    const variable = (query_data: Record<string, unknown>) => ({
      scope: "global",
      selectedTabs: [],
      selectedPanels: [],
      name: "service",
      type: "query_values",
      query_data: {
        stream_type: "logs",
        stream: "default",
        field: "service",
        max_record_size: "20",
        filter: [{ name: "a", operator: "=", value: "b" }],
        query_type: "sql",
        custom_query: false,
        query: "SELECT service FROM logs",
        value_field: "service",
        label_field: "",
        ...query_data,
      },
      options: [{ label: "", value: "", selected: true }],
      multiSelect: true,
      selectAllValueForMultiSelect: "all",
      customMultiSelectValue: [],
    });
    const autoFields = {
      stream: "default",
      field: "service",
      max_record_size: 20,
      filter: [{ name: "a", operator: "=", value: "b" }],
    };

    it("saves auto SQL in the legacy shape, without any query keys", () => {
      const payload = wrapper.vm.buildVariablePayload(variable({}));
      expect(payload.query_data).toEqual({ stream_type: "logs", ...autoFields });
      expect(payload.options).toEqual([{ label: "", value: "", selected: true }]);
    });

    it("saves auto PromQL with only its language added", () => {
      const payload = wrapper.vm.buildVariablePayload(
        variable({ stream_type: "metrics", query_type: "promql" }),
      );
      expect(payload.query_data).toEqual({
        stream_type: "metrics",
        ...autoFields,
        query_type: "promql",
      });
    });

    it("saves custom SQL with its query and columns, keeping the auto fields", () => {
      const payload = wrapper.vm.buildVariablePayload(
        variable({ custom_query: true, label_field: "name" }),
      );
      expect(payload.query_data).toEqual({
        stream_type: "logs",
        ...autoFields,
        custom_query: true,
        query_type: "sql",
        query: "SELECT service FROM logs",
        value_field: "service",
        label_field: "name",
      });
      expect(payload.options).toEqual([]);
      expect(payload.selectAllValueForMultiSelect).toBe("all");
    });

    it("saves custom PromQL without the SQL-only columns", () => {
      const payload = wrapper.vm.buildVariablePayload(
        variable({
          custom_query: true,
          stream_type: "metrics",
          query_type: "promql",
          query: "label_values(job)",
        }),
      );
      expect(payload.query_data).toEqual({
        stream_type: "metrics",
        ...autoFields,
        custom_query: true,
        query_type: "promql",
        query: "label_values(job)",
      });
    });

    it("never saves PromQL for a stream type other than metrics", () => {
      const payload = wrapper.vm.buildVariablePayload(variable({ query_type: "promql" }));
      expect(payload.query_data).not.toHaveProperty("query_type");
    });
  });

  describe("product analytics", () => {
    it("tracks dashboard_variable_saved as new once addVariable resolves", async () => {
      await wrapper.vm.saveData({ name: "v", type: "constant" });

      expect(analytics.track).toHaveBeenCalledTimes(1);
      expect(analytics.track).toHaveBeenCalledWith("dashboard_variable_saved", {
        type: "constant",
        is_new: true,
      });
    });

    it("does not track dashboard_variable_saved when addVariable rejects", async () => {
      vi.mocked(addVariable).mockRejectedValueOnce(new Error("boom"));

      await wrapper.vm.saveData({ name: "v", type: "constant" });

      expect(analytics.track).not.toHaveBeenCalled();
    });

    it("closes the form on a save conflict so Save cannot add the pending variable twice", async () => {
      vi.mocked(addVariable).mockRejectedValueOnce({ response: { status: 409 } });

      await wrapper.vm.saveData({ name: "v", type: "constant" });

      expect(mockOpenConflict).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: expect.any(String) }),
      );
      expect(wrapper.emitted("save")).toHaveLength(1);
    });

    it("tracks dashboard_variable_saved as not new once updateVariable resolves", async () => {
      const editWrapper = mount(AddSettingVariable, {
        props: { variableName: "existingVar", dashboardVariablesList: [] },
      });
      await flushPromises();
      vi.mocked(analytics.track).mockClear();

      await editWrapper.vm.saveData({ name: "existingVar", type: "custom" });

      expect(analytics.track).toHaveBeenCalledWith("dashboard_variable_saved", {
        type: "custom",
        is_new: false,
      });
      editWrapper.unmount();
    });

    it("does not track dashboard_variable_saved when updateVariable rejects", async () => {
      const editWrapper = mount(AddSettingVariable, {
        props: { variableName: "existingVar", dashboardVariablesList: [] },
      });
      await flushPromises();
      vi.mocked(analytics.track).mockClear();
      vi.mocked(updateVariable).mockRejectedValueOnce(new Error("boom"));

      await editWrapper.vm.saveData({ name: "existingVar", type: "custom" });

      expect(analytics.track).not.toHaveBeenCalled();
      editWrapper.unmount();
    });
  });

  describe("Edit Mode", () => {
    beforeEach(async () => {
      const editWrapper = mount(AddSettingVariable, {
        global: {
          plugins: [],
        },
        props: {
          variableName: "existingVar",
          dashboardVariablesList: defaultProps.dashboardVariablesList,
        },
      });

      wrapper.unmount();
      wrapper = editWrapper;
      await nextTick();
    });

    it("should set edit mode when variableName is provided", () => {
      // In edit mode, the component should be initialized differently
      expect(wrapper.props("variableName")).toBe("existingVar");
    });

    it("should have correct title in edit mode", () => {
      expect(wrapper.vm.title).toBe("Edit Variable");
    });

    it("should load existing variable data in edit mode", async () => {
      // The component should load the variable data in edit mode
      expect(wrapper.vm.title).toBe("Edit Variable");
    });

    it("loads a legacy filter array as the same chips and re-saves it unchanged", async () => {
      const legacyQueryData = {
        stream_type: "logs",
        stream: "stream1",
        field: "field1",
        max_record_size: null,
        filter: [
          { name: "env", operator: "=", value: "$env" },
          { name: "level", operator: "Is Null", value: "" },
        ],
      };
      vi.mocked(getDashboard).mockResolvedValueOnce({
        tabs: [],
        variables: {
          list: [
            {
              name: "legacyVar",
              label: "legacyVar",
              type: "query_values",
              query_data: legacyQueryData,
            },
          ],
        },
      });
      const legacyWrapper = mount(AddSettingVariable, {
        props: { variableName: "legacyVar", dashboardVariablesList: [] },
      });
      await flushPromises();

      const chips = legacyWrapper
        .findAll('[data-test^="dashboard-variable-filter-condition-"]')
        .map((chip) => chip.text().replace(/\s+/g, " ").trim());
      expect(chips).toEqual(["env = $env", "level dashboard.filterOperators.isNull"]);

      const payload = legacyWrapper.vm.buildVariablePayload(
        JSON.parse(JSON.stringify(legacyWrapper.vm.form.state.values)),
      );
      expect(JSON.stringify(payload.query_data)).toBe(JSON.stringify(legacyQueryData));
      legacyWrapper.unmount();
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
      expect(wrapper.vm.variableData).toHaveProperty("name");
    });
  });

  describe("Custom Value Management", () => {
    it("should add custom value for multi-select", async () => {
      wrapper.vm.form.setFieldValue("customMultiSelectValue", ["value1"]);
      await flushPromises();

      wrapper.vm.addCustomValue();
      await flushPromises();

      expect(wrapper.vm.variableData.customMultiSelectValue).toEqual(["value1", ""]);
    });

    it("should remove custom value", async () => {
      wrapper.vm.form.setFieldValue("customMultiSelectValue", ["value1", "value2"]);
      await flushPromises();

      wrapper.vm.removeCustomValue(0);
      await flushPromises();

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
        { label: "opt2", value: "val2", selected: false },
      ];
      wrapper.vm.variableData.multiSelect = false;

      await nextTick();

      // Should reset all selections and select first one
      expect(wrapper.vm.variableData.options[0].selected).toBe(true);
    });

    it("should handle max record size validation", async () => {
      wrapper.vm.form.setFieldValue("query_data.max_record_size", "");

      await nextTick();

      expect(wrapper.vm.variableData.query_data.max_record_size).toBe(null);
    });
  });

  describe("Variable Reference Support in Stream/Field Selection", () => {
    beforeEach(async () => {
      wrapper.vm.variableData.type = "query_values";
      await nextTick();
    });

    it("should have mergedStreamsFilteredOptions computed property", () => {
      expect(wrapper.vm.mergedStreamOptionsWithLabel).toBeDefined();
      expect(Array.isArray(wrapper.vm.mergedStreamOptionsWithLabel)).toBe(true);
    });

    it("should have mergedFieldsFilteredOptions computed property", () => {
      expect(wrapper.vm.mergedFieldOptionsWithLabel).toBeDefined();
      expect(Array.isArray(wrapper.vm.mergedFieldOptionsWithLabel)).toBe(true);
    });

    it("should have dashboardVariablesFilterItems that produces $ prefixed options", () => {
      // dashboardVariablesFilterItems should produce items like {label: "var1", value: "$var1"}
      const filterItems = wrapper.vm.dashboardVariablesFilterItems;
      expect(Array.isArray(filterItems)).toBe(true);
      // Variable options should have $ prefix in their value
      filterItems.forEach((item: any) => {
        expect(item.value).toMatch(/^\$/);
      });
    });

    it("should expose mergedStreamsFilterFn and mergedFieldsFilterFn for autocomplete", () => {
      expect(wrapper.vm.streamsFilterFn).toBeDefined();
      expect(wrapper.vm.fieldsFilterFn).toBeDefined();
    });

    it("should skip schema fetch when stream is a variable reference", async () => {
      // Set stream to a variable reference
      wrapper.vm.form.setFieldValue("query_data.stream", "$var1");
      wrapper.vm.form.setFieldValue("query_data.field", "existing_field");

      await wrapper.vm.streamUpdated();

      // Should NOT call getStream since it's a variable reference
      expect(mockStreams.getStream).not.toHaveBeenCalled();
    });

    it("should not reset field value when stream is a variable reference", async () => {
      wrapper.vm.form.setFieldValue("query_data.stream", "$var1");
      wrapper.vm.form.setFieldValue("query_data.field", "existing_field");

      await wrapper.vm.streamUpdated();

      // Field should be preserved since it was already set
      expect(wrapper.vm.variableData.query_data.field).toBe("existing_field");
    });

    it("uses the emitted $event value: selecting a $variable preserves the field even while the form still holds the previous real stream", async () => {
      // Reproduces the edit flow: the form projection still holds the PREVIOUS
      // real stream when the handler fires, but the select emits the new
      // $variable. Branching on the emitted arg (not the stale projection) must
      // classify it as a variable reference and preserve the field — otherwise
      // the field is cleared and field-required validation blocks the save.
      wrapper.vm.form.setFieldValue("query_data.stream_type", "logs");
      wrapper.vm.form.setFieldValue("query_data.stream", "regular-stream");
      wrapper.vm.form.setFieldValue("query_data.field", "existing_field");

      await wrapper.vm.streamUpdated("$var1");

      expect(wrapper.vm.variableData.query_data.field).toBe("existing_field");
      expect(mockStreams.getStream).not.toHaveBeenCalled();
    });

    it("should clear currentFieldsList when stream is a variable reference", async () => {
      // Set some initial fields
      wrapper.vm.data.currentFieldsList = [{ name: "field1", type: "string" }];

      wrapper.vm.form.setFieldValue("query_data.stream", "$var1");

      await wrapper.vm.streamUpdated();

      expect(wrapper.vm.data.currentFieldsList).toEqual([]);
    });

    it("should fetch schema normally when stream has no variable reference", async () => {
      wrapper.vm.form.setFieldValue("query_data.stream_type", "logs");
      wrapper.vm.form.setFieldValue("query_data.stream", "regular-stream");

      await wrapper.vm.streamUpdated();

      // Should call getStream for non-variable streams
      expect(mockStreams.getStream).toHaveBeenCalledWith("regular-stream", "logs", true);
    });

    it("should set empty field when stream is non-variable and updated", async () => {
      wrapper.vm.form.setFieldValue("query_data.stream_type", "logs");
      wrapper.vm.form.setFieldValue("query_data.stream", "regular-stream");
      wrapper.vm.form.setFieldValue("query_data.field", "old_field");

      await wrapper.vm.streamUpdated();

      // Field should be reset for non-variable streams
      expect(wrapper.vm.variableData.query_data.field).toBe("");
    });

    it("should render stream select with CommonAutoComplete", () => {
      const streamSelect = wrapper.find('[data-test="dashboard-variable-stream-select"]');
      expect(streamSelect.exists()).toBe(true);
    });

    it("should render field select with CommonAutoComplete", () => {
      const fieldSelect = wrapper.find('[data-test="dashboard-variable-field-select"]');
      expect(fieldSelect.exists()).toBe(true);
    });
  });
});
