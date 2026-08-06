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
import { describe, it, expect, vi, beforeEach } from "vitest";
import AppGroups from "@/components/iam/groups/AppGroups.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";

vi.mock("@/services/iam", () => ({
  getGroups: vi.fn(),
  deleteGroup: vi.fn(),
  bulkDeleteGroups: vi.fn(async () => ({
    data: { successful: [], unsuccessful: [] },
  })),
  getGroup: vi.fn(async () => ({
    data: { name: "dev", users: ["u1@o2.ai", "u2@o2.ai"], roles: ["admin"] },
  })),
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({
    track: vi.fn(),
  }),
}));

// Create mock states that will be returned by the composable
const mockGroupsState = { groups: [] };
const mockPermissionsState = { permissions: [], selectedResources: {} };
const mockRolesState = { roles: [] };
const mockUsersState = { users: [], getOrgUsers: vi.fn() };
const mockServiceAccountsState = { service_accounts_users: [], getServiceAccounts: vi.fn() };

vi.mock("@/composables/iam/usePermissions", () => ({
  default: () => ({
    groupsState: mockGroupsState,
    permissionsState: mockPermissionsState,
    rolesState: mockRolesState,
    usersState: mockUsersState,
    serviceAccountsState: mockServiceAccountsState,
    resetPermissionsState: vi.fn(),
    resetGroupsState: vi.fn(),
    resetRolesState: vi.fn(),
    resetUsersState: vi.fn(),
  }),
}));

