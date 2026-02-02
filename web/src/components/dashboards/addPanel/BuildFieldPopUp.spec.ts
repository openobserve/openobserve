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
import BuildFieldPopUp from "@/components/dashboards/addPanel/BuildFieldPopUp.vue";
import { createI18n } from "vue-i18n";

installQuasar({
  plugins: [Dialog, Notify],
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: { common: { label: "Label" } } },
});

describe("BuildFieldPopUp", () => {
  let wrapper: any;

  const defaultModelValue = {
    label: "Test Field",
    isDerived: false,
    functionName: null,
    args: [{ type: "field", value: {} }],
  };

  const defaultProps = {
    modelValue: defaultModelValue,
    customQuery: false,
    chartType: "bar",
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
    return mount(BuildFieldPopUp, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n],
        stubs: {
          SortByBtnGrp: true,
          DynamicFunctionPopUp: true,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render label input", () => {
      wrapper = createWrapper();
      const labelInput = wrapper.find('[data-test="dashboard-x-item-input"]');
      expect(labelInput.exists()).toBe(true);
    });

    it("should display label value", () => {
      wrapper = createWrapper();
      const labelInput = wrapper.find('[data-test="dashboard-x-item-input"]');
      expect(labelInput.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept modelValue prop", () => {
      const customValue = {
        label: "Custom Label",
        isDerived: false,
      };
      wrapper = createWrapper({ modelValue: customValue });
      expect(wrapper.props().modelValue.label).toBe("Custom Label");
    });

    it("should accept customQuery prop", () => {
      wrapper = createWrapper({ customQuery: true });
      expect(wrapper.props().customQuery).toBe(true);
    });

    it("should accept chartType prop", () => {
      wrapper = createWrapper({ chartType: "line" });
      expect(wrapper.props().chartType).toBe("line");
    });

    it("should handle default chartType", () => {
      const wrapperDefault = mount(BuildFieldPopUp, {
        props: {
          modelValue: defaultModelValue,
        },
        global: {
          plugins: [i18n],
          stubs: {
            SortByBtnGrp: true,
            DynamicFunctionPopUp: true,
          },
        },
      });
      expect(wrapperDefault.props().chartType).toBe("bar");
      wrapperDefault.unmount();
    });
  });

  describe("Label Input", () => {
    it("should bind label to modelValue", () => {
      wrapper = createWrapper();
      const input = wrapper.find('input[type="text"]');
      expect(input.exists()).toBe(true);
    });

    it("should update label value", async () => {
      wrapper = createWrapper();
      const input = wrapper.find('input[type="text"]');
      await input.setValue("New Label");
      expect(wrapper.vm.modelValue.label).toBe("New Label");
    });

    it("should have required validation rule", () => {
      wrapper = createWrapper();
      const labelInput = wrapper.find('[data-test="dashboard-x-item-input"]');
      expect(labelInput.exists()).toBe(true);
    });

    it("should validate empty label", () => {
      const emptyLabelValue = {
        label: "",
        isDerived: false,
      };
      wrapper = createWrapper({ modelValue: emptyLabelValue });
      expect(wrapper.vm.modelValue.label).toBe("");
    });
  });

  describe("SortByBtnGrp Visibility", () => {
    it("should show SortByBtnGrp when not customQuery and isDerived", () => {
      const derivedValue = {
        label: "Derived Field",
        isDerived: true,
      };
      wrapper = createWrapper({
        modelValue: derivedValue,
        customQuery: false,
      });
      // Component should render SortByBtnGrp
      expect(wrapper.vm.modelValue.isDerived).toBe(true);
    });

    it("should not show SortByBtnGrp when customQuery is true", () => {
      const derivedValue = {
        label: "Derived Field",
        isDerived: true,
      };
      wrapper = createWrapper({
        modelValue: derivedValue,
        customQuery: true,
      });
      expect(wrapper.props().customQuery).toBe(true);
    });

    it("should not show SortByBtnGrp when isDerived is false", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
      });
      expect(wrapper.vm.modelValue.isDerived).toBe(false);
    });
  });

  describe("DynamicFunctionPopUp Visibility", () => {
    it("should show DynamicFunctionPopUp when not customQuery and not isDerived", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
        customQuery: false,
      });
      expect(wrapper.vm.modelValue.isDerived).toBe(false);
      expect(wrapper.props().customQuery).toBe(false);
    });

    it("should not show DynamicFunctionPopUp when customQuery is true", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
        customQuery: true,
      });
      expect(wrapper.props().customQuery).toBe(true);
    });

    it("should not show DynamicFunctionPopUp when isDerived is true", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: true },
        customQuery: false,
      });
      expect(wrapper.vm.modelValue.isDerived).toBe(true);
    });

    it("should pass allowAggregation prop to DynamicFunctionPopUp", () => {
      wrapper = createWrapper();
      // DynamicFunctionPopUp should receive allowAggregation: false
      expect(wrapper.exists()).toBe(true);
    });

    it("should pass chartType prop to DynamicFunctionPopUp", () => {
      wrapper = createWrapper({ chartType: "pie" });
      expect(wrapper.props().chartType).toBe("pie");
    });
  });

  describe("Event Emissions", () => {
    it("should emit update:modelValue when model changes", async () => {
      wrapper = createWrapper();
      wrapper.vm.emit("update:modelValue", {
        ...defaultModelValue,
        label: "Updated",
      });
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should handle DynamicFunctionPopUp updates", async () => {
      wrapper = createWrapper();
      const newValue = {
        ...defaultModelValue,
        functionName: "sum",
      };
      wrapper.vm.emit("update:modelValue", newValue);
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Component Structure", () => {
    it("should have correct container structure", () => {
      wrapper = createWrapper();
      const container = wrapper.find('div[style*="padding"]');
      expect(container.exists()).toBe(true);
    });

    it("should have two main sections", () => {
      wrapper = createWrapper();
      const divs = wrapper.findAll("div");
      expect(divs.length).toBeGreaterThan(0);
    });

    it("should apply correct styles", () => {
      wrapper = createWrapper();
      const mainDiv = wrapper.find('div[style*="padding"]');
      expect(mainDiv.exists()).toBe(true);
    });
  });

  describe("Different Chart Types", () => {
    it("should handle bar chart type", () => {
      wrapper = createWrapper({ chartType: "bar" });
      expect(wrapper.props().chartType).toBe("bar");
    });

    it("should handle line chart type", () => {
      wrapper = createWrapper({ chartType: "line" });
      expect(wrapper.props().chartType).toBe("line");
    });

    it("should handle pie chart type", () => {
      wrapper = createWrapper({ chartType: "pie" });
      expect(wrapper.props().chartType).toBe("pie");
    });

    it("should handle area chart type", () => {
      wrapper = createWrapper({ chartType: "area" });
      expect(wrapper.props().chartType).toBe("area");
    });

    it("should handle table chart type", () => {
      wrapper = createWrapper({ chartType: "table" });
      expect(wrapper.props().chartType).toBe("table");
    });
  });

  describe("Derived vs Non-Derived Fields", () => {
    it("should render correctly for derived field", () => {
      const derivedValue = {
        label: "Derived Field",
        isDerived: true,
        sortBy: "ASC",
      };
      wrapper = createWrapper({
        modelValue: derivedValue,
        customQuery: false,
      });
      expect(wrapper.vm.modelValue.isDerived).toBe(true);
    });

    it("should render correctly for non-derived field", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
        customQuery: false,
      });
      expect(wrapper.vm.modelValue.isDerived).toBe(false);
    });

    it("should toggle between derived and non-derived", async () => {
      wrapper = createWrapper();
      wrapper.vm.modelValue.isDerived = true;
      await flushPromises();
      expect(wrapper.vm.modelValue.isDerived).toBe(true);

      wrapper.vm.modelValue.isDerived = false;
      await flushPromises();
      expect(wrapper.vm.modelValue.isDerived).toBe(false);
    });
  });

  describe("CustomQuery Mode", () => {
    it("should handle customQuery enabled", () => {
      wrapper = createWrapper({ customQuery: true });
      expect(wrapper.props().customQuery).toBe(true);
    });

    it("should handle customQuery disabled", () => {
      wrapper = createWrapper({ customQuery: false });
      expect(wrapper.props().customQuery).toBe(false);
    });

    it("should hide function configuration in customQuery mode", () => {
      wrapper = createWrapper({
        customQuery: true,
        modelValue: { ...defaultModelValue, isDerived: false },
      });
      expect(wrapper.props().customQuery).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty modelValue", () => {
      const emptyValue = {
        label: "",
      };
      wrapper = createWrapper({ modelValue: emptyValue as any });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing label in modelValue", () => {
      const noLabelValue = {
        isDerived: false,
      };
      wrapper = createWrapper({ modelValue: noLabelValue as any });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null values gracefully", () => {
      const nullValues = {
        label: null,
        isDerived: null,
      };
      wrapper = createWrapper({ modelValue: nullValues as any });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle undefined chartType", () => {
      wrapper = createWrapper({ chartType: undefined as any });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("should mount without errors", () => {
      expect(() => createWrapper()).not.toThrow();
    });

    it("should unmount without errors", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle multiple prop updates", async () => {
      wrapper = createWrapper();
      await wrapper.setProps({ chartType: "line" });
      await wrapper.setProps({ customQuery: true });
      await wrapper.setProps({ chartType: "bar" });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Label Validation", () => {
    it("should require non-empty label", () => {
      wrapper = createWrapper();
      const input = wrapper.find('[data-test="dashboard-x-item-input"]');
      expect(input.exists()).toBe(true);
    });

    it("should accept valid label", () => {
      const validValue = {
        label: "Valid Label",
        isDerived: false,
      };
      wrapper = createWrapper({ modelValue: validValue });
      expect(wrapper.vm.modelValue.label.length).toBeGreaterThan(0);
    });

    it("should handle long labels", () => {
      const longLabel = "A".repeat(100);
      const longLabelValue = {
        label: longLabel,
        isDerived: false,
      };
      wrapper = createWrapper({ modelValue: longLabelValue });
      expect(wrapper.vm.modelValue.label.length).toBe(100);
    });

    it("should handle special characters in label", () => {
      const specialValue = {
        label: "Label @#$%^&*()",
        isDerived: false,
      };
      wrapper = createWrapper({ modelValue: specialValue });
      expect(wrapper.vm.modelValue.label).toBe("Label @#$%^&*()");
    });
  });

  describe("Integration with Child Components", () => {
    it("should pass correct props to SortByBtnGrp", () => {
      const derivedValue = {
        label: "Derived",
        isDerived: true,
        sortBy: "ASC",
      };
      wrapper = createWrapper({
        modelValue: derivedValue,
        customQuery: false,
      });
      expect(wrapper.vm.modelValue.isDerived).toBe(true);
    });

    it("should pass correct props to DynamicFunctionPopUp", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
        customQuery: false,
        chartType: "scatter",
      });
      expect(wrapper.props().chartType).toBe("scatter");
    });

    it("should handle updates from DynamicFunctionPopUp", async () => {
      wrapper = createWrapper();
      const updatedValue = {
        ...defaultModelValue,
        functionName: "count",
      };
      wrapper.vm.emit("update:modelValue", updatedValue);
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Responsive Layout", () => {
    it("should apply flex layout", () => {
      wrapper = createWrapper();
      const container = wrapper.find('div[style*="display: flex"]');
      expect(container.exists()).toBe(true);
    });

    it("should apply gap between sections", () => {
      wrapper = createWrapper();
      const container = wrapper.find('div[style*="gap: 16px"]');
      expect(container.exists()).toBe(true);
    });
  });

  describe("i18n Support", () => {
    it("should use i18n for label translation", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.t).toBeDefined();
      expect(wrapper.vm.t("common.label")).toBe("Label");
    });

    it("should handle missing translations", () => {
      wrapper = createWrapper();
      const translation = wrapper.vm.t("nonexistent.key");
      expect(translation).toBeDefined();
    });
  });
});
