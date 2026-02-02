// Copyright 2023 OpenObserve Inc.
//
// Licensed under the GNU Affero General Public License, Version 3.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.gnu.org/licenses/agpl-3.0.en.html
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Quasar } from "quasar";
import CommonAutoComplete from "./CommonAutoComplete.vue";
// Mock store
const mockStore = {
  state: {
    theme: "light",
  },
};

// Mock the composable
let mockFilteredOptions = [
  { label: "Option 1", value: "opt1" },
  { label: "Option 2", value: "opt2" },
];

const mockFilterFn = vi.fn();

vi.mock("@/composables/useSearchInputUsingRegex", () => ({
  useSearchInputUsingRegex: vi.fn(() => ({
    filterFn: mockFilterFn,
    filteredOptions: mockFilteredOptions,
  })),
}));

// Mock Vuex useStore
vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock console methods
global.console = {
  ...console,
  error: vi.fn(),
  warn: vi.fn(),
  log: vi.fn()
};

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

installQuasar();

describe("CommonAutoComplete", () => {
  let wrapper: any;

  const defaultProps = {
    modelValue: "",
    label: "Test Label",
    items: [
      { label: "Option 1", value: "opt1" },
      { label: "Option 2", value: "opt2" },
      { label: "Option 3", value: "opt3" },
    ],
    searchRegex: "",
  };

  const createWrapper = (props = {}, slots = {}) => {
    return mount(CommonAutoComplete, {
      attachTo: "#app",
      props: { ...defaultProps, ...props },
      slots,
      global: {
        plugins: [Quasar],
        provide: {
          store: mockStore,
        },
        stubs: {
          "q-input": {
            template: `
              <div class="q-input-stub" :data-test="$attrs['data-test']">
                <input 
                  :value="modelValue" 
                  @input="$emit('update:modelValue', $event.target.value)"
                  @focus="$emit('focus', $event)"
                  @blur="$emit('blur', $event)"
                />
                <label v-if="label">{{ label }}</label>
                <slot name="label"></slot>
              </div>
            `,
            props: ["modelValue", "dense", "filled", "label"],
            emits: ["update:modelValue", "focus", "blur"],
            inheritAttrs: false,
          },
        },
      },
    });
  };

  beforeEach(() => {
    mockStore.state.theme = "light";
    mockFilterFn.mockClear();
    mockFilteredOptions = [
      { label: "Option 1", value: "opt1" },
      { label: "Option 2", value: "opt2" },
    ];
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBeTruthy();
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("CommonAutoComplete");
    });

    it("should have correct data-test attribute", () => {
      wrapper = createWrapper();
      const input = wrapper.find("[data-test='common-auto-complete']");
      expect(input.exists()).toBeTruthy();
    });

    it("should initialize showOptions as false", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.showOptions).toBe(false);
    });

    it("should sync inputValue with modelValue prop", () => {
      wrapper = createWrapper({ modelValue: "test value" });
      expect(wrapper.vm.inputValue).toBe("test value");
    });
  });

  describe("Props Handling", () => {
    it("should handle modelValue prop", () => {
      wrapper = createWrapper({ modelValue: "initial value" });
      expect(wrapper.vm.inputValue).toBe("initial value");
    });

    it("should handle label prop", () => {
      wrapper = createWrapper({ label: "Custom Label" });
      const label = wrapper.find("label");
      expect(label.text()).toBe("Custom Label");
    });

    it("should handle items prop", () => {
      const customItems = [
        { label: "Custom 1", value: "c1" },
        { label: "Custom 2", value: "c2" },
      ];
      wrapper = createWrapper({ items: customItems });
      expect(wrapper.props("items")).toEqual(customItems);
    });

    it("should use default valueReplaceFn", () => {
      wrapper = createWrapper();
      const result = wrapper.vm.$props.valueReplaceFn("test");
      expect(result).toBe("test");
    });

    it("should use custom valueReplaceFn", () => {
      const customFn = (value: string) => `custom_${value}`;
      wrapper = createWrapper({ valueReplaceFn: customFn });
      const result = wrapper.vm.$props.valueReplaceFn("test");
      expect(result).toBe("custom_test");
    });
  });

  describe("Input Behavior", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should emit update:modelValue when input changes", async () => {
      const input = wrapper.find("input");
      await input.setValue("new value");
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0]).toEqual(["new value"]);
    });

    it("should call fieldsFilterFn when input changes via onModelValueChanged", () => {
      wrapper.vm.onModelValueChanged("test");
      expect(mockFilterFn).toHaveBeenCalledWith("test");
    });

    it("should show options on focus", async () => {
      const input = wrapper.find("input");
      await input.trigger("focus");
      
      expect(wrapper.vm.showOptions).toBe(true);
    });

    it("should hide options on blur", async () => {
      wrapper.vm.showOptions = true;
      const input = wrapper.find("input");
      await input.trigger("blur");
      
      expect(wrapper.vm.showOptions).toBe(false);
    });
  });

  describe("Options Display", () => {
    it("should show options container when showOptions is true and options exist", async () => {
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const optionsContainer = wrapper.find(".options-container");
      expect(optionsContainer.exists()).toBeTruthy();
    });

    it("should not show options container when showOptions is false", async () => {
      wrapper = createWrapper();
      wrapper.vm.showOptions = false;
      await wrapper.vm.$nextTick();
      
      const optionsContainer = wrapper.find(".options-container");
      expect(optionsContainer.exists()).toBeFalsy();
    });

    it("should not show options when no filtered options", async () => {
      mockFilteredOptions = [];
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const optionsContainer = wrapper.find(".options-container");
      expect(optionsContainer.exists()).toBeFalsy();
    });

    it("should render filtered options", async () => {
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const options = wrapper.findAll("[data-test='common-auto-complete-option']");
      expect(options.length).toBe(mockFilteredOptions.length);
    });

    it("should display option labels correctly", async () => {
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const options = wrapper.findAll(".option");
      options.forEach((option, index) => {
        expect(option.text()).toBe(mockFilteredOptions[index].label);
      });
    });
  });

  describe("Option Selection", () => {
    beforeEach(async () => {
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
    });

    it("should emit update:modelValue when option is selected", async () => {
      const option = wrapper.find(".option");
      await option.trigger("mousedown");
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0]).toEqual([mockFilteredOptions[0].value]);
    });

    it("should hide options when option is selected", async () => {
      const option = wrapper.find(".option");
      await option.trigger("mousedown");
      
      expect(wrapper.vm.showOptions).toBe(false);
    });

    it("should use valueReplaceFn when selecting option", async () => {
      const customFn = vi.fn((value) => `processed_${value}`);
      wrapper = createWrapper({ valueReplaceFn: customFn });
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const option = wrapper.find(".option");
      await option.trigger("mousedown");
      
      expect(customFn).toHaveBeenCalledWith(mockFilteredOptions[0].value);
      expect(wrapper.emitted("update:modelValue")[0]).toEqual([`processed_${mockFilteredOptions[0].value}`]);
    });

    it("should handle selectOption method call", () => {
      const testOption = { label: "Test", value: "test" };
      wrapper.vm.selectOption(testOption);
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.vm.showOptions).toBe(false);
    });
  });

  describe("Theme Support", () => {
    it("should use light theme background by default", async () => {
      mockStore.state.theme = "light";
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const optionsContainer = wrapper.find(".options-container");
      expect(optionsContainer.attributes("style")).toContain("background-color: white");
    });

    it("should use dark theme background when theme is dark", async () => {
      mockStore.state.theme = "dark";
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const optionsContainer = wrapper.find(".options-container");
      const style = optionsContainer.attributes("style");
      // Check for either hex or rgb format of the same dark color
      expect(style).toMatch(/(background-color: #2d2d2d|background-color: rgb\(45, 45, 45\))/);
    });
  });

  describe("Slots", () => {
    it("should render label slot when provided", () => {
      wrapper = createWrapper({}, {
        label: '<span class="custom-label">Custom Label</span>',
      });
      
      const customLabel = wrapper.find(".custom-label");
      expect(customLabel.exists()).toBeTruthy();
      expect(customLabel.text()).toBe("Custom Label");
    });

    it("should detect slot presence correctly", () => {
      wrapper = createWrapper({}, {
        label: '<span>Custom Label</span>',
      });
      
      expect(wrapper.vm.hasSlot("label")).toBe(true);
      expect(wrapper.vm.hasSlot("nonexistent")).toBe(false);
    });

    it("should not render label slot template when no slot", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.hasSlot("label")).toBe(false);
    });
  });

  describe("Watchers", () => {
    it("should sync inputValue when modelValue prop changes", async () => {
      wrapper = createWrapper({ modelValue: "initial" });
      expect(wrapper.vm.inputValue).toBe("initial");
      
      await wrapper.setProps({ modelValue: "updated" });
      expect(wrapper.vm.inputValue).toBe("updated");
    });

    it("should call fieldsFilterFn when inputValue changes", async () => {
      wrapper = createWrapper();
      
      // Clear previous calls
      mockFilterFn.mockClear();
      
      // Simulate input value change by triggering the watcher manually
      wrapper.vm.onModelValueChanged("test");
      
      expect(mockFilterFn).toHaveBeenCalledWith("test");
    });
  });

  describe("Event Handling", () => {
    it("should handle onModelValueChanged correctly", () => {
      wrapper = createWrapper();
      
      wrapper.vm.onModelValueChanged("new value");
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0]).toEqual(["new value"]);
      expect(mockFilterFn).toHaveBeenCalledWith("new value");
    });

    it("should hide options correctly", () => {
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      
      wrapper.vm.hideOptions();
      
      expect(wrapper.vm.showOptions).toBe(false);
    });
  });

  describe("Styling and Layout", () => {
    it("should have relative container", () => {
      wrapper = createWrapper();
      const container = wrapper.find(".relative");
      expect(container.exists()).toBeTruthy();
    });

    it("should have correct container styling", () => {
      wrapper = createWrapper();
      const container = wrapper.find("div[style*='margin-top: 5px']");
      expect(container.exists()).toBeTruthy();
    });

    it("should apply option styling", async () => {
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const options = wrapper.findAll(".option");
      options.forEach(option => {
        expect(option.classes()).toContain("option");
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle empty items array", () => {
      expect(() => {
        wrapper = createWrapper({ items: [] });
      }).not.toThrow();
    });

    it("should handle null props gracefully", () => {
      expect(() => {
        wrapper = createWrapper({
          modelValue: null,
          label: null,
          items: null,
        });
      }).not.toThrow();
    });

    it("should handle undefined option in selectOption", () => {
      wrapper = createWrapper();
      
      expect(() => {
        wrapper.vm.selectOption(undefined);
      }).not.toThrow();
    });

    it("should handle option with undefined value", () => {
      wrapper = createWrapper();
      const optionWithUndefined = { label: "Test", value: undefined };
      
      wrapper.vm.selectOption(optionWithUndefined);
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Integration", () => {
    it("should work with different search regex", () => {
      wrapper = createWrapper({ searchRegex: "^test" });
      expect(wrapper.props("searchRegex")).toBe("^test");
    });

    it("should maintain state across interactions", async () => {
      wrapper = createWrapper();
      
      // Focus to show options
      const input = wrapper.find("input");
      await input.trigger("focus");
      expect(wrapper.vm.showOptions).toBe(true);
      
      // Type to filter
      await input.setValue("test");
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      
      // Blur to hide
      await input.trigger("blur");
      expect(wrapper.vm.showOptions).toBe(false);
    });

    it("should handle form-like behavior", async () => {
      wrapper = createWrapper();
      
      const input = wrapper.find("input");
      
      // Focus and show options
      await input.trigger("focus");
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      // Select option
      const option = wrapper.find(".option");
      await option.trigger("mousedown");
      
      expect(wrapper.vm.showOptions).toBe(false);
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize correctly", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.showOptions).toBe(false);
      expect(wrapper.vm.inputValue).toBe("");
      expect(wrapper.vm.fieldsFilterFn).toBe(mockFilterFn);
      expect(wrapper.vm.onModelValueChanged).toBeInstanceOf(Function);
      expect(wrapper.vm.selectOption).toBeInstanceOf(Function);
      expect(wrapper.vm.hideOptions).toBeInstanceOf(Function);
      expect(wrapper.vm.hasSlot).toBeInstanceOf(Function);
    });

    it("should cleanup properly on unmount", () => {
      wrapper = createWrapper();
      const vm = wrapper.vm;
      
      wrapper.unmount();
      
      expect(() => vm.showOptions).not.toThrow();
    });

    it("should maintain reactivity", async () => {
      wrapper = createWrapper();
      
      // Test reactivity
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".options-container").exists()).toBeTruthy();
      
      wrapper.vm.showOptions = false;
      await wrapper.vm.$nextTick();
      expect(wrapper.find(".options-container").exists()).toBeFalsy();
    });
  });

  describe("Accessibility", () => {
    it("should have proper input attributes", () => {
      wrapper = createWrapper();
      const input = wrapper.find("[data-test='common-auto-complete']");
      
      expect(input.exists()).toBeTruthy();
      expect(input.attributes("data-test")).toBe("common-auto-complete");
    });

    it("should have accessible option elements", async () => {
      wrapper = createWrapper();
      wrapper.vm.showOptions = true;
      await wrapper.vm.$nextTick();
      
      const options = wrapper.findAll("[data-test='common-auto-complete-option']");
      expect(options.length).toBeGreaterThan(0);
    });
  });

  describe("Edge Cases", () => {
    it("should handle rapid focus/blur events", async () => {
      wrapper = createWrapper();
      const input = wrapper.find("input");
      
      for (let i = 0; i < 5; i++) {
        await input.trigger("focus");
        await input.trigger("blur");
      }
      
      expect(wrapper.vm.showOptions).toBe(false);
    });

    it("should handle special characters in input", async () => {
      wrapper = createWrapper();
      
      const specialChars = "!@#$%^&*()";
      wrapper.vm.onModelValueChanged(specialChars);
      
      expect(mockFilterFn).toHaveBeenCalledWith(specialChars);
    });

    it("should handle empty string input", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.onModelValueChanged("");
      
      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(mockFilterFn).toHaveBeenCalledWith("");
    });
  });
});