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
import { nextTick } from 'vue';

// Mock services
vi.mock("@/services/organizations", () => ({
  default: {
    add_members: vi.fn()
  }
}));

vi.mock("@/services/users", () => ({
  default: {
    getRoles: vi.fn()
  }
}));

vi.mock("@/services/segment_analytics", () => ({
  default: {
    track: vi.fn()
  }
}));

// Mock toast
const toastMock = vi.fn(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args) => toastMock(...args),
}));

import MemberInvitation from "@/components/iam/users/MemberInvitation.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import organizationsService from "@/services/organizations";
import usersService from "@/services/users";
import segment from "@/services/segment_analytics";

// Create platform mock
const platform = {
  is: {
    desktop: true,
    mobile: false,
  },
  has: {
    touch: false,
  },
};

const OInputStub = {
  name: "OInput",
  props: ["modelValue", "placeholder"],
  emits: ["update:modelValue"],
  template: '<input class="o-input" :value="modelValue" :placeholder="placeholder" @input="$emit(\'update:modelValue\', $event.target.value)" />',
};

const OSelectStub = {
  name: "OSelect",
  props: ["modelValue", "options", "labelKey", "valueKey"],
  emits: ["update:modelValue"],
  template: '<div class="o-select"></div>',
};

const OButtonStub = {
  name: "OButton",
  props: ["variant", "size", "disabled"],
  emits: ["click"],
  template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot /></button>',
};

const mountComponent = (currentrole = "admin") =>
  mount(MemberInvitation, {
    props: { currentrole },
    global: {
      plugins: [i18n],
      provide: { store, platform },
      stubs: {
        OInput: OInputStub,
        OSelect: OSelectStub,
        OButton: OButtonStub,
      },
    },
    attachTo: document.body,
  });

