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
  bulkDeleteGroups: vi.fn(),
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

const { mockToast } = vi.hoisted(() => ({ mockToast: vi.fn() }));
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

const stubs = {
  OTable: {
    name: "OTable",
    template: `<div data-test="iam-groups-table-section"><slot name="cell-actions" :row="{ group_name: 'test-group' }"></slot></div>`,
    props: ["data", "columns", "rowKey", "selectedIds", "globalFilter", "pagination", "pageSize", "pageSizeOptions", "footerTitle", "sorting", "selection", "filterMode", "defaultColumns", "showGlobalFilter"],
    emits: ["update:selected-ids"],
  },
  OInput: {
    name: "OInput",
    template: `<div class="q-input"><input type="text" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)" /></div>`,
    props: ["modelValue", "placeholder"],
    emits: ["update:modelValue"],
  },
  OButton: {
    name: "OButton",
    template: `<button :data-test="$attrs['data-test']" @click="$emit('click')"><slot /></button>`,
    props: ["variant", "size", "title", "iconLeft"],
    emits: ["click"],
  },
  OIcon: {
    name: "OIcon",
    template: `<i></i>`,
    props: ["name", "size"],
  },
  NoData: {
    name: "NoData",
    template: `<div data-test="no-data"></div>`,
  },
};

describe("AppGroups Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    // Mock getGroups to return a resolved promise by default
    const { getGroups } = await import("@/services/iam");
    vi.mocked(getGroups).mockResolvedValue(
      createMockAxiosResponse(["admin", "developers", "users"]) as any
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
        stubs,
      },
    });

    await flushPromises();
  });

  describe("Component Mounting", () => {
    it("renders the component correctly", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="iam-groups-section-title"]').exists()).toBe(true);
    });

    it("displays the correct title", () => {
      const titleElement = wrapper.find('[data-test="iam-groups-section-title"]');
      expect(titleElement.text()).toContain("Groups");
    });

    it("renders search input", () => {
      const searchInput = wrapper.find('[data-test="iam-groups-search-input"] .q-input');
      expect(searchInput.exists()).toBe(true);
    });

    it("renders add group button", () => {
      const addButton = wrapper.find('[data-test="iam-groups-add-group-btn"]');
      expect(addButton.exists()).toBe(true);
    });
  });

  describe("Groups Table", () => {
    it("renders the groups table", () => {
      const table = wrapper.find('[data-test="iam-groups-table-section"]');
      expect(table.exists()).toBe(true);
    });

    it("has correct table columns structure", () => {
      expect(wrapper.vm.columns).toBeDefined();
      expect(wrapper.vm.columns).toHaveLength(3);

      const columnNames = wrapper.vm.columns.map((col: any) => col.id);
      expect(columnNames).toContain("#");
      expect(columnNames).toContain("group_name");
      expect(columnNames).toContain("actions");
    });

    it("displays groups data in rows", async () => {
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockResolvedValue(
        createMockAxiosResponse(["admin", "developers", "users"]) as any
      );

      await wrapper.vm.setupGroups();
      await flushPromises();

      expect(wrapper.vm.rows).toHaveLength(3);
      expect(wrapper.vm.rows[0].group_name).toBe("admin");
      expect(wrapper.vm.rows[1].group_name).toBe("developers");
      expect(wrapper.vm.rows[2].group_name).toBe("users");
    });

    it("formats row numbers correctly", async () => {
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockResolvedValue(
        createMockAxiosResponse(["group1", "group2", "group3"]) as any
      );

      await wrapper.vm.setupGroups();
      await flushPromises();

      expect(wrapper.vm.rows[0]["#"]).toBe("01");
      expect(wrapper.vm.rows[1]["#"]).toBe("02");
      expect(wrapper.vm.rows[2]["#"]).toBe("03");
    });
  });

  describe("Search Functionality", () => {
    it("updates filter query when searching", async () => {
      const searchInput = wrapper.find('input[type="text"]');
      await searchInput.setValue("admin");
      expect(wrapper.vm.filterQuery).toBe("admin");
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
      expect(addGroup.props("org_identifier")).toBe(
        store.state.selectedOrganization.identifier,
      );
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
      expect(getGroups).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
      );
    });
  });

  describe("Group Actions", () => {
    it("navigates to edit page when editGroup is called", async () => {
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

    it("shows confirm dialog when showConfirmDialog is called", async () => {
      const testGroup = { group_name: "test-group" };

      wrapper.vm.showConfirmDialog(testGroup);

      expect(wrapper.vm.deleteConformDialog.show).toBe(true);
      expect(wrapper.vm.deleteConformDialog.data).toEqual(testGroup);
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

      await wrapper.vm.deleteUserGroup(testGroup);
      await flushPromises();

      expect(deleteGroup).toHaveBeenCalledWith(
        "test-group",
        store.state.selectedOrganization.identifier
      );
      expect(mockToast).toHaveBeenCalledWith({
        message: "Group deleted successfully!",
        position: "bottom-center",
      });
    });

    it("handles deletion error", async () => {
      const { deleteGroup } = await import("@/services/iam");
      const mockError = { response: { status: 500 } };
      vi.mocked(deleteGroup).mockRejectedValue(mockError);

      const testGroup = { group_name: "test-group" };

      try {
        await wrapper.vm.deleteUserGroup(testGroup);
      } catch (error) {
        // Error should be caught by component
      }

      // Give time for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockToast).toHaveBeenCalledWith({
        message: "Error while deleting group!",
        position: "bottom-center",
      });
    });

    it("does not show error notification for 403 status", async () => {
      const { deleteGroup } = await import("@/services/iam");
      const mockError = { response: { status: 403 } };
      vi.mocked(deleteGroup).mockRejectedValue(mockError);

      const testGroup = { group_name: "test-group" };

      await wrapper.vm.deleteUserGroup(testGroup);
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
    it("displays correct delete confirmation data", async () => {
      wrapper.vm.deleteConformDialog.data = { group_name: "test-group" };
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.deleteConformDialog.data.group_name).toBe("test-group");
    });
  });

  describe("Data Loading", () => {
    it("loads groups on component mount", async () => {
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockResolvedValue(
        createMockAxiosResponse(["group1", "group2"]) as any
      );

      const wrapper = mount(AppGroups, {
        global: {
          provide: { store },
          plugins: [i18n, router],
          stubs,
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

  describe("Edge Cases", () => {
    it("handles empty groups list", async () => {
      const { getGroups } = await import("@/services/iam");
      vi.mocked(getGroups).mockResolvedValue(
        createMockAxiosResponse([]) as any
      );
      mockGroupsState.groups = [] as any;

      await wrapper.vm.setupGroups();
      await flushPromises();

      expect(wrapper.vm.rows).toHaveLength(0);
    });
  });
});
