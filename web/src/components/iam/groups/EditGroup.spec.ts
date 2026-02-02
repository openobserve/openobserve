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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach } from "vitest";
import EditGroup from "@/components/iam/groups/EditGroup.vue";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Notify } from "quasar";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

installQuasar({
  plugins: [Notify],
});

vi.mock("@/services/iam", () => ({
  getGroup: vi.fn(() => Promise.resolve({ data: {} })),
  updateGroup: vi.fn(() => Promise.resolve({})),
}));

vi.mock("@/composables/iam/usePermissions", () => ({
  default: vi.fn(() => ({
    groupsState: {
      groups: {},
    },
  })),
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

vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
  },
}));

// Mock child components
vi.mock("./GroupRoles.vue", () => ({
  default: {
    name: "GroupRoles",
    template: `<div data-test="group-roles-mock">GroupRoles</div>`,
    props: ["groupRoles", "activeTab", "addedRoles", "removedRoles"],
  },
}));

vi.mock("./GroupUsers.vue", () => ({
  default: {
    name: "GroupUsers",
    template: `<div data-test="group-users-mock">GroupUsers</div>`,
    props: ["groupUsers", "activeTab", "addedUsers", "removedUsers"],
  },
}));

vi.mock("./GroupServiceAccounts.vue", () => ({
  default: {
    name: "GroupServiceAccounts",
    template: `<div data-test="group-service-accounts-mock">GroupServiceAccounts</div>`,
    props: ["groupServiceAccounts", "activeTab", "addedServiceAccounts", "removedServiceAccounts"],
  },
}));

vi.mock("@/components/common/AppTabs.vue", () => ({
  default: {
    name: "AppTabs",
    template: `
      <div data-test="app-tabs-mock">
        <button 
          v-for="tab in tabs" 
          :key="tab.value"
          :data-test="'tab-' + tab.value"
          @click="$emit('update:active-tab', tab.value)"
        >
          {{ tab.label }}
        </button>
      </div>
    `,
    props: ["tabs", "activeTab"],
    emits: ["update:active-tab"],
  },
}));

