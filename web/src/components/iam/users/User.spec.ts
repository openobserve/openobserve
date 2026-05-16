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

import {
  describe,
  expect,
  it,
  beforeEach,
  vi,
  afterEach,
  beforeAll,
  afterAll,
} from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify } from "quasar";
import User from "@/components/iam/users/User.vue";
import { createI18n } from "vue-i18n";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import usersService from "@/services/users";
import organizationsService from "@/services/organizations";
import { getRoles } from "@/services/iam";
import segment from "@/services/segment_analytics";

installQuasar({
  plugins: [Dialog, Notify],
});

// Create i18n instance with comprehensive translations for CI/CD compatibility
const i18n = createI18n({
  locale: "en",
  fallbackLocale: "en",
  legacy: false,
  globalInjection: true,
  silentTranslationWarn: true,
  silentFallbackWarn: true,
  messages: {
    en: {
      user: {
        email: "Email",
        firstName: "First Name",
        lastName: "Last Name",
        role: "Role",
        actions: "Actions",
        name: "Name",
        password: "Password",
        confirmPassword: "Confirm Password",
        search: "Search",
        add: "Add User",
        update: "Update User",
        editUser: "Edit User",
        cancel: "Cancel",
        save: "Save",
        confirmDeleteHead: "Delete User",
        confirmDeleteMsg: "Are you sure you want to delete this user?",
        ok: "OK",
        header: "User",
        delete: "Delete",
        revoke_invite: "Revoke Invitation",
      },
      iam: { basicUsers: "Users" },
      search: {
        showing: "Showing",
        of: "of",
        recordsPerPage: "Records Per Page",
      },
      ticket: { noDataErrorMsg: "No data available" },
      common: {
        cancel: "Cancel",
        save: "Save",
        delete: "Delete",
        edit: "Edit",
        add: "Add",
        update: "Update",
      },
    },
  },
});

// Mock services
vi.mock("@/services/users");
vi.mock("@/services/organizations");
vi.mock("@/services/iam");
vi.mock("@/services/segment_analytics");

// Mock aws-exports config
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "false",
    isCloud: "false",
  },
}));

// Mock utility functions
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/zincutils")>();
  return {
    ...actual,
    timestampToTimezoneDate: vi.fn(() => "2023-12-01"),
    getImageURL: vi.fn(() => "http://test.com/image.png"),
    formatDate: vi.fn(() => "2023-12-01"),
    formatDateTime: vi.fn(() => "2023-12-01 12:00:00"),
    convertDateFormat: vi.fn(() => "2023-12-01"),
    maskText: vi.fn((value: string) => value),
  };
});

// Mock usePermissions composable with a shared users state so the
// component and test setup mutate the same object.
const sharedUsersState = { users: [] as any[] };
vi.mock("@/composables/iam/usePermissions", () => ({
  default: () => ({ usersState: sharedUsersState }),
}));

// Stub ODialog so the migrated confirmation dialogs are deterministic
// (no Portal/Reka teleport) and we can assert on forwarded props +
// trigger the dialog button events the component listens to.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "subTitle",
    "persistent",
    "showClose",
    "width",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "neutralButtonLabel",
    "primaryButtonVariant",
    "secondaryButtonVariant",
    "neutralButtonVariant",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
    "neutralButtonDisabled",
    "primaryButtonLoading",
    "secondaryButtonLoading",
    "neutralButtonLoading",
  ],
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      class="o-dialog-stub"
      :data-test="'o-dialog-stub-' + (title || '')"
      :data-open="String(open)"
      :data-size="size"
      :data-title="title"
      :data-primary-label="primaryButtonLabel"
      :data-secondary-label="secondaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        class="o-dialog-stub-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
      <button
        class="o-dialog-stub-secondary"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
};

// Lightweight stubs for embedded child dialogs / table helpers so the
// component renders without trying to set up the real Quasar table.
const UpdateUserRoleStub = {
  name: "UpdateUserRole",
  props: ["open", "modelValue"],
  emits: ["update:open", "update:modelValue", "updated"],
  template: `<div class="update-user-role-stub" :data-open="String(open)" />`,
};

const AddUserStub = {
  name: "AddUser",
  props: ["open", "modelValue", "isUpdated", "userRole", "roles", "customRoles"],
  emits: ["update:open", "update:modelValue", "updated"],
  template: `<div class="add-user-stub" :data-open="String(open)" />`,
};

const MemberInvitationStub = {
  name: "MemberInvitation",
  props: ["currentrole"],
  emits: ["update:currentrole", "invite-sent"],
  template: `<div class="member-invitation-stub" />`,
};

