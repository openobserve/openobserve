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

describe("OverrideConfigPopup", () => {
  let wrapper: any;

  const defaultColumns = [
    { label: "Field 1", alias: "field1" },
    { label: "Field 2", alias: "field2" },
    { label: "Timestamp", alias: "timestamp" },
    { label: "Service Name", alias: "service_name" },
  ];

  const defaultOverrideConfig = {
    overrideConfigs: []
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(OverrideConfigPopup, {
      props: {
        columns: defaultColumns,
        overrideConfig: defaultOverrideConfig,
        ...props
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Initialization", () => {
    it("should render component with default props", () => {
      wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm).toBeTruthy();
    });

    it("should initialize with required props", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.$props.columns).toEqual(defaultColumns);
      expect(wrapper.vm.$props.overrideConfig).toEqual(defaultOverrideConfig);
    });

    it("should initialize reactive data", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.configTypeOptions).toBeDefined();
      expect(wrapper.vm.unitOptions).toBeDefined();
      expect(wrapper.vm.columnsOptions).toBeDefined();
      expect(wrapper.vm.overrideConfigs).toBeDefined();
    });
  });

  describe("Template Rendering", () => {
    it("should render popup header", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain("Override Config");
    });

    it("should render close button", () => {
      wrapper = createWrapper();

      expect(wrapper.html()).toContain('close');
    });

    it("should render add field override button", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain("+ Add field override");
    });

    it("should render save button", () => {
      wrapper = createWrapper();

      expect(wrapper.text()).toContain("Save");
    });

    it("should render at least one override config by default", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.overrideConfigs).toHaveLength(1);
    });
  });

  describe("Column Options Computation", () => {
    it("should compute columns options correctly", () => {
      wrapper = createWrapper();

      const expectedOptions = [
        { label: "Field 1", value: "field1" },
        { label: "Field 2", value: "field2" },
        { label: "Timestamp", value: "timestamp" },
        { label: "Service Name", value: "service_name" },
      ];

      expect(wrapper.vm.columnsOptions).toEqual(expectedOptions);
    });

    it("should handle empty columns", () => {
      wrapper = createWrapper({ columns: [] });

      expect(wrapper.vm.columnsOptions).toEqual([]);
    });
  });

  describe("Config Type Options", () => {
    it("should have correct config type options", () => {
      wrapper = createWrapper();

      const expectedOptions = [
        { label: "Unit", value: "unit" },
        { label: "Unique Value Color", value: "unique_value_color" },
      ];

      expect(wrapper.vm.configTypeOptions).toEqual(expectedOptions);
    });
  });

  describe("Unit Options", () => {
    it("should have unit options with translation keys", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.unitOptions).toBeInstanceOf(Array);
      expect(wrapper.vm.unitOptions.length).toBeGreaterThan(0);
      expect(wrapper.vm.unitOptions[0]).toHaveProperty('label');
      expect(wrapper.vm.unitOptions[0]).toHaveProperty('value');
    });

    it("should include custom unit option", () => {
      wrapper = createWrapper();

      const customOption = wrapper.vm.unitOptions.find((option: any) => option.value === "custom");
      expect(customOption).toBeDefined();
      expect(customOption.label.toLowerCase()).toContain("custom");
    });
  });

  describe("Override Config Management", () => {
    it("should add new override config", async () => {
      wrapper = createWrapper();

      const initialLength = wrapper.vm.overrideConfigs.length;
      await wrapper.vm.addOverrideConfig();

      expect(wrapper.vm.overrideConfigs).toHaveLength(initialLength + 1);
    });

    it("should remove override config", async () => {
      wrapper = createWrapper();

      // Add another config first
      await wrapper.vm.addOverrideConfig();
      const initialLength = wrapper.vm.overrideConfigs.length;

      wrapper.vm.removeOverrideConfig(0);

      expect(wrapper.vm.overrideConfigs).toHaveLength(initialLength - 1);
    });

    it("should initialize new override config with default values", async () => {
      wrapper = createWrapper();

      await wrapper.vm.addOverrideConfig();
      const newConfig = wrapper.vm.overrideConfigs[wrapper.vm.overrideConfigs.length - 1];

      expect(newConfig.field.matchBy).toBe("name");
      expect(newConfig.field.value).toBe("");
      expect(newConfig.config[0].type).toBe("unit");
    });
  });

  describe("Config Type Changes", () => {
    it("should handle config type change to unit", () => {
      wrapper = createWrapper();

      wrapper.vm.overrideConfigs[0].config[0].type = "unit";
      wrapper.vm.onConfigTypeChange(0);

      expect(wrapper.vm.overrideConfigs[0].config[0].value).toBeDefined();
      expect(wrapper.vm.overrideConfigs[0].config[0].value.unit).toBe("");
      expect(wrapper.vm.overrideConfigs[0].config[0].value.customUnit).toBe("");
    });

    it("should handle config type change to unique_value_color", () => {
      wrapper = createWrapper();

      wrapper.vm.overrideConfigs[0].config[0].type = "unique_value_color";
      wrapper.vm.onConfigTypeChange(0);

      expect(wrapper.vm.overrideConfigs[0].config[0].autoColor).toBe(false);
      expect(wrapper.vm.overrideConfigs[0].config[0].value).toBeUndefined();
    });
  });

  describe("Field Display Value", () => {
    it("should return empty string for empty field value", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getFieldDisplayValue("")).toBe("");
      expect(wrapper.vm.getFieldDisplayValue(null)).toBe("");
      expect(wrapper.vm.getFieldDisplayValue(undefined)).toBe("");
    });

    it("should return label for existing field", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getFieldDisplayValue("field1")).toBe("Field 1");
      expect(wrapper.vm.getFieldDisplayValue("timestamp")).toBe("Timestamp");
    });

    it("should return error message for non-existent field", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.getFieldDisplayValue("non_existent")).toBe("non_existent (Field not found)");
    });
  });

  describe("Save Functionality", () => {
    it("should emit save event when saveOverrides is called", () => {
      wrapper = createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unit";
      wrapper.vm.overrideConfigs[0].config[0].value = { unit: "bytes", customUnit: "" };

      wrapper.vm.saveOverrides();

      expect(wrapper.emitted('save')).toBeTruthy();
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it("should filter out configs without field values", () => {
      wrapper = createWrapper();

      wrapper.vm.addOverrideConfig();
      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[1].field.value = "";

      wrapper.vm.saveOverrides();

      const savedConfigs = wrapper.emitted('save')[0][0];
      expect(savedConfigs).toHaveLength(1);
      expect(savedConfigs[0].field.value).toBe("field1");
    });

    it("should transform unit config correctly", () => {
      wrapper = createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unit";
      wrapper.vm.overrideConfigs[0].config[0].value = { unit: "bytes", customUnit: "" };

      wrapper.vm.saveOverrides();

      const savedConfigs = wrapper.emitted('save')[0][0];
      expect(savedConfigs[0]).toEqual({
        field: { matchBy: "name", value: "field1" },
        config: [{
          type: "unit",
          value: { unit: "bytes", customUnit: "" }
        }]
      });
    });

    it("should transform unique_value_color config correctly", () => {
      wrapper = createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unique_value_color";
      wrapper.vm.overrideConfigs[0].config[0].autoColor = true;

      wrapper.vm.saveOverrides();

      const savedConfigs = wrapper.emitted('save')[0][0];
      expect(savedConfigs[0]).toEqual({
        field: { matchBy: "name", value: "field1" },
        config: [{
          type: "unique_value_color",
          autoColor: true
        }]
      });
    });
  });

  describe("Close Functionality", () => {
    it("should emit close event when closePopup is called", () => {
      wrapper = createWrapper();

      wrapper.vm.closePopup();

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it("should reset configs to original state when closing", () => {
      const existingConfig = {
        overrideConfigs: [{
          field: { matchBy: "name", value: "field1" },
          config: [{ type: "unit", value: { unit: "bytes", customUnit: "" } }]
        }]
      };

      wrapper = createWrapper({ overrideConfig: existingConfig });

      // Modify the config
      wrapper.vm.overrideConfigs[0].field.value = "field2";

      // Close popup
      wrapper.vm.closePopup();

      // Should be reset to original value
      expect(wrapper.vm.overrideConfigs[0].field.value).toBe("field1");
    });
  });

  describe("Props Validation", () => {
    it("should accept valid columns prop", () => {
      const validColumns = [
        { label: "Field 1", alias: "field1" },
        { label: "Field 2", alias: "field2" }
      ];

      expect(() => {
        wrapper = createWrapper({ columns: validColumns });
      }).not.toThrow();
    });

    it("should validate columns prop format", () => {
      const validator = OverrideConfigPopup.props.columns.validator;

      // Valid format
      expect(validator([{ label: "Field 1", alias: "field1" }])).toBe(true);

      // Invalid format
      expect(validator([{ label: "Field 1" }])).toBe(false);
      expect(validator([{ alias: "field1" }])).toBe(false);
    });

    it("should accept valid override config prop", () => {
      const validConfig = {
        overrideConfigs: [{
          field: { matchBy: "name", value: "field1" },
          config: [{ type: "unit", value: { unit: "bytes", customUnit: "" } }]
        }]
      };

      expect(() => {
        wrapper = createWrapper({ overrideConfig: validConfig });
      }).not.toThrow();
    });
  });

  describe("Component Behavior", () => {
    it("should handle component mounting without errors", () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it("should handle component unmounting without errors", () => {
      wrapper = createWrapper();
      
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });

    it("should maintain reactive state", async () => {
      wrapper = createWrapper();

      const initialCount = wrapper.vm.overrideConfigs.length;
      wrapper.vm.overrideConfigs[0].field.value = "field1";

      expect(wrapper.vm.overrideConfigs[0].field.value).toBe("field1");
      expect(wrapper.vm.overrideConfigs.length).toBe(initialCount);
    });
  });

  describe("Edge Cases", () => {
    it("should handle undefined/null config values", () => {
      const configWithNulls = {
        overrideConfigs: [{
          field: { matchBy: null, value: null },
          config: [{ type: null, value: null }]
        }]
      };

      expect(() => {
        wrapper = createWrapper({ overrideConfig: configWithNulls });
      }).not.toThrow();
    });

    it("should handle empty overrideConfigs", () => {
      const emptyConfig = { overrideConfigs: [] };

      wrapper = createWrapper({ overrideConfig: emptyConfig });
      
      // Should create default config
      expect(wrapper.vm.overrideConfigs).toHaveLength(1);
    });

    it("should handle malformed config structure", () => {
      const malformedConfig = {
        overrideConfigs: [{}] // Empty config object
      };

      expect(() => {
        wrapper = createWrapper({ overrideConfig: malformedConfig });
      }).not.toThrow();
    });
  });

  describe("State Management", () => {
    it("should handle rapid state changes", () => {
      wrapper = createWrapper();

      expect(() => {
        wrapper.vm.addOverrideConfig();
        wrapper.vm.addOverrideConfig();
        wrapper.vm.removeOverrideConfig(1);
        wrapper.vm.addOverrideConfig();
      }).not.toThrow();

      expect(wrapper.vm.overrideConfigs.length).toBeGreaterThan(0);
    });

    it("should preserve state during operations", () => {
      wrapper = createWrapper();

      wrapper.vm.overrideConfigs[0].field.value = "field1";
      wrapper.vm.overrideConfigs[0].config[0].type = "unit";

      wrapper.vm.addOverrideConfig();

      // Original config should be preserved
      expect(wrapper.vm.overrideConfigs[0].field.value).toBe("field1");
      expect(wrapper.vm.overrideConfigs[0].config[0].type).toBe("unit");
    });
  });

  describe("Internationalization", () => {
    it("should use translation function", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.t).toBeTypeOf("function");
    });

    it("should have translated labels in unit options", () => {
      wrapper = createWrapper();

      const unitOptions = wrapper.vm.unitOptions;
      expect(unitOptions.length).toBeGreaterThan(0);
      expect(unitOptions.every((option: any) => typeof option.label === 'string')).toBe(true);
    });
  });

  describe("Data Normalization", () => {
    it("should initialize with existing configs", () => {
      const existingConfig = {
        overrideConfigs: [{
          field: { matchBy: "name", value: "field1" },
          config: [{ type: "unit", value: { unit: "bytes", customUnit: "" } }]
        }]
      };

      wrapper = createWrapper({ overrideConfig: existingConfig });

      expect(wrapper.vm.overrideConfigs).toHaveLength(1);
      expect(wrapper.vm.overrideConfigs[0].field.value).toBe("field1");
      expect(wrapper.vm.overrideConfigs[0].config[0].type).toBe("unit");
    });

    it("should normalize unique_value_color configs", () => {
      const existingConfig = {
        overrideConfigs: [{
          field: { matchBy: "name", value: "field1" },
          config: [{ type: "unique_value_color", autoColor: true }]
        }]
      };

      wrapper = createWrapper({ overrideConfig: existingConfig });

      expect(wrapper.vm.overrideConfigs[0].config[0].type).toBe("unique_value_color");
      expect(wrapper.vm.overrideConfigs[0].config[0].autoColor).toBe(true);
    });
  });

  describe("Component Methods", () => {
    it("should have all required methods", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.closePopup).toBeTypeOf("function");
      expect(wrapper.vm.addOverrideConfig).toBeTypeOf("function");
      expect(wrapper.vm.removeOverrideConfig).toBeTypeOf("function");
      expect(wrapper.vm.saveOverrides).toBeTypeOf("function");
      expect(wrapper.vm.onConfigTypeChange).toBeTypeOf("function");
      expect(wrapper.vm.getFieldDisplayValue).toBeTypeOf("function");
    });

    it("should execute methods without errors", () => {
      wrapper = createWrapper();

      expect(() => {
        wrapper.vm.getFieldDisplayValue("field1");
        wrapper.vm.onConfigTypeChange(0);
      }).not.toThrow();
    });
  });
});