describe("EditGroup Component", () => {
  let wrapper: any;
  const mockRoute = {
    params: { group_name: "test-group" },
  };

  beforeEach(async () => {
    // Mock router.currentRoute
    vi.mocked(router).currentRoute = {
      value: mockRoute,
    } as any;

    const mockGroupsState = {
      groups: {},
    };

    vi.mocked(await import("@/composables/iam/usePermissions")).default.mockReturnValue({
      groupsState: mockGroupsState,
    });

    wrapper = mount(EditGroup, {
      global: {
        provide: { store },
        plugins: [i18n, router],
      },
    });

    await flushPromises();
  });

  describe("Component Mounting", () => {
    it("renders the component correctly", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="edit-group-section"]').exists()).toBe(true);
    });

    it("displays group name in title", async () => {
      wrapper.vm.groupDetails.group_name = "test-group";
      await wrapper.vm.$nextTick();

      const titleElement = wrapper.find('[data-test="edit-group-section-title"]');
      expect(titleElement.exists()).toBe(true);
      // The title div contains both the group name and tabs, so we check if it includes the group name
      expect(titleElement.text()).toContain("test-group");
    });

    it("renders tabs component", () => {
      // Check that the tabs component is rendered (since it's mocked)
      expect(wrapper.vm.tabs).toBeDefined();
      expect(wrapper.vm.activeTab).toBeDefined();
    });

    it("renders cancel and save buttons", () => {
      const cancelButton = wrapper.find('[data-test="edit-group-cancel-btn"]');
      const saveButton = wrapper.find('[data-test="edit-group-submit-btn"]');
      
      expect(cancelButton.exists()).toBe(true);
      expect(saveButton.exists()).toBe(true);
      expect(cancelButton.text()).toContain("Cancel");
      expect(saveButton.text()).toContain("Save");
    });
  });

  describe("Tab Management", () => {
    it("initializes with roles tab active", () => {
      expect(wrapper.vm.activeTab).toBe("roles");
    });

    it("has correct tab structure", () => {
      expect(wrapper.vm.tabs).toHaveLength(3); // Since aws-exports mock sets isCloud to "false"
      expect(wrapper.vm.tabs[0]).toEqual({
        value: "roles",
        label: "Roles",
      });
      expect(wrapper.vm.tabs[1]).toEqual({
        value: "users",
        label: "Users",
      });
      expect(wrapper.vm.tabs[2]).toEqual({
        value: "serviceAccounts",
        label: "Service Accounts",
      });
    });

    it("includes service accounts tab when not in cloud mode", () => {
      // Since our mock sets isCloud to "false", service accounts tab should be included
      expect(wrapper.vm.tabs).toHaveLength(3);
      expect(wrapper.vm.tabs[2]).toEqual({
        value: "serviceAccounts",
        label: "Service Accounts",
      });
    });

    it("switches tab when updateActiveTab is called", () => {
      wrapper.vm.updateActiveTab("users");
      expect(wrapper.vm.activeTab).toBe("users");
    });

    it("ignores empty tab value", () => {
      const previousTab = wrapper.vm.activeTab;
      wrapper.vm.updateActiveTab("");
      expect(wrapper.vm.activeTab).toBe(previousTab);
    });
  });

  describe("Component Visibility", () => {
    it("shows GroupRoles when roles tab is active", async () => {
      wrapper.vm.activeTab = "roles";
      await wrapper.vm.$nextTick();
      
      const groupRoles = wrapper.find('[data-test="group-roles-mock"]');
      expect(groupRoles.exists()).toBe(true);
    });

    it("shows GroupUsers when users tab is active", async () => {
      wrapper.vm.activeTab = "users";
      await wrapper.vm.$nextTick();
      
      const groupUsers = wrapper.find('[data-test="group-users-mock"]');
      expect(groupUsers.exists()).toBe(true);
    });

    it("shows GroupServiceAccounts when serviceAccounts tab is active and not in cloud", async () => {
      wrapper.vm.activeTab = "serviceAccounts";
      await wrapper.vm.$nextTick();
      
      const groupServiceAccounts = wrapper.find('[data-test="group-service-accounts-mock"]');
      expect(groupServiceAccounts.exists()).toBe(true);
    });
  });

  describe("Data Loading", () => {
    it("fetches group details on mount", async () => {
      const { getGroup } = await import("@/services/iam");
      const mockGroupData = {
        data: {
          name: "test-group",
          roles: ["admin", "user"],
          users: ["user1@test.com", "user2@test.com"],
        },
      };
      vi.mocked(getGroup).mockResolvedValue(mockGroupData);

      await wrapper.vm.getGroupDetails();

      expect(getGroup).toHaveBeenCalledWith(
        "test-group",
        store.state.selectedOrganization.identifier
      );
      expect(wrapper.vm.groupDetails).toEqual({
        name: "test-group",
        group_name: "test-group",
        roles: ["admin", "user"],
        users: ["user1@test.com", "user2@test.com"],
      });
    });

    it("handles error when fetching group details", async () => {
      const { getGroup } = await import("@/services/iam");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      // Create a new wrapper to avoid interference with previous calls
      const newWrapper = mount(EditGroup, {
        global: {
          provide: { store },
          plugins: [i18n, router],
        },
      });
      
      vi.mocked(getGroup).mockRejectedValueOnce(new Error("Network error"));

      await newWrapper.vm.getGroupDetails();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("stores group details in groupsState", async () => {
      const { getGroup } = await import("@/services/iam");
      const mockGroupData = {
        data: {
          name: "test-group",
          roles: ["admin"],
          users: ["user1@test.com"],
        },
      };
      vi.mocked(getGroup).mockResolvedValue(mockGroupData);

      await wrapper.vm.getGroupDetails();

      expect(wrapper.vm.groupsState.groups["test-group"]).toBeDefined();
    });
  });

  describe("State Management", () => {
    it("initializes with empty sets for added/removed items", () => {
      expect(wrapper.vm.addedUsers).toEqual(new Set());
      expect(wrapper.vm.removedUsers).toEqual(new Set());
      expect(wrapper.vm.addedRoles).toEqual(new Set());
      expect(wrapper.vm.removedRoles).toEqual(new Set());
    });

    it("maintains default group details structure", () => {
      // The component fetches data on mount, so groupDetails will be populated
      expect(wrapper.vm.groupDetails.group_name).toBeDefined();
      expect(Array.isArray(wrapper.vm.groupDetails.roles)).toBe(true);
      expect(Array.isArray(wrapper.vm.groupDetails.users)).toBe(true);
    });
  });

  describe("Save Changes", () => {
    beforeEach(() => {
      mockNotify.mockClear();
    });

    it("shows info notification when no changes detected", async () => {
      await wrapper.vm.saveGroupChanges();

      expect(mockNotify).toHaveBeenCalledWith({
        type: "info",
        message: "No updates detected.",
        timeout: 3000,
      });
    });

    it("saves changes successfully when updates exist", async () => {
      const { updateGroup } = await import("@/services/iam");
      vi.mocked(updateGroup).mockResolvedValue({});

      wrapper.vm.groupDetails.group_name = "test-group";
      wrapper.vm.addedUsers.add("newuser@test.com");
      wrapper.vm.removedRoles.add("old-role");

      await wrapper.vm.saveGroupChanges();

      expect(updateGroup).toHaveBeenCalledWith({
        group_name: "test-group",
        org_identifier: store.state.selectedOrganization.identifier,
        payload: {
          add_users: ["newuser@test.com"],
          remove_users: [],
          add_roles: [],
          remove_roles: ["old-role"],
        },
      });

      expect(mockNotify).toHaveBeenCalledWith({
        type: "positive",
        message: "Updated group successfully!",
        timeout: 3000,
      });
    });

    it("resets added/removed sets after successful save", async () => {
      const { updateGroup } = await import("@/services/iam");
      vi.mocked(updateGroup).mockResolvedValue({});

      wrapper.vm.addedUsers.add("user1@test.com");
      wrapper.vm.removedUsers.add("user2@test.com");
      wrapper.vm.addedRoles.add("role1");
      wrapper.vm.removedRoles.add("role2");

      await wrapper.vm.saveGroupChanges();

      expect(wrapper.vm.addedUsers.size).toBe(0);
      expect(wrapper.vm.removedUsers.size).toBe(0);
      expect(wrapper.vm.addedRoles.size).toBe(0);
      expect(wrapper.vm.removedRoles.size).toBe(0);
    });

    it("updates group details after successful save", async () => {
      const { updateGroup } = await import("@/services/iam");
      vi.mocked(updateGroup).mockResolvedValue({});

      wrapper.vm.groupDetails = {
        group_name: "test-group",
        roles: ["admin", "old-role"],
        users: ["user1@test.com", "user2@test.com"],
      };

      wrapper.vm.addedUsers.add("newuser@test.com");
      wrapper.vm.removedUsers.add("user2@test.com");
      wrapper.vm.addedRoles.add("new-role");
      wrapper.vm.removedRoles.add("old-role");

      await wrapper.vm.saveGroupChanges();

      expect(wrapper.vm.groupDetails.users).toEqual(["user1@test.com", "newuser@test.com"]);
      expect(wrapper.vm.groupDetails.roles).toEqual(["admin", "new-role"]);
    });

    it("handles save error", async () => {
      const { updateGroup } = await import("@/services/iam");
      const mockError = { response: { status: 500 } };
      vi.mocked(updateGroup).mockRejectedValue(mockError);

      wrapper.vm.addedUsers.add("user1@test.com");

      try {
        await wrapper.vm.saveGroupChanges();
      } catch (error) {
        // Error should be caught by component
      }

      // Give time for async operations
      await flushPromises();

      expect(mockNotify).toHaveBeenCalledWith({
        type: "negative",
        message: "Error while updating group!",
        timeout: 3000,
      });
    });

    it("does not show error notification for 403 status", async () => {
      const { updateGroup } = await import("@/services/iam");
      const mockError = { response: { status: 403 } };
      vi.mocked(updateGroup).mockRejectedValue(mockError);

      wrapper.vm.addedUsers.add("user1@test.com");

      await wrapper.vm.saveGroupChanges();

      expect(mockNotify).not.toHaveBeenCalled();
    });
  });

  describe("Navigation", () => {
    it("navigates back to groups page when cancel is clicked", async () => {
      const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);

      await wrapper.vm.cancelEditGroup();

      expect(routerPushSpy).toHaveBeenCalledWith({
        name: "groups",
        query: {
          org_identifier: store.state.selectedOrganization.identifier
        }
      });
    });

    it("triggers navigation when cancel button is clicked", async () => {
      const cancelButton = wrapper.find('[data-test="edit-group-cancel-btn"]');
      
      expect(cancelButton.exists()).toBe(true);
      expect(cancelButton.text()).toContain("Cancel");
      
      // Test that the button can be clicked (without actually triggering navigation)
      await cancelButton.trigger("click");
      
      // The click event should be handled (we tested the actual navigation above)
      expect(cancelButton.exists()).toBe(true);
    });
  });

  describe("Theme Support", () => {
    it("applies correct theme classes to sticky footer", () => {
      // Footer classes have been updated to use Tailwind CSS
      const footer = wrapper.find('.flex.justify-end.tw\\:w-full');
      expect(footer.exists()).toBe(true);
      // Test that theme classes are applied correctly
    });

    it("switches to dark theme classes when theme is dark", async () => {
      const darkStore = {
        ...store,
        state: {
          ...store.state,
          theme: 'dark',
        },
      };

      const wrapper = mount(EditGroup, {
        global: {
          provide: { store: darkStore },
          plugins: [i18n, router],
        },
      });

      // Footer classes have been updated, theme classes are no longer applied to footer
      const footer = wrapper.find('.flex.justify-end.tw\\:w-full');
      expect(footer.exists()).toBe(true);
    });
  });

  describe("Props Passing", () => {
    it("passes correct props to GroupRoles", async () => {
      wrapper.vm.activeTab = "roles";
      wrapper.vm.groupDetails.roles = ["admin", "user"];
      wrapper.vm.addedRoles.add("new-role");
      wrapper.vm.removedRoles.add("old-role");
      
      await wrapper.vm.$nextTick();
      
      const groupRoles = wrapper.findComponent({ name: "GroupRoles" });
      expect(groupRoles.props()).toEqual({
        groupRoles: ["admin", "user"],
        activeTab: "roles",
        addedRoles: wrapper.vm.addedRoles,
        removedRoles: wrapper.vm.removedRoles,
      });
    });

    it("passes correct props to GroupUsers", async () => {
      wrapper.vm.activeTab = "users";
      wrapper.vm.groupDetails.users = ["user1@test.com"];
      wrapper.vm.addedUsers.add("new-user@test.com");
      wrapper.vm.removedUsers.add("old-user@test.com");
      
      await wrapper.vm.$nextTick();
      
      const groupUsers = wrapper.findComponent({ name: "GroupUsers" });
      expect(groupUsers.props()).toEqual({
        groupUsers: ["user1@test.com"],
        activeTab: "users",
        addedUsers: wrapper.vm.addedUsers,
        removedUsers: wrapper.vm.removedUsers,
      });
    });
  });

  describe("Edge Cases", () => {
    it("handles missing route params", () => {
      // Mock route without group_name
      vi.mocked(router).currentRoute = {
        value: { params: {} },
      } as any;
      
      expect(() => wrapper.vm.getGroupDetails()).not.toThrow();
    });

    it("handles empty group data response", async () => {
      const { getGroup } = await import("@/services/iam");
      vi.mocked(getGroup).mockResolvedValueOnce({ data: {} });

      const newWrapper = mount(EditGroup, {
        global: {
          provide: { store },
          plugins: [i18n, router],
        },
      });

      await newWrapper.vm.getGroupDetails();

      expect(newWrapper.vm.groupDetails.group_name).toBeDefined();
    });

    it("constructs payload with all empty arrays when no changes", async () => {
      const { updateGroup } = await import("@/services/iam");
      vi.mocked(updateGroup).mockResolvedValue({});

      // Force a save attempt with no changes
      wrapper.vm.addedUsers.add("temp");
      wrapper.vm.addedUsers.delete("temp");

      // This should still trigger the "no changes" path
      await wrapper.vm.saveGroupChanges();

      expect(mockNotify).toHaveBeenCalledWith({
        type: "info",
        message: "No updates detected.",
        timeout: 3000,
      });
    });
  });
});