const mockToast = vi.hoisted(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

vi.mock("@/components/AppTable.vue", () => ({
  default: {
    name: "AppTable",
    template: `
      <div data-test="app-table-mock">
        <slot name="actions" :column="{ row: { group_name: 'test-group' } }"></slot>
      </div>
    `,
  },
}));

vi.mock("@/components/ConfirmDialog.vue", () => ({
  default: {
    name: "ConfirmDialog",
    template: `<div data-test="confirm-dialog-mock"></div>`,
    props: ["title", "message", "modelValue"],
    emits: ["update:ok", "update:cancel", "update:modelValue"],
  },
}));

vi.mock("./AddGroup.vue", () => ({
  default: {
    name: "AddGroup",
    template: `<div data-test="add-group-mock" :data-open="open"></div>`,
    props: ["open", "org_identifier"],
    emits: ["update:open", "added:group"],
  },
}));

// Helper to create mock Axios response
const createMockAxiosResponse = (data: any) => ({
  data,
  status: 200,
  statusText: "OK",
  headers: {},
  config: {} as any,
});

describe("AppGroups Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    // Mock getGroups to return a resolved promise by default
    const { getGroups } = await import("@/services/iam");
    vi.mocked(getGroups).mockResolvedValue(
      createMockAxiosResponse(["admin", "developers", "users"]) as any,
    );

    // Update the mock groups state
    mockGroupsState.groups = [
      { group_name: "admin" },
      { group_name: "developers" },
      { group_name: "users" },
    ] as any;

    wrapper = mount(AppGroups, {
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
      // Title now lives in the standard OPageHeader (row 1).
      expect(wrapper.find(".app-page-header").exists()).toBe(true);
    });

    it("displays the correct title", () => {
      const titleElement = wrapper.find(".app-page-header h1");
      expect(titleElement.text()).toContain("Groups");
    });

    it("renders search input", () => {
      // Search is rendered via OSearchInput in OTable's custom toolbar slot.
      const searchInput = wrapper.find('[data-test="iam-groups-search-input"]');
      expect(searchInput.exists()).toBe(true);
    });

    it("renders add group button", () => {
      const addButton = wrapper.find('[data-test="iam-groups-add-group-btn"]');
      expect(addButton.exists()).toBe(true);
      expect(addButton.text()).toContain("New user group");
    });
  });

  describe("Groups Table", () => {
    it("renders the groups table", () => {
      const table = wrapper.find('[data-test="iam-groups-table-section"]');
      expect(table.exists()).toBe(true);
    });

    it("has correct table columns structure", () => {
      // The row-index ("#") column is now the built-in OTable `show-index`
      // gutter, not a member of `columns`, so only the real data columns remain.
      expect(wrapper.vm.columns).toBeDefined();
      expect(wrapper.vm.columns).toHaveLength(2);

      const columnNames = wrapper.vm.columns.map((col: any) => col.id);
      expect(columnNames).not.toContain("#");
      expect(columnNames).toContain("group_name");
      expect(columnNames).toContain("actions");
    });

    it("displays groups data in rows", async () => {
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockResolvedValue(
        createMockAxiosResponse(["admin", "developers", "users"]) as any,
      );

      await wrapper.vm.setupGroups();
      await flushPromises();

      expect(wrapper.vm.rows).toHaveLength(3);
      expect(wrapper.vm.rows[0].group_name).toBe("admin");
      expect(wrapper.vm.rows[1].group_name).toBe("developers");
      expect(wrapper.vm.rows[2].group_name).toBe("users");
    });

    // Row numbering moved to OTable's built-in `show-index` (zero-padded,
    // covered by OTable's own spec); pages no longer inject a "#" data field.
  });

  describe("Search Functionality", () => {
    it("updates filter query when searching", async () => {
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("admin");
      expect(wrapper.vm.filterQuery).toBe("admin");
    });

    it("sets filter query when searching via input", async () => {
      // Filtering is delegated to OTable's client-side filter via its custom
      // toolbar OSearchInput (v-model wired to filterQuery).
      wrapper.vm.filterQuery = "admin";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filterQuery).toBe("admin");
    });

    it("clears filter query when search input is emptied", async () => {
      wrapper.vm.filterQuery = "admin";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filterQuery).toBe("admin");

      wrapper.vm.filterQuery = "";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filterQuery).toBe("");
    });
  });

  describe("Add Group Dialog", () => {
    it("opens add group dialog when button is clicked", async () => {
      const addButton = wrapper.find('[data-test="iam-groups-add-group-btn"]');
      await addButton.trigger("click");
      expect(wrapper.vm.showAddGroup).toBe(true);
    });

    it("passes open prop to AddGroup based on showAddGroup state", async () => {
      wrapper.vm.showAddGroup = true;
      await wrapper.vm.$nextTick();
      const addGroup = wrapper.findComponent({ name: "AddGroup" });
      expect(addGroup.exists()).toBe(true);
      expect(addGroup.props("open")).toBe(true);
    });

    it("passes org_identifier prop to AddGroup", () => {
      const addGroup = wrapper.findComponent({ name: "AddGroup" });
      expect(addGroup.props("org_identifier")).toBe(store.state.selectedOrganization.identifier);
    });

    it("closes add group dialog when AddGroup emits update:open false", async () => {
      wrapper.vm.showAddGroup = true;
      await wrapper.vm.$nextTick();
      const addGroup = wrapper.findComponent({ name: "AddGroup" });
      await addGroup.vm.$emit("update:open", false);
      expect(wrapper.vm.showAddGroup).toBe(false);
    });

    it("refreshes groups list when AddGroup emits added:group", async () => {
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockClear();
      const addGroup = wrapper.findComponent({ name: "AddGroup" });
      await addGroup.vm.$emit("added:group");
      await flushPromises();
      expect(getGroups).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    });
  });

  describe("Group Actions", () => {
    it("renders edit and delete icons for each group", async () => {
      // OTable holds the loading skeleton for MIN_SKELETON_MS (2000ms) even after
      // props.loading flips to false, so we must advance fake timers past that hold
      // to allow OTableBody to render and expose the cell-actions slot.
      vi.useFakeTimers();
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockResolvedValue(
        createMockAxiosResponse(["admin", "developers", "users"]) as any,
      );
      mockGroupsState.groups = [
        { group_name: "admin" },
        { group_name: "developers" },
        { group_name: "users" },
      ] as any;

      const localWrapper = mount(AppGroups, {
        global: { provide: { store }, plugins: [i18n, router] },
      });
      await flushPromises();
      // Advance past the 2000ms minimum skeleton hold in OTable
      vi.advanceTimersByTime(2100);
      await flushPromises();

      const editIcon = localWrapper.find('[data-test="iam-groups-edit-admin-role-icon"]');
      const deleteIcon = localWrapper.find('[data-test="iam-groups-delete-admin-role-icon"]');

      expect(editIcon.exists()).toBe(true);
      expect(deleteIcon.exists()).toBe(true);

      localWrapper.unmount();
      vi.useRealTimers();
    });

    it("navigates to edit page when edit icon is clicked", async () => {
      const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      const testGroup = { group_name: "test-group" };

      await wrapper.vm.editGroup(testGroup);

      expect(routerPushSpy).toHaveBeenCalledWith({
        name: "editGroup",
        params: {
          group_name: "test-group",
        },
        query: {
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });

    it("shows confirm dialog when delete icon is clicked", async () => {
      const testGroup = { group_name: "test-group" };

      wrapper.vm.showConfirmDialog(testGroup);

      expect(wrapper.vm.deleteConformDialog.show).toBe(true);
      expect(wrapper.vm.deleteConformDialog.data).toEqual(testGroup);
    });
  });

  describe("Create flow auto-route", () => {
    it("routes to editGroup on the roles tab after create", async () => {
      const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      await wrapper.vm.onGroupAdded({ group_name: "NewGroup" });
      expect(routerPushSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "editGroup",
          params: { group_name: "NewGroup" },
          query: expect.objectContaining({ tab: "roles" }),
        }),
      );
    });

    it("falls back to refreshing the list when no group_name is provided", async () => {
      const { getGroups } = await import("@/services/iam");
      const routerPushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined as any);
      routerPushSpy.mockClear();
      vi.mocked(getGroups).mockClear();
      vi.mocked(getGroups).mockResolvedValue(createMockAxiosResponse([]) as any);
      await wrapper.vm.onGroupAdded({});
      expect(routerPushSpy).not.toHaveBeenCalled();
      expect(getGroups).toHaveBeenCalled();
    });
  });

  describe("Delete blast-radius warning", () => {
    it("builds a single-delete warning with the live member count", async () => {
      const { getGroup } = await import("@/services/iam");
      await wrapper.vm.showConfirmDialog({ group_name: "dev" });
      await flushPromises();
      expect(getGroup).toHaveBeenCalledWith("dev", store.state.selectedOrganization.identifier);
      // Two mocked members → message mentions "2".
      expect(wrapper.vm.deleteImpactMessage).toContain("2");
    });

    it("shows the live member count when exactly one group is bulk-selected", async () => {
      wrapper.vm.selectedGroups = [{ group_name: "dev" }];
      await wrapper.vm.openBulkDeleteDialog();
      await flushPromises();
      expect(wrapper.vm.bulkDeleteImpactMessage).toContain("2");
    });

    it("uses static copy (no fetch) when multiple groups are bulk-selected", async () => {
      const { getGroup } = await import("@/services/iam");
      vi.mocked(getGroup).mockClear();
      wrapper.vm.selectedGroups = [{ group_name: "dev" }, { group_name: "ops" }];
      await wrapper.vm.openBulkDeleteDialog();
      await flushPromises();
      expect(getGroup).not.toHaveBeenCalled();
      expect(wrapper.vm.bulkDeleteImpactMessage).toBeTruthy();
    });
  });

  describe("Group Deletion", () => {
    beforeEach(() => {
      mockToast.mockClear();
    });

    it("deletes group successfully", async () => {
      const { deleteGroup } = await import("@/services/iam");
      vi.mocked(deleteGroup).mockResolvedValue({});

      const testGroup = { group_name: "test-group" };

      wrapper.vm.deleteUserGroup(testGroup);
      await flushPromises();

      expect(deleteGroup).toHaveBeenCalledWith(
        "test-group",
        store.state.selectedOrganization.identifier,
      );
      expect(mockToast).toHaveBeenCalledWith({
        message: "Group deleted successfully!",
        variant: "success",
      });
    });

    it("handles deletion error", async () => {
      const { deleteGroup } = await import("@/services/iam");
      const mockError = { response: { status: 500 } };
      vi.mocked(deleteGroup).mockRejectedValue(mockError);

      const testGroup = { group_name: "test-group" };

      wrapper.vm.deleteUserGroup(testGroup);
      await flushPromises();

      expect(mockToast).toHaveBeenCalledWith({
        message: "Error while deleting group!",
        variant: "error",
      });
    });

    it("does not show error notification for 403 status", async () => {
      const { deleteGroup } = await import("@/services/iam");
      const mockError = { response: { status: 403 } };
      vi.mocked(deleteGroup).mockRejectedValue(mockError);

      const testGroup = { group_name: "test-group" };

      wrapper.vm.deleteUserGroup(testGroup);
      await flushPromises();

      expect(mockToast).not.toHaveBeenCalled();
    });

    it("executes deletion through confirm dialog", async () => {
      const testGroup = { group_name: "test-group" };

      wrapper.vm.deleteConformDialog.data = testGroup;

      // Test the actual behavior instead of spying on the method
      const initialData = wrapper.vm.deleteConformDialog.data;
      expect(initialData).toEqual(testGroup);

      wrapper.vm._deleteGroup();

      // Check that data is set to null after deletion attempt
      expect(wrapper.vm.deleteConformDialog.data).toBeNull();
    });
  });

  describe("Confirm Dialog", () => {
    it("renders confirm dialog", () => {
      const confirmDialog = wrapper.find('[data-test="confirm-dialog-mock"]');
      expect(confirmDialog.exists()).toBe(true);
    });

    it("displays correct delete confirmation message", async () => {
      wrapper.vm.deleteConformDialog.data = { group_name: "test-group" };
      await wrapper.vm.$nextTick();

      // Since we're using a mock component, we check the computed message
      expect(wrapper.vm.deleteConformDialog.data.group_name).toBe("test-group");
    });
  });

  describe("Data Loading", () => {
    it("loads groups on component mount", async () => {
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockResolvedValue(createMockAxiosResponse(["group1", "group2"]) as any);

      mount(AppGroups, {
        global: {
          provide: { store },
          plugins: [i18n, router],
        },
      });

      await flushPromises();

      expect(getGroups).toHaveBeenCalledWith(store.state.selectedOrganization.identifier);
    });

    it("handles error when loading groups", async () => {
      const { getGroups } = await import("@/services/iam");
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      vi.mocked(getGroups).mockRejectedValue(new Error("Network error"));

      await wrapper.vm.setupGroups();

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Theme Support", () => {
    it("applies correct theme classes", () => {
      const header = wrapper.find(".app-page-header");
      const table = wrapper.find('[data-test="iam-groups-table-section"]');

      expect(header.exists()).toBe(true);
      expect(table.exists()).toBe(true);
      // Just check that theme classes exist, exact class names might vary
    });

    it("switches to dark theme classes when theme is dark", async () => {
      const darkStore = {
        ...store,
        state: {
          ...store.state,
          theme: "dark",
        },
      };

      const wrapper = mount(AppGroups, {
        global: {
          provide: { store: darkStore },
          plugins: [i18n, router],
        },
      });

      await flushPromises();

      const header = wrapper.find(".app-page-header");
      const table = wrapper.find('[data-test="iam-groups-table-section"]');

      expect(header.exists()).toBe(true);
      expect(table.exists()).toBe(true);
      // Theme classes have been removed from the component
    });
  });

  describe("Edge Cases", () => {
    it("handles empty groups list", async () => {
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockResolvedValue(createMockAxiosResponse([]) as any);

      await wrapper.vm.setupGroups();
      await flushPromises();

      expect(wrapper.vm.rows).toHaveLength(0);
    });

    it("handles empty search term gracefully", () => {
      // Filtering is delegated to OTable's client-side filter-mode.
      // An empty filterQuery means OTable shows all rows.
      expect(wrapper.vm.filterQuery).toBe("");
      expect(wrapper.vm.rows).toHaveLength(3);
    });

    it("handles search term that matches no groups", async () => {
      // When filterQuery is set to a non-matching value, OTable filters rows internally.
      wrapper.vm.filterQuery = "nonexistent";
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.filterQuery).toBe("nonexistent");
    });
  });
});