const NoDataStub = {
  name: "NoData",
  template: `<div class="no-data-stub" />`,
};

const QTablePaginationStub = {
  name: "QTablePagination",
  props: ["scope", "resultTotal", "perPageOptions", "position"],
  emits: ["update:changeRecordPerPage"],
  template: `<div class="q-table-pagination-stub" />`,
};

const mountUser = () =>
  mount(User, {
    global: {
      provide: { store },
      plugins: [i18n, router, store],
      stubs: {
        ODialog: ODialogStub,
        UpdateUserRole: UpdateUserRoleStub,
        AddUser: AddUserStub,
        MemberInvitation: MemberInvitationStub,
        NoData: NoDataStub,
        QTablePagination: QTablePaginationStub,
        // Keep Quasar components shallow so we don't depend on real
        // table internals; we still render their slots.
        "q-page": { template: "<div><slot /></div>" },
        "q-table": {
          props: ["rows", "columns", "selected"],
          template: '<div class="q-table-stub"><slot /></div>',
        },
        "q-input": {
          props: ["modelValue"],
          template: '<div class="q-input-stub"><slot name="prepend" /></div>',
          emits: ["update:modelValue"],
        },
        "OIcon": { template: "<i />" },
        "q-td": { template: "<div><slot /></div>" },
        "q-th": { template: "<div><slot /></div>" },
        "q-tr": { template: "<div><slot /></div>" },
        "q-checkbox": {
          props: ["modelValue"],
          template: '<div class="q-checkbox-stub" />',
          emits: ["update:modelValue"],
        },
        OButton: {
          props: ["variant", "size", "disabled", "loading"],
          template: '<button class="o-button-stub" @click="$emit(\'click\')"><slot /></button>',
          emits: ["click"],
        },
      },
    },
  });

const mockUsersService = vi.mocked(usersService);
const mockOrganizationsService = vi.mocked(organizationsService);
const mockGetRoles = vi.mocked(getRoles);
const mockSegment = vi.mocked(segment);

beforeAll(() => {
  process.env.TZ = "UTC";
  vi.spyOn(Date, "now").mockReturnValue(1704067200000);
});

afterAll(() => {
  delete process.env.TZ;
  vi.restoreAllMocks();
});

