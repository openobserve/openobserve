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

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mount, VueWrapper } from "@vue/test-utils";
import TabsSettings from "./TabsSettings.vue";

// Mock external dependencies
vi.mock("../../../utils/commons", () => ({
  getDashboard: vi.fn(),
  editTab: vi.fn(),
  deleteTab: vi.fn(),
  updateDashboard: vi.fn(),
}));

const mockT = vi.hoisted(() => vi.fn((key: string) => key));
vi.mock("vue-i18n", () => ({
  useI18n: () => ({
    t: mockT,
  }),
}));

const mockOpenConflict = vi.fn();
vi.mock("@/composables/dashboard/useDashboardSaveConflict", () => ({
  useDashboardSaveConflict: () => ({
    isConflict: (error: any) => error?.response?.status === 409,
    openConflict: mockOpenConflict,
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
  props: ["open", "editMode", "tabId", "dashboardId"],
  template: "<div data-test='mock-add-tab'></div>",
  methods: {
    submit: vi.fn(),
  },
};

const mockTabsDeletePopUp = {
  name: "TabsDeletePopUp",
  template: "<div data-test='mock-tabs-delete-popup'></div>",
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
        plugins: [],
        components: {
          DashboardHeader: mockDashboardHeader,
          AddTab: mockAddTab,
          TabsDeletePopUp: mockTabsDeletePopUp,
        },
        stubs: {},
      },
    });
  };

  const waitForComponent = async (wrapper: VueWrapper<any>) => {
    await wrapper.vm.$nextTick();
    // Wait for getDashboard to complete and dashboard data to be populated
    await new Promise((resolve) => setTimeout(resolve, 50));
    await wrapper.vm.$nextTick();
    // Additional wait for DOM elements to render from v-for loop
    await new Promise((resolve) => setTimeout(resolve, 10));
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

  describe("save conflict descriptions", () => {
    const conflict = { response: { status: 409 } };

    const mountWithFreshDashboard = async () => {
      const dashboard = JSON.parse(JSON.stringify(mockDashboardData));
      const { getDashboard } = await import("../../../utils/commons");
      vi.mocked(getDashboard).mockResolvedValue(dashboard);
      wrapper = createWrapper();
      await waitForComponent(wrapper);
      return dashboard;
    };

    it("names the tab's old name in a rename, read before editTab changes it", async () => {
      const dashboard = await mountWithFreshDashboard();
      const { editTab } = await import("../../../utils/commons");
      vi.mocked(editTab).mockImplementationOnce(async (...args: any[]) => {
        dashboard.tabs[0].name = args[4].name;
        throw conflict;
      });
      wrapper.vm.editTabId = "tab1";
      wrapper.vm.editTabObj.data = { tabId: "tab1", name: "Renamed" };

      await wrapper.vm.saveEdit();

      expect(mockT).toHaveBeenCalledWith("dashboard.saveConflict.change.renamedTab", {
        from: "Tab 1",
        to: "Renamed",
      });
      expect(mockOpenConflict).toHaveBeenCalled();
    });

    it("names the deleted tab, read before deleteTab removes it", async () => {
      const dashboard = await mountWithFreshDashboard();
      const { deleteTab } = await import("../../../utils/commons");
      vi.mocked(deleteTab).mockImplementationOnce(async () => {
        dashboard.tabs.splice(1, 1);
        throw conflict;
      });
      wrapper.vm.tabIdToBeDeleted = "tab2";

      await wrapper.vm.confirmDelete();

      expect(mockT).toHaveBeenCalledWith("dashboard.saveConflict.change.deletedTab", {
        name: "Tab 2",
      });
    });
  });

  describe("Dashboard Data Loading", () => {
    it("should call getDashboard on mount", async () => {
      const { getDashboard } = await import("../../../utils/commons");

      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(vi.mocked(getDashboard)).toHaveBeenCalledWith(
        expect.any(Object), // store
        "test-dashboard", // dashboard query param
        "test-folder", // folder query param
      );
    });

    it("should populate currentDashboardData after successful fetch", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.currentDashboardData.data).toEqual(mockDashboardData);
    });
  });

  describe("Header and Navigation", () => {
    it("should show add tab dialog when add button is clicked", async () => {
      wrapper = createWrapper();

      const addButton = wrapper.find('[data-test="dashboard-tab-settings-add-tab"]');
      await addButton.trigger("click");

      expect(wrapper.vm.showAddTabDialog).toBe(true);
      expect(wrapper.vm.isTabEditMode).toBe(false);
    });
  });

  describe("Tab Display and Interaction", () => {
    it("should display tab names correctly", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

      const tabNames = wrapper.findAll('[data-test="dashboard-tab-settings-tab-name"]');
      expect(tabNames).toHaveLength(3);
      expect(tabNames[0].text()).toBe("Tab 1");
      expect(tabNames[1].text()).toBe("Tab 2");
      expect(tabNames[2].text()).toBe("Tab 3");
    });

    it("should render delete buttons for each tab when more than one tab exists", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();
      await new Promise((resolve) => setTimeout(resolve, 10));

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
        expect.objectContaining({ name: "Modified Tab Name" }),
      );
    });

    it("should exit edit mode when cancel button is clicked", async () => {
      wrapper = createWrapper();
      await waitForComponent(wrapper);

      const editButton = wrapper.find('[data-test="dashboard-tab-settings-tab-edit-btn"]');
      await editButton.trigger("click");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.editTabId).toBe("tab1");

      const cancelButton = wrapper.find(
        '[data-test="dashboard-tab-settings-tab-name-edit-cancel"]',
      );
      await cancelButton.trigger("click");

      expect(wrapper.vm.editTabId).toBeNull();
      expect(wrapper.vm.editTabObj.data).toEqual({});
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
        "test-dashboard", // dashboard query param
        "test-folder", // folder query param
        null, // tabIdToBeDeleted
        "target-tab-id", // moveTabId
      );
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
  });

  describe("Add Tab Drawer (AddTab owns its ODrawer)", () => {
    it("should close drawer when AddTab emits update:open with false", async () => {
      wrapper = createWrapper();
      await wrapper.vm.$nextTick();

      wrapper.vm.showAddTabDialog = true;
      await wrapper.vm.$nextTick();

      const addTabComponent = wrapper.findComponent({ name: "AddTab" });
      await addTabComponent.vm.$emit("update:open", false);
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.showAddTabDialog).toBe(false);
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
      // The dark/light ternary collapsed to a single theme-aware token utility.
      expect(editInput.exists()).toBe(true);
      expect(editInput.classes()).toContain("bg-input-bg");
    });
  });
});
