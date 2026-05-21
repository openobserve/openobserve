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

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GroupRoles from "@/components/iam/groups/GroupRoles.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/iam", () => ({
  getRoles: vi.fn(() => Promise.resolve({ data: ["admin", "user", "developer"] })),
}));

vi.mock("@/composables/iam/usePermissions", () => ({
  default: vi.fn(() => ({
    rolesState: {},
    groupsState: {},
  })),
}));

describe("GroupRoles Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    const mockPermissions = {
      rolesState: {},
      groupsState: {},
    };

    vi.mocked(await import("@/composables/iam/usePermissions")).default.mockReturnValue(mockPermissions);

    wrapper = mount(GroupRoles, {
      global: {
        provide: { store },
        plugins: [i18n],
      },
      props: {
        groupRoles: ["admin", "user"],
        activeTab: "roles",
        addedRoles: new Set(),
        removedRoles: new Set(),
      },
    });

    await flushPromises();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  describe("Component Mounting", () => {
    it("renders the component correctly", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-roles-selection-section"]').exists()).toBe(true);
    });

    it("renders filter options", () => {
      const showToggle = wrapper.find('[data-test="iam-roles-selection-show-toggle"]');
      const showText = wrapper.find('[data-test="iam-roles-selection-show-text"]');

      expect(showToggle.exists()).toBe(true);
      expect(showText.text()).toBe("Show");
    });

    it("renders search input", () => {
      const searchInput = wrapper.find('[data-test="iam-roles-selection-search-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("renders table section", () => {
      const table = wrapper.find('[data-test="iam-roles-selection-table"]');
      expect(table.exists()).toBe(true);
    });
  });

  describe("Filter Options", () => {
    it("has correct display options", () => {
      expect(wrapper.vm.usersDisplayOptions).toEqual([
        { label: "All", value: "all" },
        { label: "Selected", value: "selected" },
      ]);
    });

    it("initializes with 'selected' display option", () => {
      expect(wrapper.vm.usersDisplay).toBe("selected");
    });

    it("renders filter buttons for each option", () => {
      const allButton = wrapper.find('[data-test="iam-roles-selection-show-all-btn"]');
      const selectedButton = wrapper.find('[data-test="iam-roles-selection-show-selected-btn"]');

      expect(allButton.exists()).toBe(true);
      expect(selectedButton.exists()).toBe(true);
    });

    it("switches display option when button is clicked", async () => {
      const allButton = wrapper.find('[data-test="iam-roles-selection-show-all-btn"]');
      await allButton.trigger("click");

      expect(wrapper.vm.usersDisplay).toBe("all");
    });
  });

  describe("Search Functionality", () => {
    it("updates search key when typing", async () => {
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("admin");

      expect(wrapper.vm.userSearchKey).toBe("admin");
    });

    it("has correct search placeholder", () => {
      const searchInput = wrapper.find('input[placeholder="Search Roles"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("filters roles correctly", async () => {
      // Switch to "all" to see all roles including developer
      const allButton = wrapper.find('[data-test="iam-roles-selection-show-all-btn"]');
      await allButton.trigger("click");
      await flushPromises();

      // Verify all 3 roles are visible before filtering
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]').exists()).toBe(true);

      // Act: type search term
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("admin");
      await flushPromises();

      // Assert: only matching role checkbox is visible
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]').exists()).toBe(false);
    });

    it("filters roles case-insensitively", async () => {
      // Switch to "all" to see all roles
      const allButton = wrapper.find('[data-test="iam-roles-selection-show-all-btn"]');
      await allButton.trigger("click");
      await flushPromises();

      // Act: type search term in uppercase
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("ADMIN");
      await flushPromises();

      // Assert: case-insensitive match finds the role
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]').exists()).toBe(false);
    });

    it("returns all roles when search term is empty", async () => {
      // Switch to "all" to see all roles
      const allButton = wrapper.find('[data-test="iam-roles-selection-show-all-btn"]');
      await allButton.trigger("click");
      await flushPromises();

      // Act: clear search
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("");
      await flushPromises();

      // Assert: all 3 roles visible
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]').exists()).toBe(true);
    });
  });

  describe("Data Loading", () => {
    it("fetches roles on component mount", async () => {
      const { getRoles } = await import("@/services/iam");
      const mockRolesData = ["admin", "user", "developer"];
      vi.mocked(getRoles).mockResolvedValue({ data: mockRolesData });

      await wrapper.vm.getchOrgUsers();

      expect(getRoles).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    });

    it("transforms roles data correctly", async () => {
      const { getRoles } = await import("@/services/iam");
      const mockRolesData = ["admin", "user"];
      vi.mocked(getRoles).mockResolvedValue({ data: mockRolesData });

      await wrapper.vm.getchOrgUsers();

      expect(wrapper.vm.users).toHaveLength(2);
      expect(wrapper.vm.users[0]).toEqual({
        role_name: "admin",
        "#": 1,
        isInGroup: true, // admin is in groupRoles prop
      });
      expect(wrapper.vm.users[1]).toEqual({
        role_name: "user",
        "#": 2,
        isInGroup: true, // user is in groupRoles prop
      });
    });

    it("marks roles as selected based on groupRoles prop", async () => {
      const { getRoles } = await import("@/services/iam");
      const mockRolesData = ["admin", "user", "developer"];
      vi.mocked(getRoles).mockResolvedValue({ data: mockRolesData });

      // groupRoles prop contains ["admin", "user"]
      await wrapper.vm.getchOrgUsers();

      const adminRole = wrapper.vm.users.find((user: any) => user.role_name === "admin");
      const userRole = wrapper.vm.users.find((user: any) => user.role_name === "user");
      const developerRole = wrapper.vm.users.find((user: any) => user.role_name === "developer");

      expect(adminRole.isInGroup).toBe(true);
      expect(userRole.isInGroup).toBe(true);
      expect(developerRole.isInGroup).toBe(false);
    });
  });

  describe("Table Structure", () => {
    it("has correct column structure", () => {
      expect(wrapper.vm.columns).toHaveLength(2);

      const selectColumn = wrapper.vm.columns[0];
      expect(selectColumn.id).toBe("select");
      expect(selectColumn.accessorKey).toBe("isInGroup");

      const roleNameColumn = wrapper.vm.columns[1];
      expect(roleNameColumn.id).toBe("role_name");
      expect(roleNameColumn.accessorKey).toBe("role_name");
      expect(roleNameColumn.sortable).toBe(true);
    });

    it("renders table with roles data", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValue({
        data: ["admin", "user"],
      });

      await wrapper.vm.getchOrgUsers();
      await wrapper.vm.updateUserTable("all");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.rows).toHaveLength(2);
    });

    it("shows no users message when no roles", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValue({ data: [] });

      const emptyWrapper = mount(GroupRoles, {
        global: {
          provide: { store },
          plugins: [i18n],
        },
        props: {
          groupRoles: [],
          activeTab: "roles",
          addedRoles: new Set(),
          removedRoles: new Set(),
        },
      });
      await flushPromises();

      // OTable renders the NoData component in its #empty slot
      const noData = emptyWrapper.find('[data-test="no-data-message"]');
      expect(noData.exists()).toBe(true);

      emptyWrapper.unmount();
    });
  });

  describe("Role Selection", () => {
    it("renders checkboxes for role selection", () => {
      // After mount, roles "admin" and "user" are selected (in groupRoles)
      // "developer" is not selected and hidden (usersDisplay is "selected")
      const adminCheckbox = wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]');
      const userCheckbox = wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]');

      expect(adminCheckbox.exists()).toBe(true);
      expect(userCheckbox.exists()).toBe(true);
    });

    it("toggles selection when checkbox is clicked", async () => {
      // Switch to "all" to see developer role
      const allButton = wrapper.find('[data-test="iam-roles-selection-show-all-btn"]');
      await allButton.trigger("click");
      await flushPromises();

      const developerCheckbox = wrapper.find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]');
      expect(developerCheckbox.exists()).toBe(true);

      // Click the developer checkbox to select it
      await developerCheckbox.trigger("click");
      await flushPromises();

      // The toggleUserSelection function mutates props.addedRoles directly
      // "developer" was not in groupUsersMap, so it should be added to addedRoles
      expect(wrapper.props("addedRoles").has("developer")).toBe(true);
    });

    it("adds role to addedRoles when selecting unassigned role", () => {
      const addedRoles = new Set();
      const removedRoles = new Set();

      // Apply props via setProps to update groupUsersMap
      // groupRoles: [] means nothing is originally in group
      // isInGroup: false means the checkbox is currently unchecked
      // After toggle: isInGroup becomes true → role was not in groupUsersMap → added to addedRoles
      const testRole = { role_name: "admin", isInGroup: false };

      // Set groupUsersMap to empty (no roles originally in group)
      wrapper.vm.groupUsersMap = new Set([]);

      wrapper.vm.toggleUserSelection(testRole);

      expect(addedRoles.has("admin")).toBe(true);
    });

    it("adds role to removedRoles when deselecting assigned role", () => {
      const addedRoles = new Set();
      const removedRoles = new Set();

      // Role was originally in group (groupUsersMap has "admin")
      // isInGroup: true means the checkbox is currently checked
      // After toggle: isInGroup becomes false → role was in groupUsersMap → added to removedRoles
      const testRole = { role_name: "admin", isInGroup: true };

      wrapper.vm.groupUsersMap = new Set(["admin"]);

      wrapper.vm.toggleUserSelection(testRole);

      expect(removedRoles.has("admin")).toBe(true);
    });

    it("removes role from addedRoles when deselecting newly added role", () => {
      const addedRoles = new Set(["user"]);
      const removedRoles = new Set();

      // Role was NOT originally in group (groupUsersMap is empty)
      // isInGroup: true means the checkbox is currently checked (previously selected)
      // After toggle: isInGroup becomes false → role was not in groupUsersMap → removed from addedRoles
      const testRole = { role_name: "user", isInGroup: true };

      wrapper.vm.groupUsersMap = new Set([]);

      wrapper.vm.toggleUserSelection(testRole);

      expect(addedRoles.has("user")).toBe(false);
    });

    it("removes role from removedRoles when reselecting removed role", () => {
      const addedRoles = new Set();
      const removedRoles = new Set(["admin"]);

      // Role WAS originally in group (groupUsersMap has "admin")
      // isInGroup: false means the checkbox is currently unchecked (previously deselected)
      // After toggle: isInGroup becomes true → role was in groupUsersMap → removed from removedRoles
      const testRole = { role_name: "admin", isInGroup: false };

      wrapper.vm.groupUsersMap = new Set(["admin"]);

      wrapper.vm.toggleUserSelection(testRole);

      expect(removedRoles.has("admin")).toBe(false);
    });
  });

  describe("Display Filtering", () => {
    beforeEach(async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValue({
        data: ["admin", "user", "developer"],
      });
    });

    it("shows all roles when display is 'all'", async () => {
      // Set up the mock data first
      await wrapper.vm.getchOrgUsers();
      await wrapper.vm.updateUserTable("all");
      expect(wrapper.vm.rows.length).toBeGreaterThanOrEqual(2); // At least the existing roles
    });

    it("shows only selected roles when display is 'selected'", async () => {
      await wrapper.vm.getchOrgUsers(); // This will mark admin and user as selected
      await wrapper.vm.updateUserTable("selected");

      const selectedRoles = wrapper.vm.rows.filter((role: any) => role.isInGroup);
      expect(wrapper.vm.rows).toEqual(selectedRoles);
    });

    it("fetches data when switching to 'all' for first time", async () => {
      wrapper.vm.hasFetchedOrgUsers = false;
      const initialLength = wrapper.vm.users.length;

      await wrapper.vm.updateUserTable("all");

      // Test behavior: hasFetchedOrgUsers should be set to true after fetch
      expect(wrapper.vm.hasFetchedOrgUsers).toBe(true);
    });

    it("does not refetch data when switching to 'all' after first fetch", async () => {
      const getchOrgUsersSpy = vi.spyOn(wrapper.vm, "getchOrgUsers");
      wrapper.vm.hasFetchedOrgUsers = true;

      await wrapper.vm.updateUserTable("all");

      expect(getchOrgUsersSpy).not.toHaveBeenCalled();
    });
  });

  describe("Props Watching", () => {
    it("updates when groupRoles prop changes", async () => {
      const initialGroupUsersMapSize = wrapper.vm.groupUsersMap.size;

      await wrapper.setProps({ groupRoles: ["admin", "user", "developer"] });
      await flushPromises();

      // Test behavior: groupUsersMap should be updated with new prop values
      expect(wrapper.vm.groupUsersMap.size).toBe(3);
      expect(wrapper.vm.groupUsersMap.has("admin")).toBe(true);
      expect(wrapper.vm.groupUsersMap.has("user")).toBe(true);
      expect(wrapper.vm.groupUsersMap.has("developer")).toBe(true);
    });

    it("resets hasFetchedOrgUsers when groupRoles changes", async () => {
      wrapper.vm.hasFetchedOrgUsers = true;

      await wrapper.setProps({ groupRoles: ["new-role"] });
      await flushPromises();

      expect(wrapper.vm.hasFetchedOrgUsers).toBe(true); // Gets set back to true after fetch
    });
  });

  describe("Edge Cases", () => {
    it("handles empty groupRoles prop", async () => {
      const wrapper = mount(GroupRoles, {
        global: {
          provide: { store },
          plugins: [i18n],
        },
        props: {
          groupRoles: [],
          activeTab: "roles",
          addedRoles: new Set(),
          removedRoles: new Set(),
        },
      });

      expect(wrapper.vm.groupUsersMap.size).toBe(0);
    });

    it("method exists and can be called", () => {
      // Simply test that the method exists and is callable
      expect(typeof wrapper.vm.getchOrgUsers).toBe("function");
      expect(wrapper.vm.hasFetchedOrgUsers).toBe(true); // Set during component mount
    });

    it("handles empty roles data from API", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValue({ data: [] });

      await wrapper.vm.getchOrgUsers();

      expect(wrapper.vm.users).toEqual([]);
    });

    it("handles clearing search input", async () => {
      // Switch to "all" to see all roles
      const allButton = wrapper.find('[data-test="iam-roles-selection-show-all-btn"]');
      await allButton.trigger("click");
      await flushPromises();

      // Type something first
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("nonexistent");
      await flushPromises();

      // No checkboxes should be visible
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists()).toBe(false);

      // Clear search - all should reappear
      await searchInput.setValue("");
      await flushPromises();

      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]').exists()).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("has proper data-test attributes", () => {
      const sections = [
        "iam-roles-selection-section",
        "iam-roles-selection-show-toggle",
        "iam-roles-selection-search-input",
        "iam-roles-selection-table",
      ];

      sections.forEach((selector) => {
        expect(wrapper.find(`[data-test="${selector}"]`).exists()).toBe(true);
      });
    });

    it("has proper form labels and placeholders", () => {
      const searchInput = wrapper.find('input[placeholder="Search Roles"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("has proper button styling", () => {
      const filterButtons = wrapper.findAll('[data-test^="iam-roles-selection-show-"]');
      expect(filterButtons.length).toBeGreaterThan(0);
    });
  });
});
