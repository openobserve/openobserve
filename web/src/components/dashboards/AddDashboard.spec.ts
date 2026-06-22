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

// Mock dashboard schema conversion (identity)
vi.mock("@/utils/dashboard/convertDashboardSchemaVersion", () => ({
  convertDashboardSchemaVersion: vi.fn((data) => data),
}));

import AddDashboard from "@/components/dashboards/AddDashboard.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import dashboardService from "@/services/dashboards";


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

      expect(
        wrapper.find('[data-test="add-dashboard-name"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="add-dashboard-description"]').exists(),
      ).toBe(true);
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
    it("should expose submit() and onSubmit handlers", () => {
      wrapper = createWrapper();

      expect(typeof wrapper.vm.submit).toBe("function");
      expect(typeof wrapper.vm.onSubmit).toBe("function");
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
    it("should seed the form with blank default values", () => {
      wrapper = createWrapper();

      // The OForm is the single source of truth; it reads `:default-values`
      // (the typed `addDashboardDefaults` factory) once at mount. The factory
      // is now imported from the schema (returned from setup), so calling it
      // yields the schema-shaped defaults — `id` is NOT a form field.
      expect(typeof wrapper.vm.addDashboardDefaults).toBe("function");
      expect(wrapper.vm.addDashboardDefaults()).toEqual({ name: "", description: "" });

      const formRef = wrapper.vm.addDashboardForm;
      expect(formRef).toBeTruthy();
      expect(formRef.form.state.values.name).toBe("");
      expect(formRef.form.state.values.description).toBe("");
    });

    it("should update the form values when inputs change via OForm", async () => {
      wrapper = createWrapper();

      // The OForm exposes the underlying form via the addDashboardForm ref.
      // Updating the form's state mirrors what the inputs would do.
      const formRef = wrapper.vm.addDashboardForm;
      expect(formRef).toBeTruthy();
      formRef.form.setFieldValue("name", "New Name");
      formRef.form.setFieldValue("description", "New Description");
      await wrapper.vm.$nextTick();

      expect(formRef.form.state.values.name).toBe("New Name");
      expect(formRef.form.state.values.description).toBe("New Description");
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
    it("should create a new dashboard when onSubmit runs with a valid name", async () => {
      wrapper = createWrapper();

      // @submit payload is the source of truth (the schema already gated it).
      await wrapper.vm.onSubmit({ name: "New Dashboard", description: "Dashboard description" });
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

      await wrapper.vm.onSubmit({ name: "New Dashboard", description: "" });
      await flushPromises();

      expect(wrapper.emitted("updated")).toBeTruthy();
      const payload = wrapper.emitted("updated")![0];
      expect(payload).toEqual(["new-dashboard-1", "default"]);
    });

    it("should show a positive notification on success", async () => {
      wrapper = createWrapper();

      await wrapper.vm.onSubmit({ name: "Test Dashboard", description: "" });
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

      await wrapper.vm.onSubmit({ name: "Folder Dashboard", description: "" });
      await flushPromises();

      expect(dashboardService.create).toHaveBeenCalledWith(
        "test-org",
        expect.any(Object),
        "folder-1",
      );
    });

    it("does not create when the name is empty (schema blocks submit)", async () => {
      wrapper = createWrapper();

      // Drive the real form: empty name → schema invalid → @submit never fires.
      await (wrapper.vm.addDashboardForm as any).form.handleSubmit();
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
      await wrapper.vm.onSubmit({ name: "Test Dashboard", description: "" });
      await flushPromises();

      expect(showErrorNotificationMock).toHaveBeenCalledWith("Creation failed");
      expect(wrapper.emitted("updated")).toBeFalsy();
    });

    it("should show a fallback error notification when the rejection has no message", async () => {
      vi.mocked(dashboardService.create).mockRejectedValueOnce({});

      wrapper = createWrapper();
      await wrapper.vm.onSubmit({ name: "Test Dashboard", description: "" });
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
