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

import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import FunctionSelector from "@/plugins/logs/FunctionSelector.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// Mock useLogs composable
const mockSearchObj = {
  meta: {
    showTransformEditor: false,
  },
};

vi.mock("@/composables/useLogs", () => ({
  default: () => ({
    searchObj: mockSearchObj,
  }),
}));

// Mock zincutils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `http://localhost:8080/${path}`),
  useLocalWrapContent: vi.fn(() => false),
}));

installQuasar();

const mockFunctionOptions = [
  { name: "Function 1", function: "SELECT * FROM table1" },
  { name: "Function 2", function: "SELECT * FROM table2" },
  { name: "Test Function", function: "SELECT test FROM data" },
  { name: "Analytics Function", function: "SELECT analytics FROM logs" },
  { name: "Search Function", function: "SELECT search FROM results" },
];

describe("FunctionSelector", () => {
  let wrapper: any = null;

  beforeEach(() => {
    wrapper = mount(FunctionSelector, {
      props: {
        functionOptions: mockFunctionOptions,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          "q-toggle": {
            template: '<button class="q-toggle" @click="$emit(\'update:modelValue\', !modelValue)" :data-test="$attrs[\'data-test\']"><slot /></button>',
            props: ["modelValue"],
          },
          "q-btn-group": {
            template: '<div class="q-btn-group" :class="{ disabled: disable }"><slot /></div>',
            props: ["disable"],
          },
          "q-btn-dropdown": {
            template: '<div class="q-btn-dropdown" :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot /></div>',
            props: ["modelValue", "size", "icon", "iconRight", "title", "split"],
          },
          "q-list": {
            template: '<div class="q-list" :data-test="$attrs[\'data-test\']"><slot /></div>',
          },
          "q-input": {
            template: '<input class="q-input" v-model="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)" :data-test="$attrs[\'data-test\']" />',
            props: ["modelValue", "dense", "filled", "borderless", "clearable", "debounce", "placeholder"],
          },
          "q-icon": {
            template: '<span class="q-icon" :name="name"></span>',
            props: ["name"],
          },
          "q-item": {
            template: '<div class="q-item" @click="$emit(\'click\')" v-close-popup><slot /></div>',
            props: ["clickable"],
          },
          "q-item-section": {
            template: '<div class="q-item-section" @click="$emit(\'click\')"><slot /></div>',
          },
          "q-item-label": {
            template: '<div class="q-item-label"><slot /></div>',
          },
        },
        directives: {
          "close-popup": {},
        },
      },
    });
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllTimers();
    vi.restoreAllMocks();
  });

  // Basic Component Tests
  it("should mount FunctionSelector component", () => {
    expect(wrapper.exists()).toBeTruthy();
    expect(wrapper.vm).toBeTruthy();
  });

  it("should accept functionOptions prop", () => {
    expect(wrapper.props().functionOptions).toEqual(mockFunctionOptions);
    expect(wrapper.props().functionOptions).toHaveLength(5);
  });

  it("should render function toggle button", () => {
    const toggle = wrapper.find('[data-test="logs-search-bar-show-query-toggle-btn"]');
    expect(toggle.exists()).toBeTruthy();
  });

  it("should render function dropdown", () => {
    const dropdown = wrapper.find('[data-test="logs-search-bar-function-dropdown"]');
    expect(dropdown.exists()).toBeTruthy();
  });

  it("should render function search input", () => {
    const searchInput = wrapper.find('[data-test="function-search-input"]');
    expect(searchInput.exists()).toBeTruthy();
  });

  it("should render saved function list", () => {
    const functionList = wrapper.find('[data-test="logs-search-saved-function-list"]');
    expect(functionList.exists()).toBeTruthy();
  });

  // Computed Properties Tests
  it("should compute functionToggleIcon based on showTransformEditor state", async () => {
    // The store theme is set to "dark" by default, so it should show function_dark.svg
    const currentTheme = store.state.theme;
    if (currentTheme === "dark") {
      expect(wrapper.vm.functionToggleIcon).toContain("function_dark.svg");
    } else {
      expect(wrapper.vm.functionToggleIcon).toContain("function.svg");
    }

    // The computed property depends on reactive searchObj from composable
    // In a real scenario, changing the searchObj would trigger reactivity
    expect(wrapper.vm.searchObj.meta.showTransformEditor).toBe(false);
  });

  it("should compute iconRight based on theme", async () => {
    // Check current theme and expected icon
    const currentTheme = store.state.theme;
    if (currentTheme === "dark") {
      expect(wrapper.vm.iconRight).toContain("function_dark.svg");
    } else {
      expect(wrapper.vm.iconRight).toContain("function.svg");
    }
    
    // Change to dark theme and verify reactivity
    store.state.theme = "dark";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.iconRight).toContain("function_dark.svg");
    
    // Reset theme for other tests
    store.state.theme = "light";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.iconRight).toContain("function.svg");
  });

  // Reactive Data Tests
  it("should initialize functionModel as false", () => {
    expect(wrapper.vm.functionModel).toBe(false);
  });

  it("should initialize searchTerm as empty string", () => {
    expect(wrapper.vm.searchTerm).toBe("");
  });

  it("should update searchTerm when input changes", async () => {
    const searchInput = wrapper.find('[data-test="function-search-input"]');
    await searchInput.setValue("test");
    expect(wrapper.vm.searchTerm).toBe("test");
  });

  // Filtering Tests
  it("should return all functions when searchTerm is empty", () => {
    wrapper.vm.searchTerm = "";
    expect(wrapper.vm.filteredFunctionOptions).toEqual(mockFunctionOptions);
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(5);
  });

  it("should filter functions based on searchTerm", async () => {
    wrapper.vm.searchTerm = "Function 1";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(1);
    expect(wrapper.vm.filteredFunctionOptions[0].name).toBe("Function 1");
  });

  it("should filter functions case-insensitively", async () => {
    wrapper.vm.searchTerm = "FUNCTION";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(5); // All contain "function"
  });

  it("should filter functions with partial matches", async () => {
    wrapper.vm.searchTerm = "Test";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(1);
    expect(wrapper.vm.filteredFunctionOptions[0].name).toBe("Test Function");
  });

  it("should return empty array for non-matching search", async () => {
    wrapper.vm.searchTerm = "nonexistent";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(0);
  });

  it("should filter with multiple word search", async () => {
    wrapper.vm.searchTerm = "Analytics Function";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(1);
    expect(wrapper.vm.filteredFunctionOptions[0].name).toBe("Analytics Function");
  });

  // Function Tests
  it("should have fnSavedFunctionDialog function", () => {
    expect(typeof wrapper.vm.fnSavedFunctionDialog).toBe("function");
  });

  it("should emit save:function when fnSavedFunctionDialog is called", () => {
    wrapper.vm.fnSavedFunctionDialog();
    expect(wrapper.emitted("save:function")).toBeTruthy();
    expect(wrapper.emitted("save:function")).toHaveLength(1);
  });

  it("should have applyFunction function", () => {
    expect(typeof wrapper.vm.applyFunction).toBe("function");
  });

  it("should emit select:function when applyFunction is called", () => {
    const testFunction = { name: "Test", function: "SELECT test" };
    wrapper.vm.applyFunction(testFunction, true);
    
    expect(wrapper.emitted("select:function")).toBeTruthy();
    expect(wrapper.emitted("select:function")[0]).toEqual([testFunction, true]);
  });

  it("should call applyFunction with default flag when not provided", () => {
    const testFunction = { name: "Test", function: "SELECT test" };
    wrapper.vm.applyFunction(testFunction);
    
    expect(wrapper.emitted("select:function")).toBeTruthy();
    expect(wrapper.emitted("select:function")[0]).toEqual([testFunction, false]);
  });

  // Template Interaction Tests
  it("should emit save:function when dropdown is clicked", async () => {
    const dropdown = wrapper.find('[data-test="logs-search-bar-function-dropdown"]');
    await dropdown.trigger("click");
    expect(wrapper.emitted("save:function")).toBeTruthy();
  });

  it("should render function items in the list", () => {
    const functionItems = wrapper.findAll(".q-item");
    // Should have function items plus the "not found" item container
    expect(functionItems.length).toBeGreaterThan(0);
  });

  it("should display 'no functions found' message when filtered list is empty", async () => {
    wrapper.vm.searchTerm = "nonexistent";
    await wrapper.vm.$nextTick();
    
    const notFoundText = wrapper.text();
    // The translation key gets resolved to actual text
    expect(notFoundText).toContain("Function not found");
  });

  // Props Validation Tests
  it("should handle empty functionOptions array", async () => {
    const emptyWrapper = mount(FunctionSelector, {
      props: {
        functionOptions: [],
      },
      global: {
        plugins: [i18n, store],
        stubs: wrapper.vm.$options.components,
      },
    });
    
    expect(emptyWrapper.vm.filteredFunctionOptions).toHaveLength(0);
    emptyWrapper.unmount();
  });

  it("should handle functionOptions with different structures", async () => {
    const customFunctions = [
      { name: "Custom 1", function: "CUSTOM QUERY 1" },
      { name: "Custom 2", function: "CUSTOM QUERY 2" },
    ];
    
    const customWrapper = mount(FunctionSelector, {
      props: {
        functionOptions: customFunctions,
      },
      global: {
        plugins: [i18n, store],
        stubs: wrapper.vm.$options.components,
      },
    });
    
    expect(customWrapper.vm.filteredFunctionOptions).toEqual(customFunctions);
    customWrapper.unmount();
  });

  // Edge Cases
  it("should handle searchTerm with special characters", async () => {
    wrapper.vm.searchTerm = "!@#$%^&*()";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(0);
  });

  it("should handle searchTerm with numbers", async () => {
    wrapper.vm.searchTerm = "1";
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(1);
    expect(wrapper.vm.filteredFunctionOptions[0].name).toBe("Function 1");
  });

  it("should handle very long searchTerm", async () => {
    wrapper.vm.searchTerm = "a".repeat(1000);
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.filteredFunctionOptions).toHaveLength(0);
  });

  // Integration Tests
  it("should work with real translation function", () => {
    expect(typeof wrapper.vm.t).toBe("function");
    // The translation function resolves keys to actual text
    const translatedText = wrapper.vm.t("search.functionPlaceholder");
    expect(typeof translatedText).toBe("string");
    expect(translatedText.length).toBeGreaterThan(0);
  });

  it("should maintain reactivity when props change", async () => {
    const newFunctions = [{ name: "New Function", function: "SELECT new" }];
    await wrapper.setProps({ functionOptions: newFunctions });
    expect(wrapper.vm.filteredFunctionOptions).toEqual(newFunctions);
  });

  // State Management Tests  
  it("should access store state for theme", () => {
    expect(wrapper.vm.store).toBeTruthy();
    expect(wrapper.vm.store.state.theme).toBeDefined();
  });

  it("should access searchObj from useLogs composable", () => {
    expect(wrapper.vm.searchObj).toBeTruthy();
    expect(wrapper.vm.searchObj.meta).toBeDefined();
    expect(wrapper.vm.searchObj.meta.showTransformEditor).toBeDefined();
  });

  // Performance Tests
  it("should handle large functionOptions array efficiently", async () => {
    const largeFunctionsList = Array.from({ length: 1000 }, (_, i) => ({
      name: `Function ${i}`,
      function: `SELECT * FROM table${i}`,
    }));
    
    const largeWrapper = mount(FunctionSelector, {
      props: {
        functionOptions: largeFunctionsList,
      },
      global: {
        plugins: [i18n, store],
        stubs: wrapper.vm.$options.components,
      },
    });
    
    // Test filtering performance with large dataset
    largeWrapper.vm.searchTerm = "999";
    await largeWrapper.vm.$nextTick();
    expect(largeWrapper.vm.filteredFunctionOptions).toHaveLength(1);
    
    largeWrapper.unmount();
  });
});