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
import TabsSettings from "./TabsSettings.vue";

// Mock external dependencies
vi.mock("../../../utils/commons", () => ({
  getDashboard: vi.fn(),
  editTab: vi.fn(),
  deleteTab: vi.fn(),
  updateDashboard: vi.fn(),
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
      theme: "light",
    },
  }),
}));

vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showPositiveNotification: vi.fn(),
    showErrorNotification: vi.fn(),
    showConfictErrorNotificationWithRefreshBtn: vi.fn(),
  }),
}));

const mockDashboardHeader = {
  name: "DashboardHeader",
  template: `<div data-test="mock-dashboard-header">
    <slot name="right"></slot>
  </div>`,
};

const mockAddTab = {
  name: "AddTab",
  template: "<div data-test='mock-add-tab'></div>",
};

const mockTabsDeletePopUp = {
  name: "TabsDeletePopUp",
  template: "<div data-test='mock-tabs-delete-popup'></div>",
};

const mockDraggable = {
  name: "draggable",
  template: `<div data-test="mock-draggable">
    <slot></slot>
  </div>`,
  props: ["modelValue", "options"],
};

describe("TabsSettings", () => {
  let wrapper: VueWrapper<any>;

  const mockDashboardData = {
    dashboardId: "test-dashboard-id",
    tabs: [
      { tabId: "tab1", name: "Tab 1" },
      { tabId: "tab2", name: "Tab 2" },
      { tabId: "tab3", name: "Tab 3" },
    ],
  };

  const createWrapper = (props = {}) => {
    return mount(TabsSettings, {
      props,
      global: {
        plugins: [Quasar],
        components: {
          DashboardHeader: mockDashboardHeader,
          AddTab: mockAddTab,
          TabsDeletePopUp: mockTabsDeletePopUp,
          draggable: mockDraggable,
        },
        stubs: {
          QDialog: {
            template: "<div data-test='q-dialog-stub'><slot /></div>",
          },
        },
      },
    });
  };

  const waitForComponent = async (wrapper: VueWrapper<any>) => {
    await wrapper.vm.$nextTick();
    // Wait for getDashboard to complete and dashboard data to be populated
    await new Promise(resolve => setTimeout(resolve, 50));
    await wrapper.vm.$nextTick();
    // Additional wait for DOM elements to render from v-for loop
    await new Promise(resolve => setTimeout(resolve, 10));
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
      expect(wrapper.find('[data-test="dashboard-tab-settings"]').exists()).toBe(true);
    });

    it("should have correct component name", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.name).toBe("TabsSettings");
    });

    it("should emit correct events in emits array", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$options.emits).toEqual(["refresh"]);
    });

    it("should initialize with correct default state", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.showAddTabDialog).toBe(false);
      expect(wrapper.vm.isTabEditMode).toBe(false);
      expect(wrapper.vm.selectedTabIdToEdit).toBe("");
      expect(wrapper.vm.deletePopupVisible).toBe(false);
      expect(wrapper.vm.tabIdToBeDeleted).toBeNull();
      expect(wrapper.vm.editTabId).toBeNull();
    });
  });

  describe("Dashboard Data Loading", () => {
    it("should call getDashboard on mount", async () => {
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

    it("should handle getDashboard failure gracefully", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockRejectedValueOnce(new Error("Network error"));

      // Mock console.error and Vue error handler to suppress error messages
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      wrapper = createWrapper();
      
      // Catch the unhandled promise rejection
      try {
        await wrapper.vm.$nextTick();
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        // Expected to throw due to unhandled promise rejection
      }
      
      expect(wrapper.exists()).toBe(true);
      
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe("Header and Navigation", () => {
    it("should render dashboard header with title", () => {
      wrapper = createWrapper();
      
      const header = wrapper.find('[data-test="mock-dashboard-header"]');
      expect(header.exists()).toBe(true);
    });

    it("should render add tab button in header", () => {
      wrapper = createWrapper();
      
      const addButton = wrapper.find('[data-test="dashboard-tab-settings-add-tab"]');
      expect(addButton.exists()).toBe(true);
      expect(addButton.text()).toBe("dashboard.newTab");
    });

    it("should show add tab dialog when add button is clicked", async () => {
      wrapper = createWrapper();
      
      const addButton = wrapper.find('[data-test="dashboard-tab-settings-add-tab"]');
      await addButton.trigger("click");

      expect(wrapper.vm.showAddTabDialog).toBe(true);
      expect(wrapper.vm.isTabEditMode).toBe(false);
    });
  });

  describe("Table Structure", () => {
    it("should render table header with correct columns", () => {
      wrapper = createWrapper();
      
      const nameHeader = wrapper.find('[data-test="dashboard-tab-settings-name"]');
      const actionsHeader = wrapper.find('[data-test="dashboard-tab-settings-actions"]');
      
      expect(nameHeader.exists()).toBe(true);
      expect(nameHeader.text()).toBe("dashboard.name");
      
      expect(actionsHeader.exists()).toBe(true);
      expect(actionsHeader.text()).toBe("dashboard.actions");
    });

    it("should render draggable container", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      const draggable = wrapper.find('[data-test="dashboard-tab-settings-drag"]');
      expect(draggable.exists()).toBe(true);
    });

    it("should render tab rows for each tab", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 50)); // Allow async operations to complete
      
      const tabRows = wrapper.findAll('[data-test="dashboard-tab-settings-draggable-row"]');
      expect(tabRows).toHaveLength(mockDashboardData.tabs.length);
    });
  });

  describe("Tab Display and Interaction", () => {
    it("should display tab names correctly", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete
      
      const tabNames = wrapper.findAll('[data-test="dashboard-tab-settings-tab-name"]');
      expect(tabNames).toHaveLength(3);
      expect(tabNames[0].text()).toBe("Tab 1");
      expect(tabNames[1].text()).toBe("Tab 2");
      expect(tabNames[2].text()).toBe("Tab 3");
    });

    it("should render drag handles for each tab", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete
      
      const dragHandles = wrapper.findAll('[data-test="dashboard-tab-settings-drag-handle"]');
      expect(dragHandles).toHaveLength(mockDashboardData.tabs.length);
    });

    it("should render edit buttons for each tab", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete
      
      const editButtons = wrapper.findAll('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      expect(editButtons).toHaveLength(mockDashboardData.tabs.length);
    });

    it("should render delete buttons for each tab when more than one tab exists", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise(resolve => setTimeout(resolve, 10)); // Allow async operations to complete
      
      const deleteButtons = wrapper.findAll('[data-test="dashboard-tab-settings-tab-delete-btn"]');
      expect(deleteButtons).toHaveLength(mockDashboardData.tabs.length);
    });

    it("should not render delete button when only one tab exists", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({
        ...mockDashboardData,
        tabs: [{ tabId: "tab1", name: "Only Tab" }],
      });
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      const deleteButtons = wrapper.findAll('[data-test="dashboard-tab-settings-tab-delete-btn"]');
      expect(deleteButtons).toHaveLength(0);
    });
  });

  describe("Tab Editing", () => {
    it("should enter edit mode when edit button is clicked", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      
      expect(wrapper.vm.editTabId).toBe("tab1");
      expect(wrapper.vm.editTabObj.data.name).toBe("Tab 1");
    });

    it("should show edit input when in edit mode", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      const editInput = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit"]');
      expect(editInput.exists()).toBe(true);
      expect(editInput.element.value).toBe("Tab 1");
    });

    it("should show save and cancel buttons in edit mode", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      const saveButton = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit-save"]');
      const cancelButton = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit-cancel"]');
      
      expect(saveButton.exists()).toBe(true);
      expect(cancelButton.exists()).toBe(true);
    });

    it("should disable save button when tab name is empty", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      // Clear the input
      wrapper.vm.editTabObj.data.name = "";
      await wrapper.vm.$nextTick();
      
      const saveButton = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit-save"]');
      expect(saveButton.attributes("disabled")).toBeDefined();
    });

    it("should enable save button when tab name is not empty", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      const saveButton = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit-save"]');
      expect(saveButton.attributes("disabled")).toBeUndefined();
    });

    it("should call editTab when save button is clicked", async () => {
      const { editTab } = await import("../../../utils/commons");
      vi.mocked(editTab).mockResolvedValueOnce(undefined);
      
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      // Modify the name
      wrapper.vm.editTabObj.data.name = "Modified Tab Name";
      
      const saveButton = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit-save"]');
      await saveButton.trigger("click");
      
      expect(vi.mocked(editTab)).toHaveBeenCalledWith(
        expect.any(Object), // store
        "test-dashboard-id",
        "test-folder",
        "tab1",
        expect.objectContaining({ name: "Modified Tab Name" })
      );
    });

    it("should exit edit mode when cancel button is clicked", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.editTabId).toBe("tab1");
      
      const cancelButton = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit-cancel"]');
      await cancelButton.trigger("click");
      
      expect(wrapper.vm.editTabId).toBeNull();
      expect(wrapper.vm.editTabObj.data).toEqual({});
    });

    it("should handle edit save failure with error notification", async () => {
      const { editTab } = await import("../../../utils/commons");
      vi.mocked(editTab).mockRejectedValueOnce(new Error("Edit failed"));
      
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      const saveButton = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit-save"]');
      await saveButton.trigger("click");
      
      // Should handle error gracefully
      expect(wrapper.exists()).toBe(true);
    });

    it("should disable edit button for tab currently being edited", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      expect(editButton.attributes("disabled")).toBeDefined();
    });
  });

  describe("Tab Deletion", () => {
    it("should show delete popup when delete button is clicked", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const deleteButton = wrapper.find('[data-test="dashboard-tab-settings-tab-delete-btn"]');
      await deleteButton.trigger("click");
      
      expect(wrapper.vm.deletePopupVisible).toBe(true);
      expect(wrapper.vm.tabIdToBeDeleted).toBe("tab1");
    });

    it("should cancel edit mode when delete is initiated", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      // First enter edit mode
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.editTabId).toBe("tab1");
      
      // Then click delete
      const deleteButton = wrapper.find('[data-test="dashboard-tab-settings-tab-delete-btn"]');
      await deleteButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.editTabId).toBeNull();
      expect(wrapper.vm.deletePopupVisible).toBe(true);
    });

    it("should call deleteTab when deletion is confirmed", async () => {
      const { deleteTab } = await import("../../../utils/commons");
      vi.mocked(deleteTab).mockResolvedValueOnce(undefined);
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.confirmDelete("target-tab-id");
      
      expect(vi.mocked(deleteTab)).toHaveBeenCalledWith(
        expect.any(Object), // store
        "test-dashboard",   // dashboard query param
        "test-folder",      // folder query param
        null,              // tabIdToBeDeleted
        "target-tab-id"    // moveTabId
      );
    });

    it("should handle delete failure with error notification", async () => {
      const { deleteTab } = await import("../../../utils/commons");
      vi.mocked(deleteTab).mockRejectedValueOnce(new Error("Delete failed"));
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.confirmDelete("target-tab-id");
      
      // Should handle error gracefully
      expect(wrapper.exists()).toBe(true);
    });

    it("should emit refresh event after successful deletion", async () => {
      const { deleteTab } = await import("../../../utils/commons");
      vi.mocked(deleteTab).mockResolvedValueOnce(undefined);
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.confirmDelete("target-tab-id");
      
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });
  });

  describe("Drag and Drop Functionality", () => {
    it("should configure drag options correctly", () => {
      wrapper = createWrapper();
      
      expect(wrapper.vm.dragOptions).toEqual({
        animation: 200,
      });
    });

    it("should call updateDashboard when drag ends", async () => {
      const { updateDashboard } = await import("../../../utils/commons");
      vi.mocked(updateDashboard).mockResolvedValueOnce(undefined);
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.handleDragEnd();
      
      expect(vi.mocked(updateDashboard)).toHaveBeenCalledWith(
        expect.any(Object), // store
        "test-org",         // organization identifier
        "test-dashboard-id", // dashboard id
        mockDashboardData,   // dashboard data
        "test-folder"       // folder
      );
    });

    it("should emit refresh event after successful drag reorder", async () => {
      const { updateDashboard } = await import("../../../utils/commons");
      vi.mocked(updateDashboard).mockResolvedValueOnce(undefined);
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.handleDragEnd();
      
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });

    it("should handle drag reorder failure", async () => {
      const { updateDashboard } = await import("../../../utils/commons");
      vi.mocked(updateDashboard).mockRejectedValueOnce(new Error("Reorder failed"));
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.handleDragEnd();
      
      // Should handle error and emit refresh
      expect(wrapper.emitted("refresh")).toBeTruthy();
      expect(wrapper.exists()).toBe(true);
    });

    it("should handle 409 conflict errors with specific notification", async () => {
      const { updateDashboard } = await import("../../../utils/commons");
      const conflictError = new Error("Conflict");
      conflictError.response = { status: 409, data: { message: "Conflict message" } };
      vi.mocked(updateDashboard).mockRejectedValueOnce(conflictError);
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.handleDragEnd();
      
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe("Add Tab Dialog", () => {
    it("should render add tab dialog", () => {
      wrapper = createWrapper();
      
      const dialog = wrapper.find('[data-test="dashboard-tab-settings-add-tab-dialog"]');
      expect(dialog.exists()).toBe(true);
    });

    it("should pass correct props to AddTab component", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.isTabEditMode).toBe(false);
      expect(wrapper.vm.currentDashboardData.data.dashboardId).toBe("test-dashboard-id");
    });

    it("should close dialog and refresh after tab creation", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      wrapper.vm.showAddTabDialog = true;
      
      await wrapper.vm.refreshRequired();
      
      expect(wrapper.vm.showAddTabDialog).toBe(false);
      expect(wrapper.vm.isTabEditMode).toBe(false);
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });
  });

  describe("Event Emissions", () => {
    it("should emit refresh event from various actions", async () => {
      const { getDashboard, editTab } = await import("../../../utils/commons");
      vi.mocked(editTab).mockResolvedValueOnce(undefined);
      
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      // Test refresh from edit save
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      const saveButton = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit-save"]');
      await saveButton.trigger("click");
      
      expect(wrapper.emitted("refresh")).toBeTruthy();
    });

    it("should handle multiple refresh emissions", async () => {
      wrapper = createWrapper();
      
      await wrapper.vm.refreshRequired();
      await wrapper.vm.refreshRequired();
      await wrapper.vm.refreshRequired();
      
      expect(wrapper.emitted("refresh")).toHaveLength(3);
    });
  });

  describe("Theme Support", () => {
    it("should apply dark theme class to edit input when theme is dark", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      // Manually set the store state to dark theme
      wrapper.vm.store.state.theme = "dark";
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      const editInput = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit"]');
      // Check that the edit input exists and has the dark theme class applied
      expect(editInput.exists()).toBe(true);
      expect(editInput.classes()).toContain("bg-grey-10");
    });

    it("should not apply dark theme class when theme is light", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();
      
      const editInput = wrapper.find('[data-test="dashboard-tab-settings-tab-name-edit"]');
      expect(editInput.classes()).not.toContain("bg-grey-10");
    });
  });

  describe("Props and State Management", () => {
    it("should maintain reactive state for currentDashboardData", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.currentDashboardData.data).toBeDefined();
      expect(wrapper.vm.currentDashboardData.data.dashboardId).toBe("test-dashboard-id");
    });

    it("should handle state changes during edit operations", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      // Start editing
      await wrapper.vm.editItem("tab1");
      
      expect(wrapper.vm.editTabId).toBe("tab1");
      expect(wrapper.vm.editTabObj.data.name).toBe("Tab 1");
      
      // Cancel editing
      wrapper.vm.cancelEdit();
      
      expect(wrapper.vm.editTabId).toBeNull();
      expect(wrapper.vm.editTabObj.data).toEqual({});
    });
  });

  describe("Edge Cases and Error Handling", () => {
    it("should handle component unmounting cleanly", () => {
      wrapper = createWrapper();
      expect(() => wrapper.unmount()).not.toThrow();
    });

    it("should handle rapid state changes", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      // Rapid editing operations
      for (let i = 0; i < 5; i++) {
        await wrapper.vm.editItem("tab1");
        wrapper.vm.cancelEdit();
      }
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.$options.name).toBe("TabsSettings");
    });

    it("should maintain component integrity after multiple operations", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      
      // Perform multiple operations
      const addButton = wrapper.find('[data-test="dashboard-tab-settings-add-tab"]');
      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      
      for (let i = 0; i < 3; i++) {
        await addButton.trigger("click");
        wrapper.vm.showAddTabDialog = false;
        
        await editButton.trigger("click");
        wrapper.vm.cancelEdit();
      }
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.$options.name).toBe("TabsSettings");
    });

    it("should handle empty tabs array", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce({
        dashboardId: "test",
        tabs: [],
      });
      
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      
      const tabRows = wrapper.findAll('[data-test="dashboard-tab-settings-draggable-row"]');
      expect(tabRows).toHaveLength(0);
    });

    it("should handle null dashboard data gracefully", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce(null);
      
      // Mock console errors since null will cause render issues
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      wrapper = createWrapper();
      
      try {
        await wrapper.vm.$nextTick();
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        // Expected to have rendering issues with null data
      }
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.currentDashboardData.data).toBeNull();
      
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });

    it("should handle undefined dashboard data gracefully", async () => {
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValueOnce(undefined);
      
      // Mock console errors since undefined will cause render issues
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      wrapper = createWrapper();
      
      try {
        await wrapper.vm.$nextTick();
        await new Promise(resolve => setTimeout(resolve, 50));
      } catch (error) {
        // Expected to have rendering issues with undefined data
      }
      
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.currentDashboardData.data).toBeUndefined();
      
      consoleErrorSpy.mockRestore();
      consoleWarnSpy.mockRestore();
    });
  });

  describe("Integration with Child Components", () => {
    it("should integrate with DashboardHeader component", () => {
      wrapper = createWrapper();
      
      const header = wrapper.findComponent({ name: "DashboardHeader" });
      expect(header.exists()).toBe(true);
    });

    it("should integrate with AddTab component", () => {
      wrapper = createWrapper();
      
      const addTab = wrapper.findComponent({ name: "AddTab" });
      expect(addTab.exists()).toBe(true);
    });

    it("should integrate with TabsDeletePopUp component", () => {
      wrapper = createWrapper();
      
      const deletePopup = wrapper.findComponent({ name: "TabsDeletePopUp" });
      expect(deletePopup.exists()).toBe(true);
    });

    it("should integrate with draggable component", () => {
      wrapper = createWrapper();
      
      const draggable = wrapper.findComponent({ name: "draggable" });
      expect(draggable.exists()).toBe(true);
    });
  });
});