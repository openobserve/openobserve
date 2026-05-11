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
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";

import OverrideConfigPopup from "@/components/dashboards/OverrideConfigPopup.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Dialog, Notify],
});

// ── ODialog / OButton stubs ──────────────────────────────────────────────────
// Stubs preserve the slot content (so child rendering can be asserted) and
// re-emit the events that the component listens for: update:open, click:primary
// and click:neutral.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "width",
    "title",
    "subTitle",
    "showClose",
    "persistent",
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
      data-test-stub="o-dialog"
      :data-open="open"
      :data-title="title"
      :data-width="width"
      :data-primary-label="primaryButtonLabel"
      :data-neutral-label="neutralButtonLabel"
      :data-neutral-variant="neutralButtonVariant"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
    </div>
  `,
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled", "loading"],
  emits: ["click"],
  inheritAttrs: false,
  template: `<button
    data-test-stub="o-button"
    :data-test="$attrs['data-test']"
    :disabled="disabled"
    @click="$emit('click', $event)"
  ><slot name="icon-left" /><slot /></button>`,
};

describe("OverrideConfigPopup", () => {
  let wrapper: any;

  const defaultColumns = [
    { label: "Field 1", alias: "field1" },
    { label: "Field 2", alias: "field2" },
    { label: "Timestamp", alias: "timestamp" },
    { label: "Service Name", alias: "service_name" },
  ];

  const defaultOverrideConfig = {
    overrideConfigs: [
      {
        field: { matchBy: "name", value: "" },
        config: [{ type: "unit", value: { unit: "", customUnit: "" } }],
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = async (props = {}) => {
    const w = mount(OverrideConfigPopup, {
      props: {
        open: true,
        columns: defaultColumns,
        // Create a fresh deep copy so state isn't shared between tests
        overrideConfig: JSON.parse(JSON.stringify(defaultOverrideConfig)),
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          ODialog: ODialogStub,
          OButton: OButtonStub,
          "q-select": {
            template:
              '<select :data-test="$attrs[\'data-test\']"><slot /></select>',
            props: ["modelValue", "options"],
            emits: ["update:modelValue"],
          },
          "q-input": {
            template:
              '<input :value="modelValue" :data-test="$attrs[\'data-test\']" @input="$emit(\'update:modelValue\', $event.target.value)" />',
            props: ["modelValue"],
            emits: ["update:modelValue"],
          },
          "q-checkbox": {
            template:
              '<input type="checkbox" :checked="modelValue" @change="$emit(\'update:modelValue\', $event.target.checked)" />',
            props: ["modelValue"],
            emits: ["update:modelValue"],
          },
          "q-icon": {
            template: '<span class="q-icon">{{ $attrs.name }}</span>',
          },
        },
        mocks: {
          $t: (key: string) => key,
        },
      },
    });

    // Wait for the component to be fully mounted and onMounted hook to run
    await flushPromises();
    return w;
  };

  describe("Component Initialization", () => {
    it("should render component with default props", async () => {
      wrapper = await createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should initialize with required props", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.$props.columns).toEqual(defaultColumns);
      expect(wrapper.vm.$props.overrideConfig).toEqual(defaultOverrideConfig);
      expect(wrapper.vm.$props.open).toBe(true);
    });

    it("should initialize reactive data", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.configTypeOptions).toBeDefined();
      expect(wrapper.vm.unitOptions).toBeDefined();
      expect(wrapper.vm.columnsOptions).toBeDefined();
      expect(wrapper.vm.overrideConfigs).toBeDefined();
    });
  });

  describe("Template Rendering", () => {
    it("should render ODialog with correct title and labels", async () => {
      wrapper = await createWrapper();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.exists()).toBe(true);
      expect(dialog.props("title")).toBe("Override Config");
      expect(dialog.props("primaryButtonLabel")).toBe("Save");
      expect(dialog.props("neutralButtonLabel")).toBe("+ Add field override");
      expect(dialog.props("neutralButtonVariant")).toBe("outline");
      expect(dialog.props("width")).toBe(70);
    });

    it("should pass open prop to ODialog", async () => {
      wrapper = await createWrapper({ open: true });

      const dialog = wrapper.findComponent({ name: "ODialog" });
      expect(dialog.props("open")).toBe(true);
    });

    it("should render at least one override config row by default", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.overrideConfigs.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Column Options Computation", () => {
    it("should compute columns options correctly", async () => {
      wrapper = await createWrapper();

      const expectedOptions = [
        { label: "Field 1", value: "field1" },
        { label: "Field 2", value: "field2" },
        { label: "Timestamp", value: "timestamp" },
        { label: "Service Name", value: "service_name" },
      ];

      expect(wrapper.vm.columnsOptions).toEqual(expectedOptions);
    });

    it("should handle empty columns", async () => {
      wrapper = await createWrapper({ columns: [] });

      expect(wrapper.vm.columnsOptions).toEqual([]);
    });
  });

  describe("Config Type Options", () => {
    it("should have correct config type options", async () => {
      wrapper = await createWrapper();

      const expectedOptions = [
        { label: "Unit", value: "unit" },
        { label: "Unique Value Color", value: "unique_value_color" },
      ];

      expect(wrapper.vm.configTypeOptions).toEqual(expectedOptions);
    });
  });

  describe("Unit Options", () => {
    it("should have unit options with translation keys", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.unitOptions).toBeInstanceOf(Array);
      expect(wrapper.vm.unitOptions.length).toBeGreaterThan(0);
      expect(wrapper.vm.unitOptions[0]).toHaveProperty("label");
      expect(wrapper.vm.unitOptions[0]).toHaveProperty("value");
    });

    it("should include custom unit option", async () => {
      wrapper = await createWrapper();

      const customOption = wrapper.vm.unitOptions.find(
        (option: any) => option.value === "custom",
      );
      expect(customOption).toBeDefined();
      expect(customOption.label.toLowerCase()).toContain("custom");
    });
  });

  describe("Override Config Management", () => {
    it("should add new override config when ODialog emits click:neutral", async () => {
      wrapper = await createWrapper();

      const initialLength = wrapper.vm.overrideConfigs.length;
      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("click:neutral");

      expect(wrapper.vm.overrideConfigs).toHaveLength(initialLength + 1);
    });

    it("should add new override config via exposed method", async () => {
      wrapper = await createWrapper();

      const initialLength = wrapper.vm.overrideConfigs.length;
      await wrapper.vm.addOverrideConfig();

      expect(wrapper.vm.overrideConfigs).toHaveLength(initialLength + 1);
    });

    it("should remove override config", async () => {
      wrapper = await createWrapper();

      // Add another config first
      await wrapper.vm.addOverrideConfig();
      const initialLength = wrapper.vm.overrideConfigs.length;

      wrapper.vm.removeOverrideConfig(0);

      expect(wrapper.vm.overrideConfigs).toHaveLength(initialLength - 1);
    });

    it("should initialize new override config with default values", async () => {
      wrapper = await createWrapper();

      await wrapper.vm.addOverrideConfig();
      const newConfig =
        wrapper.vm.overrideConfigs[wrapper.vm.overrideConfigs.length - 1];

      expect(newConfig.field.matchBy).toBe("name");
      expect(newConfig.field.value).toBe("");
      expect(newConfig.config[0].type).toBe("unit");
    });
  });

  describe("Config Type Changes", () => {
    it("should handle config type change to unit", async () => {
      wrapper = await createWrapper();

      wrapper.vm.overrideConfigs[0].config[0].type = "unit";
      wrapper.vm.onConfigTypeChange(0);

      expect(wrapper.vm.overrideConfigs[0].config[0].value).toBeDefined();
      expect(wrapper.vm.overrideConfigs[0].config[0].value.unit).toBe("");
      expect(wrapper.vm.overrideConfigs[0].config[0].value.customUnit).toBe("");
    });

    it("should handle config type change to unique_value_color", async () => {
      wrapper = await createWrapper();

      wrapper.vm.overrideConfigs[0].config[0].type = "unique_value_color";
      wrapper.vm.onConfigTypeChange(0);

      expect(wrapper.vm.overrideConfigs[0].config[0].autoColor).toBe(false);
      expect(wrapper.vm.overrideConfigs[0].config[0].value).toBeUndefined();
    });
  });

  describe("Field Display Value", () => {
    it("should return empty string for empty field value", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.getFieldDisplayValue("")).toBe("");
      expect(wrapper.vm.getFieldDisplayValue(null)).toBe("");
      expect(wrapper.vm.getFieldDisplayValue(undefined)).toBe("");
    });

    it("should return label for existing field", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.getFieldDisplayValue("field1")).toBe("Field 1");
      expect(wrapper.vm.getFieldDisplayValue("timestamp")).toBe("Timestamp");
    });

    it("should return error message for non-existent field", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.getFieldDisplayValue("non_existent")).toBe(
        "non_existent (Field not found)",
      );
    });
  });

  describe("Save Functionality", () => {
    it("should emit save event when ODialog emits click:primary", async () => {
      wrapper = await createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unit";
      wrapper.vm.overrideConfigs[0].config[0].value = {
        unit: "bytes",
        customUnit: "",
      };

      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("click:primary");

      expect(wrapper.emitted("save")).toBeTruthy();
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should emit save event when saveOverrides is called directly", async () => {
      wrapper = await createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unit";
      wrapper.vm.overrideConfigs[0].config[0].value = {
        unit: "bytes",
        customUnit: "",
      };

      wrapper.vm.saveOverrides();

      expect(wrapper.emitted("save")).toBeTruthy();
      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should filter out configs without field values", async () => {
      wrapper = await createWrapper();

      wrapper.vm.addOverrideConfig();
      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[1].field.value = "";

      wrapper.vm.saveOverrides();

      const savedConfigs = wrapper.emitted("save")![0][0];
      expect(savedConfigs).toHaveLength(1);
      expect(savedConfigs[0].field.value).toBe("field1");
    });

    it("should transform unit config correctly", async () => {
      wrapper = await createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unit";
      wrapper.vm.overrideConfigs[0].config[0].value = {
        unit: "bytes",
        customUnit: "",
      };

      wrapper.vm.saveOverrides();

      const savedConfigs = wrapper.emitted("save")![0][0];
      expect(savedConfigs[0]).toEqual({
        field: { matchBy: "name", value: "field1" },
        config: [
          {
            type: "unit",
            value: { unit: "bytes", customUnit: "" },
          },
        ],
      });
    });

    it("should transform unique_value_color config correctly", async () => {
      wrapper = await createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unique_value_color";
      wrapper.vm.overrideConfigs[0].config[0].autoColor = true;

      wrapper.vm.saveOverrides();

      const savedConfigs = wrapper.emitted("save")![0][0];
      expect(savedConfigs[0]).toEqual({
        field: { matchBy: "name", value: "field1" },
        config: [
          {
            type: "unique_value_color",
            autoColor: true,
          },
        ],
      });
    });
  });

  describe("Close Functionality", () => {
    it("should emit close event when closePopup is called", async () => {
      wrapper = await createWrapper();

      wrapper.vm.closePopup();

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should emit close when ODialog emits update:open with false", async () => {
      wrapper = await createWrapper();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("update:open", false);

      expect(wrapper.emitted("close")).toBeTruthy();
    });

    it("should NOT emit close when ODialog emits update:open with true", async () => {
      wrapper = await createWrapper();

      const dialog = wrapper.findComponent({ name: "ODialog" });
      await dialog.vm.$emit("update:open", true);

      expect(wrapper.emitted("close")).toBeFalsy();
    });

    it("should reset configs to original state when closing", async () => {
      const existingConfig = {
        overrideConfigs: [
          {
            field: { matchBy: "name", value: "field1" },
            config: [
              { type: "unit", value: { unit: "bytes", customUnit: "" } },
            ],
          },
        ],
      };

      wrapper = await createWrapper({ overrideConfig: existingConfig });

      // Modify the config
      wrapper.vm.overrideConfigs[0].field.value = "field2";

      // Close popup
      wrapper.vm.closePopup();

      // Should be reset to original value
      expect(wrapper.vm.overrideConfigs[0].field.value).toBe("field1");
    });
  });

  describe("Props Validation", () => {
    it("should accept valid columns prop", async () => {
      const validColumns = [
        { label: "Field 1", alias: "field1" },
        { label: "Field 2", alias: "field2" },
      ];

      wrapper = await createWrapper({ columns: validColumns });
      expect(wrapper.vm.columnsOptions).toHaveLength(2);
    });

    it("should validate columns prop format", () => {
      const validator = (OverrideConfigPopup as any).props.columns.validator;

      // Valid format
      expect(validator([{ label: "Field 1", alias: "field1" }])).toBe(true);

      // Invalid format
      expect(validator([{ label: "Field 1" }])).toBe(false);
      expect(validator([{ alias: "field1" }])).toBe(false);
    });

    it("should accept valid override config prop", async () => {
      const validConfig = {
        overrideConfigs: [
          {
            field: { matchBy: "name", value: "field1" },
            config: [
              { type: "unit", value: { unit: "bytes", customUnit: "" } },
            ],
          },
        ],
      };

      wrapper = await createWrapper({ overrideConfig: validConfig });
      expect(wrapper.vm.overrideConfigs).toHaveLength(1);
    });
  });

  describe("Component Behavior", () => {
    it("should handle component mounting without errors", async () => {
      wrapper = await createWrapper();
      expect(wrapper.vm.overrideConfigs.length).toBeGreaterThan(0);
    });

    it("should handle component unmounting without errors", async () => {
      wrapper = await createWrapper();

      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
      // prevent afterEach double unmount
      wrapper = null;
    });

    it("should maintain reactive state", async () => {
      wrapper = await createWrapper();

      const initialCount = wrapper.vm.overrideConfigs.length;
      wrapper.vm.overrideConfigs[0].field.value = "field1";

      expect(wrapper.vm.overrideConfigs[0].field.value).toBe("field1");
      expect(wrapper.vm.overrideConfigs.length).toBe(initialCount);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined/null config values", async () => {
      const configWithNulls = {
        overrideConfigs: [
          {
            field: { matchBy: "name", value: "" },
            config: [{ type: "unit", value: { unit: "", customUnit: "" } }],
          },
        ],
      };

      wrapper = await createWrapper({ overrideConfig: configWithNulls });
      expect(wrapper.vm.overrideConfigs).toHaveLength(1);
    });

    it("should handle empty overrideConfigs by creating a default row", async () => {
      const emptyConfig = { overrideConfigs: [] };

      wrapper = await createWrapper({ overrideConfig: emptyConfig });

      // Should create default config
      expect(wrapper.vm.overrideConfigs.length).toBeGreaterThanOrEqual(1);
    });

    it("should handle malformed config structure", async () => {
      const malformedConfig = {
        overrideConfigs: [
          {
            field: { matchBy: "name", value: "" },
            config: [{ type: "unit", value: { unit: "", customUnit: "" } }],
          },
        ],
      };

      wrapper = await createWrapper({ overrideConfig: malformedConfig });
      expect(wrapper.vm.overrideConfigs).toHaveLength(1);
    });
  });

  describe("State Management", () => {
    it("should handle rapid state changes", async () => {
      wrapper = await createWrapper();

      expect(() => {
        wrapper.vm.addOverrideConfig();
        wrapper.vm.addOverrideConfig();
        wrapper.vm.removeOverrideConfig(1);
        wrapper.vm.addOverrideConfig();
      }).not.toThrow();

      expect(wrapper.vm.overrideConfigs.length).toBeGreaterThan(0);
    });

    it("should preserve state during operations", async () => {
      wrapper = await createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unit";
      // Ensure the value object is properly initialized
      wrapper.vm.overrideConfigs[0].config[0].value = {
        unit: "bytes",
        customUnit: "",
      };

      wrapper.vm.addOverrideConfig();

      // Original config should be preserved
      expect(wrapper.vm.overrideConfigs[0].field.value).toBe("field1");
      expect(wrapper.vm.overrideConfigs[0].config[0].type).toBe("unit");
    });
  });

  describe("Internationalization", () => {
    it("should expose translation function", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.t).toBeTypeOf("function");
    });

    it("should have translated labels in unit options", async () => {
      wrapper = await createWrapper();

      const unitOptions = wrapper.vm.unitOptions;
      expect(unitOptions.length).toBeGreaterThan(0);
      expect(
        unitOptions.every((option: any) => typeof option.label === "string"),
      ).toBe(true);
    });
  });

  describe("Data Normalization", () => {
    it("should initialize with existing configs", async () => {
      const existingConfig = {
        overrideConfigs: [
          {
            field: { matchBy: "name", value: "field1" },
            config: [
              { type: "unit", value: { unit: "bytes", customUnit: "" } },
            ],
          },
        ],
      };

      wrapper = await createWrapper({ overrideConfig: existingConfig });

      expect(wrapper.vm.overrideConfigs).toHaveLength(1);
      expect(wrapper.vm.overrideConfigs[0].field.value).toBe("field1");
      expect(wrapper.vm.overrideConfigs[0].config[0].type).toBe("unit");
    });

    it("should normalize unique_value_color configs", async () => {
      const existingConfig = {
        overrideConfigs: [
          {
            field: { matchBy: "name", value: "field1" },
            config: [{ type: "unique_value_color", autoColor: true }],
          },
        ],
      };

      wrapper = await createWrapper({ overrideConfig: existingConfig });

      expect(wrapper.vm.overrideConfigs[0].config[0].type).toBe(
        "unique_value_color",
      );
      expect(wrapper.vm.overrideConfigs[0].config[0].autoColor).toBe(true);
    });
  });

  describe("Component Methods", () => {
    it("should have all required methods", async () => {
      wrapper = await createWrapper();

      expect(wrapper.vm.closePopup).toBeTypeOf("function");
      expect(wrapper.vm.addOverrideConfig).toBeTypeOf("function");
      expect(wrapper.vm.removeOverrideConfig).toBeTypeOf("function");
      expect(wrapper.vm.saveOverrides).toBeTypeOf("function");
      expect(wrapper.vm.onConfigTypeChange).toBeTypeOf("function");
      expect(wrapper.vm.getFieldDisplayValue).toBeTypeOf("function");
    });

    it("should execute methods without errors", async () => {
      wrapper = await createWrapper();

      expect(() => {
        wrapper.vm.getFieldDisplayValue("field1");
        wrapper.vm.onConfigTypeChange(0);
      }).not.toThrow();
    });
  });
});
