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

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi } from "vitest";
import PredefinedThemes from "./PredefinedThemes.vue";
import i18n from "@/locales";
import { nextTick, ref } from "vue";
import {
  CUSTOM_THEME_NAME,
  getDefaultTheme,
  themeNameSlug,
} from "@/constants/themes";

// The default theme (O2 Signature) provides the fallback colors.
const DEFAULT_THEME = getDefaultTheme();

// Use vi.hoisted so these variables are available inside vi.mock() factory functions
// (vi.mock calls are hoisted to the top of the file before variable declarations)
const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(() => vi.fn()),
}));

// Mock toast — resetToDefaultTheme calls toast()
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

// Mock composable — use vi.fn() so individual tests can override via mockReturnValueOnce
vi.mock("@/composables/usePredefinedThemes", () => ({
  usePredefinedThemes: vi.fn(() => ({
    isOpen: { value: true },
    toggleThemes: vi.fn(),
  })),
}));

// Mock theme utility
vi.mock("@/utils/theme", () => ({
  applyThemeColors: vi.fn(),
  hexToRgba: vi.fn((hex: string, opacity: number) => {
    return `rgba(0, 0, 0, ${opacity / 10})`;
  }),
}));

// Mock themeManager so onMounted doesn't try to touch real localStorage/DOM
vi.mock("@/utils/themeManager", () => ({
  applyCurrentTheme: vi.fn(),
  applyThemeForMode: vi.fn(),
  bootstrapTheme: vi.fn(),
}));

// Mock Vuex store
const mockStore = {
  state: {
    theme: "light",
    defaultThemeColors: {
      light: "#3F7994",
      dark: "#5B9FBE",
    },
    tempThemeColors: {
      light: null,
      dark: null,
    },
    organizationData: {
      organizationSettings: {
        light_mode_theme_color: "#3F7994",
        dark_mode_theme_color: "#5B9FBE",
      },
    },
  },
  dispatch: vi.fn().mockResolvedValue({}),
  commit: vi.fn(),
};