describe("User Component", () => {
  let wrapper: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    sharedUsersState.users = [];

    mockUsersService.getRoles.mockResolvedValue({
      data: [{ label: "admin", value: "admin" }],
    } as any);
    mockUsersService.orgUsers.mockResolvedValue({
      data: {
        data: [
          {
            email: "test@example.com",
            first_name: "Test",
            last_name: "User",
            role: "admin",
            is_external: false,
          },
        ],
      },
    } as any);
    mockUsersService.invitedUsers.mockResolvedValue({
      status: 200,
      data: [],
    } as any);
    mockUsersService.getUserGroups.mockResolvedValue({
      data: ["group1", "group2"],
    } as any);
    mockUsersService.getUserRoles.mockResolvedValue({
      data: ["role1", "role2"],
    } as any);
    mockUsersService.delete.mockResolvedValue({ data: { code: 200 } } as any);
    mockUsersService.bulkDelete.mockResolvedValue({
      data: { successful: [], unsuccessful: [] },
    } as any);
    mockGetRoles.mockResolvedValue({ data: [] } as any);
    mockOrganizationsService.update_member_role.mockResolvedValue({
      data: {},
    } as any);
    mockOrganizationsService.revoke_invite.mockResolvedValue({
      data: {},
    } as any);

    wrapper = mountUser();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === "function") wrapper.unmount();
    vi.useRealTimers();
  });

  // ---------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------
  describe("Component Initialization", () => {
    it("should mount successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("should initialize dialog flags as closed", () => {
      const vm = wrapper.vm;
      expect(vm.showUpdateUserDialog).toBe(false);
      expect(vm.showAddUserDialog).toBe(false);
      expect(vm.confirmDelete).toBe(false);
      expect(vm.confirmRevoke).toBe(false);
      expect(vm.confirmBulkDelete).toBe(false);
    });

    it("should set up columns correctly", () => {
      const vm = wrapper.vm;
      expect(vm.columns).toHaveLength(6);
      expect(vm.columns.map((c: any) => c.name)).toEqual([
        "#",
        "email",
        "first_name",
        "last_name",
        "role",
        "actions",
      ]);
    });

    it("should initialize pagination settings", () => {
      const vm = wrapper.vm;
      expect(vm.pagination.rowsPerPage).toBe(20);
      expect(vm.selectedPerPage).toBe(20);
      expect(vm.maxRecordToReturn).toBe(500);
    });

    it("should initialize perPageOptions correctly", () => {
      const vm = wrapper.vm;
      expect(vm.perPageOptions).toEqual([
        { label: "20", value: 20 },
        { label: "50", value: 50 },
        { label: "100", value: 100 },
        { label: "250", value: 250 },
        { label: "500", value: 500 },
      ]);
    });

    it("should reflect fetched users in resultTotal", () => {
      expect(wrapper.vm.resultTotal).toBe(1);
    });
  });

  // ---------------------------------------------------------------------
  // ODialog migration coverage
  // ---------------------------------------------------------------------
  describe("Confirm Delete ODialog", () => {
    it("opens when confirmDeleteAction is invoked", async () => {
      wrapper.vm.confirmDeleteAction({ row: { email: "to-delete@example.com" } });
      await flushPromises();
      expect(wrapper.vm.confirmDelete).toBe(true);
    });

    it("forwards localized labels and size to ODialog", async () => {
      wrapper.vm.confirmDelete = true;
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Delete User");
      expect(dialog).toBeTruthy();
      expect(dialog!.props("size")).toBe("xs");
      expect(dialog!.props("primaryButtonLabel")).toBe("OK");
      expect(dialog!.props("secondaryButtonLabel")).toBe("Cancel");
      expect(dialog!.props("open")).toBe(true);
    });

    it("closes the dialog when secondary button is clicked", async () => {
      wrapper.vm.confirmDelete = true;
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Delete User")!;
      await dialog.vm.$emit("click:secondary");
      expect(wrapper.vm.confirmDelete).toBe(false);
    });

    it("invokes deleteUser when primary is clicked", async () => {
      wrapper.vm.confirmDeleteAction({ row: { email: "to-delete@example.com" } });
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Delete User")!;
      await dialog.vm.$emit("click:primary");
      await flushPromises();
      expect(mockUsersService.delete).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "to-delete@example.com",
      );
      expect(wrapper.vm.confirmDelete).toBe(false);
    });
  });

  describe("Confirm Revoke ODialog", () => {
    it("opens when confirmRevokeAction is invoked", async () => {
      wrapper.vm.confirmRevokeAction({
        row: { email: "pending@example.com", token: "tok-123" },
      });
      await flushPromises();
      expect(wrapper.vm.confirmRevoke).toBe(true);
      expect(wrapper.vm.revokeInviteEmail).toBe("pending@example.com");
    });

    it("forwards static labels and size to ODialog", async () => {
      wrapper.vm.confirmRevoke = true;
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Revoke Invitation");
      expect(dialog).toBeTruthy();
      expect(dialog!.props("size")).toBe("xs");
      expect(dialog!.props("primaryButtonLabel")).toBe("OK");
      expect(dialog!.props("secondaryButtonLabel")).toBe("Cancel");
      expect(dialog!.props("open")).toBe(true);
    });

    it("closes when secondary button is clicked", async () => {
      wrapper.vm.confirmRevoke = true;
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Revoke Invitation")!;
      await dialog.vm.$emit("click:secondary");
      expect(wrapper.vm.confirmRevoke).toBe(false);
    });

    it("invokes revokeInvite when primary is clicked", async () => {
      wrapper.vm.confirmRevokeAction({
        row: { email: "pending@example.com", token: "tok-123" },
      });
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Revoke Invitation")!;
      await dialog.vm.$emit("click:primary");
      await flushPromises();
      expect(mockOrganizationsService.revoke_invite).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "tok-123",
      );
      expect(wrapper.vm.confirmRevoke).toBe(false);
    });
  });

  describe("Bulk Delete ODialog", () => {
    it("opens via openBulkDeleteDialog", async () => {
      wrapper.vm.openBulkDeleteDialog();
      await flushPromises();
      expect(wrapper.vm.confirmBulkDelete).toBe(true);
    });

    it("forwards labels and size to ODialog", async () => {
      wrapper.vm.confirmBulkDelete = true;
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Delete Users");
      expect(dialog).toBeTruthy();
      expect(dialog!.props("size")).toBe("xs");
      expect(dialog!.props("primaryButtonLabel")).toBe("OK");
      expect(dialog!.props("secondaryButtonLabel")).toBe("Cancel");
      expect(dialog!.props("open")).toBe(true);
    });

    it("closes when secondary button is clicked", async () => {
      wrapper.vm.confirmBulkDelete = true;
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Delete Users")!;
      await dialog.vm.$emit("click:secondary");
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });

    it("invokes bulkDeleteUsers when primary is clicked", async () => {
      wrapper.vm.selectedUsers = [
        { email: "a@example.com", enableDelete: true },
        { email: "b@example.com", enableDelete: true },
      ];
      mockUsersService.bulkDelete.mockResolvedValue({
        data: { successful: ["a@example.com", "b@example.com"], unsuccessful: [] },
      } as any);
      wrapper.vm.confirmBulkDelete = true;
      await flushPromises();
      const dialog = wrapper
        .findAllComponents(ODialogStub)
        .find((d: any) => d.props("title") === "Delete Users")!;
      await dialog.vm.$emit("click:primary");
      await flushPromises();
      expect(mockUsersService.bulkDelete).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        { ids: ["a@example.com", "b@example.com"] },
      );
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // Preserved behavior coverage
  // ---------------------------------------------------------------------
  describe("getRoles", () => {
    it("should fetch roles successfully", async () => {
      const mockRoles = [
        { label: "admin", value: "admin" },
        { label: "member", value: "member" },
      ];
      mockUsersService.getRoles.mockResolvedValue({ data: mockRoles } as any);

      await wrapper.vm.getRoles();

      expect(mockUsersService.getRoles).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
      );
      expect(wrapper.vm.options).toEqual(mockRoles);
    });

    it("should handle getRoles error gracefully", async () => {
      mockUsersService.getRoles.mockRejectedValue(new Error("API Error"));

      await expect(wrapper.vm.getRoles()).resolves.toBe(true);
      expect(mockUsersService.getRoles).toHaveBeenCalled();
    });
  });

  describe("getCustomRoles", () => {
    it("should fetch custom roles successfully", async () => {
      mockGetRoles.mockResolvedValue({ data: [{ name: "custom_role" }] } as any);
      await expect(wrapper.vm.getCustomRoles()).resolves.toBeUndefined();
    });

    it("should handle getCustomRoles error", async () => {
      mockGetRoles.mockRejectedValue(new Error("Custom roles error"));
      await expect(wrapper.vm.getCustomRoles()).resolves.toBeUndefined();
    });
  });

  describe("getInvitedMembers", () => {
    it("should fetch invited members successfully", async () => {
      const mockInvitedMembers = [{ email: "invited@example.com", status: "pending" }];
      mockUsersService.invitedUsers.mockResolvedValue({
        status: 200,
        data: mockInvitedMembers,
      } as any);

      const result = await wrapper.vm.getInvitedMembers();

      expect(mockUsersService.invitedUsers).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
      );
      expect(result).toEqual(mockInvitedMembers);
    });

    it("should return empty array for non-200 status", async () => {
      mockUsersService.invitedUsers.mockResolvedValue({ status: 404, data: null } as any);
      const result = await wrapper.vm.getInvitedMembers();
      expect(result).toEqual([]);
    });

    it("should handle getInvitedMembers error", async () => {
      mockUsersService.invitedUsers.mockRejectedValue(new Error("Fetch error"));
      await expect(wrapper.vm.getInvitedMembers()).rejects.toEqual([]);
    });
  });

  describe("getOrgMembers", () => {
    it("should fetch organization members successfully", async () => {
      const mockUsers = [
        {
          email: "user1@example.com",
          first_name: "User",
          last_name: "One",
          role: "admin",
          is_external: false,
        },
        {
          email: "user2@example.com",
          first_name: "User",
          last_name: "Two",
          role: "member",
          is_external: false,
        },
      ];
      mockUsersService.orgUsers.mockResolvedValue({ data: { data: mockUsers } } as any);
      mockUsersService.invitedUsers.mockResolvedValue({ status: 200, data: [] } as any);

      await wrapper.vm.getOrgMembers();
      await flushPromises();

      expect(mockUsersService.orgUsers).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
      );
      expect(wrapper.vm.resultTotal).toBe(2);
      expect(wrapper.vm.usersState.users).toHaveLength(2);
    });

    it("should handle current user identification", async () => {
      const mockUsers = [
        {
          email: store.state.userInfo.email,
          first_name: "Current",
          last_name: "User",
          role: "admin",
          is_external: false,
        },
      ];
      mockUsersService.orgUsers.mockResolvedValue({ data: { data: mockUsers } } as any);

      await wrapper.vm.getOrgMembers();

      expect(wrapper.vm.currentUserRole).toBe("admin");
      expect(wrapper.vm.isCurrentUserInternal).toBe(true);
    });

    it("should handle getOrgMembers error", async () => {
      mockUsersService.orgUsers.mockRejectedValue(new Error("Fetch error"));
      await expect(wrapper.vm.getOrgMembers()).rejects.toBe(false);
    });
  });

  describe("changePagination", () => {
    it("should change pagination settings", () => {
      const mockSetPagination = vi.fn();
      wrapper.vm.qTable = { setPagination: mockSetPagination };

      wrapper.vm.changePagination({ label: "50", value: 50 });

      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(mockSetPagination).toHaveBeenCalledWith(wrapper.vm.pagination);
    });
  });

  describe("updateUserActions", () => {
    it("should update user action permissions", () => {
      const mockUsers = [
        { email: "test@example.com", role: "admin" },
        { email: "test2@example.com", role: "member" },
      ];
      wrapper.vm.usersState.users = mockUsers;

      wrapper.vm.updateUserActions();

      mockUsers.forEach((user) => {
        expect(user).toHaveProperty("enableEdit");
        expect(user).toHaveProperty("enableChangeRole");
        expect(user).toHaveProperty("enableDelete");
      });
    });
  });

  describe("shouldAllowEdit", () => {
    it("should allow root users to edit themselves only", () => {
      const rootUser = { email: store.state.userInfo.email, role: "root" };
      const otherRootUser = { email: "other@example.com", role: "root" };

      expect(wrapper.vm.shouldAllowEdit(rootUser)).toBe(true);
      expect(wrapper.vm.shouldAllowEdit(otherRootUser)).toBe(false);
    });

    it("should allow editing for non-root users", () => {
      expect(wrapper.vm.shouldAllowEdit({ email: "a@example.com", role: "admin" })).toBe(true);
      expect(wrapper.vm.shouldAllowEdit({ email: "b@example.com", role: "member" })).toBe(true);
    });
  });

  describe("shouldAllowChangeRole", () => {
    it("should not allow role change for root users", () => {
      wrapper.vm.currentUserRole = "admin";
      expect(
        wrapper.vm.shouldAllowChangeRole({ email: "root@example.com", role: "root" }),
      ).toBe(false);
    });

    it("should allow role change for non-root users when current user is admin", () => {
      wrapper.vm.currentUserRole = "admin";
      expect(
        wrapper.vm.shouldAllowChangeRole({ email: "member@example.com", role: "member" }),
      ).toBe(true);
    });

    it("should not allow logged in user to change their own role", () => {
      wrapper.vm.currentUserRole = "admin";
      expect(
        wrapper.vm.shouldAllowChangeRole({
          email: store.state.userInfo.email,
          role: "admin",
          isLoggedinUser: true,
        }),
      ).toBe(false);
    });
  });

  describe("shouldAllowDelete", () => {
    it("should not allow deleting root users", () => {
      wrapper.vm.currentUserRole = "admin";
      expect(wrapper.vm.shouldAllowDelete({ email: "root@example.com", role: "root" })).toBe(
        false,
      );
    });

    it("should not allow users to delete themselves", () => {
      wrapper.vm.currentUserRole = "admin";
      wrapper.vm.isEnterprise = false;
      expect(
        wrapper.vm.shouldAllowDelete({
          email: store.state.userInfo.email,
          role: "admin",
          isLoggedinUser: true,
        }),
      ).toBe(false);
    });

    it("should allow admin to delete non-root users", () => {
      wrapper.vm.currentUserRole = "admin";
      expect(wrapper.vm.shouldAllowDelete({ email: "m@example.com", role: "member" })).toBe(
        true,
      );
    });
  });

  describe("changeMaxRecordToReturn", () => {
    it("should update maxRecordToReturn value", () => {
      wrapper.vm.changeMaxRecordToReturn(1000);
      expect(wrapper.vm.maxRecordToReturn).toBe(1000);
    });
  });

  describe("updateUser", () => {
    it("should set selected user and show update dialog", () => {
      const userProps = { row: { email: "test@example.com", role: "admin" } };
      wrapper.vm.updateUser(userProps);
      expect(wrapper.vm.selectedUser).toEqual(userProps.row);
      expect(wrapper.vm.showUpdateUserDialog).toBe(true);
    });
  });

  describe("addUser", () => {
    it("should handle adding new user", () => {
      wrapper.vm.addUser({}, false);
      expect(wrapper.vm.isUpdated).toBe(false);
      expect(wrapper.vm.selectedUser).toBeDefined();
    });

    it("should handle updating existing user", () => {
      const userProps = { row: { email: "test@example.com", role: "admin" } };
      wrapper.vm.addUser(userProps, true);
      expect(wrapper.vm.isUpdated).toBe(true);
      expect(wrapper.vm.selectedUser).toEqual(userProps.row);
      expect(mockSegment.track).toHaveBeenCalled();
    });
  });

  describe("addRoutePush", () => {
    it("should navigate to update user route", () => {
      const pushSpy = vi.spyOn(router, "push").mockImplementation(() => Promise.resolve());

      wrapper.vm.addRoutePush({ row: { email: "test@example.com", role: "admin" } });

      expect(pushSpy).toHaveBeenCalledWith({
        name: "users",
        query: {
          action: "update",
          org_identifier: store.state.selectedOrganization.identifier,
          email: "test@example.com",
        },
      });
    });

    it("should navigate to add user route", () => {
      const pushSpy = vi.spyOn(router, "push").mockImplementation(() => Promise.resolve());

      wrapper.vm.addRoutePush({});

      expect(pushSpy).toHaveBeenCalledWith({
        name: "users",
        query: {
          action: "add",
          org_identifier: store.state.selectedOrganization.identifier,
        },
      });
    });
  });

  describe("toggleExpand", () => {
    it("should expand row and fetch user data", () => {
      const row = { email: "test@example.com", showGroups: false };
      wrapper.vm.toggleExpand(row);
      expect(row.showGroups).toBe(true);
    });

    it("should collapse expanded row", () => {
      const row = { email: "test@example.com", showGroups: true };
      wrapper.vm.toggleExpand(row);
      expect(row.showGroups).toBe(false);
    });
  });

  describe("forceCloseRow", () => {
    it("should close expanded row", () => {
      const row = { showGroups: true };
      wrapper.vm.forceCloseRow(row);
      expect(row.showGroups).toBe(false);
    });

    it("should handle row that is not expanded", () => {
      const row = { showGroups: false };
      wrapper.vm.forceCloseRow(row);
      expect(row.showGroups).toBe(false);
    });
  });

  describe("fetchUserGroups", () => {
    it("should fetch and update user groups", async () => {
      mockUsersService.getUserGroups.mockResolvedValue({
        data: ["group1", "group2"],
      } as any);
      wrapper.vm.usersState.users = [{ email: "test@example.com" }];

      await wrapper.vm.fetchUserGroups("test@example.com");

      expect(mockUsersService.getUserGroups).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "test@example.com",
      );
      expect(wrapper.vm.usersState.users[0].user_groups).toBe("group1, group2");
    });
  });

  describe("fetchUserRoles", () => {
    it("should fetch and update user roles", async () => {
      mockUsersService.getUserRoles.mockResolvedValue({
        data: ["role1", "role2"],
      } as any);
      wrapper.vm.usersState.users = [{ email: "test@example.com" }];

      await wrapper.vm.fetchUserRoles("test@example.com");

      expect(mockUsersService.getUserRoles).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "test@example.com",
      );
      expect(wrapper.vm.usersState.users[0].user_roles).toBe("role1, role2");
    });
  });

  describe("updateMember", () => {
    it("should refresh member list on successful update", async () => {
      wrapper.vm.showUpdateUserDialog = true;
      await wrapper.vm.updateMember({ data: { success: true } });
      expect(wrapper.vm.showUpdateUserDialog).toBe(false);
    });

    it("should not refresh if no data provided", async () => {
      wrapper.vm.showUpdateUserDialog = true;
      await wrapper.vm.updateMember({});
      // Dialog state remains unchanged when there is no data payload
      expect(wrapper.vm.showUpdateUserDialog).toBe(true);
    });
  });

  describe("hideForm", () => {
    it("should hide add user dialog and navigate", () => {
      const replaceSpy = vi
        .spyOn(router, "replace")
        .mockImplementation(() => Promise.resolve());
      wrapper.vm.showAddUserDialog = true;

      wrapper.vm.hideForm();

      expect(wrapper.vm.showAddUserDialog).toBe(false);
      expect(replaceSpy).toHaveBeenCalledWith({
        name: "users",
        query: { org_identifier: store.state.selectedOrganization.identifier },
      });
    });
  });

  describe("addMember", () => {
    it("should handle successful user creation", async () => {
      const pushSpy = vi.spyOn(router, "push").mockImplementation(() => Promise.resolve());
      const replaceSpy = vi
        .spyOn(router, "replace")
        .mockImplementation(() => Promise.resolve());

      await wrapper.vm.addMember(
        { code: 200 },
        { email: "new@example.com", organization: "test" },
        "created",
      );

      expect(wrapper.vm.showAddUserDialog).toBe(false);
      expect(pushSpy).toHaveBeenCalled();
      expect(replaceSpy).toHaveBeenCalled();
    });

    it("should handle successful user update", async () => {
      const pushSpy = vi.spyOn(router, "push").mockImplementation(() => Promise.resolve());

      await wrapper.vm.addMember(
        { code: 200 },
        { email: "updated@example.com", organization: "test" },
        "updated",
      );

      expect(pushSpy).toHaveBeenCalled();
    });

    it("should handle unsuccessful response", async () => {
      const replaceSpy = vi
        .spyOn(router, "replace")
        .mockImplementation(() => Promise.resolve());

      await wrapper.vm.addMember(
        { code: 400 },
        { email: "failed@example.com" },
        "created",
      );

      expect(wrapper.vm.showAddUserDialog).toBe(false);
      expect(replaceSpy).toHaveBeenCalled();
    });
  });

  describe("confirmDeleteAction", () => {
    it("should set up delete confirmation", () => {
      wrapper.vm.confirmDeleteAction({ row: { email: "delete@example.com" } });
      expect(wrapper.vm.confirmDelete).toBe(true);
    });
  });

  describe("deleteUser", () => {
    it("should delete user successfully", async () => {
      mockUsersService.delete.mockResolvedValue({ data: { code: 200 } } as any);
      await wrapper.vm.deleteUser();
      expect(mockUsersService.delete).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "",
      );
    });

    it("should handle delete user error", async () => {
      mockUsersService.delete.mockRejectedValue({ response: { status: 500 } });
      await wrapper.vm.deleteUser();
      expect(mockUsersService.delete).toHaveBeenCalled();
    });

    it("should handle 403 error silently", async () => {
      mockUsersService.delete.mockRejectedValue({ response: { status: 403 } });
      await wrapper.vm.deleteUser();
      expect(mockUsersService.delete).toHaveBeenCalled();
    });

    it("should set confirmDelete to false before calling service", async () => {
      wrapper.vm.confirmDelete = true;
      await wrapper.vm.deleteUser();
      expect(wrapper.vm.confirmDelete).toBe(false);
    });
  });

  describe("revokeInvite", () => {
    it("should set confirmRevoke to false before calling service", async () => {
      wrapper.vm.confirmRevoke = true;
      await wrapper.vm.revokeInvite();
      expect(wrapper.vm.confirmRevoke).toBe(false);
      expect(mockOrganizationsService.revoke_invite).toHaveBeenCalled();
    });

    it("should handle revokeInvite error", async () => {
      mockOrganizationsService.revoke_invite.mockRejectedValue({
        response: { data: { message: "fail" } },
      });
      await wrapper.vm.revokeInvite();
      expect(mockOrganizationsService.revoke_invite).toHaveBeenCalled();
    });
  });

  describe("bulkDeleteUsers", () => {
    it("should call bulkDelete with selected user emails", async () => {
      wrapper.vm.selectedUsers = [
        { email: "a@example.com", enableDelete: true },
        { email: "b@example.com", enableDelete: true },
      ];
      mockUsersService.bulkDelete.mockResolvedValue({
        data: { successful: ["a@example.com", "b@example.com"], unsuccessful: [] },
      } as any);

      await wrapper.vm.bulkDeleteUsers();

      expect(mockUsersService.bulkDelete).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        { ids: ["a@example.com", "b@example.com"] },
      );
      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });

    it("should handle partial success response", async () => {
      wrapper.vm.selectedUsers = [
        { email: "a@example.com", enableDelete: true },
        { email: "b@example.com", enableDelete: true },
      ];
      mockUsersService.bulkDelete.mockResolvedValue({
        data: { successful: ["a@example.com"], unsuccessful: ["b@example.com"] },
      } as any);

      await wrapper.vm.bulkDeleteUsers();

      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });

    it("should handle all unsuccessful response", async () => {
      wrapper.vm.selectedUsers = [{ email: "a@example.com", enableDelete: true }];
      mockUsersService.bulkDelete.mockResolvedValue({
        data: { successful: [], unsuccessful: ["a@example.com"] },
      } as any);

      await wrapper.vm.bulkDeleteUsers();

      expect(wrapper.vm.confirmBulkDelete).toBe(false);
    });

    it("should handle bulkDelete error", async () => {
      wrapper.vm.selectedUsers = [{ email: "a@example.com", enableDelete: true }];
      mockUsersService.bulkDelete.mockRejectedValue({
        response: { status: 500, data: { message: "boom" } },
      });

      await wrapper.vm.bulkDeleteUsers();

      expect(mockUsersService.bulkDelete).toHaveBeenCalled();
    });

    it("should suppress 403 errors", async () => {
      wrapper.vm.selectedUsers = [{ email: "a@example.com", enableDelete: true }];
      mockUsersService.bulkDelete.mockRejectedValue({
        response: { status: 403 },
      });

      await wrapper.vm.bulkDeleteUsers();

      expect(mockUsersService.bulkDelete).toHaveBeenCalled();
    });
  });

  describe("updateUserRole", () => {
    it("should update user role successfully", async () => {
      mockOrganizationsService.update_member_role.mockResolvedValue({ data: {} } as any);

      await wrapper.vm.updateUserRole({
        orgMemberId: "123",
        role: "admin",
        email: "test@example.com",
      });

      expect(mockOrganizationsService.update_member_role).toHaveBeenCalledWith(
        {
          id: 123,
          role: "admin",
          email: "test@example.com",
          organization_id: parseInt(store.state.selectedOrganization.id as any),
        },
        store.state.selectedOrganization.identifier,
      );
      expect(mockSegment.track).toHaveBeenCalled();
    });

    it("should handle update role error", async () => {
      mockOrganizationsService.update_member_role.mockRejectedValue(new Error("Update error"));

      await wrapper.vm.updateUserRole({
        orgMemberId: "123",
        role: "admin",
        email: "test@example.com",
      });

      expect(mockOrganizationsService.update_member_role).toHaveBeenCalled();
    });

    it("should handle error members in response", async () => {
      mockOrganizationsService.update_member_role.mockResolvedValue({
        data: { error_members: ["error"] },
      } as any);

      await wrapper.vm.updateUserRole({
        orgMemberId: "123",
        role: "admin",
        email: "test@example.com",
      });

      expect(mockOrganizationsService.update_member_role).toHaveBeenCalled();
    });
  });

  describe("filterData", () => {
    const users = () => [
      {
        first_name: "John",
        last_name: "Doe",
        email: "john@example.com",
        role: "admin",
      },
      {
        first_name: "Jane",
        last_name: "Smith",
        email: "jane@example.com",
        role: "member",
      },
    ];

    it("should filter users by first name", () => {
      const result = wrapper.vm.filterData(users(), "john");
      expect(result).toHaveLength(1);
      expect(result[0].first_name).toBe("John");
    });

    it("should filter users by last name", () => {
      const result = wrapper.vm.filterData(users(), "smith");
      expect(result).toHaveLength(1);
      expect(result[0].last_name).toBe("Smith");
    });

    it("should filter users by email", () => {
      const result = wrapper.vm.filterData(users(), "jane@example");
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe("jane@example.com");
    });

    it("should filter users by role", () => {
      const result = wrapper.vm.filterData(users(), "admin");
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("admin");
    });

    it("should return empty array for no matches", () => {
      const result = wrapper.vm.filterData(users(), "nonexistent");
      expect(result).toHaveLength(0);
    });

    it("should handle case insensitive search", () => {
      const result = wrapper.vm.filterData(users(), "JOHN");
      expect(result).toHaveLength(1);
      expect(result[0].first_name).toBe("John");
    });

    it("should handle undefined fields gracefully", () => {
      const result = wrapper.vm.filterData(
        [{ last_name: "Doe", email: "john@example.com", role: "admin" }],
        "doe",
      );
      expect(result).toHaveLength(1);
    });
  });

  describe("Enterprise and Cloud Features", () => {
    it("should handle enterprise role-change permissions", () => {
      wrapper.vm.isEnterprise = true;
      wrapper.vm.isCurrentUserInternal = true;
      wrapper.vm.currentUserRole = "admin";

      const user = { isExternal: false, role: "member", isLoggedinUser: false };
      expect(wrapper.vm.shouldAllowChangeRole(user)).toBe(true);
    });

    it("should handle enterprise delete permissions", () => {
      wrapper.vm.isEnterprise = true;
      wrapper.vm.currentUserRole = "admin";
      wrapper.vm.isCurrentUserInternal = true;

      expect(
        wrapper.vm.shouldAllowDelete({
          role: "member",
          email: "other@example.com",
          isExternal: false,
          isLoggedinUser: false,
        }),
      ).toBe(true);
    });
  });
});
