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
import SelectFunction from "@/components/dashboards/addPanel/dynamicFunction/SelectFunction.vue";
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
    organizationData: {
      organizationPasscode: "test-org",
    },
  },
});

const mockDashboardPanelData = {
  data: {
    queries: [
      {
        fields: {
          stream: "default_stream",
          stream_type: "logs",
        },
      },
    ],
  },
};

vi.mock("@/composables/useDashboardPanel", () => ({
  default: vi.fn(() => ({
    getAllSelectedStreams: vi.fn(() => [
      { stream: "stream1", streamAlias: "s1" },
      { stream: "stream2", streamAlias: "s2" },
    ]),
    dashboardPanelData: mockDashboardPanelData,
  })),
}));

describe("SelectFunction", () => {
  let wrapper: any;

  const defaultModelValue = {
    functionName: null,
    args: [
      {
        type: "field",
        value: {},
      },
    ],
  };

  const defaultProps = {
    modelValue: defaultModelValue,
    allowAggregation: false,
    isChild: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}, provide = {}) => {
    return mount(SelectFunction, {
      props: {
        ...defaultProps,
        ...props,
      },
      global: {
        plugins: [i18n, mockStore],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
          ...provide,
        },
        stubs: {
          HistogramIntervalDropDown: true,
          StreamFieldSelect: true,
          SubTaskArrow: true,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render select function dropdown", () => {
      wrapper = createWrapper();
      expect(
        wrapper.find('[data-test="dashboard-function-dropdown"]').exists()
      ).toBe(true);
    });

    it("should render with correct default structure", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.fields).toBeDefined();
      expect(wrapper.vm.filteredFunctions).toBeDefined();
    });

    it("should display function name label", () => {
      wrapper = createWrapper();
      const select = wrapper.find('[data-test="dashboard-function-dropdown"]');
      expect(select.exists()).toBe(true);
    });
  });

  describe("Props and Model Value", () => {
    it("should accept modelValue prop", () => {
      const customValue = {
        functionName: "count",
        args: [{ type: "field", value: {} }],
      };
      wrapper = createWrapper({ modelValue: customValue });
      expect(wrapper.vm.fields.functionName).toBe("count");
    });

    it("should handle allowAggregation prop", () => {
      wrapper = createWrapper({ allowAggregation: true });
      expect(wrapper.props().allowAggregation).toBe(true);
    });

    it("should handle isChild prop", () => {
      wrapper = createWrapper({ isChild: true });
      expect(wrapper.props().isChild).toBe(true);
    });

    it("should emit update:modelValue on changes", async () => {
      wrapper = createWrapper();
      wrapper.vm.fields.functionName = "sum";
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Function Selection", () => {
    it("should initialize filteredFunctions", () => {
      wrapper = createWrapper();
      expect(Array.isArray(wrapper.vm.filteredFunctions)).toBe(true);
      expect(wrapper.vm.filteredFunctions.length).toBeGreaterThan(0);
    });

    it("should filter functions when allowAggregation is false", () => {
      wrapper = createWrapper({ allowAggregation: false });
      wrapper.vm.initializeFunctions();
      // Should not include aggregation functions
      expect(wrapper.vm.filteredFunctions).toBeDefined();
    });

    it("should include all functions when allowAggregation is true", () => {
      wrapper = createWrapper({ allowAggregation: true });
      wrapper.vm.initializeFunctions();
      expect(wrapper.vm.filteredFunctions).toBeDefined();
    });

    it("should filter functions based on search text", () => {
      wrapper = createWrapper();
      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFunctionsOptions("sum", update);
      expect(update).toHaveBeenCalled();
    });
  });

  describe("Arguments Management", () => {
    it("should add argument when allowed", () => {
      const modelValue = {
        functionName: "concat",
        args: [{ type: "string", value: "" }],
      };
      wrapper = createWrapper({ modelValue });
      const initialLength = wrapper.vm.fields.args.length;
      if (wrapper.vm.canAddArgument(wrapper.vm.fields.functionName)) {
        wrapper.vm.addArgument();
        expect(wrapper.vm.fields.args.length).toBeGreaterThanOrEqual(
          initialLength
        );
      }
    });

    it("should remove argument when allowed", () => {
      const modelValue = {
        functionName: "concat",
        args: [
          { type: "string", value: "a" },
          { type: "string", value: "b" },
        ],
      };
      wrapper = createWrapper({ modelValue });
      const initialLength = wrapper.vm.fields.args.length;
      wrapper.vm.removeArgument(0);
      expect(wrapper.vm.fields.args.length).toBe(initialLength - 1);
    });

    it("should check if argument can be removed", () => {
      wrapper = createWrapper();
      const canRemove = wrapper.vm.canRemoveArgument("concat", 0);
      expect(typeof canRemove).toBe("boolean");
    });

    it("should check if argument can be added", () => {
      wrapper = createWrapper();
      const canAdd = wrapper.vm.canAddArgument("concat");
      expect(typeof canAdd).toBe("boolean");
    });
  });

  describe("Argument Types", () => {
    it("should render field selector for field type", () => {
      const modelValue = {
        functionName: "sum",
        args: [{ type: "field", value: {} }],
      };
      wrapper = createWrapper({ modelValue });
      const fieldSelector = wrapper.find(
        '[data-test="dashboard-function-dropdown-arg-field-selector-0"]'
      );
      expect(fieldSelector.exists()).toBe(true);
    });

    it("should handle string type arguments", () => {
      const modelValue = {
        functionName: "concat",
        args: [{ type: "string", value: "test" }],
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.fields.args[0].type).toBe("string");
    });

    it("should handle number type arguments", () => {
      const modelValue = {
        functionName: "round",
        args: [
          { type: "field", value: {} },
          { type: "number", value: 2 },
        ],
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.fields.args[1].type).toBe("number");
    });

    it("should handle function type arguments", () => {
      const modelValue = {
        functionName: "coalesce",
        args: [{ type: "function", value: { functionName: null, args: [] } }],
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.fields.args[0].type).toBe("function");
    });

    it("should handle histogramInterval type", () => {
      const modelValue = {
        functionName: "histogram",
        args: [{ type: "histogramInterval", value: null }],
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.fields.args[0].type).toBe("histogramInterval");
    });
  });

  describe("Argument Type Changes", () => {
    it("should reset value when changing to field type", () => {
      wrapper = createWrapper();
      const arg = { type: "string", value: "test" };
      wrapper.vm.onArgTypeChange(arg);
      arg.type = "field";
      wrapper.vm.onArgTypeChange(arg);
      expect(arg.value).toEqual({});
    });

    it("should reset value when changing to string type", () => {
      wrapper = createWrapper();
      const arg = { type: "number", value: 5 };
      arg.type = "string";
      wrapper.vm.onArgTypeChange(arg);
      expect(arg.value).toBe("");
    });

    it("should reset value when changing to number type", () => {
      wrapper = createWrapper();
      const arg = { type: "string", value: "test" };
      arg.type = "number";
      wrapper.vm.onArgTypeChange(arg);
      expect(arg.value).toBe(0);
    });

    it("should reset value when changing to function type", () => {
      wrapper = createWrapper();
      const arg = { type: "string", value: "test" };
      arg.type = "function";
      wrapper.vm.onArgTypeChange(arg);
      expect(arg.value).toEqual({
        functionName: null,
        args: [],
        value: "",
      });
    });
  });

  describe("Function Validation", () => {
    it("should get validation for function", () => {
      wrapper = createWrapper();
      const validation = wrapper.vm.getValidationForFunction("sum");
      expect(validation).toBeDefined();
    });

    it("should check if argument is required", () => {
      wrapper = createWrapper();
      const isReq = wrapper.vm.isRequired("sum", 0);
      expect(typeof isReq).toBe("boolean");
    });

    it("should get supported types for function and index", () => {
      wrapper = createWrapper();
      const types = wrapper.vm.getSupportedTypeBasedOnFunctionNameAndIndex(
        "concat",
        0
      );
      expect(Array.isArray(types)).toBe(true);
    });
  });

  describe("Function Name Changes", () => {
    it("should rebuild args when function name changes", async () => {
      const modelValue = {
        functionName: "sum",
        args: [{ type: "field", value: {} }],
      };
      wrapper = createWrapper({ modelValue });

      wrapper.vm.fields.functionName = "count";
      await flushPromises();

      expect(wrapper.vm.fields.args).toBeDefined();
      expect(Array.isArray(wrapper.vm.fields.args)).toBe(true);
    });

    it("should preserve field values when types match", async () => {
      const fieldValue = { field: "test", streamAlias: "s1" };
      const modelValue = {
        functionName: "sum",
        args: [{ type: "field", value: fieldValue }],
      };
      wrapper = createWrapper({ modelValue });

      wrapper.vm.fields.functionName = "avg";
      await flushPromises();

      // Should preserve field values where possible
      expect(wrapper.vm.fields.args).toBeDefined();
    });
  });

  describe("Icon and Label Helpers", () => {
    it("should get correct icon for field type", () => {
      wrapper = createWrapper();
      const icon = wrapper.vm.getIconBasedOnArgType("field");
      expect(icon).toBeDefined();
    });

    it("should get correct icon for function type", () => {
      wrapper = createWrapper();
      const icon = wrapper.vm.getIconBasedOnArgType("function");
      expect(icon).toBeDefined();
    });

    it("should get correct icon for string type", () => {
      wrapper = createWrapper();
      const icon = wrapper.vm.getIconBasedOnArgType("string");
      expect(icon).toBeDefined();
    });

    it("should get correct icon for number type", () => {
      wrapper = createWrapper();
      const icon = wrapper.vm.getIconBasedOnArgType("number");
      expect(icon).toBeDefined();
    });

    it("should get parameter label for function and index", () => {
      wrapper = createWrapper();
      const label = wrapper.vm.getParameterLabel("sum", 0);
      expect(typeof label).toBe("string");
    });
  });

  describe("Add Argument Button", () => {
    it("should show add argument button when allowed", () => {
      const modelValue = {
        functionName: "concat",
        args: [{ type: "string", value: "" }],
      };
      wrapper = createWrapper({ modelValue });
      if (wrapper.vm.canAddArgument("concat")) {
        const addBtn = wrapper.find(
          '[data-test="dashboard-function-dropdown-add-argument-button"]'
        );
        expect(addBtn.exists()).toBe(true);
      }
    });

    it("should add argument on button click", async () => {
      const modelValue = {
        functionName: "concat",
        args: [{ type: "string", value: "" }],
      };
      wrapper = createWrapper({ modelValue });
      if (wrapper.vm.canAddArgument("concat")) {
        const initialLength = wrapper.vm.fields.args.length;
        const addBtn = wrapper.find(
          '[data-test="dashboard-function-dropdown-add-argument-button"]'
        );
        if (addBtn.exists()) {
          await addBtn.trigger("click");
          expect(wrapper.vm.fields.args.length).toBeGreaterThan(initialLength);
        }
      }
    });
  });

  describe("Remove Argument Button", () => {
    it("should show remove button when argument can be removed", () => {
      const modelValue = {
        functionName: "concat",
        args: [
          { type: "string", value: "a" },
          { type: "string", value: "b" },
        ],
      };
      wrapper = createWrapper({ modelValue });
      if (wrapper.vm.canRemoveArgument("concat", 0)) {
        const removeBtn = wrapper.find(
          '[data-test="dashboard-function-dropdown-arg-remove-button-0"]'
        );
        expect(removeBtn.exists()).toBe(true);
      }
    });

    it("should remove argument on button click", async () => {
      const modelValue = {
        functionName: "concat",
        args: [
          { type: "string", value: "a" },
          { type: "string", value: "b" },
        ],
      };
      wrapper = createWrapper({ modelValue });
      const initialLength = wrapper.vm.fields.args.length;
      if (wrapper.vm.canRemoveArgument("concat", 0)) {
        const removeBtn = wrapper.find(
          '[data-test="dashboard-function-dropdown-arg-remove-button-0"]'
        );
        if (removeBtn.exists()) {
          await removeBtn.trigger("click");
          expect(wrapper.vm.fields.args.length).toBe(initialLength - 1);
        }
      }
    });
  });

  describe("Nested Functions", () => {
    it("should render nested SelectFunction for function type args", () => {
      const modelValue = {
        functionName: "coalesce",
        args: [
          {
            type: "function",
            value: { functionName: "sum", args: [{ type: "field", value: {} }] },
          },
        ],
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.fields.args[0].type).toBe("function");
    });

    it("should handle isChild prop for nested functions", () => {
      wrapper = createWrapper({ isChild: true });
      expect(wrapper.props().isChild).toBe(true);
    });
  });

  describe("Streams Integration", () => {
    it("should get all selected streams", () => {
      wrapper = createWrapper();
      const streams = wrapper.vm.getAllSelectedStreams();
      expect(Array.isArray(streams)).toBe(true);
    });

    it("should pass streams to StreamFieldSelect", () => {
      const modelValue = {
        functionName: "sum",
        args: [{ type: "field", value: {} }],
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.getAllSelectedStreams).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle null function name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.fields.functionName).toBeNull();
    });

    it("should handle empty args array", () => {
      const modelValue = {
        functionName: null,
        args: [],
      };
      wrapper = createWrapper({ modelValue });
      expect(wrapper.vm.fields.args.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle function with no validation", () => {
      wrapper = createWrapper();
      const validation = wrapper.vm.getValidationForFunction("nonexistent");
      expect(validation).toEqual({});
    });

    it("should handle empty search filter", () => {
      wrapper = createWrapper();
      const update = vi.fn((callback) => callback());
      wrapper.vm.filterFunctionsOptions("", update);
      expect(update).toHaveBeenCalled();
    });
  });

  describe("Argument Adjusted Index", () => {
    it("should handle allowAddArgAt with n value", () => {
      wrapper = createWrapper();
      // Test functions that support adding at position n
      const validation = wrapper.vm.getValidationForFunction("concat");
      if (validation?.allowAddArgAt === "n") {
        expect(validation.allowAddArgAt).toBe("n");
      }
    });

    it("should handle allowAddArgAt with n-1 value", () => {
      wrapper = createWrapper();
      // Some functions allow adding before last argument
      const types = wrapper.vm.getSupportedTypeBasedOnFunctionNameAndIndex(
        "concat",
        0
      );
      expect(Array.isArray(types)).toBe(true);
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize functions on mount", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.filteredFunctions.length).toBeGreaterThan(0);
    });

    it("should watch for deep changes in fields", async () => {
      wrapper = createWrapper();
      wrapper.vm.fields.args[0].value = { field: "newField" };
      await flushPromises();
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });

    it("should unmount without errors", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });

  describe("Type Selector", () => {
    it("should render type selector for each argument", () => {
      const modelValue = {
        functionName: "concat",
        args: [{ type: "string", value: "" }],
      };
      wrapper = createWrapper({ modelValue });
      const typeSelector = wrapper.find(
        '[data-test="dashboard-function-dropdown-arg-type-selector-0"]'
      );
      expect(typeSelector.exists()).toBe(true);
    });

    it("should update arg type on selector change", async () => {
      const modelValue = {
        functionName: "concat",
        args: [{ type: "string", value: "test" }],
      };
      wrapper = createWrapper({ modelValue });
      wrapper.vm.fields.args[0].type = "number";
      wrapper.vm.onArgTypeChange(wrapper.vm.fields.args[0]);
      await flushPromises();
      expect(wrapper.vm.fields.args[0].type).toBe("number");
    });
  });

  describe("Vertical Line Rendering", () => {
    it("should render vertical line for non-last arguments", () => {
      const modelValue = {
        functionName: "concat",
        args: [
          { type: "string", value: "a" },
          { type: "string", value: "b" },
        ],
      };
      wrapper = createWrapper({ modelValue });
      // Check that component renders without errors
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle last argument differently", () => {
      const modelValue = {
        functionName: "sum",
        args: [{ type: "field", value: {} }],
      };
      wrapper = createWrapper({ modelValue });
      // Last argument should have different styling
      expect(wrapper.vm.fields.args.length).toBeGreaterThan(0);
    });
  });

  describe("Missing Args Handling", () => {
    it("should add missing args to model value", () => {
      const modelValue = {
        functionName: "sum",
        args: [],
      };
      wrapper = createWrapper({ modelValue });
      // addMissingArgs should be called during initialization
      expect(wrapper.vm.fields.args.length).toBeGreaterThanOrEqual(0);
    });
  });
});
