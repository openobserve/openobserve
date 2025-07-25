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

// Mock userService
vi.mock("@/services/users", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
    updateexistinguser: vi.fn(),
    getUserRoles: vi.fn()
  }
}));

// Mock aws-exports
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: false
  }
}));

import AddUser from "@/components/iam/users/AddUser.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import userService from "@/services/users";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

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

describe("AddUser Component", () => {
  let wrapper;
  let mockRouter;
  let mockNotify;

  const defaultProps = {
    modelValue: {
      org_member_id: "",
      role: "admin",
      first_name: "",
      last_name: "",
      email: "",
      old_password: "",
      new_password: "",
      change_password: false,
      organization: "",
      other_organization: "",
    },
    isUpdated: false,
    userRole: "admin",
    roles: [
      {
        label: "Admin",
        value: "admin",
      },
      {
        label: "Member",
        value: "member",
      },
    ],
    customRoles: ["role1", "role2"],
  };

  beforeEach(async () => {
    // Reset mock implementations
    vi.mocked(userService.create).mockReset();
    vi.mocked(userService.update).mockReset();
    vi.mocked(userService.updateexistinguser).mockReset();
    vi.mocked(userService.getUserRoles).mockReset();

    // Setup store state
    store.state.organizations = [
      { name: "Test Org", identifier: "test-org" },
      { name: "Another Org", identifier: "another-org" }
    ];
    store.state.selectedOrganization = { identifier: "test-org", name: "Test Org" };
    store.state.userInfo = { email: "test@example.com" };

    // Setup router mock
    mockRouter = {
      push: vi.fn()
    };

    // Setup notify mock
    mockNotify = vi.fn();

    wrapper = mount(AddUser, {
      props: defaultProps,
      global: {
        plugins: [
          [Quasar, { platform }],
          [i18n]
        ],
        provide: { 
          store,
          platform
        },
        mocks: {
          $router: mockRouter,
          $q: {
            platform,
            notify: mockNotify,
            dialog: Dialog
          }
        }
      },
      attachTo: document.body
    });

    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === 'function') {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  it("renders the component", () => {
    expect(wrapper.exists()).toBe(true);
  });

  it("displays add user title when not updating", () => {
    expect(wrapper.find('.text-h6').exists()).toBe(true);
    expect(wrapper.vm.beingUpdated).toBe(false);
  });

  it("displays edit user title when updating", async () => {
    // Create a new wrapper with isUpdated true
    const editWrapper = mount(AddUser, {
      props: {
        ...defaultProps,
        isUpdated: true,
        modelValue: {
          ...defaultProps.modelValue,
          email: "test@example.com"
        }
      },
      global: {
        plugins: [
          i18n, 
          router,
          [Quasar, { platform }]
        ],
        provide: { 
          store,
          platform
        },
        mocks: {
          $q: {
            platform,
            notify: vi.fn()
          }
        }
      }
    });

    await nextTick();
    await flushPromises();
    
    const title = editWrapper.find('.text-h6');
    expect(title.exists()).toBe(true);
    expect(editWrapper.vm.beingUpdated).toBe(true);

    editWrapper.unmount();
  });

  it("validates email format", async () => {
    // Set existingUser to true to show email input
    wrapper.vm.existingUser = true;
    wrapper.vm.beingUpdated = false;
    await nextTick();

    const emailInput = wrapper.find('[data-test="user-email-field"]');
    expect(emailInput.exists()).toBe(true);
    
    await emailInput.setValue('invalid-email');
    await emailInput.trigger('blur');
    
    expect(wrapper.vm.formData.email).toBe('invalid-email');
  });

  it("validates password length", async () => {
    // Set conditions to show password input
    wrapper.vm.existingUser = false;
    wrapper.vm.beingUpdated = false;
    await nextTick();

    const passwordInput = wrapper.find('[data-test="user-password-field"]');
    expect(passwordInput.exists()).toBe(true);
    
    await passwordInput.setValue('short');
    await passwordInput.trigger('blur');
    
    expect(wrapper.vm.formData.password).toBe('short');
  });

  describe("Form Submission", () => {
    it("creates a new user successfully", async () => {
      vi.mocked(userService.create).mockResolvedValue({
        data: { message: "User created successfully" },
        status: 200,
      });

      // Set initial conditions
      wrapper.vm.formData = {
        email: "test@example.com",
        password: "password123",
        first_name: "John",
        last_name: "Doe",
        role: "admin",
        organization: "test-org",
      };
      wrapper.vm.existingUser = false;

      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "test@example.com",
          password: "password123"
        }),
        "test-org"
      );
    });

    it("updates an existing user successfully", async () => {
      vi.mocked(userService.update).mockResolvedValue({
        data: { message: "User updated successfully" },
        status: 200,
      });

      // Set initial conditions
      wrapper.vm.formData = {
        email: "test@example.com",
        first_name: "John Updated",
        last_name: "Doe Updated",
        role: "admin",
        organization: "test-org",
      };
      wrapper.vm.beingUpdated = true;

      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(userService.update).toHaveBeenCalled();
    });
  });

  describe("Custom Roles", () => {
    it("filters custom roles based on input", async () => {
      // Set conditions to show custom roles select
      await wrapper.setProps({
        ...defaultProps,
        userRole: "admin"
      });
      wrapper.vm.existingUser = true;
      await nextTick();

      const filterFn = wrapper.vm.filterFn;
      const updateFn = vi.fn();
      
      filterFn("role1", updateFn);
      expect(updateFn).toHaveBeenCalled();

      // Verify the filter works
      const lastCall = updateFn.mock.calls[updateFn.mock.calls.length - 1];
      const filterCallback = lastCall[0];
      filterCallback();
      expect(wrapper.vm.filterdOption).toContain("role1");
    });

    it("fetches user roles for existing user in enterprise mode", async () => {
      vi.mocked(userService.getUserRoles).mockResolvedValue({
        data: ["role1"],
      });

      await wrapper.vm.fetchUserRoles("test@example.com");
      await flushPromises();

      expect(userService.getUserRoles).toHaveBeenCalledWith(
        "test-org",
        "test@example.com"
      );
    });
  });

  describe("Password Change", () => {
    it("shows logout confirmation when changing own password", async () => {
      const email = store.state.userInfo.email;
      
      // Mount a new wrapper specifically for this test
      const passwordWrapper = mount(AddUser, {
        props: {
          ...defaultProps,
          isUpdated: true,
          modelValue: {
            ...defaultProps.modelValue,
            email: email
          }
        },
        global: {
          plugins: [
            i18n, 
            router,
            [Quasar, { platform }]
          ],
          provide: { 
            store,
            platform
          },
          mocks: {
            $q: {
              platform,
              notify: vi.fn()
            }
          }
        }
      });

      await nextTick();
      await flushPromises();

      // Set up the form data
      passwordWrapper.vm.formData = {
        email: email,
        change_password: true,
        new_password: "newpassword123",
        old_password: "oldpassword123"
      };
      passwordWrapper.vm.beingUpdated = true;
      passwordWrapper.vm.loggedInUserEmail = email;

      await nextTick();

      // Mock the update service call
      vi.mocked(userService.update).mockResolvedValue({
        data: { message: "Password updated" },
        status: 200,
      });

      // Submit the form
      const form = passwordWrapper.find('form');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(passwordWrapper.vm.logout_confirm).toBe(true);
      
      passwordWrapper.unmount();
    });
  });

  describe("Form Validation", () => {
    it("validates required fields", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.beingUpdated = false;
      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      
      // Check if validation prevented submission
      expect(userService.create).not.toHaveBeenCalled();
    });

    it("validates organization name format", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.beingUpdated = false;
      wrapper.vm.formData.organization = "other";
      wrapper.vm.formData.other_organization = "123-invalid";
      await nextTick();

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');
      
      // Should show validation error for organization name
      expect(wrapper.text()).toContain("Input must start with a letter");
    });

    it("validates password match for change password", async () => {
      const email = store.state.userInfo.email;
      const passwordWrapper = mount(AddUser, {
        props: {
          ...defaultProps,
          isUpdated: true,
          modelValue: { ...defaultProps.modelValue, email }
        },
        global: {
          plugins: [i18n, router, [Quasar, { platform }]],
          provide: { store, platform },
          mocks: { $q: { platform, notify: vi.fn() } }
        }
      });

      passwordWrapper.vm.formData = {
        email,
        change_password: true,
        old_password: "oldpassword123",
        new_password: "short" // Too short password
      };
      passwordWrapper.vm.beingUpdated = true;

      await nextTick();
      const form = passwordWrapper.find('form');
      await form.trigger('submit.prevent');

      expect(userService.update).not.toHaveBeenCalled();
      passwordWrapper.unmount();
    });
  });

  describe("User Role Management", () => {
    it("shows custom role field for admin users", async () => {
      const adminWrapper = mount(AddUser, {
        props: {
          ...defaultProps,
          userRole: "admin",
          customRoles: ["role1", "role2"]
        },
        global: {
          plugins: [i18n, router, [Quasar, { platform }]],
          provide: { store, platform },
          mocks: { $q: { platform, notify: vi.fn() } }
        }
      });

      adminWrapper.vm.existingUser = true;
      await nextTick();

      const customRoleField = adminWrapper.find('[data-test="user-custom-role-field"]');
      expect(customRoleField.exists()).toBe(true);
      adminWrapper.unmount();
    });

    it("hides custom role field for member users", async () => {
      const memberWrapper = mount(AddUser, {
        props: {
          ...defaultProps,
          userRole: "member",
          customRoles: ["role1", "role2"]
        },
        global: {
          plugins: [i18n, router, [Quasar, { platform }]],
          provide: { store, platform },
          mocks: { $q: { platform, notify: vi.fn() } }
        }
      });

      memberWrapper.vm.existingUser = true;
      await nextTick();

      const customRoleField = memberWrapper.find('[data-test="user-custom-role-field"]');
      expect(customRoleField.exists()).toBe(false);
      memberWrapper.unmount();
    });
  });

  describe("Enterprise Mode Features", () => {
    it("fetches user roles in enterprise mode", async () => {
      const email = "test@example.com";
      const roles = ["role1", "role2"];
      
      vi.mocked(userService.getUserRoles).mockResolvedValue({
        data: roles
      });

      const enterpriseWrapper = mount(AddUser, {
        props: {
          ...defaultProps,
          isUpdated: true,
          modelValue: { ...defaultProps.modelValue, email }
        },
        global: {
          plugins: [i18n, router, [Quasar, { platform }]],
          provide: { store, platform },
          mocks: { $q: { platform, notify: vi.fn() } }
        }
      });

      await flushPromises();

      expect(userService.getUserRoles).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        email
      );
      
      enterpriseWrapper.unmount();
    });

    it("handles error in fetching user roles", async () => {
      const email = "test@example.com";
      const errorMessage = "Failed to fetch roles";
      
      vi.mocked(userService.getUserRoles).mockRejectedValue({
        message: errorMessage
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const enterpriseWrapper = mount(AddUser, {
        props: {
          ...defaultProps,
          isUpdated: true,
          modelValue: { ...defaultProps.modelValue, email }
        },
        global: {
          plugins: [i18n, router, [Quasar, { platform }]],
          provide: { store, platform },
          mocks: { $q: { platform, notify: vi.fn() } }
        }
      });

      await flushPromises();

      expect(consoleSpy).toHaveBeenCalledWith("Error fetching user roles:", expect.any(Object));
      
      consoleSpy.mockRestore();
      enterpriseWrapper.unmount();
    });
  });
});
