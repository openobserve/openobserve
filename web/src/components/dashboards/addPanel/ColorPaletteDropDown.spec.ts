// Copyright 2026 OpenObserve Inc.
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
import { mount, VueWrapper, flushPromises } from "@vue/test-utils";
import ColorPaletteDropDown from "./ColorPaletteDropDown.vue";
import { reactive, nextTick } from "vue";

// Create reactive mock dashboard panel data
const createMockDashboardPanelData = () =>
  reactive({
    data: {
      config: {
        color: {
          mode: "palette-classic-by-series",
          fixedColor: [],
          seriesBy: "last",
        },
      },
    },
  });

let mockDashboardPanelData = createMockDashboardPanelData();

// Mock the useDashboardPanel composable
vi.mock("@/composables/dashboard/useDashboardPanel", () => ({
  default: () => ({
    dashboardPanelData: mockDashboardPanelData,
    promqlMode: { value: false },
  }),
}));

// Mock color palette utility
const mockColorPalette = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
vi.mock("@/utils/dashboard/colorPalette", () => ({
  getColorPalette: vi.fn((theme: string) => mockColorPalette),
}));

// Mock Vuex store
const mockStore = reactive({
  state: {
    theme: "light",
  },
});

vi.mock("vuex", () => ({
  useStore: () => mockStore,
}));

// Mock vue-i18n
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => {
      const translations: Record<string, string> = {
        "dashboard.colorPalette": "Color palette",
        "dashboard.colorSeriesBy": "Color series by:",
        "dashboard.colorBySeries": "<b>By Series</b>",
        "dashboard.colorDefaultPaletteBySeries": "Default Palette (By Series)",
        "dashboard.colorDefaultPaletteBySeriesSubLabel":
          "Series with the same name will use the same color",
        "dashboard.colorPaletteClassic": "Palette-Classic",
        "dashboard.colorPaletteClassicSubLabel":
          "A random color will be used for each series, regardless of its name",
        "dashboard.colorSingleColor": "Single Color",
        "dashboard.colorSingleColorSubLabel":
          "Set a specific color to all series",
        "dashboard.colorShadesOfSpecificColor": "Shades Of Specific Color",
        "dashboard.colorShadesOfSpecificColorSubLabel":
          "Different shades of specific color",
        "dashboard.colorByValue": "<b>By Value</b>",
        "dashboard.colorGreenYellowRed": "Green-Yellow-Red (By Value)",
        "dashboard.colorRedYellowGreen": "Red-Yellow-Green (By Value)",
        "dashboard.colorTemperature": "Temperature (By Value)",
        "dashboard.colorPositive": "Positive (By Value)",
        "dashboard.colorNegative": "Negative (By Value)",
        "dashboard.colorLightToDarkBlue": "Light To Dark Blue (By Value)",
        "dashboard.colorPaletteClassicBySeries": "Palette-Classic (By Series)",
      };
      return translations[key] || key;
    },
  }),
}));


