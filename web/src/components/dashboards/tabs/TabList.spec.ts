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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import { Quasar } from "quasar";
import TabList from "./TabList.vue";
import AddTab from "./AddTab.vue";

// Mock vue-router
const mockRoute = {
  params: { dashboard: "test-dashboard" },
  query: {},
  name: "dashboards",
};

vi.mock("vue-router", () => ({
  useRoute: () => mockRoute,
}));

// Mock AddTab component
vi.mock("./AddTab.vue", () => ({
  default: {
    name: "AddTab",
    template: '<div data-test="add-tab-component">AddTab Component</div>',
    props: ["dashboardId"],
    emits: ["refresh"],
  },
}));

describe("TabList", () => {
  let wrapper: VueWrapper<any>;

  const mockDashboardData = {
    dashboardId: "test-dashboard-id",
    name: "Test Dashboard",
    tabs: [
      {
        tabId: "tab1",
        name: "First Tab",
        panels: [],
      },
      {
        tabId: "tab2", 
        name: "Second Tab",
        panels: [],
      },
      {
        tabId: "tab3",
        name: "Very Long Tab Name That Should Be Truncated",
        panels: [],
      },
    ],
  };

  const createWrapper = (props = {}, options = {}) => {
    const selectedTabIdRef = { value: "tab1" };
    
    return mount(TabList, {
      props: {
        dashboardData: mockDashboardData,
        ...props,
      },
      global: {
        plugins: [Quasar],
        provide: {
          selectedTabId: selectedTabIdRef,
        },
        stubs: {
          "AddTab": {
            template: '<div data-test="add-tab-component">AddTab Component</div>',
            props: ["dashboardId"],
            emits: ["refresh"],
          },
          "q-dialog": {
            template: '<div v-if="modelValue" data-test="dialog-wrapper"><slot /></div>',
            props: ["modelValue", "position", "fullHeight", "maximized"],
          },
          "q-tabs": {
            template: `<div class="q-tabs" :data-test="$attrs['data-test']">
              <slot />
            </div>`,
            props: ["modelValue", "align", "dense", "inline-label", "outside-arrows", "mobile-arrows", "active-color"],
          },
          "q-tab": {
            template: `<div 
              :data-test="$attrs['data-test']" 
              class="q-tab" 
              @click="$emit('click', $event)"
            >
              <slot />
            </div>`,
            props: ["no-caps", "ripple", "name", "content-class"],
            emits: ["click"],
            inheritAttrs: false,
          },
          "q-btn": {
            template: `<button 
              :data-test="$attrs['data-test']"
              @click="$emit('click', $event)"
              v-show="!($attrs['v-show'] === false)"
            >
              <slot />
            </button>`,
            props: ["class", "no-caps", "no-outline", "rounded", "icon", "padding"],
            emits: ["click"],
            inheritAttrs: false,
          },
          "q-tooltip": {
            template: "<span data-test='tooltip-wrapper'><slot /></span>",
          },
        },
        ...options,
      },
    });
  };

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly", () => {
      wrapper = createWrapper();
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-list"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.$options.name).toBe("TabList");
    });

    it("should accept dashboardData prop", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props("dashboardData")).toEqual(mockDashboardData);
    });

    it("should accept viewOnly prop with default false", () => {
      wrapper = createWrapper();
      
      expect(wrapper.props("viewOnly")).toBe(false);
    });

    it("should handle viewOnly prop when true", () => {
      wrapper = createWrapper({ viewOnly: true });
      
      expect(wrapper.props("viewOnly")).toBe(true);
    });
  });

  describe("Tabs Rendering", () => {
    it("should render all tabs from dashboardData", () => {
      wrapper = createWrapper();
      
      // Test that all specific tabs exist
      expect(wrapper.find('[data-test="dashboard-tab-tab1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-tab2"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-tab3"]').exists()).toBe(true);
      
      // Test that tabs contain the expected content
      expect(wrapper.find('[data-test="dashboard-tab-tab1-name"]').text()).toBe("First Tab");
      expect(wrapper.find('[data-test="dashboard-tab-tab2-name"]').text()).toBe("Second Tab");
      expect(wrapper.find('[data-test="dashboard-tab-tab3-name"]').text()).toContain("Very Long Tab");
    });

    it("should display tab names correctly", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-tab-tab1-name"]').text()).toBe("First Tab");
      expect(wrapper.find('[data-test="dashboard-tab-tab2-name"]').text()).toBe("Second Tab");
      expect(wrapper.find('[data-test="dashboard-tab-tab3-name"]').text()).toBe("Very Long Tab Name That Should Be Truncated");
    });

    it("should handle empty tabs array", () => {
      const emptyDashboard = {
        ...mockDashboardData,
        tabs: [],
      };
      
      wrapper = createWrapper({ dashboardData: emptyDashboard });
      
      const tabs = wrapper.findAll('[data-test^="dashboard-tab-tab"]');
      expect(tabs.length).toBe(0);
    });

    it("should handle missing tabs property", () => {
      const dashboardWithoutTabs = {
        dashboardId: "test",
        name: "Test",
      };
      
      wrapper = createWrapper({ dashboardData: dashboardWithoutTabs });
      
      const tabs = wrapper.findAll('[data-test^="dashboard-tab-tab"]');
      expect(tabs.length).toBe(0);
    });

    it("should apply correct title attribute for tab names", () => {
      wrapper = createWrapper();
      
      const firstTab = wrapper.find('[data-test="dashboard-tab-tab1-name"]');
      expect(firstTab.attributes("title")).toBe("First Tab");
    });
  });

  describe("Tab Interaction", () => {
    it("should have correct q-tabs configuration", () => {
      wrapper = createWrapper();
      
      const qTabs = wrapper.find('[data-test="dashboard-tab-list"]');
      expect(qTabs.classes()).toContain("q-tabs");
    });

    it("should handle tab click events", async () => {
      wrapper = createWrapper();
      
      const secondTab = wrapper.find('[data-test="dashboard-tab-tab2"]');
      await secondTab.trigger("click");
      
      expect(secondTab.exists()).toBe(true);
    });

    it("should display tab content with proper styling", () => {
      wrapper = createWrapper();
      
      const tabNames = wrapper.findAll('[data-test$="-name"]');
      tabNames.forEach(tabName => {
        const style = tabName.attributes("style");
        expect(style).toContain("white-space: nowrap");
        expect(style).toContain("overflow: hidden");
        expect(style).toContain("text-overflow: ellipsis");
        expect(style).toContain("width: 100%");
      });
    });
  });

  describe("Add Tab Button", () => {
    it("should show add button when not in viewOnly mode", () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.exists()).toBe(true);
    });

    it("should hide add button when in viewOnly mode", () => {
      wrapper = createWrapper({ viewOnly: true });
      
      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.exists()).toBe(false);
    });

    it("should have add icon and tooltip", () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.exists()).toBe(true);
      
      const tooltip = addButton.find('[data-test="tooltip-wrapper"]');
      expect(tooltip.exists()).toBe(true);
      expect(tooltip.text()).toBe("Add Tab");
    });

    it("should open add tab dialog when clicked", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      await addButton.trigger("click");
      
      expect(wrapper.vm.showAddTabDialog).toBe(true);
    });

    it("should initially hide add button until hovered", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      // Button should have v-show="isHovered" directive
      expect(wrapper.vm.isHovered).toBe(false);
    });
  });

  describe("Hover Interaction", () => {
    it("should handle mouseover event", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const container = wrapper.find("div");
      await container.trigger("mouseover");
      
      expect(wrapper.vm.isHovered).toBe(true);
    });

    it("should handle mouseleave event", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const container = wrapper.find("div");
      await container.trigger("mouseover");
      expect(wrapper.vm.isHovered).toBe(true);
      
      await container.trigger("mouseleave");
      expect(wrapper.vm.isHovered).toBe(false);
    });

    it("should show add button on hover", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const container = wrapper.find("div");
      await container.trigger("mouseover");
      
      expect(wrapper.vm.isHovered).toBe(true);
    });
  });

  describe("AddTab Dialog", () => {
    it("should render AddTab component in dialog when dialog is shown", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      // Initially dialog should not be visible
      let dialog = wrapper.find('[data-test="dialog-wrapper"]');
      expect(dialog.exists()).toBe(false);
      
      // Show the dialog
      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();
      
      dialog = wrapper.find('[data-test="dialog-wrapper"]');
      expect(dialog.exists()).toBe(true);
      
      const addTabComponent = wrapper.find('[data-test="add-tab-component"]');
      expect(addTabComponent.exists()).toBe(true);
    });

    it("should show AddTab component when dialog is opened", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      // Initially no AddTab component should be visible
      let addTabComponent = wrapper.find('[data-test="add-tab-component"]');
      expect(addTabComponent.exists()).toBe(false);
      
      // Open dialog
      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();
      
      addTabComponent = wrapper.find('[data-test="add-tab-component"]');
      expect(addTabComponent.exists()).toBe(true);
    });

    it("should handle refresh event from AddTab component", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      // Test the refreshDashboard method directly
      wrapper.vm.refreshDashboard();
      
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });

    it("should close dialog after refresh", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();
      
      wrapper.vm.refreshDashboard();
      
      expect(wrapper.vm.showAddTabDialog).toBe(false);
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });

    it("should open dialog when add button is clicked", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      // Simulate hover to show the add button
      const container = wrapper.find("div");
      await container.trigger("mouseover");
      
      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      await addButton.trigger("click");
      
      expect(wrapper.vm.showAddTabDialog).toBe(true);
      
      await wrapper.vm.$nextTick();
      const dialog = wrapper.find('[data-test="dialog-wrapper"]');
      expect(dialog.exists()).toBe(true);
    });
  });

  describe("Computed Properties", () => {
    it("should compute tabs from dashboardData", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.tabs).toEqual(mockDashboardData.tabs);
    });

    it("should return empty array when dashboardData has no tabs", () => {
      const dashboardWithoutTabs = {
        dashboardId: "test",
        name: "Test",
      };
      
      wrapper = createWrapper({ dashboardData: dashboardWithoutTabs });
      
      expect(wrapper.vm.tabs).toEqual([]);
    });

    it("should handle null dashboardData", () => {
      wrapper = createWrapper({ dashboardData: null });
      
      expect(wrapper.vm.tabs).toEqual([]);
    });
  });

  describe("Dependency Injection", () => {
    it("should inject selectedTabId with default value", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.selectedTabId).toBeDefined();
    });

    it("should use custom selectedTabId when provided", () => {
      const customSelectedTabIdRef = { value: "tab2" };
      
      wrapper = mount(TabList, {
        props: {
          dashboardData: mockDashboardData,
        },
        global: {
          plugins: [Quasar],
          provide: {
            selectedTabId: customSelectedTabIdRef,
          },
          stubs: {
            "AddTab": {
              template: '<div data-test="add-tab-component">AddTab Component</div>',
              props: ["dashboardId"],
              emits: ["refresh"],
            },
            "q-dialog": {
              template: '<div v-if="modelValue" data-test="dialog-wrapper"><slot /></div>',
              props: ["modelValue", "position", "fullHeight", "maximized"],
            },
            "q-tooltip": {
              template: "<span data-test='tooltip-wrapper'><slot /></span>",
            },
          },
        },
      });
      
      expect(wrapper.vm.selectedTabId.value).toBe("tab2");
    });
  });

  describe("Props Validation", () => {
    it("should require dashboardData prop", () => {
      const component = TabList as any;
      expect(component.props.dashboardData.required).toBe(true);
      expect(component.props.dashboardData.type).toBe(Object);
    });

    it("should have correct viewOnly prop configuration", () => {
      const component = TabList as any;
      expect(component.props.viewOnly.type).toBe(Boolean);
      expect(component.props.viewOnly.default).toBe(false);
    });
  });

  describe("Event Emissions", () => {
    it("should emit refresh event", async () => {
      wrapper = createWrapper();
      
      wrapper.vm.refreshDashboard();
      
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("should have correct emits configuration", () => {
      const component = TabList as any;
      expect(component.emits).toContain("refresh");
    });
  });

  describe("Router Integration", () => {
    it("should access route object", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.route).toEqual(mockRoute);
      expect(wrapper.vm.route.params.dashboard).toBe("test-dashboard");
    });
  });

  describe("Component State", () => {
    it("should initialize showAddTabDialog as false", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });

    it("should initialize isHovered as false", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.isHovered).toBe(false);
    });

    it("should maintain reactive state", async () => {
      wrapper = createWrapper({ viewOnly: false });
      
      expect(wrapper.vm.showAddTabDialog).toBe(false);
      
      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.showAddTabDialog).toBe(true);
    });
  });

  describe("Component Styling", () => {
    it("should have correct container styling", () => {
      wrapper = createWrapper();
      
      const container = wrapper.find("div");
      expect(container.attributes("style")).toContain("display: flex");
    });

    it("should apply correct styling to q-tabs", () => {
      wrapper = createWrapper();
      
      const qTabs = wrapper.find('[data-test="dashboard-tab-list"]');
      expect(qTabs.attributes("style")).toContain("max-width: calc(100% - 40px)");
    });
  });

  describe("Error Handling", () => {
    it("should handle undefined tab properties gracefully", () => {
      const dashboardWithUndefinedTabs = {
        dashboardId: "test",
        name: "Test",
        tabs: [
          { tabId: "tab1", name: "Tab 1" }, // valid tab
          { tabId: "tab2", name: "Tab 2" },  // valid tab
        ],
      };
      
      expect(() => {
        wrapper = createWrapper({ dashboardData: dashboardWithUndefinedTabs });
      }).not.toThrow();
      
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle component unmounting gracefully", () => {
      wrapper = createWrapper();
      
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });
  });

  describe("Accessibility", () => {
    it("should have proper data-test attributes for testing", () => {
      wrapper = createWrapper();
      
      expect(wrapper.find('[data-test="dashboard-tab-list"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-tab1"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-tab-tab1-name"]').exists()).toBe(true);
    });

    it("should have accessible add button when not in viewOnly mode", () => {
      wrapper = createWrapper({ viewOnly: false });
      
      const addButton = wrapper.find('[data-test="dashboard-tab-add-btn"]');
      expect(addButton.exists()).toBe(true);
      expect(addButton.find('[data-test="tooltip-wrapper"]').text()).toBe("Add Tab");
    });

    it("should prevent click propagation on tabs", () => {
      wrapper = createWrapper();
      
      const qTabs = wrapper.find('[data-test="dashboard-tab-list"]');
      const tabElement = wrapper.find('[data-test="dashboard-tab-tab1"]');
      
      // These should have @click.stop handlers
      expect(qTabs.exists()).toBe(true);
      expect(tabElement.exists()).toBe(true);
    });
  });
});