// Mock localStorage
const mockLocalStorage = {
  getItem: vi.fn((key: string) => {
    if (key === "appliedLightTheme") return null;
    if (key === "appliedDarkTheme") return null;
    if (key === "customLightColor") return null;
    if (key === "customDarkColor") return null;
    return null;
  }),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

const createWrapper = (props = {}, options = {}) => {
  return mount(PredefinedThemes, {
    props: {
      ...props,
    },
    global: {
      plugins: [i18n],
      mocks: {
        $store: mockStore,
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        // ODrawer stub — outer container
        ODrawer: {
          name: "ODrawer",
          template:
            '<div data-test-stub="o-drawer" :data-title="title"><span data-test-stub="o-drawer-title">{{ title }}</span><slot name="header-right"></slot><slot></slot></div>',
          props: ["open", "size", "seamless", "title"],
          emits: ["update:open"],
        },
        // ODialog stub — inner color picker dialog
        ODialog: {
          name: "ODialog",
          template:
            '<div data-test-stub="o-dialog" :data-title="title"><span data-test-stub="o-dialog-title">{{ title }}</span><slot name="header"></slot><slot></slot><slot name="footer"></slot><button data-test-stub="o-dialog-primary" @click="$emit(\'click:primary\')">{{ primaryButtonLabel }}</button><button data-test-stub="o-dialog-neutral" @click="$emit(\'click:neutral\')">{{ neutralButtonLabel }}</button></div>',
          props: [
            "open",
            "size",
            "title",
            "primaryButtonLabel",
            "neutralButtonLabel",
          ],
          emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
        },
        // OToggleGroup — replaces the old OTabs segmented control
        OToggleGroup: {
          name: "OToggleGroup",
          template:
            '<div data-test-stub="o-toggle-group"><slot></slot></div>',
          props: ["modelValue", "type"],
          emits: ["update:modelValue"],
        },
        // OToggleGroupItem — individual toggle items; forward data-test and value
        OToggleGroupItem: {
          name: "OToggleGroupItem",
          template:
            '<button data-test-stub="o-toggle-group-item" :data-test="$attrs[\'data-test\']" :value="value" @click="$emit(\'click\', value)"><slot></slot></button>',
          props: ["value", "iconLeft"],
          emits: ["click"],
          inheritAttrs: false,
        },
        // OBadge — inline badge for "Applied" indicator; forward data-test
        OBadge: {
          name: "OBadge",
          template:
            '<span data-test-stub="o-badge" :data-test="$attrs[\'data-test\']"><slot></slot></span>',
          props: ["variant", "size", "icon"],
          inheritAttrs: false,
        },
        OButton: {
          template:
            '<button data-test-stub="o-btn" :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot></slot><slot name="icon-left"></slot></button>',
          props: ["variant", "size", "disabled", "loading"],
          emits: ["click"],
          inheritAttrs: false,
        },
        OCardSection: {
          template: '<div data-test-stub="o-card-section"><slot></slot></div>',
        },
        OSeparator: {
          template: '<hr data-test-stub="o-separator" />',
        },
        OIcon: {
          template: '<i data-test-stub="o-icon"></i>',
          props: ["name", "size"],
        },
        OColor: {
          template: '<div data-test-stub="o-color"></div>',
          props: ["modelValue"],
          emits: ["update:modelValue"],
        },
        // Legacy stubs kept for safety (no longer rendered, harmless)
        QCard: {
          template: '<div data-test-stub="q-card"><slot></slot></div>',
        },
        QCardSection: {
          template: '<div data-test-stub="q-card-section"><slot></slot></div>',
        },
        QBtn: {
          template:
            '<button data-test-stub="q-btn" :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot></slot></button>',
        },
        QIcon: {
          template: '<i data-test-stub="OIcon"></i>',
        },
        QTooltip: {
          template: '<div data-test-stub="q-tooltip"><slot></slot></div>',
        },
        QColor: {
          template: '<div data-test-stub="q-color"></div>',
          props: ["modelValue"],
          emits: ["update:modelValue"],
        },
      },
      ...options,
    },
  });
};

describe("PredefinedThemes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockToast.mockReturnValue(vi.fn());
    mockLocalStorage.getItem.mockImplementation((key: string) => {
      if (key === "appliedLightTheme") return null;
      if (key === "appliedDarkTheme") return null;
      if (key === "customLightColor") return null;
      if (key === "customDarkColor") return null;
      return null;
    });
    // Reset store state mutations between tests
    mockStore.state.tempThemeColors = { light: null, dark: null };
    mockStore.state.theme = "light";
    mockStore.state.organizationData = {
      organizationSettings: {
        light_mode_theme_color: "#3F7994",
        dark_mode_theme_color: "#5B9FBE",
      },
    };
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should render drawer (ODrawer)", () => {
      const wrapper = createWrapper();

      expect(wrapper.find('[data-test-stub="o-drawer"]').exists()).toBe(true);
    });

    it("should render inner color picker ODialog", () => {
      const wrapper = createWrapper();

      expect(wrapper.find('[data-test-stub="o-dialog"]').exists()).toBe(true);
    });

    it("should render light and dark mode toggle items", () => {
      const wrapper = createWrapper();

      // New segmented control uses OToggleGroupItem with data-test attrs
      expect(
        wrapper.find('[data-test="predefined-themes-tab-light"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="predefined-themes-tab-dark"]').exists(),
      ).toBe(true);
    });

    it("should render the OToggleGroup container", () => {
      const wrapper = createWrapper();

      expect(wrapper.find('[data-test-stub="o-toggle-group"]').exists()).toBe(
        true,
      );
    });

    it("should initialize with light mode tab active", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.activeTab).toBe("light");
    });
  });

  describe("Theme Display", () => {
    it("should display predefined themes", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.predefinedThemes.length).toBeGreaterThan(0);
    });

    it("includes O2 Crimson Ink as a predefined theme with semanticColors", () => {
      const wrapper = createWrapper();
      const { vm } = wrapper;
      const o2Theme = (vm as any).predefinedThemes.find(
        (t: any) => t.name === "O2 Crimson Ink",
      );

      expect(o2Theme).toBeDefined();
      expect(o2Theme.light.themeColor).toBe("#E11D48");
      expect(o2Theme.light.semanticColors).toBeDefined();
      expect(o2Theme.light.semanticColors.error).toBe("#F97316");
      expect(o2Theme.light.semanticColors.success).toBe("#6366F1");
      expect(o2Theme.dark.semanticColors).toBeDefined();
    });

    it("passes semanticColors to applyThemeColors when applying O2 Crimson Ink", async () => {
      const wrapper = createWrapper();
      const { vm } = wrapper;
      const { applyThemeColors } = await import("@/utils/theme");
      const o2Theme = (vm as any).predefinedThemes.find(
        (t: any) => t.name === "O2 Crimson Ink",
      );

      (vm as any).applyTheme(o2Theme, "light");

      expect(applyThemeColors).toHaveBeenCalledWith(
        "#E11D48",
        "light",
        false,
        expect.objectContaining({
          error: "#F97316",
          success: "#6366F1",
        }),
      );
    });

    it("does not pass semanticColors when applying a non-signature theme", async () => {
      const wrapper = createWrapper();
      const { vm } = wrapper;
      const { applyThemeColors } = await import("@/utils/theme");
      const oceanTheme = (vm as any).predefinedThemes.find(
        (t: any) => t.name === "O2 Pulse",
      );

      (vm as any).applyTheme(oceanTheme, "light");

      expect(applyThemeColors).toHaveBeenCalledWith(
        oceanTheme.light.themeColor,
        "light",
        false,
        undefined,
      );
    });

    it("should display custom color option", () => {
      const wrapper = createWrapper();

      expect(wrapper.text()).toContain("Custom Color");
    });

    it("should use the default theme (O2 Signature) colors as defaults", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.DEFAULT_LIGHT_COLOR).toBe(DEFAULT_THEME.light.themeColor);
      expect(vm.DEFAULT_DARK_COLOR).toBe(DEFAULT_THEME.dark.themeColor);
    });

    it("renders theme row buttons for each predefined theme in light mode", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Each predefined theme should have a row button in the active (light) mode
      const pulseSlug = themeNameSlug("O2 Pulse");
      const pulseRow = wrapper.find(
        `[data-test="predefined-themes-apply-btn-light-${pulseSlug}"]`,
      );

      expect(pulseRow.exists()).toBe(true);
    });

    it("renders theme row for O2 Crimson Ink in light mode", () => {
      const wrapper = createWrapper();

      const slug = themeNameSlug("O2 Crimson Ink");
      const row = wrapper.find(
        `[data-test="predefined-themes-apply-btn-light-${slug}"]`,
      );

      expect(row.exists()).toBe(true);
    });

    it("renders custom color row for active mode", () => {
      const wrapper = createWrapper();

      expect(
        wrapper
          .find('[data-test="predefined-themes-card-light-custom-color"]')
          .exists(),
      ).toBe(true);
    });

    it("shows hint text 'Pick any brand hex' when custom theme is not applied", () => {
      const wrapper = createWrapper();

      expect(wrapper.text()).toContain("Pick any brand hex");
    });

    it("shows bottom note about device-only storage", () => {
      const wrapper = createWrapper();

      expect(wrapper.text()).toContain("Saved to this device only");
    });
  });

  describe("Mode (computed)", () => {
    it("mode is 'light' when activeTab is 'light'", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.activeTab = "light";

      expect(vm.mode).toBe("light");
    });

    it("mode is 'dark' when activeTab is 'dark'", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.activeTab = "dark";
      await nextTick();

      expect(vm.mode).toBe("dark");
    });
  });

  describe("Tab Switching", () => {
    it("should switch to dark mode tab", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.activeTab = "dark";
      await nextTick();

      expect(vm.activeTab).toBe("dark");
    });

    it("should switch to light mode tab", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.activeTab = "dark";
      await nextTick();
      vm.activeTab = "light";
      await nextTick();

      expect(vm.activeTab).toBe("light");
    });

    it("renders dark-mode theme rows when activeTab switches to dark", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.activeTab = "dark";
      await nextTick();

      const slug = themeNameSlug("O2 Pulse");
      expect(
        wrapper
          .find(`[data-test="predefined-themes-apply-btn-dark-${slug}"]`)
          .exists(),
      ).toBe(true);
    });

    it("renders dark-mode custom-color row when activeTab switches to dark", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.activeTab = "dark";
      await nextTick();

      expect(
        wrapper
          .find('[data-test="predefined-themes-card-dark-custom-color"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("Theme Application", () => {
    it("should have apply buttons (theme rows) for each theme", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Every predefined theme should have a clickable row
      for (const theme of vm.predefinedThemes) {
        const slug = themeNameSlug(theme.name);
        const row = wrapper.find(
          `[data-test="predefined-themes-apply-btn-light-${slug}"]`,
        );
        expect(row.exists()).toBe(true);
      }
    });

    it("should store theme in localStorage when applied via applyTheme()", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const theme = vm.predefinedThemes[0];
      vm.applyTheme(theme, "light");
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "appliedLightThemeName",
        theme.name,
      );
    });

    it("clicking the O2 Pulse theme row calls localStorage.setItem with its name", async () => {
      const wrapper = createWrapper();

      const slug = themeNameSlug("O2 Pulse");
      const row = wrapper.find(
        `[data-test="predefined-themes-apply-btn-light-${slug}"]`,
      );
      expect(row.exists()).toBe(true);

      await row.trigger("click");
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "appliedLightThemeName",
        "O2 Pulse",
      );
    });

    it("clicking a theme row calls applyThemeColors with the correct color", async () => {
      const wrapper = createWrapper();
      const { applyThemeColors } = await import("@/utils/theme");
      const vm = wrapper.vm as any;
      const pulseTheme = vm.predefinedThemes.find(
        (t: any) => t.name === "O2 Pulse",
      );

      const slug = themeNameSlug("O2 Pulse");
      const row = wrapper.find(
        `[data-test="predefined-themes-apply-btn-light-${slug}"]`,
      );
      await row.trigger("click");
      await nextTick();

      expect(applyThemeColors).toHaveBeenCalledWith(
        pulseTheme.light.themeColor,
        "light",
        false,
        undefined,
      );
    });

    it("shows applied badge for the theme that is currently applied", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Mark O2 Pulse as applied
      const slug = themeNameSlug("O2 Pulse");
      vm.appliedLightThemeName = "O2 Pulse";
      await nextTick();

      const badge = wrapper.find(
        `[data-test="predefined-themes-applied-badge-light-${slug}"]`,
      );
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("Applied");
    });

    it("does NOT show applied badge for a theme that is NOT applied", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Only O2 Pulse is applied; O2 Horizon badge should not exist
      vm.appliedLightThemeName = "O2 Pulse";
      await nextTick();

      const horizonSlug = themeNameSlug("O2 Horizon");
      const badge = wrapper.find(
        `[data-test="predefined-themes-applied-badge-light-${horizonSlug}"]`,
      );
      expect(badge.exists()).toBe(false);
    });

    it("isThemeApplied returns true when the theme name matches the applied name", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.appliedLightThemeName = "O2 Signature";

      const theme = vm.predefinedThemes.find(
        (t: any) => t.name === "O2 Signature",
      );
      expect(vm.isThemeApplied(theme, "light")).toBe(true);
    });

    it("isThemeApplied returns false when a different theme is applied", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.appliedLightThemeName = "O2 Pulse";

      const theme = vm.predefinedThemes.find(
        (t: any) => t.name === "O2 Signature",
      );
      expect(vm.isThemeApplied(theme, "light")).toBe(false);
    });
  });

  describe("Custom Color Picker", () => {
    it("should have custom light color initialized", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.customLightColor).toBeDefined();
    });

    it("should have custom dark color initialized", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.customDarkColor).toBeDefined();
    });

    it("should open color picker for light mode via openColorPicker()", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.openColorPicker("light");
      await nextTick();

      expect(vm.showColorPicker).toBe(true);
      expect(vm.currentPickerMode).toBe("light");
    });

    it("should open color picker for dark mode via openColorPicker()", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.openColorPicker("dark");
      await nextTick();

      expect(vm.showColorPicker).toBe(true);
      expect(vm.currentPickerMode).toBe("dark");
    });

    it("clicking the custom-color row opens the picker for the active mode", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const row = wrapper.find(
        '[data-test="predefined-themes-card-light-custom-color"]',
      );
      expect(row.exists()).toBe(true);

      await row.trigger("click");
      await nextTick();

      expect(vm.showColorPicker).toBe(true);
      expect(vm.currentPickerMode).toBe("light");
    });

    it("clicking the custom-color row in dark mode opens picker with dark mode", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.activeTab = "dark";
      await nextTick();

      const row = wrapper.find(
        '[data-test="predefined-themes-card-dark-custom-color"]',
      );
      expect(row.exists()).toBe(true);

      await row.trigger("click");
      await nextTick();

      expect(vm.showColorPicker).toBe(true);
      expect(vm.currentPickerMode).toBe("dark");
    });

    it("should update custom color when color picker changes", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.tempColor = "#FF0000";
      vm.currentPickerMode = "light";
      vm.updateCustomColor();
      await nextTick();

      expect(vm.customLightColor).toBe("#FF0000");
    });

    it("updateCustomColor updates dark color when currentPickerMode is dark", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.tempColor = "#0000FF";
      vm.currentPickerMode = "dark";
      vm.updateCustomColor();
      await nextTick();

      expect(vm.customDarkColor).toBe("#0000FF");
    });

    it("should apply custom theme and save to localStorage via applyCustomTheme()", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.customLightColor = "#FF0000";
      vm.applyCustomTheme("light");
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "customLightColor",
        "#FF0000",
      );
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "appliedLightThemeName",
        CUSTOM_THEME_NAME,
      );
    });

    it("applyCustomTheme stores CUSTOM_THEME_NAME for dark mode", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.customDarkColor = "#AABBCC";
      vm.applyCustomTheme("dark");
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "appliedDarkThemeName",
        CUSTOM_THEME_NAME,
      );
    });
  });

  describe("confirmCustomColor (Dialog Apply button)", () => {
    it("confirmCustomColor closes the color picker", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.showColorPicker = true;
      vm.currentPickerMode = "light";
      await nextTick();

      vm.confirmCustomColor();
      await nextTick();

      expect(vm.showColorPicker).toBe(false);
    });

    it("confirmCustomColor applies the custom theme for the current picker mode", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.customLightColor = "#123456";
      vm.showColorPicker = true;
      vm.currentPickerMode = "light";
      await nextTick();

      vm.confirmCustomColor();
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "appliedLightThemeName",
        CUSTOM_THEME_NAME,
      );
    });

    it("clicking the ODialog primary button closes the color picker via confirmCustomColor", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.showColorPicker = true;
      vm.currentPickerMode = "light";
      await nextTick();

      const primaryBtn = wrapper.find('[data-test-stub="o-dialog-primary"]');
      expect(primaryBtn.exists()).toBe(true);
      await primaryBtn.trigger("click");
      await nextTick();

      expect(vm.showColorPicker).toBe(false);
    });

    it("clicking the ODialog neutral button closes the picker without applying", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vi.clearAllMocks();
      vm.showColorPicker = true;
      vm.currentPickerMode = "light";
      await nextTick();

      const neutralBtn = wrapper.find('[data-test-stub="o-dialog-neutral"]');
      expect(neutralBtn.exists()).toBe(true);
      await neutralBtn.trigger("click");
      await nextTick();

      expect(vm.showColorPicker).toBe(false);
      // neutral must NOT call applyCustomTheme — no appliedLightThemeName set
      expect(mockLocalStorage.setItem).not.toHaveBeenCalledWith(
        "appliedLightThemeName",
        CUSTOM_THEME_NAME,
      );
    });

    it("shows applied badge for custom color row after confirmCustomColor", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.showColorPicker = true;
      vm.currentPickerMode = "light";
      await nextTick();

      vm.confirmCustomColor();
      await nextTick();

      // The badge appears when isCustomThemeApplied returns true
      const badge = wrapper.find(
        '[data-test="predefined-themes-applied-badge-light-custom-color"]',
      );
      expect(badge.exists()).toBe(true);
      expect(badge.text()).toContain("Applied");
    });
  });

  describe("Reset Functionality", () => {
    it("should have resetToDefaultTheme function", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(typeof vm.resetToDefaultTheme).toBe("function");
    });

    it("should call localStorage.removeItem when resetting", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.resetToDefaultTheme();
      await nextTick();

      expect(mockLocalStorage.removeItem).toHaveBeenCalled();
    });

    it("should show toast notification after reset", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.resetToDefaultTheme();
      await nextTick();

      // resetToDefaultTheme calls toast() from @/lib/feedback/Toast/useToast
      expect(mockToast).toHaveBeenCalled();
    });

    it("reset button is rendered in the drawer header-right slot", () => {
      const wrapper = createWrapper();

      const resetBtn = wrapper.find(
        '[data-test="predefined-themes-reset-btn"]',
      );
      expect(resetBtn.exists()).toBe(true);
    });

    it("clicking the reset button triggers the reset (localStorage.removeItem called)", async () => {
      const wrapper = createWrapper();

      // Arrange — pre-set an applied theme so removeItem is definitely called by reset
      (wrapper.vm as any).appliedLightThemeName = "O2 Pulse";
      await nextTick();

      const resetBtn = wrapper.find(
        '[data-test="predefined-themes-reset-btn"]',
      );
      expect(resetBtn.exists()).toBe(true);

      await resetBtn.trigger("click");
      await nextTick();

      // If resetToDefaultTheme ran, it removes the localStorage entries
      expect(mockLocalStorage.removeItem).toHaveBeenCalled();
    });

    it("after reset, appliedLightThemeName is null", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.appliedLightThemeName = "O2 Pulse";
      await nextTick();

      vm.resetToDefaultTheme();
      await nextTick();

      expect(vm.appliedLightThemeName).toBeNull();
    });

    it("after reset, appliedDarkThemeName is null", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.appliedDarkThemeName = "O2 Horizon";
      await nextTick();

      vm.resetToDefaultTheme();
      await nextTick();

      expect(vm.appliedDarkThemeName).toBeNull();
    });
  });

  describe("Temp Theme Colors (Preview)", () => {
    it("should use temp colors from store when available", () => {
      mockStore.state.tempThemeColors.light = "#FF0000";
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.customLightColor).toBe("#FF0000");
    });

    it("should not show 'Applied' badge when temp colors exist", () => {
      mockStore.state.tempThemeColors.light = "#FF0000";
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const isApplied = vm.isCustomThemeApplied("light");
      expect(isApplied).toBe(false);
    });

    it("should show 'Applied' badge when theme is permanently applied", () => {
      mockStore.state.tempThemeColors.light = null;
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === "appliedLightThemeName") return CUSTOM_THEME_NAME;
        return null;
      });

      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.appliedLightThemeName = CUSTOM_THEME_NAME;

      const isApplied = vm.isCustomThemeApplied("light");
      expect(isApplied).toBe(true);
    });
  });

  describe("Theme Priority", () => {
    it("should prioritize temp colors over localStorage", () => {
      mockStore.state.tempThemeColors.light = "#FF0000";
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === "customLightColor") return "#00FF00";
        return null;
      });

      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.customLightColor).toBe("#FF0000");
    });

    it("should use localStorage when no temp colors", () => {
      mockStore.state.tempThemeColors.light = null;
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === "customLightColor") return "#00FF00";
        return null;
      });

      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.customLightColor).toBe("#00FF00");
    });

    it("should use organization settings when no localStorage", () => {
      mockStore.state.tempThemeColors.light = null;
      mockLocalStorage.getItem.mockReturnValue(null);

      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.customLightColor).toBe("#3F7994");
    });
  });

  describe("Edge Cases", () => {
    it("should handle missing organization settings gracefully", () => {
      mockStore.state.organizationData = {};
      const wrapper = createWrapper();

      expect(wrapper.exists()).toBe(true);
    });

    it("should handle missing temp theme colors gracefully", () => {
      mockStore.state.tempThemeColors = { light: null, dark: null };
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.customLightColor).toBeDefined();
    });

    it("should handle empty predefined themes", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(Array.isArray(vm.predefinedThemes)).toBe(true);
    });

    it("isCustomThemeApplied returns false when no theme is applied", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.appliedLightThemeName = null;

      expect(vm.isCustomThemeApplied("light")).toBe(false);
    });

    it("isCustomThemeApplied returns false when a predefined (not custom) theme is applied", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.appliedLightThemeName = "O2 Pulse";

      expect(vm.isCustomThemeApplied("light")).toBe(false);
    });
  });

  describe("applyTheme — dark mode branch", () => {
    it("stores appliedDarkThemeName in localStorage when applying a dark theme", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const theme = vm.predefinedThemes.find((t: any) => t.name === "O2 Pulse");
      vm.applyTheme(theme, "dark");
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "appliedDarkThemeName",
        "O2 Pulse",
      );
    });

    it("sets appliedDarkThemeName ref when applying a dark theme", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const theme = vm.predefinedThemes.find(
        (t: any) => t.name === "O2 Horizon",
      );
      vm.applyTheme(theme, "dark");
      await nextTick();

      expect(vm.appliedDarkThemeName).toBe("O2 Horizon");
    });

    it("updates customDarkColor ref to the theme color when applying dark", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const theme = vm.predefinedThemes.find(
        (t: any) => t.name === "O2 Beacon",
      );
      vm.applyTheme(theme, "dark");
      await nextTick();

      expect(vm.customDarkColor).toBe(theme.dark.themeColor);
    });

    it("stores semanticColors JSON in localStorage when applying O2 Crimson Ink dark", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const theme = vm.predefinedThemes.find(
        (t: any) => t.name === "O2 Crimson Ink",
      );
      vm.applyTheme(theme, "dark");
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        "darkSemanticColors",
        JSON.stringify(theme.dark.semanticColors),
      );
    });
  });

  describe("applyTheme — semantic-less theme removes stale semantic localStorage key", () => {
    it("calls localStorage.removeItem for semantic key when theme has no semanticColors", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      const theme = vm.predefinedThemes.find((t: any) => t.name === "O2 Pulse");
      // O2 Pulse has no semanticColors — removeItem should be called for lightSemanticColors
      vm.applyTheme(theme, "light");
      await nextTick();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith(
        "lightSemanticColors",
      );
    });
  });

  describe("Watch handlers — isOpen composable", () => {
    it("syncs dialogOpen when isOpen ref changes", async () => {
      const { usePredefinedThemes } = await import(
        "@/composables/usePredefinedThemes"
      );

      // Start with isOpen=false so dialogOpen starts false, then flip to true
      const reactiveIsOpen = ref(false);
      vi.mocked(usePredefinedThemes).mockReturnValueOnce({
        isOpen: reactiveIsOpen,
        toggleThemes: vi.fn(),
      } as any);

      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Initially closed (isOpen=false → dialogOpen=false, watch hasn't fired yet)
      expect(vm.dialogOpen).toBe(false);

      // Simulate composable opening the dialog
      reactiveIsOpen.value = true;
      await nextTick();

      expect(vm.dialogOpen).toBe(true);

      // Simulate composable closing the dialog (covers the else/false branch)
      reactiveIsOpen.value = false;
      await nextTick();

      expect(vm.dialogOpen).toBe(false);
    });

    it("syncs activeTab from store theme when isOpen becomes true", async () => {
      const { usePredefinedThemes } = await import(
        "@/composables/usePredefinedThemes"
      );

      mockStore.state.theme = "dark";
      const reactiveIsOpen = ref(false);
      vi.mocked(usePredefinedThemes).mockReturnValueOnce({
        isOpen: reactiveIsOpen,
        toggleThemes: vi.fn(),
      } as any);

      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      // Initially closed — activeTab is "light" (default)
      expect(vm.activeTab).toBe("light");

      // Open the dialog — watcher should sync activeTab to store theme (dark)
      reactiveIsOpen.value = true;
      await nextTick();

      expect(vm.activeTab).toBe("dark");
    });
  });

  describe("Watch handlers — reactive Vuex store", () => {
    // These tests use the real Vuex store so watchers on store.state actually fire.
    const createWrapperWithRealStore = async () => {
      const { default: realStore } = await import(
        "@/test/unit/helpers/store"
      );
      return {
        store: realStore,
        wrapper: mount(PredefinedThemes, {
          global: {
            plugins: [i18n, realStore],
            stubs: {
              ODrawer: {
                name: "ODrawer",
                template:
                  '<div data-test-stub="o-drawer" :data-title="title"><slot name="header-right"></slot><slot></slot></div>',
                props: ["open", "size", "seamless", "title"],
                emits: ["update:open"],
              },
              ODialog: {
                name: "ODialog",
                template:
                  '<div data-test-stub="o-dialog"><slot></slot><button data-test-stub="o-dialog-primary" @click="$emit(\'click:primary\')">Apply</button></div>',
                props: ["open", "size", "title", "primaryButtonLabel", "neutralButtonLabel"],
                emits: ["update:open", "click:primary", "click:neutral"],
              },
              OToggleGroup: {
                name: "OToggleGroup",
                template: '<div data-test-stub="o-toggle-group"><slot></slot></div>',
                props: ["modelValue", "type"],
                emits: ["update:modelValue"],
              },
              OToggleGroupItem: {
                name: "OToggleGroupItem",
                template:
                  '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\', value)"><slot></slot></button>',
                props: ["value", "iconLeft"],
                emits: ["click"],
                inheritAttrs: false,
              },
              OBadge: {
                name: "OBadge",
                template: '<span :data-test="$attrs[\'data-test\']"><slot></slot></span>',
                props: ["variant", "size", "icon"],
                inheritAttrs: false,
              },
              OButton: {
                template: '<button :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot></slot></button>',
                props: ["variant", "size"],
                emits: ["click"],
                inheritAttrs: false,
              },
              OCardSection: { template: '<div><slot></slot></div>' },
              OSeparator: { template: '<hr />' },
              OIcon: { template: '<i></i>', props: ["name", "size"] },
              OColor: {
                template: '<div></div>',
                props: ["modelValue"],
                emits: ["update:modelValue"],
              },
            },
          },
        }),
      };
    };

    it("updates activeTab when store.state.theme changes", async () => {
      // Real test store starts with theme:"dark".
      // First mount — activeTab starts at "light" (component default).
      // Switch the mock store to "light" first so the watcher transition goes light→dark.
      const { store, wrapper } = await createWrapperWithRealStore();
      const vm = wrapper.vm as any;

      // activeTab starts at "light" (the component's initial ref value)
      expect(vm.activeTab).toBe("light");

      // Commit "dark" — store.state.theme changes from "dark"→"dark" (no change) …
      // so first reset to "light" so the next commit is a real change
      store.commit("appTheme", "light");
      await nextTick();
      // No change: activeTab was already "light"
      expect(vm.activeTab).toBe("light");

      // Now change to "dark" — watcher should fire and update activeTab
      store.commit("appTheme", "dark");
      await nextTick();

      expect(vm.activeTab).toBe("dark");
      wrapper.unmount();
    });

    it("does not change activeTab when store.state.theme matches current activeTab", async () => {
      const { store, wrapper } = await createWrapperWithRealStore();
      const vm = wrapper.vm as any;

      // activeTab starts at "light" — set store to "light" then commit "light" again
      store.commit("appTheme", "light");
      await nextTick();
      expect(vm.activeTab).toBe("light");

      // Commit same value — guard should prevent activeTab from re-assignment
      store.commit("appTheme", "light");
      await nextTick();
      expect(vm.activeTab).toBe("light");
      wrapper.unmount();
    });

    it("updates customLightColor when organizationSettings changes and no localStorage color", async () => {
      const { store, wrapper } = await createWrapperWithRealStore();
      const vm = wrapper.vm as any;

      mockLocalStorage.getItem.mockReturnValue(null);
      // Commit new org settings — fires the deep watcher
      store.commit("setOrganizationSettings", {
        light_mode_theme_color: "#AABBCC",
        dark_mode_theme_color: "#112233",
      });
      await nextTick();
      await nextTick(); // deep watcher may need an extra tick

      expect(vm.customLightColor).toBe("#AABBCC");
      wrapper.unmount();
    });

    it("does not update customLightColor when hasTempColors is set in orgSettings watcher", async () => {
      const { store, wrapper } = await createWrapperWithRealStore();
      const vm = wrapper.vm as any;

      // Simulate temp colors being active in the store
      (store.state as any).tempThemeColors = { light: "#FF0000", dark: null };
      mockLocalStorage.getItem.mockReturnValue(null);

      const colorBefore = vm.customLightColor;

      store.commit("setOrganizationSettings", {
        light_mode_theme_color: "#DEADBE",
        dark_mode_theme_color: "#EFFACE",
      });
      await nextTick();
      await nextTick();

      // hasTempColors guard should have returned early
      expect(vm.customLightColor).toBe(colorBefore);
      wrapper.unmount();
    });
  });

  describe("Watch handlers — activeTab", () => {
    it("dispatches appTheme when activeTab changes to a different theme mode", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // store.state.theme starts as "light"; changing to dark should dispatch
      vm.activeTab = "dark";
      await nextTick();

      expect(mockStore.dispatch).toHaveBeenCalledWith("appTheme", "dark");
    });

    it("does not dispatch appTheme when activeTab matches current store.state.theme", async () => {
      // Set store theme to dark before mounting so they start in sync
      mockStore.state.theme = "dark";
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // activeTab defaults to "light" (store override not used by default during mount)
      // but the component syncs from store.state.theme — let's directly set activeTab to dark
      // first to match the store
      vm.activeTab = "dark";
      await nextTick();
      vi.clearAllMocks();

      // Now set it to the same value — watcher should not dispatch again
      vm.activeTab = "dark";
      await nextTick();

      expect(mockStore.dispatch).not.toHaveBeenCalled();
    });

    it("sets localStorage theme key when activeTab changes", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.activeTab = "dark";
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith("theme", "dark");
    });
  });

  describe("Lifecycle — MutationObserver and onUnmounted", () => {
    it("disconnects the MutationObserver on unmount without throwing", async () => {
      const wrapper = createWrapper();

      // Unmounting must not throw even if observer is null
      await wrapper.unmount();
      // If we got here without an error, the guard `if (observer)` worked
      expect(true).toBe(true);
    });

    it("triggers applyThemeForMode when body class changes to body--dark", async () => {
      const { applyThemeForMode } = await import("@/utils/themeManager");
      const wrapper = createWrapper();
      // Wait for onMounted to set up the observer
      await nextTick();

      // Reset so we can check for new calls
      vi.clearAllMocks();

      // Simulate the body class toggle (the MutationObserver watches this)
      document.body.classList.add("body--dark");
      // MutationObserver fires asynchronously in a microtask
      await new Promise((resolve) => setTimeout(resolve, 0));

      // applyThemeForMode should have been called by the observer callback
      expect(applyThemeForMode).toHaveBeenCalledWith("dark", expect.anything());

      // Cleanup
      document.body.classList.remove("body--dark");
      wrapper.unmount();
    });

    it("does NOT call applyThemeForMode when temp colors exist (observer hasTempColors guard)", async () => {
      const { applyThemeForMode } = await import("@/utils/themeManager");

      // Mount with temp colors active
      mockStore.state.tempThemeColors = { light: "#FF0000", dark: null };
      const wrapper = createWrapper();
      await nextTick();
      vi.clearAllMocks();

      // Trigger the MutationObserver
      document.body.classList.add("body--dark");
      await new Promise((resolve) => setTimeout(resolve, 0));

      // With hasTempColors=true the observer returns early — no call
      expect(applyThemeForMode).not.toHaveBeenCalled();

      // Cleanup
      document.body.classList.remove("body--dark");
      wrapper.unmount();
    });
  });

  describe("Dialog Controls", () => {
    it("should pass title 'Theme' to ODrawer", () => {
      const wrapper = createWrapper();

      const drawer = wrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.exists()).toBe(true);
      expect(drawer.attributes("data-title")).toBe("Theme");
    });

    it("should pass title 'Pick Custom Color' to inner ODialog", () => {
      const wrapper = createWrapper();

      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.exists()).toBe(true);
      expect(dialog.attributes("data-title")).toBe("Pick Custom Color");
    });

    it("should close color picker when ODialog emits click:primary", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.showColorPicker = true;
      await nextTick();
      expect(vm.showColorPicker).toBe(true);

      const primaryBtn = wrapper.find('[data-test-stub="o-dialog-primary"]');
      await primaryBtn.trigger("click");
      await nextTick();

      expect(vm.showColorPicker).toBe(false);
    });

    it("ODialog primary button label is 'Apply'", () => {
      const wrapper = createWrapper();

      const primaryBtn = wrapper.find('[data-test-stub="o-dialog-primary"]');
      expect(primaryBtn.text()).toBe("Apply");
    });

    it("ODialog neutral button label is 'Cancel'", () => {
      const wrapper = createWrapper();

      const neutralBtn = wrapper.find('[data-test-stub="o-dialog-neutral"]');
      expect(neutralBtn.text()).toBe("Cancel");
    });

    it("should close color picker when ODialog emits click:neutral", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.showColorPicker = true;
      await nextTick();

      const neutralBtn = wrapper.find('[data-test-stub="o-dialog-neutral"]');
      await neutralBtn.trigger("click");
      await nextTick();

      expect(vm.showColorPicker).toBe(false);
    });

    it("should close drawer when dialogOpen is set to false", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.dialogOpen = true;
      await nextTick();
      expect(vm.dialogOpen).toBe(true);

      vm.dialogOpen = false;
      await nextTick();

      expect(vm.dialogOpen).toBe(false);
    });
  });
});
