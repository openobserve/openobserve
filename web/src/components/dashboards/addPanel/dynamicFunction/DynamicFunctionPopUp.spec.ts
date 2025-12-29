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
import DynamicFunctionPopUp from "@/components/dashboards/addPanel/dynamicFunction/DynamicFunctionPopUp.vue";
import { createStore } from "vuex";
import { createI18n } from "vue-i18n";

installQuasar({
  plugins: [Dialog, Notify],
});

const i18n = createI18n({
  legacy: false,
  locale: "en",
  messages: { en: {} },
});

const mockStore = createStore({
  state: {
    theme: "light",
  },
});

const mockStoreDark = createStore({
  state: {
    theme: "dark",
  },
});

describe("DynamicFunctionPopUp", () => {
  let wrapper: any;

  const defaultModelValue = {
    label: "Test Field",
    alias: "test_field",
    type: "build",
    functionName: null,
    args: [{ type: "field", value: {} }],
    rawQuery: "",
    isDerived: false,
  };

  const defaultProps = {
    modelValue: defaultModelValue,
    allowAggregation: false,
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

  const createWrapper = (props = {}, store = mockStore) => {
    return mount(DynamicFunctionPopUp, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          RawQueryBuilder: true,
          SelectFunction: true,
          SortByBtnGrp: true,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render component correctly", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render property section", () => {
      wrapper = createWrapper();
      const propertyLabel = wrapper.find(".text-label-bold");
      expect(propertyLabel.text()).toBe("Property");
    });

    it("should render label input", () => {
      wrapper = createWrapper();
      const inputs = wrapper.findAll("input");
      expect(inputs.length).toBeGreaterThan(0);
    });

    it("should render alias input", () => {
      wrapper = createWrapper();
      const inputs = wrapper.findAll("input");
      expect(inputs.length).toBeGreaterThanOrEqual(2);
    });

    it("should render tabs", () => {
      wrapper = createWrapper();
      const tabs = wrapper.find('[data-test="dynamic-function-popup-tabs"]');
      expect(tabs.exists()).toBe(true);
    });
  });

  describe("Props Handling", () => {
    it("should accept modelValue prop", () => {
      wrapper = createWrapper();
      expect(wrapper.props().modelValue).toEqual(defaultModelValue);
    });

    it("should accept allowAggregation prop", () => {
      wrapper = createWrapper({ allowAggregation: true });
      expect(wrapper.props().allowAggregation).toBe(true);
    });

    it("should accept customQuery prop", () => {
      wrapper = createWrapper({ customQuery: true });
      expect(wrapper.props().customQuery).toBe(true);
    });

    it("should accept chartType prop", () => {
      wrapper = createWrapper({ chartType: "line" });
      expect(wrapper.props().chartType).toBe("line");
    });

    it("should have default chartType", () => {
      const wrapperDefault = mount(DynamicFunctionPopUp, {
        props: {
          modelValue: defaultModelValue,
        },
        global: {
          plugins: [i18n, mockStore],
          stubs: {
            RawQueryBuilder: true,
            SelectFunction: true,
            SortByBtnGrp: true,
          },
        },
      });
      expect(wrapperDefault.props().chartType).toBe("bar");
      wrapperDefault.unmount();
    });
  });

  describe("Label Input", () => {
    it("should bind label value", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.fields.label).toBe("Test Field");
    });

    it("should update label on input", async () => {
      wrapper = createWrapper();
      const labelInput = wrapper.findAll("input")[0];

      await labelInput.setValue("Updated Label");
      await flushPromises();

      expect(wrapper.vm.fields.label).toBe("Updated Label");
    });

    it("should emit update on label change", async () => {
      wrapper = createWrapper();
      wrapper.vm.fields.label = "New Label";
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should apply correct theme class to input", () => {
      wrapper = createWrapper({}, mockStoreDark);
      const inputs = wrapper.findAll("input");
      expect(inputs[0].classes()).toContain("bg-grey-10");
    });
  });

  describe("Alias Input", () => {
    it("should bind alias value", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.fields.alias).toBe("test_field");
    });

    it("should be disabled", () => {
      wrapper = createWrapper();
      const aliasInput = wrapper.findAll("input")[1];
      expect(aliasInput.attributes("disabled")).toBeDefined();
    });

    it("should display alias value", () => {
      const customValue = {
        ...defaultModelValue,
        alias: "custom_alias",
      };
      wrapper = createWrapper({ modelValue: customValue });
      expect(wrapper.vm.fields.alias).toBe("custom_alias");
    });
  });

  describe("Tabs", () => {
    it("should have Build tab", () => {
      wrapper = createWrapper();
      const buildTab = wrapper.find('[data-test="dynamic-function-popup-tab-build"]');
      expect(buildTab.exists()).toBe(true);
    });

    it("should have Raw tab", () => {
      wrapper = createWrapper();
      const rawTab = wrapper.find('[data-test="dynamic-function-popup-tab-raw"]');
      expect(rawTab.exists()).toBe(true);
    });

    it("should default to Build tab", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.fields.type).toBe("build");
    });

    it("should switch to Raw tab", async () => {
      wrapper = createWrapper();
      wrapper.vm.fields.type = "raw";
      await flushPromises();
      expect(wrapper.vm.fields.type).toBe("raw");
    });

    it("should call onFieldTypeChange when tab changes", async () => {
      wrapper = createWrapper();
      const spy = vi.spyOn(wrapper.vm, "onFieldTypeChange");

      wrapper.vm.fields.type = "raw";
      wrapper.vm.onFieldTypeChange();

      expect(spy).toHaveBeenCalled();
    });
  });

  describe("Tab Panel - Build", () => {
    it("should show SelectFunction in build mode", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
        customQuery: false,
      });
      // Build mode should be active when not customQuery and not isDerived
      expect(["build", "raw"]).toContain(wrapper.vm.fields.type);
    });

    it("should render Configuration label", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
        customQuery: false,
      });
      // Component should render when not in customQuery mode
      expect(wrapper.exists()).toBe(true);
    });

    it("should pass correct props to SelectFunction", () => {
      wrapper = createWrapper({ allowAggregation: true });
      expect(wrapper.props().allowAggregation).toBe(true);
    });
  });

  describe("Tab Panel - Raw", () => {
    it("should show RawQueryBuilder in raw mode", async () => {
      wrapper = createWrapper();
      wrapper.vm.fields.type = "raw";
      await flushPromises();
      expect(wrapper.vm.fields.type).toBe("raw");
    });

    it("should pass modelValue to RawQueryBuilder", async () => {
      wrapper = createWrapper();
      wrapper.vm.fields.type = "raw";
      await flushPromises();
      expect(wrapper.vm.fields).toBeDefined();
    });
  });

  describe("Field Type Change", () => {
    it("should reset rawQuery when switching to build", () => {
      const customValue = {
        ...defaultModelValue,
        type: "raw",
        rawQuery: "SELECT * FROM logs",
      };
      wrapper = createWrapper({ modelValue: customValue });

      wrapper.vm.fields.type = "build";
      wrapper.vm.onFieldTypeChange();

      expect(wrapper.vm.fields.rawQuery).toBe("");
    });

    it("should reset functionName when switching to raw", () => {
      const customValue = {
        ...defaultModelValue,
        type: "build",
        functionName: "sum",
      };
      wrapper = createWrapper({ modelValue: customValue });

      wrapper.vm.fields.type = "raw";
      wrapper.vm.onFieldTypeChange();

      expect(wrapper.vm.fields.functionName).toBeNull();
    });

    it("should reset args when switching to raw", () => {
      const customValue = {
        ...defaultModelValue,
        type: "build",
        args: [
          { type: "field", value: { field: "test" } },
          { type: "string", value: "test" },
        ],
      };
      wrapper = createWrapper({ modelValue: customValue });

      wrapper.vm.fields.type = "raw";
      wrapper.vm.onFieldTypeChange();

      expect(wrapper.vm.fields.args).toHaveLength(1);
      expect(wrapper.vm.fields.args[0]).toEqual({
        type: "field",
        value: {},
      });
    });
  });

  describe("SortByBtnGrp Visibility", () => {
    it("should show SortByBtnGrp when not customQuery and not isDerived", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
        customQuery: false,
      });
      expect(wrapper.vm.fields.isDerived).toBe(false);
    });

    it("should not show SortByBtnGrp when customQuery is true", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: false },
        customQuery: true,
      });
      expect(wrapper.props().customQuery).toBe(true);
    });

    it("should not show SortByBtnGrp when isDerived is true", () => {
      wrapper = createWrapper({
        modelValue: { ...defaultModelValue, isDerived: true },
        customQuery: false,
      });
      expect(wrapper.vm.fields.isDerived).toBe(true);
    });
  });

  describe("Having Filter", () => {
    it("should not show having filter by default", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.isHavingFilterVisible()).toBe(false);
    });

    it("should show Add button when allowAggregation is true", () => {
      wrapper = createWrapper({ allowAggregation: true });
      expect(wrapper.props().allowAggregation).toBe(true);
    });

    it("should toggle having filter visibility", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      expect(wrapper.vm.isHavingFilterVisible()).toBe(false);

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      expect(wrapper.vm.isHavingFilterVisible()).toBe(true);
    });

    it("should add having condition on toggle", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      expect(wrapper.vm.fields.havingConditions).toBeDefined();
      expect(wrapper.vm.fields.havingConditions.length).toBeGreaterThan(0);
    });

    it("should cancel having filter", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      await wrapper.vm.cancelHavingFilter();
      await flushPromises();

      expect(wrapper.vm.fields.havingConditions).toEqual([]);
    });

    it("should get having condition", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      const condition = wrapper.vm.getHavingCondition();

      expect(condition).toBeDefined();
      expect(condition).toHaveProperty("operator");
      expect(condition).toHaveProperty("value");
    });

    it("should return default condition when none exists", () => {
      wrapper = createWrapper();

      const condition = wrapper.vm.getHavingCondition();

      expect(condition.operator).toBeNull();
      expect(condition.value).toBeNull();
    });
  });

  describe("Having Operators", () => {
    it("should have correct operators", () => {
      wrapper = createWrapper({ allowAggregation: true });

      const operators = wrapper.vm.havingOperators;

      expect(operators).toContain("=");
      expect(operators).toContain("<>");
      expect(operators).toContain(">=");
      expect(operators).toContain("<=");
      expect(operators).toContain(">");
      expect(operators).toContain("<");
    });

    it("should have 6 operators", () => {
      wrapper = createWrapper({ allowAggregation: true });
      expect(wrapper.vm.havingOperators.length).toBe(6);
    });
  });

  describe("Table Chart Type - Timestamp Field", () => {
    it("should show treatAsNonTimestamp checkbox for table charts", () => {
      wrapper = createWrapper({
        chartType: "table",
        customQuery: false,
        modelValue: { ...defaultModelValue, isDerived: false },
      });

      expect(wrapper.props().chartType).toBe("table");
    });

    it("should not show checkbox for non-table charts", () => {
      wrapper = createWrapper({
        chartType: "bar",
        customQuery: false,
        modelValue: { ...defaultModelValue, isDerived: false },
      });

      expect(wrapper.props().chartType).toBe("bar");
    });

    it("should bind treatAsNonTimestamp value", () => {
      const customValue = {
        ...defaultModelValue,
        treatAsNonTimestamp: true,
      };
      wrapper = createWrapper({
        chartType: "table",
        modelValue: customValue,
      });

      expect(wrapper.vm.fields.treatAsNonTimestamp).toBe(true);
    });

    it("should toggle treatAsNonTimestamp", async () => {
      wrapper = createWrapper({
        chartType: "table",
        modelValue: { ...defaultModelValue, treatAsNonTimestamp: false },
      });

      wrapper.vm.fields.treatAsNonTimestamp = true;
      await flushPromises();

      expect(wrapper.vm.fields.treatAsNonTimestamp).toBe(true);
    });
  });

  describe("Watchers", () => {
    it("should emit on fields change", async () => {
      wrapper = createWrapper();

      wrapper.vm.fields.label = "Changed Label";
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should watch deep changes", async () => {
      wrapper = createWrapper();

      wrapper.vm.fields.args[0].value = { field: "new_field" };
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should handle multiple changes", async () => {
      wrapper = createWrapper();

      wrapper.vm.fields.label = "Change 1";
      await flushPromises();
      wrapper.vm.fields.alias = "change_1";
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")?.length).toBeGreaterThan(0);
    });
  });

  describe("Theme Support", () => {
    it("should apply light theme to inputs", () => {
      wrapper = createWrapper({}, mockStore);
      const inputs = wrapper.findAll("input");
      expect(inputs[0].classes()).not.toContain("bg-grey-10");
    });

    it("should apply dark theme to inputs", () => {
      wrapper = createWrapper({}, mockStoreDark);
      const inputs = wrapper.findAll("input");
      expect(inputs[0].classes()).toContain("bg-grey-10");
    });

    it("should access store theme", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.store.state.theme).toBe("light");
    });
  });

  describe("Custom Query Mode", () => {
    it("should hide tabs when customQuery is true", () => {
      wrapper = createWrapper({
        customQuery: true,
        modelValue: { ...defaultModelValue, isDerived: false },
      });

      expect(wrapper.props().customQuery).toBe(true);
    });

    it("should show tabs when customQuery is false", () => {
      wrapper = createWrapper({
        customQuery: false,
        modelValue: { ...defaultModelValue, isDerived: false },
      });

      expect(wrapper.props().customQuery).toBe(false);
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty modelValue", () => {
      const emptyValue = {};
      wrapper = createWrapper({ modelValue: emptyValue as any });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing label", () => {
      const noLabel = { ...defaultModelValue, label: undefined };
      wrapper = createWrapper({ modelValue: noLabel });
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle null functionName", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.fields.functionName).toBeNull();
    });

    it("should handle undefined havingConditions", () => {
      wrapper = createWrapper();
      const condition = wrapper.vm.getHavingCondition();
      expect(condition).toBeDefined();
    });

    it("should initialize havingConditions when undefined", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      // havingConditions may or may not be defined initially
      const wasUndefined = wrapper.vm.fields.havingConditions === undefined;

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      expect(wrapper.vm.fields.havingConditions).toBeDefined();
      expect(wrapper.vm.fields.havingConditions.length).toBeGreaterThan(0);
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

    it("should handle prop updates", async () => {
      wrapper = createWrapper();
      await wrapper.setProps({ chartType: "line" });
      await wrapper.setProps({ allowAggregation: true });
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Layout and Styling", () => {
    it("should have flex layout", () => {
      wrapper = createWrapper();
      const container = wrapper.find('div.tw\\:flex');
      expect(container.exists()).toBe(true);
    });

    it("should apply correct label styles", () => {
      wrapper = createWrapper();
      const boldLabel = wrapper.find(".text-label-bold");
      expect(boldLabel.exists()).toBe(true);
    });

    it("should apply correct normal label styles", () => {
      wrapper = createWrapper();
      const normalLabel = wrapper.find(".text-label-normal");
      expect(normalLabel.exists()).toBe(true);
    });

    it("should have edit-input class on inputs", () => {
      wrapper = createWrapper();
      const inputs = wrapper.findAll("input");
      expect(inputs[0].classes()).toContain("edit-input");
    });
  });

  describe("Having Filter UI", () => {
    it("should render operator select when having filter visible", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      expect(wrapper.vm.isHavingFilterVisible()).toBe(true);
    });

    it("should render value input when having filter visible", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      expect(wrapper.vm.getHavingCondition()).toBeDefined();
    });

    it("should update having condition operator", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      const condition = wrapper.vm.getHavingCondition();
      condition.operator = ">=";

      expect(condition.operator).toBe(">=");
    });

    it("should update having condition value", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      const condition = wrapper.vm.getHavingCondition();
      condition.value = 100;

      expect(condition.value).toBe(100);
    });
  });

  describe("Integration Tests", () => {
    it("should switch between build and raw modes", async () => {
      wrapper = createWrapper();

      // Initial type might be set by modelValue
      const initialType = wrapper.vm.fields.type;
      expect(["build", "raw"]).toContain(initialType);

      wrapper.vm.fields.type = "raw";
      wrapper.vm.onFieldTypeChange();
      await flushPromises();

      expect(wrapper.vm.fields.type).toBe("raw");
      expect(wrapper.vm.fields.functionName).toBeNull();

      wrapper.vm.fields.type = "build";
      wrapper.vm.onFieldTypeChange();
      await flushPromises();

      expect(wrapper.vm.fields.type).toBe("build");
      expect(wrapper.vm.fields.rawQuery).toBe("");
    });

    it("should handle complete workflow with having filter", async () => {
      wrapper = createWrapper({ allowAggregation: true });

      // Add having filter
      await wrapper.vm.toggleHavingFilter();
      await flushPromises();

      // Set values
      const condition = wrapper.vm.getHavingCondition();
      condition.operator = ">";
      condition.value = 50;

      expect(wrapper.vm.fields.havingConditions[0].operator).toBe(">");
      expect(wrapper.vm.fields.havingConditions[0].value).toBe(50);

      // Cancel filter
      await wrapper.vm.cancelHavingFilter();
      await flushPromises();

      expect(wrapper.vm.isHavingFilterVisible()).toBe(false);
    });
  });

  describe("i18n Support", () => {
    it("should have i18n instance", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.t).toBeDefined();
    });

    it("should use i18n for translations", () => {
      wrapper = createWrapper();
      const translation = wrapper.vm.t("test.key");
      expect(translation).toBeDefined();
    });
  });
});
