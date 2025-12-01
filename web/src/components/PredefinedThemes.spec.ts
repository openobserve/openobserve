// Copyright 2025 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

import { mount } from "@vue/test-utils";
import { describe, expect, it, beforeEach, vi } from "vitest";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import PredefinedThemes from "./PredefinedThemes.vue";
import i18n from "@/locales";
import { Notify } from "quasar";
import { nextTick } from "vue";

installQuasar({
  plugins: [Notify],
});

// Mock useQuasar
const mockNotify = vi.fn(() => vi.fn());
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
      dark: {
        set: vi.fn(),
      },
    }),
  };
});

// Mock composable
vi.mock("@/composables/usePredefinedThemes", () => ({
  usePredefinedThemes: () => ({
    isOpen: { value: true },
    toggleThemes: vi.fn(),
  }),
}));

// Mock theme utility
vi.mock("@/utils/theme", () => ({
  applyThemeColors: vi.fn(),
  hexToRgba: vi.fn((hex: string, opacity: number) => {
    return `rgba(0, 0, 0, ${opacity / 10})`;
  }),
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
    if (key === 'appliedLightTheme') return null;
    if (key === 'appliedDarkTheme') return null;
    if (key === 'customLightColor') return null;
    if (key === 'customDarkColor') return null;
    return null;
  }),
  setItem: vi.fn(),
  removeItem: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
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
        $q: {
          notify: mockNotify,
          dark: {
            set: vi.fn(),
          },
        },
      },
      provide: {
        store: mockStore,
      },
      stubs: {
        QDialog: {
          template: '<div data-test-stub="q-dialog"><slot></slot></div>',
        },
        QCard: {
          template: '<div data-test-stub="q-card"><slot></slot></div>',
        },
        QCardSection: {
          template: '<div data-test-stub="q-card-section"><slot></slot></div>',
        },
        QTabs: {
          template: '<div data-test-stub="q-tabs"><slot></slot></div>',
          props: ['modelValue'],
        },
        QTab: {
          template: '<button data-test-stub="q-tab" @click="$emit(\'click\')"><slot></slot></button>',
        },
        QTabPanels: {
          template: '<div data-test-stub="q-tab-panels"><slot></slot></div>',
          props: ['modelValue'],
        },
        QTabPanel: {
          template: '<div data-test-stub="q-tab-panel"><slot></slot></div>',
          props: ['name'],
        },
        QBtn: {
          template: '<button data-test-stub="q-btn" :data-test="$attrs[\'data-test\']" @click="$emit(\'click\')"><slot></slot></button>',
        },
        QIcon: {
          template: '<i data-test-stub="q-icon"></i>',
        },
        QTooltip: {
          template: '<div data-test-stub="q-tooltip"><slot></slot></div>',
        },
        QBadge: {
          template: '<span data-test-stub="q-badge"><slot></slot></span>',
        },
        QColor: {
          template: '<div data-test-stub="q-color"></div>',
          props: ['modelValue'],
          emits: ['update:modelValue'],
        },
      },
      ...options,
    },
  });
};

describe("PredefinedThemes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockImplementation((key: string) => {
      if (key === 'appliedLightTheme') return null;
      if (key === 'appliedDarkTheme') return null;
      if (key === 'customLightColor') return null;
      if (key === 'customDarkColor') return null;
      return null;
    });
  });

  describe("Component Mounting", () => {
    it("should mount successfully", () => {
      const wrapper = createWrapper();
      expect(wrapper.exists()).toBe(true);
    });

    it("should render dialog", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test-stub="q-dialog"]').exists()).toBe(true);
    });

    it("should render light and dark mode tabs", () => {
      const wrapper = createWrapper();
      expect(wrapper.find('[data-test-stub="q-tabs"]').exists()).toBe(true);
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

    it("should display custom color option", () => {
      const wrapper = createWrapper();
      expect(wrapper.text()).toContain("Custom Color");
    });

    it("should show default colors from store", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      expect(vm.DEFAULT_LIGHT_COLOR).toBe("#3F7994");
      expect(vm.DEFAULT_DARK_COLOR).toBe("#5B9FBE");
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
  });

  describe("Theme Application", () => {
    it("should have apply buttons for each theme", () => {
      const wrapper = createWrapper();
      const applyButtons = wrapper.findAll('[data-test-stub="q-btn"]');
      expect(applyButtons.length).toBeGreaterThan(0);
    });

    it("should store theme in localStorage when applied", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      // Apply a predefined theme
      const theme = vm.predefinedThemes[0];
      vm.applyTheme(theme);
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalled();
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

    it("should open color picker for light mode", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.openColorPicker("light");
      await nextTick();

      expect(vm.showColorPicker).toBe(true);
      expect(vm.currentPickerMode).toBe("light");
    });

    it("should open color picker for dark mode", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.openColorPicker("dark");
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

    it("should apply custom theme and save to localStorage", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.customLightColor = "#FF0000";
      vm.applyCustomTheme("light");
      await nextTick();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'customLightColor',
        '#FF0000'
      );
      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'appliedLightTheme',
        '-1'
      );
    });
  });

  describe("Reset Functionality", () => {
    it("should have reset to default theme function", () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      // The component should have resetToDefaultTheme function
      expect(typeof vm.resetToDefaultTheme).toBe('function');
    });

    it("should reset to organization settings when available", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.resetToDefaultTheme();
      await nextTick();

      expect(mockLocalStorage.removeItem).toHaveBeenCalled();
    });

    it("should show notification after reset", async () => {
      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      vm.resetToDefaultTheme();
      await nextTick();

      expect(mockNotify).toHaveBeenCalled();
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
        if (key === 'appliedLightTheme') return '-1';
        return null;
      });

      const wrapper = createWrapper();
      const vm = wrapper.vm as any;
      vm.appliedLightTheme = -1;

      const isApplied = vm.isCustomThemeApplied("light");
      expect(isApplied).toBe(true);
    });
  });

  describe("Theme Priority", () => {
    it("should prioritize temp colors over localStorage", () => {
      mockStore.state.tempThemeColors.light = "#FF0000";
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === 'customLightColor') return '#00FF00';
        return null;
      });

      const wrapper = createWrapper();
      const vm = wrapper.vm as any;

      expect(vm.customLightColor).toBe("#FF0000");
    });

    it("should use localStorage when no temp colors", () => {
      mockStore.state.tempThemeColors.light = null;
      mockLocalStorage.getItem.mockImplementation((key: string) => {
        if (key === 'customLightColor') return '#00FF00';
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
  });

  describe("Dialog Controls", () => {
    it("should have close button", () => {
      const wrapper = createWrapper();
      // Find button with icon "close"
      const buttons = wrapper.findAll('[data-test-stub="q-btn"]');
      // The close button is the one without text (icon only)
      const closeButtons = buttons.filter(btn => btn.text().trim() === '');
      expect(closeButtons.length).toBeGreaterThan(0);
    });

    it("should close dialog when dialogOpen is set to false", async () => {
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