describe("MemberInvitation Component", () => {
  let wrapper;

  beforeEach(async () => {
    vi.mocked(organizationsService.add_members).mockReset();
    vi.mocked(usersService.getRoles).mockReset();
    vi.mocked(segment.track).mockReset();
    toastMock.mockClear();

    store.state.selectedOrganization = { identifier: "test-org", name: "Test Org" };
    store.state.userInfo = { email: "test@example.com" };

    vi.mocked(usersService.getRoles).mockResolvedValue({
      data: [
        { label: "Admin", value: "admin" },
        { label: "Member", value: "member" }
      ]
    });

    wrapper = mountComponent("admin");
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === 'function') {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  it("renders the component for admin user", () => {
    expect(wrapper.exists()).toBe(true);
    expect(wrapper.find('.invite-user').exists()).toBe(true);
  });

  it("does not render for non-admin users", async () => {
    const memberWrapper = mountComponent("member");
    await nextTick();
    expect(memberWrapper.find('.invite-user').exists()).toBe(false);
    memberWrapper.unmount();
  });

  describe("Email Validation", () => {
    it("validates single email", async () => {
      wrapper.vm.userEmail = "invalid-email";
      await nextTick();
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Please enter correct email id."
        })
      );
    });

    it("validates multiple emails", async () => {
      wrapper.vm.userEmail = "test1@example.com; invalid-email, test2@example.com";
      await nextTick();
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Please enter correct email id."
        })
      );
    });

    it("accepts valid emails", async () => {
      wrapper.vm.userEmail = "test1@example.com; test2@example.com, test3@example.com";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: {
          data: {},
          message: "Invitations sent successfully"
        }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        {
          invites: ["test1@example.com", "test2@example.com", "test3@example.com"],
          role: "admin"
        },
        "test-org"
      );
    });
  });

  describe("Invitation Process", () => {
    it("handles successful invitation", async () => {
      wrapper.vm.userEmail = "test@example.com";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: {
          data: {},
          message: "Invitations sent successfully"
        }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "Invitations sent successfully",
          timeout: 5000
        })
      );
      expect(wrapper.vm.userEmail).toBe("");
    });

    it("handles invalid members error", async () => {
      wrapper.vm.userEmail = "test@example.com";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: {
          data: {
            invalid_members: ["test@example.com"]
          }
        }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "Error while member invitation: test@example.com",
          timeout: 15000
        })
      );
    });

    it("tracks invitation in analytics", async () => {
      wrapper.vm.userEmail = "test@example.com";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: {
          data: {},
          message: "Success"
        }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(segment.track).toHaveBeenCalledWith(
        "Button Click",
        expect.objectContaining({
          button: "Invite User",
          user_org: "test-org",
          user_id: "test@example.com",
          page: "Users"
        })
      );
    });
  });

  describe("UI Interactions", () => {
    it("disables invite button when email is empty", async () => {
      wrapper.vm.userEmail = "";
      await nextTick();

      const inviteButton = wrapper.find('button');
      expect(inviteButton.attributes('disabled')).toBeDefined();
    });

    it("enables invite button when email is provided", async () => {
      wrapper.vm.userEmail = "test@example.com";
      await nextTick();

      const inviteButton = wrapper.find('button');
      expect(inviteButton.attributes('disabled')).toBeUndefined();
    });

    it("allows role selection", async () => {
      const select = wrapper.findComponent(OSelectStub);
      expect(select.exists()).toBe(true);

      await select.vm.$emit('update:modelValue', 'member');
      await nextTick();

      expect(wrapper.vm.selectedRole).toBe('member');
    });
  });

  describe("Error Handling", () => {
    it("handles API error during invitation", async () => {
      wrapper.vm.userEmail = "test@example.com";
      await nextTick();

      const error = new Error("Network error");
      vi.mocked(organizationsService.add_members).mockRejectedValue(error);

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: error.message,
          timeout: 5000
        })
      );
    });

    it("handles empty response from getRoles", async () => {
      vi.mocked(usersService.getRoles).mockResolvedValue({ data: [] });

      const newWrapper = mountComponent("admin");
      await flushPromises();
      expect(newWrapper.vm.options).toEqual([]);
      newWrapper.unmount();
    });
  });

  describe("Email Input Handling", () => {
    it("handles mixed separators in email list", async () => {
      wrapper.vm.userEmail = "test1@example.com, test2@example.com; test3@example.com,test4@example.com";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { data: {}, message: "Success" }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        {
          invites: [
            "test1@example.com",
            "test2@example.com",
            "test3@example.com",
            "test4@example.com"
          ],
          role: "admin"
        },
        "test-org"
      );
    });

    it("trims whitespace from emails", async () => {
      wrapper.vm.userEmail = "  test1@example.com ,  test2@example.com  ";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { data: {}, message: "Success" }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        {
          invites: ["test1@example.com", "test2@example.com"],
          role: "admin"
        },
        "test-org"
      );
    });

    it("converts emails to lowercase", async () => {
      wrapper.vm.userEmail = "TEST@EXAMPLE.COM, Test@Example.com";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { data: {}, message: "Success" }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(organizationsService.add_members).toHaveBeenCalledWith(
        {
          invites: ["test@example.com"],
          role: "admin"
        },
        "test-org"
      );
    });
  });

  describe("Component Initialization", () => {
    it("initializes with default role as admin", () => {
      expect(wrapper.vm.selectedRole).toBe("admin");
    });

    it("fetches roles on mount", async () => {
      expect(usersService.getRoles).toHaveBeenCalledWith("test-org");
    });

    it("sets current user role from props", () => {
      expect(wrapper.vm.currentUserRole).toBe("admin");
    });

    it("initializes with empty email input", () => {
      expect(wrapper.vm.userEmail).toBe("");
    });
  });

  describe("Notification Behavior", () => {
    it("shows loading notification during invitation process", async () => {
      wrapper.vm.userEmail = "test@example.com";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve({ data: { data: {}, message: "Success" } }), 100))
      );

      await wrapper.find('button').trigger('click');

      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message: "Please wait...",
          timeout: 2000
        })
      );
    });

    it("dismisses loading notification after successful invitation", async () => {
      wrapper.vm.userEmail = "test@example.com";
      await nextTick();

      const dismissMock = vi.fn();
      toastMock.mockReturnValueOnce(dismissMock);

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { data: {}, message: "Success" }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(dismissMock).toHaveBeenCalled();
    });
  });

  describe("Role Selection Validation", () => {
    it("updates selected role when valid option is chosen", async () => {
      const select = wrapper.findComponent(OSelectStub);
      await select.vm.$emit('update:modelValue', 'member');
      await nextTick();

      expect(wrapper.vm.selectedRole).toBe('member');
      expect(select.props('modelValue')).toBe('member');
    });

    it("maintains default role when options are empty", async () => {
      vi.mocked(usersService.getRoles).mockResolvedValue({ data: [] });

      const newWrapper = mountComponent("admin");
      await flushPromises();
      expect(newWrapper.vm.selectedRole).toBe('admin');
      newWrapper.unmount();
    });

    it("updates options when getRoles returns new data", async () => {
      const newRoles = [
        { label: "Super Admin", value: "super_admin" },
        { label: "Basic User", value: "basic" }
      ];

      vi.mocked(usersService.getRoles).mockResolvedValue({ data: newRoles });

      const newWrapper = mountComponent("admin");
      await flushPromises();
      expect(newWrapper.vm.options).toEqual(newRoles);
      newWrapper.unmount();
    });
  });

  describe("Component Visibility", () => {
    const roles = ["member", "viewer", "custom", "unknown"];

    roles.forEach(role => {
      it(`does not show invitation form for ${role} role`, () => {
        const newWrapper = mountComponent(role);
        expect(newWrapper.find('.invite-user').exists()).toBe(false);
        newWrapper.unmount();
      });
    });

    it("shows invitation form for root user", () => {
      const newWrapper = mountComponent("root");
      expect(newWrapper.find('.invite-user').exists()).toBe(true);
      newWrapper.unmount();
    });
  });

  describe("Input Reset Behavior", () => {
    it("resets email input after successful invitation", async () => {
      wrapper.vm.userEmail = "test@example.com";
      await nextTick();

      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: { data: {}, message: "Success" }
      });

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.vm.userEmail).toBe("");
    });
  });
});
