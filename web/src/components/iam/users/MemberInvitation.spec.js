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
import { Dialog, Notify, Quasar } from "quasar";
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

// Install Quasar with platform
installQuasar({
  plugins: [Dialog, Notify],
  config: {
    platform
  }
});

describe("MemberInvitation Component", () => {
  let wrapper;

  beforeEach(async () => {
    // Reset mocks
    vi.mocked(organizationsService.add_members).mockReset();
    vi.mocked(usersService.getRoles).mockReset();
    vi.mocked(segment.track).mockReset();
    

    // Setup store state
    store.state.selectedOrganization = { identifier: "test-org", name: "Test Org" };
    store.state.userInfo = { email: "test@example.com" };

    // Mock getRoles response
    vi.mocked(usersService.getRoles).mockResolvedValue({
      data: [
        { label: "Admin", value: "admin" },
        { label: "Member", value: "member" }
      ]
    });

    wrapper = mount(MemberInvitation, {
      props: {
        currentrole: "admin"
      },
      global: {
        plugins: [
          [Quasar, { platform }],
          i18n
        ],
        provide: { 
          store,
          platform
        },
        mocks: {
        }
      },
      attachTo: document.body
    });


    await flushPromises();

    let dismissMock = vi.fn();
    let notifyMock = vi.fn().mockReturnValue(dismissMock);
    // wrapper.vm.$q = { notify: notifyMock };
    wrapper.vm.$q.notify = notifyMock;
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
    const memberWrapper = mount(MemberInvitation, {
      props: {
        currentrole: "member"
      },
      global: {
        plugins: [
          [Quasar, { platform }],
          i18n
        ],
        provide: { 
          store,
          platform
        }
      }
    });
    await nextTick();
    expect(memberWrapper.find('.invite-user').exists()).toBe(false);
    memberWrapper.unmount();
  });

  describe("Email Validation", () => {
    it("validates single email", async () => {
      const emailInput = wrapper.find('.q-input input');
      expect(emailInput.exists()).toBe(true);
      
      await emailInput.setValue("invalid-email");
      await wrapper.find('.q-btn').trigger('click');
      await flushPromises();
      
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please enter correct email id."
        })
      );
    });

    it("validates multiple emails", async () => {
      const emailInput = wrapper.find('.q-input input');
      expect(emailInput.exists()).toBe(true);
      
      await emailInput.setValue("test1@example.com; invalid-email, test2@example.com");
      await wrapper.find('.q-btn').trigger('click');
      await flushPromises();
      
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Please enter correct email id."
        })
      );
    });

    it("accepts valid emails", async () => {
      const validEmails = "test1@example.com; test2@example.com, test3@example.com";
      const emailInput = wrapper.find('.q-input input');
      expect(emailInput.exists()).toBe(true);
      
      await emailInput.setValue(validEmails);
      
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: {
          data: {},
          message: "Invitations sent successfully"
        }
      });

      await wrapper.find('.q-btn').trigger('click');
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
      const emailInput = wrapper.find('.q-input input');
      expect(emailInput.exists()).toBe(true);
      
      await emailInput.setValue("test@example.com");
      
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: {
          data: {},
          message: "Invitations sent successfully"
        }
      });

      await wrapper.find('.q-btn').trigger('click');
      await flushPromises();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "positive",
          message: "Invitations sent successfully",
          timeout: 5000
        })
      );
      expect(wrapper.vm.userEmail).toBe("");
    });

    it("handles invalid members error", async () => {
      const emailInput = wrapper.find('.q-input input');
      expect(emailInput.exists()).toBe(true);
      
      await emailInput.setValue("test@example.com");
      
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: {
          data: {
            invalid_members: ["test@example.com"]
          }
        }
      });

      await wrapper.find('.q-btn').trigger('click');
      await flushPromises();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Error while member invitation: test@example.com",
          timeout: 15000
        })
      );
    });

    it("tracks invitation in analytics", async () => {
      const emailInput = wrapper.find('.q-input input');
      expect(emailInput.exists()).toBe(true);
      
      await emailInput.setValue("test@example.com");
      
      vi.mocked(organizationsService.add_members).mockResolvedValue({
        data: {
          data: {},
          message: "Success"
        }
      });

      await wrapper.find('.q-btn').trigger('click');
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
      const emailInput = wrapper.find('.q-input input');
      expect(emailInput.exists()).toBe(true);
      
      await emailInput.setValue("");
      await nextTick();
      
      const inviteButton = wrapper.find('.q-btn');
      expect(inviteButton.attributes('disabled')).toBeDefined();
    });

    it("enables invite button when email is provided", async () => {
      const emailInput = wrapper.find('.q-input input');
      expect(emailInput.exists()).toBe(true);
      
      await emailInput.setValue("test@example.com");
      await nextTick();
      
      const inviteButton = wrapper.find('.q-btn');
      expect(inviteButton.attributes('disabled')).toBeUndefined();
    });

    it("allows role selection", async () => {
      const select = wrapper.findComponent('.q-select');
      expect(select.exists()).toBe(true);
      
      await select.vm.$emit('update:modelValue', 'member');
      await nextTick();
      
      expect(wrapper.vm.selectedRole).toBe('member');
    });
  });
});
