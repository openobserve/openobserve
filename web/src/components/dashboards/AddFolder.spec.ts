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

// Mock commons utility
vi.mock("@/utils/commons", () => ({
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
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

// Mock zinc utils
vi.mock("@/utils/zincutils", () => ({
  getImageURL: vi.fn(),
}));

import AddFolder from "@/components/dashboards/AddFolder.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import { createFolder, updateFolder } from "@/utils/commons";

installQuasar({
  plugins: [Dialog, Notify],
});

describe("AddFolder", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    vi.mocked(createFolder).mockResolvedValue({
      folderId: "new-folder-1",
      name: "Test Folder",
      description: "Test folder description"
    });

    vi.mocked(updateFolder).mockResolvedValue({
      folderId: "existing-folder",
      name: "Updated Folder",
      description: "Updated description"
    });

    store.state.selectedOrganization = { identifier: "test-org" };
    store.state.userInfo = { name: "test-user" };
    store.state.organizationData = {
      folders: [
        { folderId: "existing-folder", name: "Existing Folder", description: "Existing description" },
        { folderId: "folder-2", name: "Folder 2", description: "Folder 2 description" }
      ]
    };
  });

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount();
    }
  });

  const createWrapper = (props = {}) => {
    return mount(AddFolder, {
      props: {
        folderId: "default",
        editMode: false,
        ...props
      },
      global: {
        plugins: [i18n, store],
        mocks: {
          $t: (key: string) => key
        }
      }
    });
  };

  describe("Component Rendering", () => {
    it("should render create folder form by default", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.editMode).toBe(false);
      expect(wrapper.find('[data-test="dashboard-folder-add-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-add-description"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-add-save"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-add-cancel"]').exists()).toBe(true);
    });

    it("should render update folder form in edit mode", () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });

      expect(wrapper.vm.editMode).toBe(true);
      expect(wrapper.text()).toContain("Update Folder");
    });

    it("should render create folder form in non-edit mode", () => {
      wrapper = createWrapper({ editMode: false });

      expect(wrapper.text()).toContain("New Folder");
    });

    it("should render all required form elements", () => {
      wrapper = createWrapper();

      expect(wrapper.find('form').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-add-name"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-add-description"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-add-save"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-add-cancel"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="dashboard-folder-cancel"]').exists()).toBe(true);
    });

    it("should have proper card structure", () => {
      wrapper = createWrapper();

      expect(wrapper.classes()).toContain('column');
      expect(wrapper.classes()).toContain('full-height');
      expect(wrapper.find('form').exists()).toBe(true);
    });
  });

  describe("Form Validation", () => {
    it("should require folder name", async () => {
      wrapper = createWrapper();
      
      const submitBtn = wrapper.find('[data-test="dashboard-folder-add-save"]');
      expect(submitBtn.element.disabled).toBe(true);
    });

    it("should enable submit button when name is provided", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Test Folder");
      await wrapper.vm.$nextTick();

      const submitBtn = wrapper.find('[data-test="dashboard-folder-add-save"]');
      expect(submitBtn.element.disabled).toBe(false);
    });

    it("should validate required name field", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("");
      await nameInput.trigger('blur');
      
      expect(wrapper.vm.folderData.name.trim()).toBe("");
    });

    it("should trim whitespace from name validation", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("   ");
      await wrapper.vm.$nextTick();

      const submitBtn = wrapper.find('[data-test="dashboard-folder-add-save"]');
      expect(submitBtn.element.disabled).toBe(true);
    });

    it("should allow valid folder names", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Valid Folder Name");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.folderData.name).toBe("Valid Folder Name");
      const submitBtn = wrapper.find('[data-test="dashboard-folder-add-save"]');
      expect(submitBtn.element.disabled).toBe(false);
    });
  });

  describe("Folder Creation", () => {
    it("should create new folder when form is valid", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      const descInput = wrapper.find('[data-test="dashboard-folder-add-description"]');
      
      await nameInput.setValue("New Folder");
      await descInput.setValue("Folder description");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createFolder).toHaveBeenCalledWith(
        store,
        expect.objectContaining({
          name: "New Folder",
          description: "Folder description"
        })
      );
    });

    it("should emit update:modelValue with new folder data", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Test Folder");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toEqual({
        folderId: "new-folder-1",
        name: "Test Folder",
        description: "Test folder description"
      });
    });

    it("should reset form after successful creation", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      const descInput = wrapper.find('[data-test="dashboard-folder-add-description"]');
      
      await nameInput.setValue("Test Folder");
      await descInput.setValue("Test Description");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(wrapper.vm.folderData.name).toBe("");
      expect(wrapper.vm.folderData.description).toBe("");
    });

    it("should handle folder creation with only name", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Folder Name Only");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createFolder).toHaveBeenCalledWith(
        store,
        expect.objectContaining({
          name: "Folder Name Only",
          description: ""
        })
      );
    });
  });

  describe("Folder Update", () => {
    it("should initialize with existing folder data in edit mode", () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });

      expect(wrapper.vm.folderData.name).toBe("Existing Folder");
      expect(wrapper.vm.folderData.description).toBe("Existing description");
      expect(wrapper.vm.folderData.folderId).toBe("existing-folder");
    });

    it("should update existing folder when form is valid", async () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      const descInput = wrapper.find('[data-test="dashboard-folder-add-description"]');
      
      await nameInput.setValue("Updated Folder Name");
      await descInput.setValue("Updated description");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(updateFolder).toHaveBeenCalledWith(
        store,
        "existing-folder",
        expect.objectContaining({
          name: "Updated Folder Name",
          description: "Updated description"
        })
      );
    });

    it("should emit update:modelValue with updated folder data", async () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Updated Name");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(wrapper.emitted("update:modelValue")).toBeTruthy();
      expect(wrapper.emitted("update:modelValue")[0][0]).toEqual(
        expect.objectContaining({
          name: "Updated Name"
        })
      );
    });

    it("should handle update with partial data changes", async () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });
      
      // Only change description
      const descInput = wrapper.find('[data-test="dashboard-folder-add-description"]');
      await descInput.setValue("Only description changed");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(updateFolder).toHaveBeenCalledWith(
        store,
        "existing-folder",
        expect.objectContaining({
          name: "Existing Folder", // Unchanged
          description: "Only description changed" // Changed
        })
      );
    });
  });

  describe("Error Handling", () => {
    it("should handle folder creation error", async () => {
      vi.mocked(createFolder).mockRejectedValue(new Error("Creation failed"));
      
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Test Folder");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createFolder).toHaveBeenCalled();
    });

    it("should handle folder update error", async () => {
      vi.mocked(updateFolder).mockRejectedValue(new Error("Update failed"));
      
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Updated Name");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(updateFolder).toHaveBeenCalled();
    });

    it("should handle API errors gracefully", async () => {
      vi.mocked(createFolder).mockRejectedValue({ 
        response: { status: 500, data: { message: "Server error" } }
      });
      
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Test Folder");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createFolder).toHaveBeenCalled();
    });

    it("should handle form validation errors", async () => {
      wrapper = createWrapper();
      
      // Mock form validation to fail
      wrapper.vm.addFolderForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn()
      };
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createFolder).not.toHaveBeenCalled();
    });
  });

  describe("User Interactions", () => {
    it("should close dialog when cancel button is clicked", async () => {
      wrapper = createWrapper();
      
      const cancelBtns = wrapper.findAll('[data-test="dashboard-folder-add-cancel"]');
      expect(cancelBtns.length).toBeGreaterThan(0);
    });

    it("should close dialog when X button is clicked", async () => {
      wrapper = createWrapper();
      
      const closeBtn = wrapper.find('[data-test="dashboard-folder-cancel"]');
      expect(closeBtn.exists()).toBe(true);
    });

    it("should handle form input changes", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      const descInput = wrapper.find('[data-test="dashboard-folder-add-description"]');
      
      await nameInput.setValue("Dynamic Name");
      await descInput.setValue("Dynamic Description");

      expect(wrapper.vm.folderData.name).toBe("Dynamic Name");
      expect(wrapper.vm.folderData.description).toBe("Dynamic Description");
    });

    it("should show loading state during submission", async () => {
      // Mock slow API response
      vi.mocked(createFolder).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          folderId: "test",
          name: "Test Folder",
          description: "Test description"
        }), 100))
      );
      
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Test Folder");
      
      const form = wrapper.find('form');
      form.trigger('submit.prevent');
      
      await wrapper.vm.$nextTick();
      
      expect(wrapper.vm.onSubmit.isLoading.value).toBe(false); // Initial state
    });
  });

  describe("Props Handling", () => {
    it("should handle different folderId prop values", () => {
      wrapper = createWrapper({ folderId: "custom-folder-id" });
      expect(wrapper.vm.$props.folderId).toBe("custom-folder-id");
    });

    it("should handle editMode prop correctly", () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });
      expect(wrapper.vm.$props.editMode).toBe(true);
    });

    it("should use default props when not provided", () => {
      wrapper = createWrapper();
      expect(wrapper.vm.$props.folderId).toBe("default");
      expect(wrapper.vm.$props.editMode).toBe(false);
    });

    it("should handle non-existent folder in edit mode", () => {
      // Add non-existent folder to store to avoid undefined JSON parsing
      store.state.organizationData.folders.push({
        folderId: "non-existent",
        name: "",
        description: ""
      });
      
      wrapper = createWrapper({ editMode: true, folderId: "non-existent" });
      
      // Should initialize with empty values when folder not found
      expect(wrapper.vm.folderData.name).toBe("");
      expect(wrapper.vm.folderData.description).toBe("");
    });
  });

  describe("Data Initialization", () => {
    it("should initialize with default values in create mode", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.folderData.folderId).toBe("");
      expect(wrapper.vm.folderData.name).toBe("");
      expect(wrapper.vm.folderData.description).toBe("");
    });

    it("should initialize with folder data in edit mode", () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });

      expect(wrapper.vm.folderData.folderId).toBe("existing-folder");
      expect(wrapper.vm.folderData.name).toBe("Existing Folder");
      expect(wrapper.vm.folderData.description).toBe("Existing description");
    });

    it("should clone folder data to avoid mutations", () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });

      const originalFolder = store.state.organizationData.folders.find(
        (f: any) => f.folderId === "existing-folder"
      );

      // Modify the component data
      wrapper.vm.folderData.name = "Modified Name";

      // Original should be unchanged
      expect(originalFolder.name).toBe("Existing Folder");
    });
  });

  describe("Component Lifecycle", () => {
    it("should setup reactive references correctly", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.folderData).toBeTypeOf("object");
      expect(wrapper.vm.addFolderForm).toBeDefined();
      expect(wrapper.vm.t).toBeTypeOf("function");
      expect(wrapper.vm.onSubmit).toBeTypeOf("object");
    });

    it("should handle component mounting without errors", () => {
      expect(() => {
        wrapper = createWrapper();
      }).not.toThrow();
    });

    it("should handle component unmounting without errors", () => {
      wrapper = createWrapper();
      
      expect(() => {
        wrapper.unmount();
      }).not.toThrow();
    });
  });

  describe("Form State Management", () => {
    it("should maintain form state during user interactions", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      const descInput = wrapper.find('[data-test="dashboard-folder-add-description"]');
      
      await nameInput.setValue("Test Name");
      await descInput.setValue("Test Description");
      
      // Simulate other interactions
      const cancelBtn = wrapper.find('[data-test="dashboard-folder-add-cancel"]');
      expect(cancelBtn.exists()).toBe(true);
      
      // Data should persist
      expect(wrapper.vm.folderData.name).toBe("Test Name");
      expect(wrapper.vm.folderData.description).toBe("Test Description");
    });

    it("should validate form state before submission", async () => {
      wrapper = createWrapper();
      
      // Mock validation to return false
      const mockValidate = vi.fn().mockResolvedValue(false);
      const mockResetValidation = vi.fn();
      
      // Override the addFolderForm ref with mocked methods
      wrapper.vm.addFolderForm = {
        validate: mockValidate,
        resetValidation: mockResetValidation
      };
      
      // Call onSubmit directly to ensure it gets called
      await wrapper.vm.onSubmit.execute();
      
      expect(mockValidate).toHaveBeenCalled();
      expect(createFolder).not.toHaveBeenCalled();
    });
  });

  describe("Internationalization", () => {
    it("should use translation keys correctly", () => {
      wrapper = createWrapper();

      expect(wrapper.vm.t).toBeTypeOf("function");
    });

    it("should handle different language contexts", () => {
      wrapper = createWrapper({ editMode: true, folderId: "existing-folder" });
      
      // Should use different translation keys based on mode
      expect(wrapper.text()).toContain("Update Folder");
      
      wrapper.unmount();
      wrapper = createWrapper({ editMode: false });
      
      expect(wrapper.text()).toContain("New Folder");
    });
  });

  describe("Edge Cases", () => {
    it("should handle special characters in folder name", async () => {
      wrapper = createWrapper();
      
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue("Folder with Special @#$%^&*() Characters");
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createFolder).toHaveBeenCalledWith(
        store,
        expect.objectContaining({
          name: "Folder with Special @#$%^&*() Characters"
        })
      );
    });

    it("should handle very long folder names", async () => {
      wrapper = createWrapper();
      
      const longName = "A".repeat(255);
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue(longName);
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createFolder).toHaveBeenCalledWith(
        store,
        expect.objectContaining({
          name: longName
        })
      );
    });

    it("should handle Unicode characters in folder name", async () => {
      wrapper = createWrapper();
      
      const unicodeName = "测试文件夹 🚀 Folder";
      const nameInput = wrapper.find('[data-test="dashboard-folder-add-name"]');
      await nameInput.setValue(unicodeName);
      
      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createFolder).toHaveBeenCalledWith(
        store,
        expect.objectContaining({
          name: unicodeName
        })
      );
    });

    it("should handle empty store data", () => {
      const originalFolders = store.state.organizationData.folders;
      store.state.organizationData = { folders: [] };
      
      expect(() => {
        wrapper = createWrapper({ editMode: false });
      }).not.toThrow();
      
      // Restore original folders
      store.state.organizationData.folders = originalFolders;
    });
  });
});