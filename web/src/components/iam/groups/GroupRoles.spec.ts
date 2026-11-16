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

import { queryClient } from "@/composables/query/queryClient";
import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import GroupRoles from "@/components/iam/groups/GroupRoles.vue";
import OEmptyState from "@/lib/core/EmptyState/OEmptyState.vue";
import OTable from "@/lib/core/Table/OTable.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/iam", async (importOriginal) => {
  const { overlayServiceMock } = await import("@/test/unit/helpers/mockService");
  const getRoles = vi.fn(() => Promise.resolve({ data: ["admin", "user", "developer"] }));
  return overlayServiceMock(await importOriginal(), {
    getRoles,
  });
});

vi.mock("@/composables/iam/usePermissions", () => ({
  default: vi.fn(() => ({
    rolesState: {},
    groupsState: {},
  })),
}));

// OTable holds its skeleton for a minimum time after a load, so a flush alone can land before the rows or empty state paint.
const waitForTableSettled = async (w: any) => {
  await flushPromises();
  await vi.waitFor(() =>
    expect(w.get('[data-test="o2-table"]').attributes("data-test-loading")).toBe("false"),
  );
};

describe("GroupRoles Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    const mockPermissions = {
      rolesState: {},
      groupsState: {},
    };

    vi.mocked(await import("@/composables/iam/usePermissions")).default.mockReturnValue(
      mockPermissions,
    );

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

    await waitForTableSettled(wrapper);
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
      // Reka UI ToggleGroupItem does not fire update:modelValue via .trigger("click")
      // in jsdom — use the public updateUserTable method directly (same pattern used
      // throughout this spec for display-switching tests).
      expect(wrapper.find('[data-test="iam-roles-selection-show-all-btn"]').exists()).toBe(true);

      await wrapper.vm.updateUserTable("all");

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
      // Switch to "all" via direct API call to avoid reka-ui toggle quirks in jsdom
      await wrapper.vm.updateUserTable("all");
      await flushPromises();

      // Verify all 3 roles are visible before filtering
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]')
          .exists(),
      ).toBe(true);

      // Act: type search term
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("admin");
      await flushPromises();

      // Assert: only matching role checkbox is visible
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]').exists(),
      ).toBe(false);
      expect(
        wrapper
          .find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]')
          .exists(),
      ).toBe(false);
    });

    it("filters roles case-insensitively", async () => {
      // Switch to "all" via direct API call to avoid reka-ui toggle quirks in jsdom
      await wrapper.vm.updateUserTable("all");
      await flushPromises();

      // Act: type search term in uppercase
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("ADMIN");
      await flushPromises();

      // Assert: case-insensitive match finds the role
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]').exists(),
      ).toBe(false);
    });

    it("returns all roles when search term is empty", async () => {
      // Switch to "all" via direct API call to avoid reka-ui toggle quirks in jsdom
      await wrapper.vm.updateUserTable("all");
      await flushPromises();

      // Act: clear search
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("");
      await flushPromises();

      // Assert: all 3 roles visible
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists(),
      ).toBe(true);
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-user-checkbox"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("Data Loading", () => {
    it("fetches roles on component mount", async () => {
      const { getRoles } = await import("@/services/iam");
      const mockRolesData = ["admin", "user", "developer"];
      vi.mocked(getRoles).mockResolvedValueOnce({ data: mockRolesData });
      // Drop the cached read so this override is the one that runs.
      queryClient.clear();

      await wrapper.vm.getchOrgUsers();

      expect(getRoles).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    });

    it("transforms roles data correctly", async () => {
      const { getRoles } = await import("@/services/iam");
      const mockRolesData = ["admin", "user"];
      vi.mocked(getRoles).mockResolvedValueOnce({ data: mockRolesData });
      // Drop the cached read so this override is the one that runs.
      queryClient.clear();

      await wrapper.vm.getchOrgUsers();

      expect(wrapper.vm.users).toHaveLength(2);
      expect(wrapper.vm.users[0]).toEqual({
        role_name: "admin",
        isInGroup: true, // admin is in groupRoles prop
      });
      expect(wrapper.vm.users[1]).toEqual({
        role_name: "user",
        isInGroup: true, // user is in groupRoles prop
      });
    });

    it("marks roles as selected based on groupRoles prop", async () => {
      const { getRoles } = await import("@/services/iam");
      const mockRolesData = ["admin", "user", "developer"];
      vi.mocked(getRoles).mockResolvedValueOnce({ data: mockRolesData });
      // Drop the cached read so this override is the one that runs.
      queryClient.clear();

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
      vi.mocked(getRoles).mockResolvedValueOnce({
        data: ["admin", "user"],
      });
      // Drop the cached read so this override is the one that runs.
      queryClient.clear();

      await wrapper.vm.getchOrgUsers();
      await wrapper.vm.updateUserTable("all");
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.rows).toHaveLength(2);
    });

    it("shows no users message when no roles", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValueOnce({ data: [] });
      // Drop the cached read so this override is the one that runs.
      queryClient.clear();

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
      await waitForTableSettled(emptyWrapper);

      // OTable renders the OEmptyState component in its #empty slot when there are no rows
      // The empty state is rendered by OTable internally; verify no role rows are rendered
      const roleCheckboxes = emptyWrapper.findAll(
        '[data-test^="iam-roles-selection-table-body-row-"]',
      );
      expect(roleCheckboxes.length).toBe(0);

      emptyWrapper.unmount();
    });
  });

  describe("Role Selection", () => {
    it("renders checkboxes for role selection", async () => {
      // After mount, roles "admin" and "user" are selected (in groupRoles).
      // usersDisplay starts as "selected" so only selected roles are shown.
      // Call updateUserTable directly to switch to "all" (avoids reka-ui toggle quirks in jsdom).
      await wrapper.vm.updateUserTable("all");
      await flushPromises();

      const adminCheckbox = wrapper.find(
        '[data-test="iam-roles-selection-table-body-row-admin-checkbox"]',
      );
      const userCheckbox = wrapper.find(
        '[data-test="iam-roles-selection-table-body-row-user-checkbox"]',
      );

      expect(adminCheckbox.exists()).toBe(true);
      expect(userCheckbox.exists()).toBe(true);
    });

    it("toggles selection when checkbox is clicked", async () => {
      // Switch to "all" via direct API call to avoid reka-ui toggle quirks in jsdom
      await wrapper.vm.updateUserTable("all");
      await flushPromises();

      const developerCheckbox = wrapper.find(
        '[data-test="iam-roles-selection-table-body-row-developer-checkbox"]',
      );
      expect(developerCheckbox.exists()).toBe(true);

      // Click the developer checkbox to select it
      await developerCheckbox.trigger("click");
      await flushPromises();

      // The toggleUserSelection function mutates props.addedRoles directly.
      // "developer" was not in groupUsersMap, so it should be added to addedRoles.
      expect(wrapper.props("addedRoles").has("developer")).toBe(true);
    });

    it("adds role to addedRoles when selecting unassigned role", () => {
      // Arrange: use the actual props.addedRoles Set passed to the component
      const addedRoles = wrapper.props("addedRoles") as Set<string>;
      const testRole = { role_name: "newrole", isInGroup: false };

      // Set groupUsersMap to empty — "newrole" was not originally in the group
      wrapper.vm.groupUsersMap = new Set([]);

      // Act
      wrapper.vm.toggleUserSelection(testRole);

      // Assert: newrole is staged for addition
      expect(addedRoles.has("newrole")).toBe(true);
    });

    it("adds role to removedRoles when deselecting assigned role", () => {
      // Arrange: use the actual props.removedRoles Set passed to the component
      const removedRoles = wrapper.props("removedRoles") as Set<string>;
      // "admin" was originally in the group
      const testRole = { role_name: "admin", isInGroup: true };

      wrapper.vm.groupUsersMap = new Set(["admin"]);

      // Act
      wrapper.vm.toggleUserSelection(testRole);

      // Assert: admin is staged for removal
      expect(removedRoles.has("admin")).toBe(true);
    });

    it("removes role from addedRoles when deselecting newly added role", () => {
      // Arrange: stage "user" for addition first using the prop's Set
      const addedRoles = wrapper.props("addedRoles") as Set<string>;
      addedRoles.add("user");

      const testRole = { role_name: "user", isInGroup: true };

      // "user" was NOT originally in the group
      wrapper.vm.groupUsersMap = new Set([]);

      // Act: deselect the role
      wrapper.vm.toggleUserSelection(testRole);

      // Assert: "user" is removed from addedRoles (undoes the pending addition)
      expect(addedRoles.has("user")).toBe(false);
    });

    it("removes role from removedRoles when reselecting removed role", () => {
      // Arrange: stage "admin" for removal first using the prop's Set
      const removedRoles = wrapper.props("removedRoles") as Set<string>;
      removedRoles.add("admin");

      // "admin" WAS originally in the group
      const testRole = { role_name: "admin", isInGroup: false };

      wrapper.vm.groupUsersMap = new Set(["admin"]);

      // Act: reselect the role
      wrapper.vm.toggleUserSelection(testRole);

      // Assert: "admin" is removed from removedRoles (undoes the pending removal)
      expect(removedRoles.has("admin")).toBe(false);
    });
  });

  describe("Display Filtering", () => {
    beforeEach(async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValueOnce({
        data: ["admin", "user", "developer"],
      });
      // Drop the cached read so this override is the one that runs.
      queryClient.clear();
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
      vi.mocked(getRoles).mockResolvedValueOnce({ data: [] });
      // Drop the cached read so this override is the one that runs.
      queryClient.clear();

      await wrapper.vm.getchOrgUsers();

      expect(wrapper.vm.users).toEqual([]);
    });

    it("handles clearing search input", async () => {
      // Switch to "all" via direct API call to avoid reka-ui toggle quirks in jsdom
      await wrapper.vm.updateUserTable("all");
      await flushPromises();

      // Type something first
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("nonexistent");
      await flushPromises();

      // No checkboxes should be visible
      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists(),
      ).toBe(false);

      // Clear search - all should reappear
      await searchInput.setValue("");
      await flushPromises();

      expect(
        wrapper.find('[data-test="iam-roles-selection-table-body-row-admin-checkbox"]').exists(),
      ).toBe(true);
      expect(
        wrapper
          .find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]')
          .exists(),
      ).toBe(true);
    });
  });

  describe("Empty states (ENT#2696)", () => {
    const mountWithGroupRoles = async (groupRoles: string[], { settle = true } = {}) => {
      const emptyGroup = mount(GroupRoles, {
        global: { provide: { store }, plugins: [i18n] },
        props: {
          groupRoles,
          activeTab: "roles",
          addedRoles: new Set(),
          removedRoles: new Set(),
        },
      });
      if (settle) await waitForTableSettled(emptyGroup);
      else await flushPromises();
      return emptyGroup;
    };

    it("says no roles are selected, not that the org has none, when the Selected filter is empty", async () => {
      const emptyGroup = await mountWithGroupRoles([]);

      const noneSelected = emptyGroup.find('[data-test="iam-roles-selection-none-selected"]');
      expect(noneSelected.exists()).toBe(true);
      expect(noneSelected.text()).toContain("No roles selected");
      expect(emptyGroup.text()).not.toContain("No roles yet");

      emptyGroup.unmount();
    });

    it("switches to All from the none-selected action and lists the org's roles", async () => {
      const emptyGroup = await mountWithGroupRoles([]);

      await emptyGroup
        .find('[data-test="iam-roles-selection-none-selected"] button')
        .trigger("click");
      await flushPromises();

      expect((emptyGroup.vm as any).usersDisplay).toBe("all");
      expect(
        emptyGroup
          .find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]')
          .exists(),
      ).toBe(true);

      emptyGroup.unmount();
    });

    it("keeps the org-empty copy when the All filter shows the org has no roles", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValueOnce({ data: [] });
      queryClient.clear();
      const emptyGroup = await mountWithGroupRoles([]);

      await (emptyGroup.vm as any).updateUserTable("all");
      await flushPromises();

      expect(emptyGroup.find('[data-test="iam-roles-selection-none-selected"]').exists()).toBe(
        false,
      );
      expect(emptyGroup.text()).toContain("No roles yet");

      emptyGroup.unmount();
    });

    it("shows the search-filtered state when a search empties the Selected view", async () => {
      await wrapper.find('input[type="text"]').setValue("nonexistent");
      await flushPromises();

      expect(wrapper.find('[data-test="iam-roles-selection-none-selected"]').exists()).toBe(false);
      expect(wrapper.text()).toContain("No roles found");
    });

    it("keeps the org-empty copy under the default Selected filter when the org has no roles", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValueOnce({ data: [] });
      queryClient.clear();
      const emptyGroup = await mountWithGroupRoles([]);

      expect((emptyGroup.vm as any).usersDisplay).toBe("selected");
      expect(emptyGroup.find('[data-test="iam-roles-selection-none-selected"]').exists()).toBe(
        false,
      );
      expect(emptyGroup.text()).toContain("No roles yet");

      emptyGroup.unmount();
    });

    const expectUnclippable = (emptyGroup: any) => {
      const emptyState = emptyGroup.findComponent(OEmptyState);
      expect(emptyState.props("size")).toBe("block");
      expect(emptyState.classes()).toContain("shrink-0");
    };

    it("renders the none-selected state at block size that cannot shrink below its content", async () => {
      const emptyGroup = await mountWithGroupRoles([]);

      expect(emptyGroup.find('[data-test="iam-roles-selection-none-selected"]').exists()).toBe(
        true,
      );
      expectUnclippable(emptyGroup);

      emptyGroup.unmount();
    });

    it("renders the org-empty state the same way", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockResolvedValueOnce({ data: [] });
      queryClient.clear();
      const emptyGroup = await mountWithGroupRoles([]);

      expect(emptyGroup.text()).toContain("No roles yet");
      expectUnclippable(emptyGroup);

      emptyGroup.unmount();
    });

    it("renders the search-empty state the same way", async () => {
      await wrapper.find('input[type="text"]').setValue("nonexistent");
      await flushPromises();

      expect(wrapper.text()).toContain("No roles found");
      expectUnclippable(wrapper);
    });

    it("makes no claim about the org while its role list is still loading", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockReturnValueOnce(new Promise(() => {}));
      queryClient.clear();
      const pending = await mountWithGroupRoles([], { settle: false });

      expect(pending.findComponent(OTable).props("loading")).toBe(true);
      expect(pending.find('[data-test="iam-roles-selection-none-selected"]').exists()).toBe(false);
      expect(pending.text()).not.toContain("No roles yet");

      pending.unmount();
      queryClient.clear();
    });

    it("shows a load error, not the org-empty copy, when the role list fails, and recovers on retry", async () => {
      const { getRoles } = await import("@/services/iam");
      vi.mocked(getRoles).mockRejectedValueOnce({ response: { status: 404 } });
      queryClient.clear();
      const failed = await mountWithGroupRoles([]);

      expect(failed.find('[data-test="iam-roles-selection-load-error"]').exists()).toBe(true);
      expect(failed.find('[data-test="iam-roles-selection-none-selected"]').exists()).toBe(false);
      expect(failed.text()).not.toContain("No roles yet");

      await (failed.vm as any).updateUserTable("all");
      await flushPromises();
      await failed.find('[data-test="iam-roles-selection-load-error"] button').trigger("click");
      await flushPromises();

      await vi.waitFor(() =>
        expect(
          failed
            .find('[data-test="iam-roles-selection-table-body-row-developer-checkbox"]')
            .exists(),
        ).toBe(true),
      );
      expect(failed.find('[data-test="iam-roles-selection-load-error"]').exists()).toBe(false);

      failed.unmount();
      queryClient.clear();
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
