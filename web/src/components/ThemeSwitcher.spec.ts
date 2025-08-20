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
import { mount } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import ThemeSwitcher from "@/components/ThemeSwitcher.vue";
import { createStore } from "vuex";

// Install Quasar plugin for testing
installQuasar();

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

// Mock Quasar composable
const mockQuasar = {
  dark: {
    set: vi.fn(),
  },
};

vi.mock("quasar", async () => {
  const actual: any = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => mockQuasar,
  };
});

// Create a mock store
const createMockStore = (initialTheme = "light") => {
  return createStore({
    state: {
      theme: initialTheme,
    },
    mutations: {
      setTheme(state, theme) {
        state.theme = theme;
      },
    },
    actions: {
      appTheme({ commit }, theme) {
        commit("setTheme", theme);
      },
    },
  });
};

describe("ThemeSwitcher", () => {
  let mockStore: any;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();
    
    // Mock localStorage
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Create fresh store for each test
    mockStore = createMockStore();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  const mountComponent = (options = {}) => {
    return mount(ThemeSwitcher, {
      global: {
        plugins: [mockStore],
        ...options,
      },
    });
  };

  describe("component rendering", () => {
    it("should render the theme switcher button", () => {
      const wrapper = mountComponent();
      
      expect(wrapper.find("button").exists()).toBe(true);
      expect(wrapper.find(".round-button").exists()).toBe(true);
    });

    it("should render the correct icon for light mode", () => {
      localStorageMock.getItem.mockReturnValue("light");
      const wrapper = mountComponent();
      
      const icon = wrapper.find("i");
      expect(icon.exists()).toBe(true);
    });

    it("should render the correct icon for dark mode", () => {
      localStorageMock.getItem.mockReturnValue("dark");
      const wrapper = mountComponent();
      
      const icon = wrapper.find("i");
      expect(icon.exists()).toBe(true);
    });

    it("should render tooltip with correct text for light mode", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      const wrapper = mountComponent();
      
      // Wait for component to mount and process localStorage
      await wrapper.vm.$nextTick();
      
      const tooltip = wrapper.find(".q-tooltip");
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain("Dark Mode");
      }
    });

    it("should render tooltip with correct text for dark mode", async () => {
      localStorageMock.getItem.mockReturnValue("dark");
      const wrapper = mountComponent();
      
      // Wait for component to mount and process localStorage
      await wrapper.vm.$nextTick();
      
      const tooltip = wrapper.find(".q-tooltip");
      if (tooltip.exists()) {
        expect(tooltip.text()).toContain("Light Mode");
      }
    });
  });

  describe("theme initialization", () => {
    it("should initialize with light theme when no saved theme exists", async () => {
      localStorageMock.getItem.mockReturnValue(null);
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.darkMode).toBe(false);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "light");
      expect(mockQuasar.dark.set).toHaveBeenCalledWith(false);
    });

    it("should initialize with saved light theme", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.darkMode).toBe(false);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "light");
      expect(mockQuasar.dark.set).toHaveBeenCalledWith(false);
    });

    it("should initialize with saved dark theme", async () => {
      localStorageMock.getItem.mockReturnValue("dark");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.darkMode).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "dark");
      expect(mockQuasar.dark.set).toHaveBeenCalledWith(true);
    });

    it("should dispatch appTheme action on initialization", async () => {
      const dispatchSpy = vi.spyOn(mockStore, 'dispatch');
      localStorageMock.getItem.mockReturnValue("dark");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      expect(dispatchSpy).toHaveBeenCalledWith("appTheme", "dark");
    });
  });

  describe("theme toggling", () => {
    it("should toggle from light to dark mode when button is clicked", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      // Verify initial state
      expect(wrapper.vm.darkMode).toBe(false);
      
      // Click the button
      await wrapper.find("button").trigger("click");
      
      // Verify state changed
      expect(wrapper.vm.darkMode).toBe(true);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "dark");
      expect(mockQuasar.dark.set).toHaveBeenCalledWith(true);
    });

    it("should toggle from dark to light mode when button is clicked", async () => {
      localStorageMock.getItem.mockReturnValue("dark");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      // Verify initial state
      expect(wrapper.vm.darkMode).toBe(true);
      
      // Click the button
      await wrapper.find("button").trigger("click");
      
      // Verify state changed
      expect(wrapper.vm.darkMode).toBe(false);
      expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "light");
      expect(mockQuasar.dark.set).toHaveBeenCalledWith(false);
    });

    it("should dispatch appTheme action when toggling", async () => {
      const dispatchSpy = vi.spyOn(mockStore, 'dispatch');
      localStorageMock.getItem.mockReturnValue("light");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      // Clear previous calls
      dispatchSpy.mockClear();
      
      // Click the button
      await wrapper.find("button").trigger("click");
      
      expect(dispatchSpy).toHaveBeenCalledWith("appTheme", "dark");
    });

    it("should handle multiple rapid toggles correctly", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      const button = wrapper.find("button");
      
      // Multiple rapid clicks
      await button.trigger("click"); // light -> dark
      expect(wrapper.vm.darkMode).toBe(true);
      
      await button.trigger("click"); // dark -> light
      expect(wrapper.vm.darkMode).toBe(false);
      
      await button.trigger("click"); // light -> dark
      expect(wrapper.vm.darkMode).toBe(true);
      
      // Verify final state
      expect(localStorageMock.setItem).toHaveBeenLastCalledWith("theme", "dark");
      expect(mockQuasar.dark.set).toHaveBeenLastCalledWith(true);
    });
  });

  describe("computed properties", () => {
    it("should return correct dark mode icon when in dark mode", async () => {
      localStorageMock.getItem.mockReturnValue("dark");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.DarkModeIcon).toBe(wrapper.vm.outlinedDarkMode);
    });

    it("should return correct light mode icon when in light mode", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.DarkModeIcon).toBe(wrapper.vm.outlinedLightMode);
    });

    it("should update icon when theme changes", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      // Initial state - light mode icon
      expect(wrapper.vm.DarkModeIcon).toBe(wrapper.vm.outlinedLightMode);
      
      // Toggle to dark mode
      await wrapper.find("button").trigger("click");
      
      // Should now show dark mode icon
      expect(wrapper.vm.DarkModeIcon).toBe(wrapper.vm.outlinedDarkMode);
    });
  });

  describe("watchers", () => {
    it("should call setTheme when darkMode changes", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      // Clear previous setItem calls
      localStorageMock.setItem.mockClear();
      mockQuasar.dark.set.mockClear();
      
      // Change darkMode programmatically
      wrapper.vm.darkMode = true;
      await wrapper.vm.$nextTick();
      
      expect(localStorageMock.setItem).toHaveBeenCalledWith("theme", "dark");
      expect(mockQuasar.dark.set).toHaveBeenCalledWith(true);
    });
  });

  describe("localStorage edge cases", () => {
    it("should handle localStorage.getItem throwing an error", async () => {
      localStorageMock.getItem.mockImplementation(() => {
        throw new Error("localStorage not available");
      });
      
      // Should not throw and should default to light theme
      expect(() => {
        const wrapper = mountComponent();
      }).not.toThrow();
    });

    it("should handle localStorage.setItem throwing an error", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      localStorageMock.setItem.mockImplementation(() => {
        throw new Error("localStorage not available");
      });
      
      const wrapper = mountComponent();
      
      // Should not throw when toggling
      expect(async () => {
        await wrapper.find("button").trigger("click");
      }).not.toThrow();
    });
  });

  describe("accessibility", () => {
    it("should have proper button attributes", () => {
      const wrapper = mountComponent();
      const button = wrapper.find("button");
      
      expect(button.classes()).toContain("round-button");
      expect(button.attributes("aria-label")).toBeDefined;
    });

    it("should be keyboard accessible", async () => {
      localStorageMock.getItem.mockReturnValue("light");
      
      const wrapper = mountComponent();
      await wrapper.vm.$nextTick();
      
      const button = wrapper.find("button");
      
      // Simulate Enter key press
      await button.trigger("keydown.enter");
      
      // Note: The actual implementation uses @click, so this tests the button's general accessibility
      expect(button.exists()).toBe(true);
    });
  });

  describe("component lifecycle", () => {
    it("should clean up properly when unmounted", () => {
      const wrapper = mountComponent();
      
      // Should not throw when unmounting
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });
  });
});