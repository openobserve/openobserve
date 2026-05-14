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
const showErrorNotificationMock = vi.fn();
const showPositiveNotificationMock = vi.fn();
vi.mock("@/composables/useNotifications", () => ({
  default: () => ({
    showErrorNotification: showErrorNotificationMock,
    showPositiveNotification: showPositiveNotificationMock,
  }),
}));

// Mock loading composable — preserve original behaviour (execute = the supplied fn)
vi.mock("@/composables/useLoading", () => ({
  useLoading: vi.fn((fn) => ({
    execute: fn,
    isLoading: { value: false },
  })),
}));

// Mock dashboard schema conversion (identity)
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
        v3: { dashboardId: "new-dashboard-1", title: "Test Dashboard" },
      },
    } as any);

    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.userInfo = { name: "test-user" };
    store.state.organizationData = {
      folders: [
        { folderId: "default", name: "Default" },
        { folderId: "folder-1", name: "Folder 1" },
      ],
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
        ...props,
      },
      global: {
        plugins: [i18n, store],
        stubs: {
          SelectFolderDropdown: {
            name: "SelectFolderDropdown",
            template: '<div data-test="folder-dropdown"></div>',
            props: ["activeFolderId"],
            emits: ["folder-selected"],
          },
        },
        mocks: {
          $t: (key: string) => key,
        },
      },
    });
  };

  describe("Component Rendering", () => {
    it("should render the create dashboard form by default", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.beingUpdated).toBe(false);
      expect(
        wrapper.find('[data-test="add-dashboard-name"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-dashboard-description"]').exists(),
      ).toBe(true);
    });

    it("should not render the id input in create mode", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="dashboard-id"]').exists()).toBe(false);
    });

    it("should show folder selection when showFolderSelection is true", () => {
      wrapper = createWrapper();

      expect(wrapper.find('[data-test="folder-dropdown"]').exists()).toBe(true);
    });

    it("should hide folder selection when showFolderSelection is false", () => {
      wrapper = createWrapper({ showFolderSelection: false });

      expect(wrapper.find('[data-test="folder-dropdown"]').exists()).toBe(
        false,
      );
    });
  });

  describe("Setup & Exposed API", () => {
    it("should expose submit() helper that delegates to onSubmit.execute", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.submit).toBe("function");
      expect(typeof wrapper.vm.onSubmit.execute).toBe("function");
    });

    it("should initialise selectedFolder from the active folder", () => {
      wrapper = createWrapper({ activeFolderId: "folder-1" });

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Folder 1",
        value: "folder-1",
      });
    });

    it("should default selectedFolder to the default folder", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.selectedFolder).toEqual({
        label: "Default",
        value: "default",
      });
    });

    it("should produce a numeric random integer id", () => {
      wrapper = createWrapper();

      const id = wrapper.vm.getRandInteger();
      expect(typeof id).toBe("number");
      expect(id).toBeGreaterThanOrEqual(100);
    });
  });

  describe("Form Inputs", () => {
    it("should initialise dashboard data with empty strings", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.dashboardData.name).toBe("");
      expect(wrapper.vm.dashboardData.description).toBe("");
    });

    it("should update dashboardData when inputs change", async () => {
      wrapper = createWrapper();

      const nameInput = wrapper.find('[data-test="add-dashboard-name"]');
      const descInput = wrapper.find(
        '[data-test="add-dashboard-description"]',
      );

      await nameInput.setValue("New Name");
      await descInput.setValue("New Description");

      expect(wrapper.vm.dashboardData.name).toBe("New Name");
      expect(wrapper.vm.dashboardData.description).toBe("New Description");
    });
  });

  describe("Folder Selection", () => {
    it("should update selectedFolder when SelectFolderDropdown emits folder-selected", async () => {
      wrapper = createWrapper();

      const folderDropdown = wrapper.findComponent({
        name: "SelectFolderDropdown",
      });
      await folderDropdown.vm.$emit("folder-selected", {
        value: "folder-1",
        label: "Folder 1",
      });

      expect(wrapper.vm.selectedFolder).toEqual({
        value: "folder-1",
        label: "Folder 1",
      });
    });
  });

  describe("Form Submission", () => {
    it("should create a new dashboard when submit is called with a valid name", async () => {
      wrapper = createWrapper();

      wrapper.vm.dashboardData.name = "New Dashboard";
      wrapper.vm.dashboardData.description = "Dashboard description";
      await wrapper.vm.$nextTick();

      await wrapper.vm.submit();
      await flushPromises();

      expect(dashboardService.create).toHaveBeenCalledWith(
        "test-org",
        expect.objectContaining({
          title: "New Dashboard",
          description: "Dashboard description",
          owner: "test-user",
          version: 3,
        }),
        "default",
      );
    });

    it("should emit 'updated' after a successful submission", async () => {
      wrapper = createWrapper();

      wrapper.vm.dashboardData.name = "New Dashboard";
      await wrapper.vm.submit();
      await flushPromises();

      expect(wrapper.emitted("updated")).toBeTruthy();
      const payload = wrapper.emitted("updated")![0];
      expect(payload).toEqual(["new-dashboard-1", "default"]);
    });

    it("should reset dashboardData after successful submission", async () => {
      wrapper = createWrapper();

      wrapper.vm.dashboardData.name = "Test Dashboard";
      wrapper.vm.dashboardData.description = "Test Description";
      await wrapper.vm.submit();
      await flushPromises();

      expect(wrapper.vm.dashboardData).toEqual({
        id: "",
        name: "",
        description: "",
      });
    });

    it("should show a positive notification on success", async () => {
      wrapper = createWrapper();

      wrapper.vm.dashboardData.name = "Test Dashboard";
      await wrapper.vm.submit();
      await flushPromises();

      expect(showPositiveNotificationMock).toHaveBeenCalledWith(
        "Dashboard added successfully.",
      );
    });

    it("should pass the currently selected folder id to the service", async () => {
      wrapper = createWrapper();

      const folderDropdown = wrapper.findComponent({
        name: "SelectFolderDropdown",
      });
      await folderDropdown.vm.$emit("folder-selected", {
        value: "folder-1",
        label: "Folder 1",
      });

      wrapper.vm.dashboardData.name = "Folder Dashboard";
      await wrapper.vm.submit();
      await flushPromises();

      expect(dashboardService.create).toHaveBeenCalledWith(
        "test-org",
        expect.any(Object),
        "folder-1",
      );
    });

    it("should short-circuit when form validation fails", async () => {
      wrapper = createWrapper();

      // Stub the form ref so validate() resolves false.
      wrapper.vm.addDashboardForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn(),
      };

      wrapper.vm.dashboardData.name = "Anything";
      await wrapper.vm.submit();
      await flushPromises();

      expect(dashboardService.create).not.toHaveBeenCalled();
      expect(wrapper.emitted("updated")).toBeFalsy();
    });
  });

  describe("Error Handling", () => {
    it("should show an error notification when dashboard creation rejects with a message", async () => {
      vi.mocked(dashboardService.create).mockRejectedValueOnce(
        new Error("Creation failed"),
      );

      wrapper = createWrapper();
      wrapper.vm.dashboardData.name = "Test Dashboard";
      await wrapper.vm.submit();
      await flushPromises();

      expect(showErrorNotificationMock).toHaveBeenCalledWith("Creation failed");
      expect(wrapper.emitted("updated")).toBeFalsy();
    });

    it("should show a fallback error notification when the rejection has no message", async () => {
      vi.mocked(dashboardService.create).mockRejectedValueOnce({});

      wrapper = createWrapper();
      wrapper.vm.dashboardData.name = "Test Dashboard";
      await wrapper.vm.submit();
      await flushPromises();

      expect(showErrorNotificationMock).toHaveBeenCalledWith(
        "Dashboard creation failed.",
      );
    });
  });

  describe("Props Handling", () => {
    it("should accept a custom activeFolderId prop", () => {
      wrapper = createWrapper({ activeFolderId: "folder-1" });
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.vm.selectedFolder.value).toBe("folder-1");
    });

    it("should accept a null activeFolderId via the validator and fall back to default folder lookup", () => {
      // When null is passed, the lookup will fail to find a matching folder,
      // so we provide a matching null-id folder for safety.
      store.state.organizationData.folders.push({
        folderId: null,
        name: "Null Folder",
      } as any);

      wrapper = createWrapper({ activeFolderId: null });
      expect(wrapper.exists()).toBe(true);
    });
  });
});
