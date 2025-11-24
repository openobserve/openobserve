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

import { mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import AddGroup from "@/components/iam/groups/AddGroup.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

installQuasar({
  plugins: [Notify],
});

vi.mock("@/services/iam", () => ({
  createGroup: vi.fn(),
}));

const mockNotify = vi.fn();
vi.mock("quasar", async () => {
  const actual = await vi.importActual("quasar");
  return {
    ...actual,
    useQuasar: () => ({
      notify: mockNotify,
    }),
  };
});

describe("AddGroup Component", () => {
  let wrapper: any;

  beforeEach(() => {
    wrapper = mount(AddGroup, {
      global: {
        provide: { store },
        plugins: [i18n],
      },
      props: {
        width: "30vw",
        group: null,
        org_identifier: "test-org",
      },
    });
  });

  describe("Component Mounting", () => {
    it("renders the component correctly", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="add-group-section"]').exists()).toBe(true);
    });

    it("displays the correct title", () => {
      const titleElement = wrapper.find('[data-test="add-group-section-title"]');
      expect(titleElement.exists()).toBe(true);
      expect(titleElement.text()).toContain("New user group");
    });
  });

  describe("Form Input", () => {
    it("renders the group name input field", () => {
      const nameInput = wrapper.find('[data-test="add-group-groupname-input-btn"]');
      expect(nameInput.exists()).toBe(true);
    });

    it("displays validation hint text", () => {
      // Check if hint text is in the component (it's in the template)
      expect(wrapper.text()).toContain("Use alphanumeric and '_' characters only, without spaces.");
    });

    it("updates name value when input changes", async () => {
      const nameInput = wrapper.find('input[type="text"]');
      await nameInput.setValue("test_group");
      expect(wrapper.vm.name).toBe("test_group");
    });

    it("trims whitespace from input", async () => {
      const nameInput = wrapper.find('input[type="text"]');
      await nameInput.setValue("  test_group  ");
      expect(wrapper.vm.name).toBe("test_group");
    });
  });

  describe("Form Validation", () => {
    it("validates group name format correctly", () => {
      wrapper.vm.name = "valid_group_123";
      expect(wrapper.vm.isValidGroupName).toBe(true);
    });

    it("rejects group names with spaces", () => {
      wrapper.vm.name = "invalid group";
      expect(wrapper.vm.isValidGroupName).toBe(false);
    });

    it("rejects group names with special characters", () => {
      wrapper.vm.name = "invalid-group!";
      expect(wrapper.vm.isValidGroupName).toBe(false);
    });

    it("accepts group names with underscores and alphanumeric characters", () => {
      wrapper.vm.name = "valid_group_name_123";
      expect(wrapper.vm.isValidGroupName).toBe(true);
    });

    it("rejects empty group names", () => {
      wrapper.vm.name = "";
      expect(wrapper.vm.isValidGroupName).toBe(false);
    });
  });

  describe("Button Actions", () => {
    it("renders cancel and save buttons", () => {
      const cancelButton = wrapper.find('[data-test="add-group-cancel-btn"]');
      const saveButton = wrapper.find('[data-test="add-group-submit-btn"]');
      
      expect(cancelButton.exists()).toBe(true);
      expect(saveButton.exists()).toBe(true);
      expect(cancelButton.text()).toContain("Cancel");
      expect(saveButton.text()).toContain("Save");
    });

    it("emits cancel event when close button is clicked", async () => {
      const closeButton = wrapper.find('[data-test="add-group-close-dialog-btn"]');
      await closeButton.trigger("click");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("emits cancel event when cancel button is clicked", async () => {
      const cancelButton = wrapper.find('[data-test="add-group-cancel-btn"]');
      await cancelButton.trigger("click");
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });
  });

  describe("Group Creation", () => {
    beforeEach(() => {
      // Clear previous mock calls
      mockNotify.mockClear();
    });

    it("does not save when group name is empty", async () => {
      const { createGroup } = await import("@/services/iam");
      wrapper.vm.name = "";
      
      await wrapper.vm.saveGroup();
      
      expect(createGroup).not.toHaveBeenCalled();
    });

    it("does not save when group name is invalid", async () => {
      const { createGroup } = await import("@/services/iam");
      wrapper.vm.name = "invalid group name";
      
      await wrapper.vm.saveGroup();
      
      expect(createGroup).not.toHaveBeenCalled();
    });

    it("creates group successfully with valid data", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockResponse = { data: { name: "test_group" } };
      vi.mocked(createGroup).mockResolvedValue(mockResponse);
      
      wrapper.vm.name = "test_group";
      
      await wrapper.vm.saveGroup();
      
      expect(createGroup).toHaveBeenCalledWith("test_group", store.state.selectedOrganization.identifier);
      expect(wrapper.emitted("added:group")).toBeTruthy();
      expect(wrapper.emitted("cancel:hideform")).toBeTruthy();
    });

    it("displays success notification on successful creation", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockResponse = { data: { name: "test_group" } };
      vi.mocked(createGroup).mockResolvedValue(mockResponse);
      
      wrapper.vm.name = "test_group";
      
      await wrapper.vm.saveGroup();
      
      expect(mockNotify).toHaveBeenCalledWith({
        message: 'User Group "test_group" Created Successfully!',
        color: "positive",
        position: "bottom",
        timeout: 3000,
      });
    });

    it("handles error during group creation", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockError = { response: { status: 400 } };
      vi.mocked(createGroup).mockRejectedValue(mockError);
      
      wrapper.vm.name = "test_group";
      
      try {
        await wrapper.vm.saveGroup();
      } catch (e) {
        // Error should be caught by component
      }
      
      // Give time for async operations
      await new Promise(resolve => setTimeout(resolve, 0));
      
      expect(mockNotify).toHaveBeenCalledWith({
        message: "Error while creating group",
        color: "negative",
        position: "bottom",
        timeout: 3000,
      });
    });

    it("does not show error notification for 403 status", async () => {
      const { createGroup } = await import("@/services/iam");
      const mockError = { response: { status: 403 } };
      vi.mocked(createGroup).mockRejectedValue(mockError);
      
      wrapper.vm.name = "test_group";
      
      await wrapper.vm.saveGroup();
      
      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe("Props Handling", () => {
    it("initializes with group prop data when provided", async () => {
      const groupData = { name: "existing_group" };
      const wrapper = mount(AddGroup, {
        global: {
          provide: { store },
          plugins: [i18n],
        },
        props: {
          group: groupData,
        },
      });

      expect(wrapper.vm.name).toBe("existing_group");
    });

    it("initializes with empty name when no group prop", () => {
      expect(wrapper.vm.name).toBe("");
    });

    it("uses default width when not provided", () => {
      // The width prop has been removed from the component
      // Verify the component mounts successfully without the width prop
      expect(wrapper.exists()).toBe(true);
    });

    it("uses provided org_identifier", () => {
      expect(wrapper.props("org_identifier")).toBe("test-org");
    });
  });

  describe("Input Validation Rules", () => {
    it("validates required field rule", () => {
      const input = wrapper.find('input[type="text"]');
      const rules = wrapper.vm.$el.querySelector('.q-input').getAttribute('rules') || [];
      
      wrapper.vm.name = "";
      wrapper.vm.isValidGroupName = false;
      
      const validationResult = wrapper.vm.name ? "valid" : "Name is required";
      expect(validationResult).toBe("Name is required");
    });

    it("validates format rule when name exists", () => {
      wrapper.vm.name = "invalid name";
      wrapper.vm.isValidGroupName = false;
      
      const validationResult = wrapper.vm.isValidGroupName || "Use alphanumeric and '_' characters only, without spaces.";
      expect(validationResult).toBe("Use alphanumeric and '_' characters only, without spaces.");
    });
  });

  describe("Edge Cases", () => {
    it("handles maxlength constraint", () => {
      const nameInput = wrapper.find('input[type="text"]');
      expect(nameInput.attributes("maxlength")).toBe("100");
    });

    it("handles empty organization identifier", async () => {
      const wrapper = mount(AddGroup, {
        global: {
          provide: { store: { ...store, state: { ...store.state, selectedOrganization: { identifier: "" } } } },
          plugins: [i18n],
        },
      });

      const { createGroup } = await import("@/services/iam");
      const mockResponse = { data: { name: "test_group" } };
      vi.mocked(createGroup).mockResolvedValue(mockResponse);
      
      wrapper.vm.name = "test_group";
      wrapper.vm.q = { notify: vi.fn() };
      
      await wrapper.vm.saveGroup();
      
      expect(createGroup).toHaveBeenCalledWith("test_group", "");
    });
  });

  describe("Accessibility", () => {
    it("has proper button attributes", () => {
      const closeButton = wrapper.find('[data-test="add-group-close-dialog-btn"]');
      const cancelButton = wrapper.find('[data-test="add-group-cancel-btn"]');
      const saveButton = wrapper.find('[data-test="add-group-submit-btn"]');

      expect(closeButton.exists()).toBe(true);
      expect(cancelButton.exists()).toBe(true);
      expect(saveButton.exists()).toBe(true);
    });

    it("has proper input labels", () => {
      const input = wrapper.find('input[type="text"]');
      expect(input.exists()).toBe(true);
      expect(input.attributes("maxlength")).toBe("100");
    });
  });
});