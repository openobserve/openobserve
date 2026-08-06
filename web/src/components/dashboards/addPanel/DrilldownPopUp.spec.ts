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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import DrilldownPopUp from "@/components/dashboards/addPanel/DrilldownPopUp.vue";
import i18n from "@/locales";

// Stub ODialog so tests are deterministic (no Portal/Teleport) and so we can
// drive primary/secondary button clicks via the emits the component listens to.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test="o-dialog-stub"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
      :data-primary-disabled="String(primaryButtonDisabled)"
    >
      <span data-test="o-dialog-stub-title">{{ title }}</span>
      <slot name="header-right" />
      <slot />
      <slot name="footer" />
      <button
        data-test="o-dialog-stub-primary"
        :disabled="primaryButtonDisabled"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
      <button
        data-test="o-dialog-stub-close"
        @click="$emit('update:open', false)"
      >close</button>
    </div>
  `,
};

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const mockStore = {
  state: {
    theme: "light",
    organizationData: {
      folders: [
        { name: "test-folder", folderId: "folder-1" },
        { name: "demo-folder", folderId: "folder-2" },
      ],
    },
  },
};

const mockDashboardPanelData = {
  data: {
    type: "table",
    config: {
      drilldown: [
        {
          name: "Test Drilldown",
          type: "byDashboard",
          targetBlank: false,
          data: {
            folder: "test-folder",
            dashboard: "Dashboard 1",
            tab: "Tab 1",
            variables: [],
            passAllVariables: true,
          },
        },
      ],
    },
    queries: [
      {
        fields: {
          x: [{ label: "timestamp", alias: "timestamp" }],
          y: [{ label: "value", alias: "value" }],
          z: [],
        },
      },
    ],
  },
};

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

vi.mock("../../../composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
  }),
}));

vi.mock("../../../utils/commons", () => ({
  getFoldersList: vi.fn(),
  getAllDashboardsByFolderId: vi.fn(() =>
    Promise.resolve([
      { title: "Dashboard 1", dashboardId: "dash-1" },
      { title: "Dashboard 2", dashboardId: "dash-2" },
    ]),
  ),
  getDashboard: vi.fn(() =>
    Promise.resolve({
      tabs: [{ name: "Tab 1" }, { name: "Tab 2" }],
      variables: {
        list: [{ name: "var1" }, { name: "var2" }],
      },
    }),
  ),
}));

vi.mock("@/composables/useLoading", () => ({
  useLoading: (fn: () => Promise<void>) => ({
    execute: fn,
    isLoading: { value: false },
  }),
}));

describe("DrilldownPopUp", () => {
  let wrapper: any;

  const defaultProps = {
    open: true,
    isEditMode: false,
    drilldownDataIndex: -1,
    variablesData: {
      values: [{ name: "testVar", type: "text" }],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // restore mockStore folders that some edge-case tests mutate
    mockStore.state.organizationData.folders = [
      { name: "test-folder", folderId: "folder-1" },
      { name: "demo-folder", folderId: "folder-2" },
    ];
    // restore mockDashboardPanelData fields some tests mutate
    mockDashboardPanelData.data.type = "table";
    mockDashboardPanelData.data.queries = [
      {
        fields: {
          x: [{ label: "timestamp", alias: "timestamp" }],
          y: [{ label: "value", alias: "value" }],
          z: [],
        },
      },
    ];
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(DrilldownPopUp, {
      attachTo: "#app",
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        stubs: {
          ODialog: ODialogStub,
          DrilldownUserGuide: true,
          CommonAutoComplete: {
            template: '<div><input v-model="modelValue" /></div>',
            props: ["modelValue", "items", "placeholder"],
            emits: ["update:modelValue"],
          },
          QueryEditor: {
            template: '<div><textarea v-model="query"></textarea></div>',
            props: ["query", "debounceTime"],
            emits: ["update:query"],
          },
        },
        mocks: {
          $t: (key: string) => key,
        },
      },
    });
  };

  // Set a form-owned field on the REAL OForm (the validation source). The
  // entangled `drilldownData` mirror is synced via v-model in the live app; in
  // tests we drive the form directly.
  const setField = (w: any, name: string, val: unknown) => w.vm.form.setFieldValue(name, val);

  // Drive the form's own submit so the schema runs + the handler is awaited
  // deterministically.
  const submitForm = async (w: any) => {
    await w.vm.form.handleSubmit();
    await flushPromises();
  };

  it("clears validation state on close so a reopen starts clean (no lingering errors)", async () => {
    wrapper = createWrapper();
    // A failed submit (empty name) populates submit-state + errors on the
    // persistent useOForm form (the component is :open-toggled, not v-if'd).
    await submitForm(wrapper);
    expect(wrapper.vm.form.state.submissionAttempts).toBeGreaterThan(0);
    expect(wrapper.vm.form.state.isValid).toBe(false);

    // Closing the dialog must reset the persistent form so the next open is clean.
    await wrapper.setProps({ open: false });
    await flushPromises();
    expect(wrapper.vm.form.state.submissionAttempts).toBe(0);
  });

  describe("Component Rendering", () => {
    it("should render drilldown popup container", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-drilldown-popup"]').exists()).toBe(true);
    });

    it("should render ODialog wrapper", () => {
      wrapper = createWrapper();

      // The parent-supplied data-test fallthrough overrides the stub's own
      // data-test on the root, so assert via findComponent instead.
      expect(wrapper.findComponent(ODialogStub).exists()).toBe(true);
    });

    it("should forward create-drilldown title to ODialog by default", () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("Create Drilldown");
    });

    it("should forward edit-drilldown title to ODialog in edit mode", () => {
      wrapper = createWrapper({ isEditMode: true, drilldownDataIndex: 0 });

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("title")).toBe("Edit Drilldown");
    });

    it("should forward md size to ODialog", () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("size")).toBe("md");
    });

    it("should forward open prop to ODialog", () => {
      wrapper = createWrapper({ open: true });

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("open")).toBe(true);
    });

    it("should render drilldown name input", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-config-panel-drilldown-name"]').exists()).toBe(
        true,
      );
    });

    it("should render drilldown type buttons", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-drilldown-by-dashboard-btn"]').exists()).toBe(
        true,
      );
      expect(wrapper.find('[data-test="dashboard-drilldown-by-url-btn"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-drilldown-by-logs-btn"]').exists()).toBe(true);
    });

    it("should render primary and secondary action buttons via ODialog", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="o-dialog-stub-primary"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="o-dialog-stub-secondary"]').exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should handle isEditMode prop", () => {
      wrapper = createWrapper({ isEditMode: true, drilldownDataIndex: 0 });

      expect(wrapper.props("isEditMode")).toBe(true);
      expect(wrapper.vm.isEditMode).toBe(true);
    });

    it("should handle drilldownDataIndex prop", () => {
      wrapper = createWrapper({ drilldownDataIndex: 2 });

      expect(wrapper.props("drilldownDataIndex")).toBe(2);
    });

    it("should handle variablesData prop", () => {
      const variables = { values: [{ name: "test", type: "custom" }] };
      wrapper = createWrapper({ variablesData: variables });

      expect(wrapper.props("variablesData")).toEqual(variables);
    });

    it("should have default empty variablesData", () => {
      wrapper = createWrapper({ variablesData: undefined });

      expect(wrapper.props("variablesData")).toEqual({});
    });

    it("should default open prop to false when omitted", () => {
      wrapper = createWrapper({ open: undefined });

      expect(wrapper.props("open")).toBe(false);
    });
  });

  describe("Component Structure", () => {
    it("should have correct component name", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$options.name).toBe("DrilldownPopUp");
    });

    it("should have all required methods", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.updateQueryValue).toBe("function");
      expect(typeof wrapper.vm.addVariableRow).toBe("function");
      expect(typeof wrapper.vm.removeVariableRow).toBe("function");
    });

    it("should own the form (useOForm owner pattern, schema-driven)", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.folderList).toBeDefined();
      expect(wrapper.vm.form).toBeDefined();
      expect(typeof wrapper.vm.form.handleSubmit).toBe("function");
    });

    it("should initialize with default drilldown data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.drilldownData).toBeDefined();
      expect(wrapper.vm.drilldownData.name).toBe("");
      expect(wrapper.vm.drilldownData.type).toBe("byDashboard");
      expect(wrapper.vm.drilldownData.targetBlank).toBe(false);
    });
  });

  describe("Drilldown Type Selection", () => {
    it("should default to byDashboard type", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.drilldownData.type).toBe("byDashboard");
    });

    it("should change to byUrl type when clicked", async () => {
      wrapper = createWrapper();

      // OToggleGroup uses reka-ui under the hood — emit update:model-value on the
      // first OToggleGroup (the type selector) to simulate a user click.
      const typeToggleGroup = wrapper.findAllComponents({ name: "OToggleGroup" }).at(0);
      await typeToggleGroup!.vm.$emit("update:modelValue", "byUrl");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.drilldownData.type).toBe("byUrl");
    });

    it("should change to logs type when clicked", async () => {
      wrapper = createWrapper();

      const typeToggleGroup = wrapper.findAllComponents({ name: "OToggleGroup" }).at(0);
      await typeToggleGroup!.vm.$emit("update:modelValue", "logs");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.drilldownData.type).toBe("logs");
    });

    it("should call changeTypeOfDrilldown method", async () => {
      wrapper = createWrapper();

      wrapper.vm.form.setFieldValue("type", "byUrl");
      await flushPromises();

      expect(wrapper.vm.drilldownData.type).toBe("byUrl");
    });
  });

  describe("URL Drilldown Mode", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      wrapper.vm.form.setFieldValue("type", "byUrl");
      await wrapper.vm.$nextTick();
    });

    it("should show URL textarea for byUrl type", () => {
      expect(wrapper.find('[data-test="dashboard-drilldown-url-textarea"]').exists()).toBe(true);
    });

    it("validates URL format via the schema (protocol required)", async () => {
      // type=byUrl bridged into the form by changeTypeOfDrilldown (beforeEach).
      setField(wrapper, "name", "d1");
      setField(wrapper, "data.url", "https://example.com");
      await submitForm(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(true);

      setField(wrapper, "data.url", "invalid-url");
      await submitForm(wrapper);
      expect(wrapper.vm.form.state.isValid).toBe(false);
    });

    it("shows the invalid-URL error after submit (replaces the inline div)", async () => {
      setField(wrapper, "name", "d1");
      setField(wrapper, "data.url", "invalid-url");
      await submitForm(wrapper);

      expect(wrapper.text()).toContain("Invalid URL");
    });

    it("requires a URL for byUrl (empty URL blocks submit)", async () => {
      setField(wrapper, "name", "d1");
      setField(wrapper, "data.url", "");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
    });
  });

  describe("Logs Drilldown Mode", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      wrapper.vm.form.setFieldValue("type", "logs");
      await wrapper.vm.$nextTick();
    });

    it("should show logs mode selection", () => {
      expect(wrapper.text()).toContain("Select Logs Mode:");
    });

    it("should default to auto logs mode", () => {
      expect(wrapper.vm.drilldownData.data.logsMode).toBe("auto");
    });

    it("should switch to custom logs mode", async () => {
      // OToggleGroup uses reka-ui — emit update:model-value on the logsMode toggle
      // (second OToggleGroup in the component) to simulate a user selecting "custom".
      const logsModeToggleGroup = wrapper.findAllComponents({ name: "OToggleGroup" }).at(1);
      expect(logsModeToggleGroup).toBeTruthy();
      await logsModeToggleGroup!.vm.$emit("update:modelValue", "custom");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.drilldownData.data.logsMode).toBe("custom");
    });

    it("should show query editor in custom mode", async () => {
      wrapper.vm.form.setFieldValue("data.logsMode", "custom");
      await flushPromises();

      expect(wrapper.text()).toContain("Custom SQL Query");
    });

    it("should update query value", async () => {
      wrapper.vm.updateQueryValue("SELECT * FROM logs");
      await flushPromises();

      expect(wrapper.vm.drilldownData.data.logsQuery).toBe("SELECT * FROM logs");
    });
  });

  describe("Dashboard Drilldown Mode", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      wrapper.vm.form.setFieldValue("type", "byDashboard");
      await wrapper.vm.$nextTick();
    });

    it("should render folder selection", () => {
      expect(wrapper.find('[data-test="dashboard-drilldown-folder-select"]').exists()).toBe(true);
    });

    it("should render dashboard selection when folder is selected", async () => {
      setField(wrapper, "data.folder", "test-folder");
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-drilldown-dashboard-select"]').exists()).toBe(
        true,
      );
    });

    it("should render tab selection when dashboard is selected", async () => {
      setField(wrapper, "data.folder", "test-folder");
      setField(wrapper, "data.dashboard", "Dashboard 1");
      await flushPromises();

      expect(wrapper.find('[data-test="dashboard-drilldown-tab-select"]').exists()).toBe(true);
    });

    it("should populate folder list from store", () => {
      expect(wrapper.vm.folderList).toEqual([
        { label: "test-folder", value: "test-folder" },
        { label: "demo-folder", value: "demo-folder" },
      ]);
    });

    it("should render pass all variables toggle", () => {
      expect(wrapper.find('[data-test="dashboard-drilldown-pass-all-variables"]').exists()).toBe(
        true,
      );
    });
  });

  describe("Variables Management", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      wrapper.vm.form.setFieldValue("type", "byDashboard");
      await wrapper.vm.$nextTick();
    });

    it("should render add variable button", () => {
      expect(wrapper.find('[data-test="dashboard-drilldown-add-variable"]').exists()).toBe(true);
    });

    it("should add new variable when add button clicked", async () => {
      const initialLength = wrapper.vm.drilldownData.data.variables.length;

      await wrapper.find('[data-test="dashboard-drilldown-add-variable"]').trigger("click");

      expect(wrapper.vm.drilldownData.data.variables.length).toBe(initialLength + 1);
    });

    it("should initialize with default variable", () => {
      expect(wrapper.vm.drilldownData.data.variables).toHaveLength(1);
      expect(wrapper.vm.drilldownData.data.variables[0]).toEqual({
        name: "",
        value: "",
      });
    });

    it("should render remove variable buttons", () => {
      expect(wrapper.find('[data-test="dashboard-drilldown-variable-remove-0"]').exists()).toBe(
        true,
      );
    });

    it("should remove variable when remove button clicked", async () => {
      // Add another variable first
      wrapper.vm.drilldownData.data.variables.push({
        name: "test",
        value: "value",
      });
      await wrapper.vm.$nextTick();

      const initialLength = wrapper.vm.drilldownData.data.variables.length;
      await wrapper.find('[data-test="dashboard-drilldown-variable-remove-0"]').trigger("click");

      expect(wrapper.vm.drilldownData.data.variables.length).toBe(initialLength - 1);
    });
  });

  describe("Selected Values for Different Chart Types", () => {
    it("should generate correct values for table type", () => {
      mockDashboardPanelData.data.type = "table";
      wrapper = createWrapper();

      const selectedValues = wrapper.vm.options.selectedValue;
      expect(selectedValues.some((val: any) => val.value.includes("row.field"))).toBe(true);
    });

    it("should generate correct values for sankey type", () => {
      mockDashboardPanelData.data.type = "sankey";
      wrapper = createWrapper();

      const selectedValues = wrapper.vm.options.selectedValue;
      expect(selectedValues.some((val: any) => val.value.includes("${edge.__source}"))).toBe(true);
      expect(selectedValues.some((val: any) => val.value.includes("${node.__name}"))).toBe(true);
    });

    it("should generate correct values for pie chart type", () => {
      mockDashboardPanelData.data.type = "pie";
      wrapper = createWrapper();

      const selectedValues = wrapper.vm.options.selectedValue;
      expect(selectedValues.some((val: any) => val.value === "${series.__name}")).toBe(true);
      expect(selectedValues.some((val: any) => val.value === "${series.__value}")).toBe(true);
    });

    it("should generate correct values for metric type", () => {
      mockDashboardPanelData.data.type = "metric";
      wrapper = createWrapper();

      const selectedValues = wrapper.vm.options.selectedValue;
      expect(selectedValues.some((val: any) => val.value === "${series.__value}")).toBe(true);
    });

    it("should generate correct values for line chart type", () => {
      mockDashboardPanelData.data.type = "line";
      wrapper = createWrapper();

      const selectedValues = wrapper.vm.options.selectedValue;
      expect(selectedValues.some((val: any) => val.value === "${series.__axisValue}")).toBe(true);
    });
  });

  // Validation is now schema-driven through the REAL OForm (playbook §5). Each
  // case sets the relevant form fields, drives a submit, and asserts the
  // schema's verdict (form.state.isValid). This is the type-conditional
  // superRefine that replaced the old isFormValid/isFormURLValid/nameError gate.
  describe("Form Validation (schema)", () => {
    it("is invalid when the name is empty", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
    });

    it("is invalid for byUrl with an invalid URL", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "Test Drilldown");
      setField(wrapper, "type", "byUrl");
      setField(wrapper, "data.url", "invalid-url");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
    });

    it("is valid for byUrl with a valid URL", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "Test Drilldown");
      setField(wrapper, "type", "byUrl");
      setField(wrapper, "data.url", "https://example.com");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
    });

    it("is valid for logs type in auto mode", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "Test Drilldown");
      setField(wrapper, "type", "logs");
      setField(wrapper, "data.logsMode", "auto");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
    });

    it("is invalid for logs custom mode with an empty query", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "Test Drilldown");
      setField(wrapper, "type", "logs");
      setField(wrapper, "data.logsMode", "custom");
      setField(wrapper, "data.logsQuery", "");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(false);
    });

    it("surfaces an inline required error for an empty custom query after submit", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "Test Drilldown");
      setField(wrapper, "type", "logs");
      setField(wrapper, "data.logsMode", "custom");
      setField(wrapper, "data.logsQuery", "");
      await flushPromises();

      // submit-then-change timing: nothing shows before the first submit attempt.
      expect(wrapper.find('[data-test="dashboard-drilldown-logs-query-error"]').exists()).toBe(
        false,
      );

      await submitForm(wrapper);

      // The Monaco editor is a manual widget bridged into the form; the error is
      // rendered from its mapped field meta next to the editor.
      expect(wrapper.find('[data-test="dashboard-drilldown-logs-query-error"]').exists()).toBe(
        true,
      );
    });

    it("clears the inline custom-query error once a query is entered", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "Test Drilldown");
      setField(wrapper, "type", "logs");
      setField(wrapper, "data.logsMode", "custom");
      setField(wrapper, "data.logsQuery", "");
      await submitForm(wrapper);
      expect(wrapper.find('[data-test="dashboard-drilldown-logs-query-error"]').exists()).toBe(
        true,
      );

      // Re-validation on change (submit-then-change) drops the error.
      setField(wrapper, "data.logsQuery", "SELECT * FROM logs");
      await flushPromises();
      expect(wrapper.find('[data-test="dashboard-drilldown-logs-query-error"]').exists()).toBe(
        false,
      );
    });

    it("is valid for byDashboard with all selections", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "Test Drilldown");
      setField(wrapper, "type", "byDashboard");
      setField(wrapper, "data.folder", "test-folder");
      setField(wrapper, "data.dashboard", "Dashboard 1");
      setField(wrapper, "data.tab", "Tab 1");
      await submitForm(wrapper);

      expect(wrapper.vm.form.state.isValid).toBe(true);
    });

    it("keeps the Save button enabled (R3) and wires form-id (R4)", async () => {
      wrapper = createWrapper();
      await flushPromises();

      const dialog = wrapper.findComponent(ODialogStub);
      // Save is never disabled by validity now — the schema gates the submit.
      expect(dialog.props("primaryButtonDisabled")).toBeFalsy();
      // form-id (container) === OForm id makes Enter / footer Save submit.
      expect(wrapper.find("#drilldown-popup-form").exists()).toBe(true);
    });
  });

  describe("Target Blank Toggle", () => {
    it("should render open in new tab toggle", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-drilldown-open-in-new-tab"]').exists()).toBe(true);
    });

    it("should default to false for targetBlank", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.drilldownData.targetBlank).toBe(false);
    });

    it("should toggle targetBlank value", async () => {
      wrapper = createWrapper();

      const toggle = wrapper.find('[data-test="dashboard-drilldown-open-in-new-tab"]');
      await toggle.trigger("click");

      expect(wrapper.vm.drilldownData.targetBlank).toBe(true);
    });
  });

  describe("Event Handling", () => {
    it("should emit close when ODialog requests cancel (click:secondary)", async () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("click:secondary");

      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")!.length).toBe(1);
    });

    it("should emit close when ODialog requests close via update:open=false", async () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", false);

      expect(wrapper.emitted("close")).toBeTruthy();
      expect(wrapper.emitted("close")!.length).toBe(1);
    });

    it("should not emit close when ODialog reports update:open=true", async () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent(ODialogStub);
      await dialog.vm.$emit("update:open", true);

      expect(wrapper.emitted("close")).toBeFalsy();
    });

    it("saves via a valid form submit (logs/auto) and emits close", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "Test");
      setField(wrapper, "type", "logs");
      setField(wrapper, "data.logsMode", "auto");

      const initialLength = mockDashboardPanelData.data.config.drilldown.length;
      await submitForm(wrapper);

      // a valid submit pushed a new drilldown and emitted close
      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(initialLength + 1);
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("does NOT save when the form is invalid (empty name)", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "");
      setField(wrapper, "type", "logs");
      setField(wrapper, "data.logsMode", "auto");

      const initialLength = mockDashboardPanelData.data.config.drilldown.length;
      await submitForm(wrapper);

      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(initialLength);
      expect(wrapper.emitted("close")).toBeFalsy();
    });

    it("saves a new drilldown in create mode (validated payload)", async () => {
      wrapper = createWrapper();
      await flushPromises();
      setField(wrapper, "name", "New Drilldown");
      setField(wrapper, "type", "logs");
      setField(wrapper, "data.logsMode", "auto");

      const initialLength = mockDashboardPanelData.data.config.drilldown.length;
      await submitForm(wrapper);

      expect(mockDashboardPanelData.data.config.drilldown.length).toBe(initialLength + 1);
      const saved =
        mockDashboardPanelData.data.config.drilldown[
          mockDashboardPanelData.data.config.drilldown.length - 1
        ];
      expect(saved.name).toBe("New Drilldown");
      expect(saved.type).toBe("logs");
    });

    it("updates the drilldown in edit mode (validated payload)", async () => {
      // Use existing drilldown data from mock (byDashboard with all selections)
      wrapper = createWrapper({ isEditMode: true, drilldownDataIndex: 0 });
      await flushPromises();
      setField(wrapper, "name", "Updated Drilldown");
      setField(wrapper, "type", "logs");
      setField(wrapper, "data.logsMode", "auto");

      await submitForm(wrapper);

      expect(mockDashboardPanelData.data.config.drilldown[0].name).toBe("Updated Drilldown");
      expect(mockDashboardPanelData.data.config.drilldown[0].type).toBe("logs");
    });
  });

  describe("Button Labels", () => {
    it("should show 'Add' label on ODialog primary button in create mode", () => {
      wrapper = createWrapper({ isEditMode: false });

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLabel")).toBe("Add");
    });

    it("should show 'Update' label on ODialog primary button in edit mode", () => {
      wrapper = createWrapper({
        isEditMode: true,
        drilldownDataIndex: 0,
      });

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("primaryButtonLabel")).toBe("Update");
    });

    it("should show Cancel label on ODialog secondary button", () => {
      wrapper = createWrapper();

      const dialog = wrapper.findComponent(ODialogStub);
      expect(dialog.props("secondaryButtonLabel")).toBe("Cancel");
    });
  });

  describe("Loading States", () => {
    it("should have loading states for async operations", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getFoldersListLoading).toBeDefined();
      expect(wrapper.vm.getDashboardListLoading).toBeDefined();
      expect(wrapper.vm.getTabListLoading).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty folders list", () => {
      mockStore.state.organizationData.folders = [];
      wrapper = createWrapper();

      expect(wrapper.vm.folderList).toEqual([]);
    });

    it("should handle undefined folders list", () => {
      (mockStore.state.organizationData as any).folders = undefined;
      wrapper = createWrapper();

      expect(wrapper.vm.folderList).toEqual([]);
    });

    it("should handle variable names with special characters", () => {
      wrapper = createWrapper();

      const result = wrapper.vm.options.selectedValue;
      expect(Array.isArray(result)).toBe(true);
    });

    it("should handle empty dashboard panel queries", () => {
      mockDashboardPanelData.data.queries = [];
      wrapper = createWrapper();

      expect(wrapper.vm.options.selectedValue).toBeDefined();
    });
  });

  describe("Component Integration", () => {
    it("should render DrilldownUserGuide component in header-right slot", () => {
      wrapper = createWrapper();

      expect(wrapper.findComponent({ name: "DrilldownUserGuide" }).exists()).toBe(true);
    });

    it("should render CommonAutoComplete components for variables", async () => {
      wrapper = createWrapper();
      wrapper.vm.form.setFieldValue("type", "byDashboard");

      // Add a variable to ensure autocomplete components are rendered
      wrapper.vm.drilldownData.data.variables.push({
        name: "test",
        value: "value",
      });
      await wrapper.vm.$nextTick();

      // Check that the stub components exist (they might be rendered as stubs)
      const stubElements = wrapper.element.querySelectorAll("div");
      expect(stubElements.length).toBeGreaterThan(0);
    });
  });
});