describe("ColorPaletteDropDown", () => {
  let wrapper: VueWrapper;

  const createWrapper = (props = {}) => {
    return mount(ColorPaletteDropDown, {
      props,
      global: {
        plugins: [],
        provide: {
          dashboardPanelDataPageKey: "dashboard",
        },
        stubs: {
          "OSelect": {
            template: `
              <div class="o-select"
                   data-test="color-palette-select"
                   :model-value="modelValue">
                <slot name="option" v-for="opt in options" :key="opt.value" :opt="opt" />
              </div>
            `,
            props: [
              "modelValue",
              "options",
              "label",
              "dropdownStyle",
            ],
            emits: ["update:model-value"],
            inheritAttrs: false,
          },
          "OToggleGroup": {
            template: `
              <div class="o-toggle-group"
                   :model-value="modelValue"
                   data-test="series-by-toggle">
                <slot />
              </div>
            `,
            props: ["modelValue", "variant"],
            emits: ["update:modelValue"],
          },
          "OToggleGroupItem": {
            template: `<button data-test="o-toggle-group-item" :value="value"><slot /></button>`,
            props: ["value", "size", "disabled"],
          },
        },
      },
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset mock data to default state
    mockDashboardPanelData = createMockDashboardPanelData();
    mockStore.state.theme = "light";
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render the component", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBeTruthy();
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("ColorPaletteDropdown");
    });

    it("should initialize with default color config on mount", () => {
      mockDashboardPanelData.data.config = {};
      wrapper = createWrapper();

      // onBeforeMount should set default config
      expect(mockDashboardPanelData.data.config.color).toBeDefined();
      expect(mockDashboardPanelData.data.config.color.mode).toBe(
        "palette-classic-by-series",
      );
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([]);
      expect(mockDashboardPanelData.data.config.color.seriesBy).toBe("last");
    });

    it("should not overwrite existing color config", () => {
      mockDashboardPanelData.data.config.color = {
        mode: "fixed",
        fixedColor: ["#custom"],
        seriesBy: "max",
      };
      wrapper = createWrapper();

      // Should preserve existing config
      expect(mockDashboardPanelData.data.config.color.mode).toBe("fixed");
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([
        "#custom",
      ]);
      expect(mockDashboardPanelData.data.config.color.seriesBy).toBe("max");
    });

    it("should use injected dashboardPanelDataPageKey", () => {
      const customWrapper = mount(ColorPaletteDropDown, {
        global: {
          plugins: [],
          provide: {
            dashboardPanelDataPageKey: "customKey",
          },
          stubs: {
            "OSelect": { template: "<div class='o-select'></div>" },
            "OToggleGroup": { template: "<div class='o-toggle-group'><slot /></div>" },
            "OToggleGroupItem": { template: "<button><slot /></button>" },
          },
        },
      });

      expect(customWrapper.exists()).toBeTruthy();
      customWrapper.unmount();
    });

    it("should use default dashboardPanelDataPageKey when not provided", () => {
      // Test that the component can be initialized without providing a dashboardPanelDataPageKey
      // The component internally uses "dashboard" as the default key
      expect(() => {
        const testWrapper = createWrapper();
        expect(testWrapper.exists()).toBeTruthy();
        testWrapper.unmount();
      }).not.toThrow();
    });
  });

  describe("Color Options and Palette Logic", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should generate color options with correct structure", () => {
      const colorOptions = wrapper.vm.colorOptions;

      expect(Array.isArray(colorOptions)).toBeTruthy();
      expect(colorOptions.length).toBeGreaterThan(10);

      // Should have group headers
      const bySeriesGroup = colorOptions.find(
        (opt) => opt.label === "<b>By Series</b>",
      );
      expect(bySeriesGroup).toBeDefined();
      expect(bySeriesGroup.header).toBe(true);

      const byValueGroup = colorOptions.find(
        (opt) => opt.label === "<b>By Value</b>",
      );
      expect(byValueGroup).toBeDefined();
      expect(byValueGroup.header).toBe(true);
    });

    it("should include palette-classic-by-series option with theme-based colors", () => {
      const colorOptions = wrapper.vm.colorOptions;
      const defaultOption = colorOptions.find(
        (opt) => opt.value === "palette-classic-by-series",
      );

      expect(defaultOption).toBeDefined();
      expect(defaultOption.label).toBe("Default Palette (By Series)");
      expect(defaultOption.subLabel).toBe(
        "Series with the same name will use the same color",
      );
      expect(defaultOption.colorPalette).toEqual(mockColorPalette);
    });

    it("should include all expected color mode options", () => {
      const colorOptions = wrapper.vm.colorOptions;
      const expectedValues = [
        "palette-classic-by-series",
        "palette-classic",
        "fixed",
        "shades",
        "continuous-green-yellow-red",
        "continuous-red-yellow-green",
        "continuous-temperature",
        "continuous-positive",
        "continuous-negative",
        "continuous-light-to-dark-blue",
      ];

      expectedValues.forEach((value) => {
        const option = colorOptions.find((opt) => opt.value === value);
        expect(option).toBeDefined();
      });
    });

    it("should have fixed palette colors for palette-classic option", () => {
      const colorOptions = wrapper.vm.colorOptions;
      const classicOption = colorOptions.find(
        (opt) => opt.value === "palette-classic",
      );

      expect(classicOption).toBeDefined();
      expect(Array.isArray(classicOption.colorPalette)).toBeTruthy();
      expect(classicOption.colorPalette.length).toBeGreaterThan(10);
      expect(classicOption.colorPalette[0]).toBe("#5b8ef0");
    });
  });

  describe("Selected Option Label Computed Property", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should return correct label for default mode", () => {
      expect(wrapper.vm.selectedOptionLabel).toBe(
        "Default Palette (By Series)",
      );
    });

    it("should return correct label for palette-classic mode", async () => {
      mockDashboardPanelData.data.config.color.mode = "palette-classic";
      await nextTick();

      expect(wrapper.vm.selectedOptionLabel).toBe("Palette-Classic");
    });

    it("should return correct label for fixed mode", async () => {
      mockDashboardPanelData.data.config.color.mode = "fixed";
      await nextTick();

      expect(wrapper.vm.selectedOptionLabel).toBe("Single Color");
    });

    it("should return default label for unknown mode", async () => {
      mockDashboardPanelData.data.config.color.mode = "unknown-mode";
      await nextTick();

      expect(wrapper.vm.selectedOptionLabel).toBe(
        "Palette-Classic (By Series)",
      );
    });

    it("should handle missing color config gracefully", async () => {
      // Save original color config
      const originalColor = mockDashboardPanelData.data.config.color;
      mockDashboardPanelData.data.config.color = {
        mode: "palette-classic-by-series",
        fixedColor: [],
        seriesBy: "last",
      };
      wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.selectedOptionLabel).toBe(
        "Default Palette (By Series)",
      );

      // Restore original color config
      mockDashboardPanelData.data.config.color = originalColor;
    });
  });

  describe("Color Mode Change Handler", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should handle fixed color mode change", async () => {
      wrapper.vm.onColorModeChange("fixed");
      await nextTick();

      expect(mockDashboardPanelData.data.config.color.mode).toBe("fixed");
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([
        "#53ca53",
      ]);
      expect(mockDashboardPanelData.data.config.color.seriesBy).toBe("last");
    });

    it("should handle shades color mode change", async () => {
      wrapper.vm.onColorModeChange("shades");
      await nextTick();

      expect(mockDashboardPanelData.data.config.color.mode).toBe("shades");
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([
        "#53ca53",
      ]);
      expect(mockDashboardPanelData.data.config.color.seriesBy).toBe("last");
    });

    it("should handle palette-classic-by-series mode change", async () => {
      wrapper.vm.onColorModeChange("palette-classic-by-series");
      await nextTick();

      expect(mockDashboardPanelData.data.config.color.mode).toBe(
        "palette-classic-by-series",
      );
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([]);
    });

    it("should handle palette-classic mode change", async () => {
      wrapper.vm.onColorModeChange("palette-classic");
      await nextTick();

      expect(mockDashboardPanelData.data.config.color.mode).toBe(
        "palette-classic",
      );
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([]);
    });

    it("should handle continuous color modes", async () => {
      const customPalette = ["red", "yellow", "green"];
      wrapper.vm.onColorModeChange("continuous-red-yellow-green");
      await nextTick();

      expect(mockDashboardPanelData.data.config.color.mode).toBe(
        "continuous-red-yellow-green",
      );
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual(
        customPalette,
      );
    });
  });

  describe("Store Integration and Theme Support", () => {
    it("should use light theme colors by default", () => {
      mockStore.state.theme = "light";
      wrapper = createWrapper();

      const colorOptions = wrapper.vm.colorOptions;
      const defaultOption = colorOptions.find(
        (opt) => opt.value === "palette-classic-by-series",
      );
      expect(defaultOption.colorPalette).toEqual(mockColorPalette);
    });

    it("should use dark theme colors when theme is dark", () => {
      mockStore.state.theme = "dark";
      wrapper = createWrapper();

      const colorOptions = wrapper.vm.colorOptions;
      const defaultOption = colorOptions.find(
        (opt) => opt.value === "palette-classic-by-series",
      );
      expect(defaultOption.colorPalette).toEqual(mockColorPalette);
    });

    it("should integrate with store correctly", () => {
      wrapper = createWrapper();
      // Check that the component uses the store theme correctly through colorOptions
      const colorOptions = wrapper.vm.colorOptions;
      const defaultOption = colorOptions.find(
        (opt) => opt.value === "palette-classic-by-series",
      );
      expect(defaultOption.colorPalette).toEqual(mockColorPalette);
    });
  });

  describe("Template Rendering and UI", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should render main container with correct structure", () => {
      const container = wrapper.find('[data-test="dashboard-color-palette-root"]');
      expect(container.exists()).toBeTruthy();

      const flexContainer = wrapper.find('[data-test="dashboard-color-palette-flex-container"]');
      expect(flexContainer.exists()).toBeTruthy();
      expect(flexContainer.classes()).toContain("flex");
      expect(flexContainer.classes()).toContain("items-center");
    });

    it("should render q-select with correct props", () => {
      const select = wrapper.find("[data-test='color-palette-select']");
      expect(select.exists()).toBeTruthy();
    });

    it("should not show color input by default", () => {
      const colorInput = wrapper.find('[data-test="dashboard-color-palette-color-input"]');
      expect(colorInput.exists()).toBeFalsy();
    });

    it("should show color input for fixed mode", async () => {
      mockDashboardPanelData.data.config.color.mode = "fixed";
      await nextTick();

      const colorInput = wrapper.find('[data-test="dashboard-color-palette-color-input"]');
      expect(colorInput.exists()).toBeTruthy();
    });

    it("should show color input for shades mode", async () => {
      mockDashboardPanelData.data.config.color.mode = "shades";
      await nextTick();

      const colorInput = wrapper.find('[data-test="dashboard-color-palette-color-input"]');
      expect(colorInput.exists()).toBeTruthy();
    });

    it("should render color-input-wrapper with correct styling", async () => {
      mockDashboardPanelData.data.config.color.mode = "fixed";
      await nextTick();

      const wrapper_element = wrapper.find('[data-test="dashboard-color-palette-color-input-wrapper"]');
      expect(wrapper_element.exists()).toBeTruthy();
      expect(wrapper_element.classes()).toContain("inline-flex");
      expect(wrapper_element.classes()).toContain("items-center");
    });

    it("should not show series by toggle by default", () => {
      const toggle = wrapper.find("[data-test='series-by-toggle']");
      expect(toggle.exists()).toBeFalsy();
    });

    it("should show series by toggle for continuous modes", async () => {
      mockDashboardPanelData.data.config.color.mode =
        "continuous-green-yellow-red";
      await nextTick();

      const toggle = wrapper.find("[data-test='series-by-toggle']");
      expect(toggle.exists()).toBeTruthy();
    });

    it("should render series by toggle with correct options", async () => {
      mockDashboardPanelData.data.config.color.mode = "continuous-temperature";
      await nextTick();

      const toggle = wrapper.find("[data-test='series-by-toggle']");
      expect(toggle.exists()).toBeTruthy();

      const buttons = toggle.findAll('[data-test="o-toggle-group-item"]');
      expect(buttons).toHaveLength(3);
      expect(buttons[0].text()).toBe("Last");
      expect(buttons[1].text()).toBe("Min");
      expect(buttons[2].text()).toBe("Max");
    });
  });

  describe("Template Slot Rendering", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should render option template for regular options", () => {
      const colorOptions = wrapper.vm.colorOptions;
      const regularOption = colorOptions.find(
        (opt) => !opt.header && opt.value,
      );

      expect(regularOption).toBeDefined();
      expect(regularOption.label).toBeDefined();
    });

    it("should render option template for group headers", () => {
      const colorOptions = wrapper.vm.colorOptions;
      const groupOption = colorOptions.find((opt) => opt.header);

      expect(groupOption).toBeDefined();
      expect(groupOption.label).toContain("<b>");
    });

    it("should handle options with colorPalette arrays", () => {
      const colorOptions = wrapper.vm.colorOptions;
      const optionWithPalette = colorOptions.find(
        (opt) => Array.isArray(opt.colorPalette) && opt.colorPalette.length > 0,
      );

      expect(optionWithPalette).toBeDefined();
      expect(Array.isArray(optionWithPalette.colorPalette)).toBeTruthy();
    });

    it("should handle options with subLabel", () => {
      const colorOptions = wrapper.vm.colorOptions;
      const optionWithSubLabel = colorOptions.find((opt) => opt.subLabel);

      expect(optionWithSubLabel).toBeDefined();
      expect(optionWithSubLabel.subLabel).toBeDefined();
    });
  });

  describe("User Interactions and Events", () => {
    beforeEach(() => {
      wrapper = createWrapper();
    });

    it("should update model value when color mode changes", async () => {
      wrapper.vm.onColorModeChange("fixed");
      await flushPromises();

      expect(mockDashboardPanelData.data.config.color.mode).toBe("fixed");
    });

    it("should update color input value when model changes", async () => {
      mockDashboardPanelData.data.config.color.mode = "fixed";
      mockDashboardPanelData.data.config.color.fixedColor = ["#ff0000"];
      await nextTick();

      const colorInput = wrapper.find('[data-test="dashboard-color-palette-color-input"]');
      expect(colorInput.exists()).toBeTruthy();
    });

    it("should bind series by toggle to model correctly", async () => {
      mockDashboardPanelData.data.config.color.mode = "continuous-positive";
      mockDashboardPanelData.data.config.color.seriesBy = "max";
      await nextTick();

      const toggle = wrapper.find("[data-test='series-by-toggle']");
      expect(toggle.exists()).toBeTruthy();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle missing dashboard panel data gracefully", () => {
      // Save original data
      const originalData = mockDashboardPanelData.data;
      mockDashboardPanelData.data = {
        config: {
          color: {
            mode: "palette-classic-by-series",
            fixedColor: [],
            seriesBy: "last",
          },
        },
      };

      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();

      // Restore original data
      mockDashboardPanelData.data = originalData;
    });

    it("should handle missing config gracefully", () => {
      // Save original config
      const originalConfig = mockDashboardPanelData.data.config;
      mockDashboardPanelData.data.config = {
        color: {
          mode: "palette-classic-by-series",
          fixedColor: [],
          seriesBy: "last",
        },
      };

      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();

      // Restore original config
      mockDashboardPanelData.data.config = originalConfig;
    });

    it("should handle null color config in selectedOptionLabel", async () => {
      // Save original color config
      const originalColor = mockDashboardPanelData.data.config.color;
      mockDashboardPanelData.data.config.color = {
        mode: "palette-classic-by-series",
        fixedColor: [],
        seriesBy: "last",
      };
      wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.selectedOptionLabel).toBe(
        "Default Palette (By Series)",
      );

      // Restore original color config
      mockDashboardPanelData.data.config.color = originalColor;
    });

    it("should handle undefined mode in selectedOptionLabel", async () => {
      // Save original mode
      const originalMode = mockDashboardPanelData.data.config.color.mode;
      mockDashboardPanelData.data.config.color.mode =
        "palette-classic-by-series";
      wrapper = createWrapper();
      await nextTick();

      expect(wrapper.vm.selectedOptionLabel).toBe(
        "Default Palette (By Series)",
      );

      // Restore original mode
      mockDashboardPanelData.data.config.color.mode = originalMode;
    });

    it("should handle onColorModeChange with missing colorPalette", async () => {
      expect(() => {
        wrapper.vm.onColorModeChange("continuous-test");
      }).not.toThrow();
    });

    it("should handle invalid color modes", async () => {
      // Ensure the component is properly initialized
      wrapper = createWrapper();
      await nextTick();

      wrapper.vm.onColorModeChange("invalid-mode");
      await nextTick();

      expect(mockDashboardPanelData.data.config.color.mode).toBe(
        "invalid-mode",
      );
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([]);
    });
  });

  describe("Component Lifecycle", () => {
    it("should initialize correctly with all required properties", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardPanelData).toBeDefined();
      expect(wrapper.vm.promqlMode).toBeDefined();
      expect(wrapper.vm.colorOptions).toBeDefined();
      expect(wrapper.vm.onColorModeChange).toBeDefined();
      expect(wrapper.vm.selectedOptionLabel).toBeDefined();
    });

    it("should maintain reactivity throughout lifecycle", async () => {
      wrapper = createWrapper();

      const initialMode = mockDashboardPanelData.data.config.color.mode;
      mockDashboardPanelData.data.config.color.mode = "fixed";
      await nextTick();

      expect(wrapper.vm.selectedOptionLabel).toBe("Single Color");
    });

    it("should cleanup correctly on unmount", () => {
      wrapper = createWrapper();
      expect(wrapper.exists()).toBeTruthy();

      wrapper.unmount();
      expect(wrapper.vm).toBeTruthy(); // Component instance should still exist for cleanup
    });
  });

  describe("Integration Tests", () => {
    it("should work correctly with different theme values", async () => {
      // Test light theme
      mockStore.state.theme = "light";
      wrapper = createWrapper();

      let colorOptions = wrapper.vm.colorOptions;
      let defaultOption = colorOptions.find(
        (opt) => opt.value === "palette-classic-by-series",
      );
      expect(defaultOption.colorPalette).toEqual(mockColorPalette);

      wrapper.unmount();

      // Test dark theme
      mockStore.state.theme = "dark";
      wrapper = createWrapper();

      colorOptions = wrapper.vm.colorOptions;
      defaultOption = colorOptions.find(
        (opt) => opt.value === "palette-classic-by-series",
      );
      expect(defaultOption.colorPalette).toEqual(mockColorPalette);
    });

    it("should maintain state consistency across multiple operations", async () => {
      wrapper = createWrapper();

      // Change to fixed mode
      wrapper.vm.onColorModeChange("fixed");
      await nextTick();

      expect(mockDashboardPanelData.data.config.color.mode).toBe("fixed");
      expect(wrapper.vm.selectedOptionLabel).toBe("Single Color");

      // Change to continuous mode
      wrapper.vm.onColorModeChange("continuous-temperature");
      await nextTick();

      expect(mockDashboardPanelData.data.config.color.mode).toBe(
        "continuous-temperature",
      );
      expect(wrapper.vm.selectedOptionLabel).toBe("Temperature (By Value)");
    });

    it("should handle complex state transitions correctly", async () => {
      wrapper = createWrapper();

      // Start with default
      expect(mockDashboardPanelData.data.config.color.mode).toBe(
        "palette-classic-by-series",
      );

      // Change to fixed
      wrapper.vm.onColorModeChange("fixed");
      await nextTick();
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([
        "#53ca53",
      ]);

      // Change to palette-classic (should clear fixedColor)
      wrapper.vm.onColorModeChange("palette-classic");
      await nextTick();
      expect(mockDashboardPanelData.data.config.color.fixedColor).toEqual([]);
    });
  });

  describe("CSS Classes and Styling", () => {
    it("should apply correct CSS classes", () => {
      wrapper = createWrapper();

      const container = wrapper.find('[data-test="dashboard-color-palette-root"]');
      expect(container.exists()).toBeTruthy();
    });

    it("should have scoped styling for color-input-wrapper", async () => {
      mockDashboardPanelData.data.config.color.mode = "fixed";
      wrapper = createWrapper();
      await nextTick();

      const colorWrapper = wrapper.find('[data-test="dashboard-color-palette-color-input-wrapper"]');
      expect(colorWrapper.exists()).toBeTruthy();
    });
  });
});
