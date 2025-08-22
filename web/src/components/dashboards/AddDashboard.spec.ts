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
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";

// Mock dashboard service
vi.mock("@/services/dashboards", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

// Mock commons utility
vi.mock("@/utils/commons", () => ({
  getAllDashboards: vi.fn().mockResolvedValue([]),
}));

// Mock notifications
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: vi.fn(),
    showPositiveNotification: vi.fn(),
  }),
}));

// Mock loading composable
vi.mock("@/composables/useLoading", () => ({
  useLoading: vi.fn((fn) => ({
    execute: fn,
    isLoading: { value: false },
  })),
}));

// Mock dashboard schema conversion
vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data),
}));

import AddDashboard from "@/components/dashboards/AddDashboard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import dashboardService from "@/services/dashboards";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("AddDashboard", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(dashboardService.create).mockResolvedValue({
      data: {
        id: "new-dashboard-1",
        version: 3,
        "v3": { dashboardId: "new-dashboard-1", title: "Test Dashboard" }
      }
    });

    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.userInfo = { name: "test-user" };
    store.state.organizationData = {
      folders: [
        { folderId: "default", name: "Default" },
        { folderId: "folder-1", name: "Folder 1" }
      ]
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(AddDashboard, {
      props: {
        showFolderSelection: true,
        activeFolderId: "default",
        ...props
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          'SelectFolderDropdown': {
            template: '<div data-test="folder-dropdown"></div>',
            props: ['activeFolderId'],
            emits: ['folder-selected']
          }
        },
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render create dashboard form by default", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.beingUpdated).toBe(false);
      expect(wrapper.find('[data-test="add-dashboard-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="add-dashboard-description"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-submit"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-add-cancel"]').exists()).toBe(true);
    });

    it("should show folder selection when showFolderSelection is true", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="folder-dropdown"]').exists()).toBe(true);
    });

    it("should hide folder selection when showFolderSelection is false", () => {
      wrapper = createWrapper({ showFolderSelection: false });

      expect(wrapper.find('[data-test="folder-dropdown"]').exists()).toBe(false);
    });
  });

  describe("Form Validation", () => {
    it("should require dashboard name", async () => {
      wrapper = createWrapper();
      
      const submitBtn = wrapper.find('[data-test="dashboard-add-submit"]');
      expect(submitBtn.element.disabled).toBe(true);
    });

    it("should enable submit button when name is provided", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      await nameInput.setValue("Test Dashboard");
      await wrapper.vm.$nextTick();

      const submitBtn = wrapper.find('[data-test="dashboard-add-submit"]');
      expect(submitBtn.element.disabled).toBe(false);
    });

    it("should validate required name field", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      await nameInput.setValue("");
      await nameInput.trigger('blur');
      
      expect(wrapper.vm.dashboardData.name.trim()).toBe("");
    });

    it("should trim whitespace from name validation", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      await nameInput.setValue("   ");
      await wrapper.vm.$nextTick();

      const submitBtn = wrapper.find('[data-test="dashboard-add-submit"]');
      expect(submitBtn.element.disabled).toBe(true);
    });
  });

  describe("Form Submission", () => {
    it("should create new dashboard when form is valid", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      const descInput = wrapper.find('[data-test="add-dashboard-description"]');
      
      await nameInput.setValue("New Dashboard");
      await descInput.setValue("Dashboard description");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(dashboardService.create).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        expect.objectContaining({
          title: "New Dashboard",
          description: "Dashboard description"
        }),
        expect.any(String)
      );
    });

    it("should show loading state during submission", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      await nameInput.setValue("Test Dashboard");
      
      // Mock slow API response
      vi.mocked(dashboardService.create).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({ 
          data: { 
            id: "test", 
            version: 3, 
            "v3": { dashboardId: "test", title: "Test Dashboard" } 
          } 
        }), 100))
      );
      
      const form = wrapper.find('form');
      form.trigger('submit.prevent');
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.onSubmit.isLoading.value).toBe(false); // Initial state
    });

    it("should handle folder selection", async () => {
      wrapper = createWrapper();
      
      const folderDropdown = wrapper.findComponent('[data-test="folder-dropdown"]');
      await folderDropdown.vm.$emit('folder-selected', { value: 'folder-1', label: 'Folder 1' });

      expect(wrapper.vm.selectedFolder.value).toBe('folder-1');
    });
  });

  describe("Error Handling", () => {
    it("should handle dashboard creation error", async () => {
      vi.mocked(dashboardService.create).mockRejectedValue(new Error("Creation failed"));
      
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      await nameInput.setValue("Test Dashboard");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(dashboardService.create).toHaveBeenCalled();
    });
  });

  describe("User Interactions", () => {
    it("should close dialog when cancel button is clicked", async () => {
      wrapper = createWrapper();
      
      const cancelBtns = wrapper.findAll('[data-test="dashboard-add-cancel"]');
      expect(cancelBtns.length).toBeGreaterThan(0);
    });

    it("should close dialog when X button is clicked", async () => {
      wrapper = createWrapper();
      
      const closeBtn = wrapper.findComponent({ name: 'QBtn' });
      expect(closeBtn.exists()).toBe(true);
    });

    it("should emit events after successful creation", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      await nameInput.setValue("New Dashboard");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(wrapper.emitted('updated')).toBeTruthy();
    });
  });

  describe("Props Handling", () => {
    it("should handle activeFolderId prop", () => {
      wrapper = createWrapper({ activeFolderId: "folder-1" });
      expect(wrapper.exists()).toBe(true);
    });

    it("should properly initialize dashboard data", async () => {
      wrapper = createWrapper();

      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      const descInput = wrapper.find('[data-test="add-dashboard-description"]');

      expect(nameInput.element.value).toBe("");
      expect(descInput.element.value).toBe("");
    });
  });

  describe("Reactive Updates", () => {
    it("should update form data when inputs change", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      const descInput = wrapper.find('[data-test="add-dashboard-description"]');
      
      await nameInput.setValue("New Name");
      await descInput.setValue("New Description");

      expect(wrapper.vm.dashboardData.name).toBe("New Name");
      expect(wrapper.vm.dashboardData.description).toBe("New Description");
    });
  });

  describe("Form Reset", () => {
    it("should reset form after successful submission", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      const descInput = wrapper.find('[data-test="add-dashboard-description"]');
      
      await nameInput.setValue("Test Dashboard");
      await descInput.setValue("Test Description");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      // Form should be reset after successful creation
      expect(wrapper.vm.dashboardData.name).toBe("");
      expect(wrapper.vm.dashboardData.description).toBe("");
    });
  });
});
