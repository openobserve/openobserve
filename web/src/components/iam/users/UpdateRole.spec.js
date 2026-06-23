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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import i18n from "@/locales";
import UpdateRole from "./UpdateRole.vue";
import organizationsService from "@/services/organizations";

// Mock the organizations service
vi.mock("@/services/organizations", () => ({
  default: {
    update_member_role: vi.fn(),
  },
}));

// Mock vue-i18n so t(key) returns the key unchanged
vi.mock("vue-i18n", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key) => key,
    }),
  };
});

// The factory must not reference top-level variables — vi.mock() is hoisted
// by Vitest and those variables are not yet initialised at hoist time.
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

import * as useToastModule from "@/lib/feedback/Toast/useToast";


const ODialogStub = {
  name: "ODialog",
  props: {
    open: { type: Boolean, default: false },
    size: { type: String, default: "sm" },
    showClose: { type: Boolean, default: true },
    persistent: { type: Boolean, default: false },
    title: { type: String, default: "" },
    subTitle: { type: String, default: "" },
    primaryButtonLabel: { type: String, default: "" },
    secondaryButtonLabel: { type: String, default: "" },
    neutralButtonLabel: { type: String, default: "" },
    primaryButtonVariant: { type: String, default: "primary" },
    secondaryButtonVariant: { type: String, default: "outline" },
    neutralButtonVariant: { type: String, default: "ghost" },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test-stub="o-dialog"
      :data-open="open"
      :data-title="title"
      :data-size="size"
      :data-persistent="persistent"
    >
      <div data-test-stub="o-dialog-header"><slot name="header" /></div>
      <div data-test-stub="o-dialog-body"><slot /></div>
      <div data-test-stub="o-dialog-footer"><slot name="footer" /></div>
    </div>
  `,
  inheritAttrs: false,
};

const findDrawer = (w) =>
  w.findComponent({ name: "ODialog" });

describe("UpdateRole Component", () => {
  let wrapper;
  let mockStore;
  let notifyMock;
  let dismissMock;

  const defaultModelValue = {
    org_member_id: "456",
    role: "admin",
    first_name: "John",
    email: "john@example.com",
  };

  const mountUpdateRole = (props = {}) =>
    mount(UpdateRole, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          ODialog: ODialogStub,
          QForm: false,
          QInput: false,
          QSelect: false,
        },
      },
      props: {
        open: true,
        modelValue: { ...defaultModelValue },
        ...props,
      },
    });

  beforeEach(() => {
    mockStore = {
      state: {
        selectedOrganization: {
          id: "123",
          identifier: "test-org",
        },
        userInfo: {
          email: "test@example.com",
        },
      },
    };

    dismissMock = vi.fn();
    notifyMock = useToastModule.toast;
    vi.mocked(useToastModule.toast).mockReturnValue(dismissMock);

    wrapper = mountUpdateRole();
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (wrapper) wrapper.unmount();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the ODrawer with migrated props", () => {
      const drawer = findDrawer(wrapper);
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("open")).toBe(true);
      expect(drawer.props("size")).toBe("sm");
      expect(drawer.props("title")).toBe("user.editUser");
      expect(drawer.props("persistent")).toBe(true);
    });

    it("initializes with correct props data", () => {
      expect(wrapper.vm.orgMemberData).toEqual({
        org_member_id: "456",
        role: "admin",
        first_name: "John",
        email: "john@example.com",
      });
    });

    it("has correct default role options", () => {
      expect(wrapper.vm.roleOptions).toContain("admin");
    });
  });

  describe("Form Validation and Submission", () => {
    it("submits form with valid data", async () => {
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { success: true },
      });

      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(organizationsService.update_member_role).toHaveBeenCalledWith(
        {
          id: 456,
          role: "admin",
          organization_id: 123,
        },
        "test-org",
      );

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "Organization member updated successfully.",
        }),
      );
      expect(dismissMock).toHaveBeenCalled();
    });

    it("handles form validation failure", async () => {
      wrapper.vm.orgMemberData.role = "";
      await wrapper.vm.$nextTick();

      await wrapper.vm.onSubmit();

      expect(organizationsService.update_member_role).not.toHaveBeenCalled();
      expect(wrapper.vm.roleError).toBe("Role is required");
    });

    it("handles API error response", async () => {
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { error_members: ["Some error"] },
      });

      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Error while updating organization member",
        }),
      );
      expect(dismissMock).toHaveBeenCalled();
    });

    it("shows loading notification during form submission", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      vi.mocked(organizationsService.update_member_role).mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 100)),
      );

      wrapper.vm.onSubmit();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message: "Please wait...",
          timeout: 0,
        }),
      );
    });

    it("resets role error after successful submission", async () => {
      wrapper.vm.roleError = "Role is required";

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { success: true },
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(wrapper.vm.roleError).toBe("");
    });

    it("handles error_members response with negative notification", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { error_members: ["Some error"] },
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Error while updating organization member",
          timeout: 15000,
        }),
      );
    });

    it("handles empty response data gracefully", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: {},
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      // No error_members → success notification.
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "Organization member updated successfully.",
        }),
      );
    });

    it("handles malformed API response", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { unexpected: "format" },
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "Organization member updated successfully.",
        }),
      );
    });
  });

  describe("Component Props and Emits", () => {
    it("emits updated event on successful form submission", async () => {
      const responseData = { success: true };
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: responseData,
      });

      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(wrapper.emitted("updated")?.[0]).toEqual([responseData]);
      expect(dismissMock).toHaveBeenCalled();
    });

    it("emits update:open(false) after a successful submission", async () => {
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { success: true },
      });

      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[updateOpen.length - 1]).toEqual([false]);
    });

    it("propagates ODrawer's update:open event upward", async () => {
      await findDrawer(wrapper).vm.$emit("update:open", false);

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[0]).toEqual([false]);
    });

    it("reflects the open prop on the drawer", async () => {
      const localWrapper = mountUpdateRole({ open: false });
      expect(findDrawer(localWrapper).props("open")).toBe(false);
      localWrapper.unmount();
    });

    it("updates orgMemberData when modelValue prop changes", async () => {
      const newModelValue = {
        org_member_id: "789",
        role: "admin",
        first_name: "Jane",
        email: "jane@example.com",
      };

      wrapper.vm.orgMemberData = newModelValue;
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.orgMemberData).toEqual(newModelValue);
    });
  });

  describe("Role Selection", () => {
    it("initializes with admin role option", () => {
      expect(wrapper.vm.roleOptions).toEqual(["admin"]);
    });

    it("updates role when selected", async () => {
      wrapper.vm.orgMemberData.role = "admin";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.orgMemberData.role).toBe("admin");
    });
  });

  describe("Form State Management", () => {
    it("maintains form state after failed submission", async () => {
      const initialData = { ...defaultModelValue };

      wrapper.vm.orgMemberData = { ...initialData };
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(wrapper.vm.orgMemberData).toEqual(initialData);
    });

    it("properly formats organization ID for API call", async () => {
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { success: true },
      });

      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(organizationsService.update_member_role).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: expect.any(Number),
        }),
        expect.any(String),
      );
    });
  });

  describe("UI Elements", () => {
    it("renders the drawer body content", () => {
      const drawer = findDrawer(wrapper);
      expect(drawer.exists()).toBe(true);
    });

    it("shows role selector component", () => {
      const roleSelect = wrapper.findComponent({ name: "OSelect" });
      expect(roleSelect.exists()).toBe(true);
    });

    it("has a save button", () => {
      const saveButton = wrapper.findAll("button").find((b) => b.text() === "user.save");
      expect(saveButton).toBeDefined();
    });

    it("renders the cancel OButton in the drawer body", () => {
      const buttons = wrapper.findAll("button");
      expect(buttons.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("UI Interactions", () => {
    it("prevents form submission on validation failure", async () => {
      wrapper.vm.orgMemberData.role = "";
      await wrapper.vm.$nextTick();

      await wrapper.vm.onSubmit();

      expect(organizationsService.update_member_role).not.toHaveBeenCalled();
    });

    it("emits update:open(false) when the cancel OButton is clicked", async () => {
      const buttons = wrapper.findAll("button");
      const cancelButton = buttons.find((b) => b.text() === "user.cancel");
      expect(cancelButton).toBeDefined();
      await cancelButton.trigger("click");

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[0]).toEqual([false]);
    });
  });

  describe("Error Handling", () => {
    it("handles undefined response data gracefully", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: undefined,
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalled();
    });

    it("handles malformed API response", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn(),
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { unexpected: "format" },
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalled();
    });
  });

  describe("Form Input Validation", () => {
    it("validates required role field and sets roleError", async () => {
      wrapper.vm.orgMemberData.role = "";
      await wrapper.vm.$nextTick();

      await wrapper.vm.onSubmit();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.roleError).toBe("Role is required");
    });

    it("prevents submission with empty role", async () => {
      wrapper.vm.orgMemberData.role = "";
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn(),
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(organizationsService.update_member_role).not.toHaveBeenCalled();
    });
  });

  describe("Component Reactivity", () => {
    it("updates form data when modelValue is provided on mount", () => {
      const newData = {
        org_member_id: "789",
        role: "admin",
        first_name: "Jane",
        email: "jane@example.com",
      };

      const localWrapper = mountUpdateRole({ modelValue: newData });
      expect(localWrapper.vm.orgMemberData).toEqual(newData);
      localWrapper.unmount();
    });

    it("maintains role options after component update", async () => {
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.roleOptions).toContain("admin");
      expect(wrapper.vm.roleOptions.length).toBe(1);
    });
  });
});
