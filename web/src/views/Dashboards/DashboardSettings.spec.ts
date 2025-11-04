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

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { createStore } from "vuex";
import { createRouter, createWebHistory } from "vue-router";
import { createI18n } from "vue-i18n";
import { Quasar } from "quasar";
import DashboardSettings from "./DashboardSettings.vue";

// Mock child components
const mockGeneralSettings = {
  name: "GeneralSettings",
  template: '<div data-test="general-settings-mock">GeneralSettings</div>',
  emits: ["save"]
};

const mockVariableSettings = {
  name: "VariableSettings", 
  template: '<div data-test="variable-settings-mock">VariableSettings</div>',
  emits: ["save"]
};

const mockTabsSettings = {
  name: "TabsSettings",
  template: '<div data-test="tabs-settings-mock">TabsSettings</div>',
  emits: ["refresh"]
};

// Mock getImageURL utility
vi.mock("../../utils/zincutils", () => ({
  getImageURL: vi.fn((path: string) => `mocked-${path}`)
}));

describe("DashboardSettings.vue", () => {
  let wrapper: VueWrapper;
  let store: any;
  let router: any;
  let i18n: any;

  // Mock store state
  const createMockStore = (theme = "light") => {
    return createStore({
      state: {
        theme,
        selectedOrganization: {
          identifier: "test-org"
        }
      },
      getters: {},
      mutations: {},
      actions: {}
    });
  };

  // Mock router
  const createMockRouter = () => {
    return createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/", component: { template: "<div>Home</div>" } }
      ]
    });
  };

  // Mock i18n
  const createMockI18n = () => {
    return createI18n({
      legacy: false,
      locale: "en",
      messages: {
        en: {
          dashboard: {
            setting: "Dashboard Settings",
            generalSettings: "General Settings", 
            variableSettings: "Variable Settings",
            tabSettings: "Tab Settings"
          }
        }
      }
    });
  };

  beforeEach(() => {
    store = createMockStore();
    router = createMockRouter();
    i18n = createMockI18n();
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Mounting and Initialization", () => {
    it("should mount successfully", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize with correct default values", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const vm = wrapper.vm as any;
      expect(vm.activeTab).toBe("generalSettings");
      expect(vm.splitterModel).toBe(220);
      expect(vm.templates).toEqual([]);
    });

    it("should have correct component name", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      expect(wrapper.vm.$options.name).toBe("AppSettings");
    });
  });

  describe("Template Rendering", () => {
    it("should render main container with correct theme class for light theme", () => {
      store = createMockStore("light");
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const mainContainer = wrapper.find(".q-pa-none");
      expect(mainContainer.exists()).toBe(true);
      expect(mainContainer.classes()).toContain("bg-white");
      expect(mainContainer.classes()).not.toContain("dark-mode");
    });

    it("should render main container with correct theme class for dark theme", () => {
      store = createMockStore("dark");
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const mainContainer = wrapper.find(".q-pa-none");
      expect(mainContainer.exists()).toBe(true);
      expect(mainContainer.classes()).toContain("dark-mode");
      expect(mainContainer.classes()).not.toContain("bg-white");
    });

    it("should render dashboard settings title", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const title = wrapper.find(".text-h6");
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe("Dashboard Settings");
    });

    it("should render close button", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const closeButton = wrapper.find('[data-test="dashboard-settings-close-btn"]');
      expect(closeButton.exists()).toBe(true);
    });

    it("should render splitter with correct model value", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const splitter = wrapper.findComponent({ name: "QSplitter" });
      expect(splitter.exists()).toBe(true);
      expect(splitter.props("modelValue")).toBe(220);
    });
  });

  describe("Tabs Functionality", () => {
    it("should render all three tabs with correct names and labels", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const generalTab = wrapper.find('[data-test="dashboard-settings-general-tab"]');
      const variableTab = wrapper.find('[data-test="dashboard-settings-variable-tab"]');  
      const tabTab = wrapper.find('[data-test="dashboard-settings-tab-tab"]');

      expect(generalTab.exists()).toBe(true);
      expect(variableTab.exists()).toBe(true);
      expect(tabTab.exists()).toBe(true);

      expect(generalTab.text()).toContain("General Settings");
      expect(variableTab.text()).toContain("Variable Settings");
      expect(tabTab.text()).toContain("Tab Settings");
    });

    it("should have generalSettings as default active tab", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const tabs = wrapper.findComponent({ name: "QTabs" });
      expect(tabs.exists()).toBe(true);
      expect(tabs.props("modelValue")).toBe("generalSettings");
    });

    it("should change active tab when a different tab is clicked", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const variableTab = wrapper.find('[data-test="dashboard-settings-variable-tab"]');
      await variableTab.trigger("click");

      expect(wrapper.vm.activeTab).toBe("variableSettings");
    });

    it("should render tab panels component", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const tabPanels = wrapper.findComponent({ name: "QTabPanels" });
      expect(tabPanels.exists()).toBe(true);
      expect(tabPanels.props("modelValue")).toBe("generalSettings");
    });

    it("should render active tab component (GeneralSettings by default)", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const generalSettings = wrapper.findComponent({ name: "GeneralSettings" });
      expect(generalSettings.exists()).toBe(true);
    });

    it("should render VariableSettings component when variable tab is active", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      // Change to variable tab
      const variableTab = wrapper.find('[data-test="dashboard-settings-variable-tab"]');
      await variableTab.trigger("click");

      const variableSettings = wrapper.findComponent({ name: "VariableSettings" });
      expect(variableSettings.exists()).toBe(true);
    });

    it("should render TabsSettings component when tab tab is active", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      // Change to tab tab
      const tabTab = wrapper.find('[data-test="dashboard-settings-tab-tab"]');
      await tabTab.trigger("click");

      const tabsSettings = wrapper.findComponent({ name: "TabsSettings" });
      expect(tabsSettings.exists()).toBe(true);
    });
  });

  describe("Methods and Event Handling", () => {
    it("should emit refresh event when refreshRequired is called", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      // Call the refreshRequired method directly
      const vm = wrapper.vm as any;
      vm.refreshRequired();

      // Check if refresh event was emitted
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("should emit refresh event when GeneralSettings emits save event", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const generalSettings = wrapper.findComponent({ name: "GeneralSettings" });
      
      // Emit save event from GeneralSettings
      await generalSettings.vm.$emit("save");

      // Check if refresh event was emitted from parent
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("should emit refresh event when VariableSettings emits save event", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      // Switch to variable tab first
      const variableTab = wrapper.find('[data-test="dashboard-settings-variable-tab"]');
      await variableTab.trigger("click");

      const variableSettings = wrapper.findComponent({ name: "VariableSettings" });
      
      // Emit save event from VariableSettings
      await variableSettings.vm.$emit("save");

      // Check if refresh event was emitted from parent
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("should emit refresh event when TabsSettings emits refresh event", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      // Switch to tab tab first
      const tabTab = wrapper.find('[data-test="dashboard-settings-tab-tab"]');
      await tabTab.trigger("click");

      const tabsSettings = wrapper.findComponent({ name: "TabsSettings" });
      
      // Emit refresh event from TabsSettings
      await tabsSettings.vm.$emit("refresh");

      // Check if refresh event was emitted from parent
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("should handle close button click functionality", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const closeButton = wrapper.find('[data-test="dashboard-settings-close-btn"]');
      expect(closeButton.exists()).toBe(true);
      
      // Verify it's a button element
      expect(closeButton.element.tagName.toLowerCase()).toBe('i');
      
      // Test that clicking the button doesn't throw an error
      await closeButton.trigger('click');
      
      // The button should be clickable
      expect(closeButton.exists()).toBe(true);
    });

    it("should handle splitter model value changes", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const splitter = wrapper.findComponent({ name: "QSplitter" });
      expect(splitter.exists()).toBe(true);
      
      // Test initial splitter value
      expect(splitter.props("modelValue")).toBe(220);
      
      // Test changing splitter value
      const vm = wrapper.vm as any;
      vm.splitterModel = 300;
      await wrapper.vm.$nextTick();
      
      expect(vm.splitterModel).toBe(300);
    });
  });

  describe("Edge Cases and Error Scenarios", () => {
    it("should handle missing or undefined theme state", () => {
      const storeWithoutTheme = createMockStore();
      storeWithoutTheme.state.theme = undefined;

      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [storeWithoutTheme, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const mainContainer = wrapper.find(".q-pa-none");
      expect(mainContainer.exists()).toBe(true);
      // Should default to light theme behavior when theme is undefined
      expect(mainContainer.classes()).toContain("bg-white");
    });

    it("should handle null theme state", () => {
      const storeWithNullTheme = createMockStore();
      storeWithNullTheme.state.theme = null;

      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [storeWithNullTheme, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const mainContainer = wrapper.find(".q-pa-none");
      expect(mainContainer.exists()).toBe(true);
      // Should default to light theme behavior when theme is null
      expect(mainContainer.classes()).toContain("bg-white");
    });

    it("should handle empty templates array", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const vm = wrapper.vm as any;
      expect(vm.templates).toEqual([]);
      expect(Array.isArray(vm.templates)).toBe(true);
    });

    it("should maintain activeTab state when switching between tabs rapidly", async () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      // Rapidly switch tabs
      const variableTab = wrapper.find('[data-test="dashboard-settings-variable-tab"]');
      const tabTab = wrapper.find('[data-test="dashboard-settings-tab-tab"]');
      const generalTab = wrapper.find('[data-test="dashboard-settings-general-tab"]');

      await variableTab.trigger("click");
      expect(wrapper.vm.activeTab).toBe("variableSettings");

      await tabTab.trigger("click");
      expect(wrapper.vm.activeTab).toBe("tabSettings");

      await generalTab.trigger("click");
      expect(wrapper.vm.activeTab).toBe("generalSettings");
    });

    it("should handle getImageURL function call", () => {
      wrapper = mount(DashboardSettings, {
        global: {
          plugins: [store, router, i18n, Quasar],
          components: {
            GeneralSettings: mockGeneralSettings,
            VariableSettings: mockVariableSettings,
            TabsSettings: mockTabsSettings
          }
        }
      });

      const vm = wrapper.vm as any;
      expect(typeof vm.getImageURL).toBe("function");
      
      // Test that getImageURL returns expected format
      const result = vm.getImageURL("test-path");
      expect(result).toBe("mocked-test-path");
    });
  });
});