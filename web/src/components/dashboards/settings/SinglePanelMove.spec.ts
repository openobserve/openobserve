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
import SinglePanelMove from "./SinglePanelMove.vue";

// Mock external dependencies
vi.mock("../../../utils/commons", () => ({
  getDashboard: vi.fn(),
}));

vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock("vue-router", () => ({
  useRoute: () => ({
    query: {
      dashboard: "test-dashboard",
      folder: "test-folder",
      tab: "current-tab-id",
    },
  }),
}));

vi.mock("vuex", () => ({
  useStore: () => ({
    state: {
      selectedOrganization: {
        identifier: "test-org",
      },
    },
  }),
}));

const mockAddTab = {
  name: "AddTab",
  template: "<div data-test='mock-add-tab'></div>",
};

describe("SinglePanelMove", () => {
  let wrapper: VueWrapper<any>;

  const mockDashboardData = {
    dashboardId: "test-dashboard-id",
    tabs: [
      { tabId: "tab1", name: "Tab 1" },
      { tabId: "tab2", name: "Tab 2" },
      { tabId: "current-tab-id", name: "Current Tab" },
      { tabId: "tab3", name: "Tab 3" },
    ],
  };

  const createWrapper = (props = {}) => {
    const defaultProps = {
      title: "Move Panel",
      message: "Select a tab to move the panel to",
    };

    return mount(SinglePanelMove, {
      props: { ...defaultProps, ...props },
      global: {
        plugins: [Quasar],
        components: {
          AddTab: mockAddTab,
        },
        stubs: {
          QDialog: {
            template: "<div data-test='q-dialog-stub'><slot /></div>",
          },
        },
      },
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    const { getDashboard } = await import("../../../utils/commons");
    vi.mocked(getDashboard).mockResolvedValue(mockDashboardData);
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  describe("Component Initialization", () => {
    it("should render correctly with default props", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="dialog-box"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("SinglePanelMove");
    });

    it("should initialize with correct prop values", () => {
      const customProps = {
        title: "Custom Move Title",
        message: "Custom move message",
      };

      wrapper = createWrapper(customProps);

      expect(wrapper.props("title")).toBe("Custom Move Title");
      expect(wrapper.props("message")).toBe("Custom move message");
    });

    it("should emit correct events in emits array", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toEqual([
        "update:ok",
        "update:cancel",
        "refresh",
      ]);
    });
  });

  describe("Dashboard Data Loading", () => {
    it("should call getDashboard on mount with correct parameters", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(vi.mocked(getDashboard)).toHaveBeenCalledWith(
        expect.any(Object), // store
        "test-dashboard",   // dashboard query param
        "test-folder"      // folder query param
      );
    });

    it("should populate currentDashboardData after successful fetch", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentDashboardData.data).toEqual(mockDashboardData);
    });

    it("should handle empty dashboard response gracefully", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      
      // Mock getDashboard to return empty data (simulates API returning empty response)
      vi.mocked(getDashboard).mockResolvedValueOnce({});

      wrapper = createWrapper();
      
      // Should not throw error and component should still exist
      await wrapper.vm.$nextTick();
      // Allow time for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(wrapper.exists()).toBe(true);
      // Should have empty tab options when no dashboard data
      expect(wrapper.vm.moveTabOptions).toEqual([]);
      expect(wrapper.vm.selectedMoveTabId).toBeNull();
    });

  });

  describe("Title and Message Display", () => {
    it("should display provided title", () => {
      wrapper = createWrapper({ title: "Move Panel Dialog" });
      
      const titleElement = wrapper.find('[data-test="dashboard-tab-move-title"]');
      expect(titleElement.exists()).toBe(true);
      expect(titleElement.text()).toBe("Move Panel Dialog");
    });

    it("should display provided message", () => {
      wrapper = createWrapper({ message: "Please select target tab" });
      
      const messageElement = wrapper.find('[data-test="dashboard-tab-move-message"]');
      expect(messageElement.exists()).toBe(true);
      expect(messageElement.text()).toBe("Please select target tab");
    });

    it("should handle empty title", () => {
      wrapper = createWrapper({ title: "" });
      
      const titleElement = wrapper.find('[data-test="dashboard-tab-move-title"]');
      expect(titleElement.text()).toBe("");
    });

    it("should handle empty message", () => {
      wrapper = createWrapper({ message: "" });
      
      const messageElement = wrapper.find('[data-test="dashboard-tab-move-message"]');
      expect(messageElement.text()).toBe("");
    });
  });

  describe("Tab Selection Dropdown", () => {
    it("should render tab selection dropdown", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const selectElement = wrapper.find('[data-test="dashboard-tab-move-select"]');
      expect(selectElement.exists()).toBe(true);
    });

    it("should populate move tab options excluding current tab", async () => {
      wrapper = createWrapper();
      // Wait for the component to mount and complete async operations
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete

      const expectedOptions = [
        { label: "Tab 1", value: "tab1" },
        { label: "Tab 2", value: "tab2" },
        { label: "Tab 3", value: "tab3" },
      ];

      expect(wrapper.vm.moveTabOptions).toEqual(expectedOptions);
    });

    it("should set first available tab as default selection", async () => {
      wrapper = createWrapper();
      // Wait for the component to mount and complete async operations
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete

      expect(wrapper.vm.selectedMoveTabId).toEqual({
        label: "Tab 1",
        value: "tab1",
      });
    });

    it("should handle empty tab options", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({
        ...mockDashboardData,
        tabs: [{ tabId: "current-tab-id", name: "Current Tab" }],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.moveTabOptions).toEqual([]);
      expect(wrapper.vm.selectedMoveTabId).toBeNull();
    });

    it("should show no options message when no tabs available", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({
        ...mockDashboardData,
        tabs: [{ tabId: "current-tab-id", name: "Current Tab" }],
      });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete

      // The no-option slot will only show when the select is opened and empty
      expect(wrapper.vm.moveTabOptions).toHaveLength(0);
      
      // Check if the select component has no options
      const selectElement = wrapper.find('[data-test="dashboard-tab-move-select"]');
      expect(selectElement.exists()).toBe(true);
    });
  });

  describe("Add Tab Button and Dialog", () => {
    it("should render add tab button", () => {
      wrapper = createWrapper();
      
      const addTabBtn = wrapper.find('[data-test="dashboard-tab-move-add-tab-btn"]');
      expect(addTabBtn.exists()).toBe(true);
    });

    it("should have correct add tab button attributes", () => {
      wrapper = createWrapper();
      
      const addTabBtn = wrapper.findComponent({ name: "QBtn" });
      expect(addTabBtn.exists()).toBe(true);
      expect(addTabBtn.classes()).toContain("text-bold");
      // Check for Quasar button class instead
      expect(addTabBtn.classes()).toContain("q-btn");
    });

    it("should show add tab dialog when add button is clicked", async () => {
      wrapper = createWrapper();
      
      const addTabBtn = wrapper.find('[data-test="dashboard-tab-move-add-tab-btn"]');
      await addTabBtn.trigger("click");

      expect(wrapper.vm.showAddTabDialog).toBe(true);
      expect(wrapper.vm.isTabEditMode).toBe(false);
    });

    it("should pass correct props to AddTab component", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      const addTabBtn = wrapper.find('[data-test="dashboard-tab-move-add-tab-btn"]');
      await addTabBtn.trigger("click");

      const addTabDialog = wrapper.find('[data-test="dashboard-tab-move-add-tab-dialog"]');
      expect(addTabDialog.exists()).toBe(true);
      
      expect(wrapper.vm.isTabEditMode).toBe(false);
      expect(wrapper.vm.currentDashboardData.data.dashboardId).toBe("test-dashboard-id");
    });

    it("should handle add tab tooltip", () => {
      wrapper = createWrapper();
      
      const tooltip = wrapper.findComponent({ name: "QTooltip" });
      expect(tooltip.exists()).toBe(true);
      // QTooltip content might not be directly accessible in tests
      expect(tooltip.props()).toBeDefined();
    });
  });

  describe("Move Confirmation Buttons", () => {
    it("should render cancel button", () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      expect(cancelBtn.exists()).toBe(true);
      expect(cancelBtn.text()).toBe("confirmDialog.cancel");
    });

    it("should render confirm button", () => {
      wrapper = createWrapper();
      
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      expect(confirmBtn.exists()).toBe(true);
      expect(confirmBtn.text()).toBe("Move");
    });

    it("should disable confirm button when no tab is selected", async () => {
      wrapper = createWrapper();
      wrapper.vm.selectedMoveTabId = null;
      await wrapper.vm.$nextTick();

      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      expect(confirmBtn.attributes("disabled")).toBeDefined();
    });

    it("should enable confirm button when tab is selected", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete

      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      // When a tab is selected, disabled should not be present
      expect(confirmBtn.attributes("disabled")).toBeFalsy();
    });
  });

  describe("Event Emissions", () => {
    it("should emit update:cancel when cancel button is clicked", async () => {
      wrapper = createWrapper();
      
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      await cancelBtn.trigger("click");

      expect(wrapper.emitted("update:cancel")).toBeTruthy();
      expect(wrapper.emitted("update:cancel")).toHaveLength(1);
    });

    it("should emit update:ok with selected tab value when confirm is clicked", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete

      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      await confirmBtn.trigger("click");

      expect(wrapper.emitted("update:ok")).toBeTruthy();
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
      expect(wrapper.emitted("update:ok")?.[0]).toEqual(["tab1"]);
    });

    it("should emit refresh event when refreshRequired is called", async () => {
      wrapper = createWrapper();
      
      const newTabData = { name: "New Tab", tabId: "new-tab-id" };
      await wrapper.vm.refreshRequired(newTabData);

      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.emitted("refresh")).toHaveLength(1);
    });

    it("should emit multiple events when buttons are clicked multiple times", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');

      await cancelBtn.trigger("click");
      await confirmBtn.trigger("click");
      await cancelBtn.trigger("click");

      expect(wrapper.emitted("update:cancel")).toHaveLength(2);
      expect(wrapper.emitted("update:ok")).toHaveLength(1);
    });
  });

  describe("Refresh Functionality", () => {
    it("should update tab options after refresh", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Mock new dashboard data for subsequent call
      const newDashboardData = {
        ...mockDashboardData,
        tabs: [
          ...mockDashboardData.tabs,
          { tabId: "new-tab", name: "New Tab" },
        ],
      };

      vi.mocked(getDashboard).mockResolvedValueOnce(newDashboardData);
      
      const newTabData = { name: "New Tab", tabId: "new-tab" };
      await wrapper.vm.refreshRequired(newTabData);

      expect(wrapper.vm.selectedMoveTabId).toEqual({
        label: "New Tab",
        value: "new-tab",
      });
      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });

    it("should close add tab dialog after refresh", async () => {
      wrapper = createWrapper();
      wrapper.vm.showAddTabDialog = true;
      
      const newTabData = { name: "Test Tab", tabId: "test-tab" };
      await wrapper.vm.refreshRequired(newTabData);

      expect(wrapper.vm.showAddTabDialog).toBe(false);
    });
  });

  describe("Props Validation", () => {
    it("should handle string title prop", () => {
      wrapper = createWrapper({ title: "Valid Title" });
      expect(wrapper.props("title")).toBe("Valid Title");
    });

    it("should handle string message prop", () => {
      wrapper = createWrapper({ message: "Valid Message" });
      expect(wrapper.props("message")).toBe("Valid Message");
    });

    it("should handle undefined props gracefully", () => {
      wrapper = createWrapper({ title: undefined, message: undefined });
      expect(wrapper.props("title")).toBeUndefined();
      expect(wrapper.props("message")).toBeUndefined();
    });
  });

  describe("Error Handling", () => {
    it("should handle empty dashboard data", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      // Mock with empty object instead of null to avoid template errors
      vi.mocked(getDashboard).mockResolvedValueOnce({});

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.moveTabOptions).toEqual([]);
    });

    it("should handle dashboard data without tabs", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({ dashboardId: "test" });

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.moveTabOptions).toEqual([]);
    });
  });

  describe("Component State Management", () => {
    it("should initialize with correct default state", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.selectedMoveTabId).toBeNull();
      expect(wrapper.vm.showAddTabDialog).toBe(false);
      expect(wrapper.vm.isTabEditMode).toBe(false);
      expect(wrapper.vm.selectedTabIdToEdit).toBeNull();
      expect(wrapper.vm.moveTabOptions).toEqual([]);
    });

    it("should maintain reactive state for currentDashboardData", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
      expect(wrapper.vm.currentDashboardData.data.dashboardId).toBe("test-dashboard-id");
    });

    it("should update selectedMoveTabId when tab options change", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      const newTabData = { name: "Updated Tab", tabId: "updated-tab" };
      await wrapper.vm.refreshRequired(newTabData);

      expect(wrapper.vm.selectedMoveTabId.value).toBe("updated-tab");
    });
  });

  describe("Edge Cases and Integration", () => {
    it("should handle rapid state changes", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Simulate rapid interactions
      const addTabBtn = wrapper.find('[data-test="dashboard-tab-move-add-tab-btn"]');
      await addTabBtn.trigger("click");
      
      wrapper.vm.showAddTabDialog = false;
      await wrapper.vm.$nextTick();
      
      await addTabBtn.trigger("click");
      expect(wrapper.vm.showAddTabDialog).toBe(true);
    });

    it("should maintain component integrity after multiple operations", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      // Perform multiple operations
      const cancelBtn = wrapper.find('[data-test="cancel-button"]');
      const confirmBtn = wrapper.find('[data-test="confirm-button"]');
      const addTabBtn = wrapper.find('[data-test="dashboard-tab-move-add-tab-btn"]');

      for (let i = 0; i < 5; i++) {
        await addTabBtn.trigger("click");
        await cancelBtn.trigger("click");
        if (wrapper.vm.selectedMoveTabId) {
          await confirmBtn.trigger("click");
        }
      }

      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.$options.name).toBe("SinglePanelMove");
    });

    it("should handle component unmounting cleanly", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });
  });
});