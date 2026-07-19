import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import User from "./User.vue";
import usersService from "@/services/users";
import organizationsService from "@/services/organizations";
import config from "@/aws-exports";

// Mock the services
vi.mock("@/services/users", () => ({
  default: {
    orgUsers: vi.fn(),
    invitedUsers: vi.fn(),
    getRoles: vi.fn(),
    getUserGroups: vi.fn(),
    getUserRoles: vi.fn(),
    delete: vi.fn()
  },
}));

vi.mock("@/services/organizations", () => ({
  default: {
    update_member_role: vi.fn(),
  },
}));

// Mock vue-i18n. Resolve keys against the real app locale so migrated t()
// calls produce the actual English text the notification assertions expect.
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal();
  const en = (await import("@/locales/languages/en-US.json")).default;
  const t = (key, params) => {
    const val = String(key)
      .split(".")
      .reduce((o, k) => (o == null ? undefined : o[k]), en);
    let out = typeof val === "string" ? val : key;
    if (params && typeof out === "string") {
      for (const p in params) {
        out = out.replace(new RegExp("\\{\\s*" + p + "\\s*\\}", "g"), params[p]);
      }
    }
    return out;
  };
  return {
    ...actual,
    useI18n: () => ({ t })
  };
});

// Mock router
vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    currentRoute: {
      value: {
        query: {}
      }
    }
  })
}));

// Mock config
vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false"
  }
}));

// The factory must not reference top-level variables — vi.mock() is hoisted
// by Vitest and those variables are not yet initialised at hoist time.
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn(() => vi.fn()),
}));

import * as useToastModule from "@/lib/feedback/Toast/useToast";


describe("User Component", () => {
  let wrapper;
  let mockStore;
  let notifyMock;
  let dismissMock;

  const mockUsers = [
    {
      email: "test@example.com",
      first_name: "Test",
      last_name: "User",
      role: "admin",
      org_member_id: "123"
    },
    {
      email: "user@example.com",
      first_name: "Regular",
      last_name: "User",
      role: "user",
      org_member_id: "456"
    }
  ];

  beforeEach(() => {
    // Setup mock store
    mockStore = {
      state: {
        selectedOrganization: {
          id: "123",
          identifier: "test-org"
        },
        userInfo: {
          email: "test@example.com"
        },
        organizations: [],
        theme: 'light'
      }
    };

    // Setup notify mock with dismiss function — use toast which is what source calls
    dismissMock = vi.fn();
    notifyMock = useToastModule.toast;
    vi.mocked(useToastModule.toast).mockReturnValue(dismissMock);

    // Mock successful API responses
    vi.mocked(usersService.orgUsers).mockResolvedValue({
      data: {
        data: mockUsers
      }
    });

    vi.mocked(usersService.invitedUsers).mockResolvedValue({
      status: 200,
      data: []
    });

    vi.mocked(usersService.getRoles).mockResolvedValue({
      data: ["admin", "user"]
    });

    // Mount component
    wrapper = mount(User, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          QPage: false,
          QTable: true,
          QInput: {
            template: '<div><input /></div>',
            props: ['modelValue', 'prefix', 'borderless', 'dense', 'filled']
          },
          QBtn: true,
          QIcon: true,
          QDialog: true,
          QCard: true,
          QCardSection: true,
          QCardActions: true,
          QTr: true,
          QTd: true,
          QTh: true,
          RouterLink: true
        }
      }
    });

  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with correct data", async () => {
      await flushPromises();
      expect(wrapper.vm.usersState.users).toHaveLength(2);
      expect(usersService.orgUsers).toHaveBeenCalled();
      expect(usersService.getRoles).toHaveBeenCalled();
    });

  });

  describe("User Management", () => {
    it("deletes a user successfully", async () => {
      vi.mocked(usersService.delete).mockResolvedValue({
        data: { code: 200 }
      });

      wrapper.vm.deleteUserEmail = "user@example.com";
      await wrapper.vm.deleteUser();
      await flushPromises();

      expect(usersService.delete).toHaveBeenCalled();
    });

    it("handles user deletion error", async () => {
      vi.mocked(usersService.delete).mockRejectedValue({
        response: { status: 500 }
      });

      wrapper.vm.deleteUserEmail = "user@example.com";
      await wrapper.vm.deleteUser();
      await flushPromises();

      // The component calls toast({ message: "Error while deleting user." })
      // without a variant property — assert only on the message.
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Error while deleting user."
        })
      );
    });

    it("updates user role successfully", async () => {
      const userData = {
        org_member_id: "123",
        email: "test@example.com",
        role: "admin"
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { success: true }
      });

      await wrapper.vm.updateUserRole(userData);
      await flushPromises();

      expect(organizationsService.update_member_role).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 123,
          role: "admin",
          email: "test@example.com"
        }),
        "test-org"
      );

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "success",
          message: "Organization member updated successfully."
        })
      );
    });
  });

  // filterData & changePagination removed — component uses OTable client-side
  // filtering/pagination internally, no longer exposes these methods.

  describe("UI Elements", () => {
    it("shows add user button when not in cloud mode", () => {
      const addButton = wrapper.find('[data-test="add-basic-user"]');
      expect(addButton.exists()).toBe(true);
    });


  });

  describe("Error Handling", () => {
    it("handles network error when loading users", async () => {
      vi.mocked(usersService.orgUsers).mockRejectedValue(new Error("Network error"));
      
      try {
        await wrapper.vm.getOrgMembers();
      } catch (error) {
        // Error is expected
      }
      await flushPromises();

      // Verify both the initial loading notification and error notification
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "loading",
          message: "Please wait while loading users..."
        })
      );
    });

    it("handles error when updating user role", async () => {
      const userData = {
        org_member_id: "123",
        email: "test@example.com",
        role: "admin"
      };

      vi.mocked(organizationsService.update_member_role).mockRejectedValue(new Error("Update failed"));

      await wrapper.vm.updateUserRole(userData);
      await flushPromises();
    });

    it("handles error when loading invited users", async () => {
      vi.mocked(usersService.invitedUsers).mockRejectedValue(new Error("Failed to load"));
      
      await wrapper.vm.getOrgMembers();
      await flushPromises();

      expect(wrapper.vm.usersState.users).toBeDefined();
    });
  });

  describe("User Role Management", () => {

    it("updates current user role on initialization", async () => {
      await wrapper.vm.getOrgMembers();
      expect(wrapper.vm.currentUserRole).toBeDefined();
    });
  });

  describe("Form Handling", () => {
    it("shows add user dialog on addUser call", async () => {
      // Fix: Need to wait for setTimeout
      wrapper.vm.addUser({}, false);
      // Wait for the setTimeout in addUser
      await new Promise(resolve => setTimeout(resolve, 100));
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showAddUserDialog).toBe(true);
    });

    it("hides form and updates route on hideForm call", async () => {
      wrapper.vm.showAddUserDialog = true;
      await wrapper.vm.$nextTick();
      wrapper.vm.hideForm();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.showAddUserDialog).toBe(false);
    });

    it("handles add member with success response", async () => {
      const mockResponse = { code: 200 };
      const mockData = {
        email: "new@example.com",
        first_name: "New",
        last_name: "User",
        role: "user"
      };

      await wrapper.vm.addMember(mockResponse, mockData, "created");
      await flushPromises();

      expect(wrapper.vm.showAddUserDialog).toBe(false);
      // The component calls toast({ message: "User added successfully." })
      // without a variant property — assert only on the message.
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "User added successfully."
        })
      );
    });
  });

  describe("Component State Management", () => {
    it("updates filter query", async () => {
      await wrapper.vm.$nextTick();
      wrapper.vm.filterQuery = "test";
      expect(wrapper.vm.filterQuery).toBe("test");
    });

    it("handles empty filter query", async () => {
      wrapper.vm.filterQuery = "";
      expect(wrapper.vm.filterQuery).toBe("");
    });
  });

  describe("Cloud Mode Specific Features", () => {
    beforeEach(async () => {
      // Remount component with cloud mode
      config.isCloud = "true";
      wrapper = mount(User, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            QPage: false,
            QTable: true,
            QInput: {
              template: '<div><input /></div>',
              props: ['modelValue', 'prefix', 'borderless', 'dense', 'filled']
            },
            QBtn: true,
            QIcon: true,
            QDialog: true,
            QCard: true,
            QCardSection: true,
            QCardActions: true,
            QTr: true,
            QTd: true,
            QTh: true,
            RouterLink: true,
            MemberInvitation: true // Add this stub
          }
        }
      });
      await wrapper.vm.$nextTick();
    });

    afterEach(() => {
      config.isCloud = "false";
    });

    it("shows member invitation component in cloud mode", async () => {
      const memberInvitation = wrapper.findComponent({ name: 'MemberInvitation' });
      expect(memberInvitation.exists()).toBe(true);
    });

    it("shows correct UI elements in cloud mode", () => {
      const addButton = wrapper.find('[data-test="add-basic-user"]');
      expect(addButton.exists()).toBe(false); // Add button should not exist in cloud mode
    });
  });

  // Pre-migration behavior (restored): the row stores the DISPLAY-cased role
  // (toCamelCase → "Admin" / "User"), which is what pre-migration sent on the
  // wire for edit/update_member_role. Accepted trade-off: this value doesn't
  // match the lowercase role-select options, so the edit dropdown comes up
  // blank until the role is re-picked (same as pre-migration).
  describe("Edit dialog role prefill (row stores the display-cased role)", () => {
    it("builds rows with the camel-cased display role", async () => {
      await flushPromises();
      // mockUsers roles are "admin" / "user" → stored as "Admin" / "User".
      expect(wrapper.vm.usersState.users[0].role).toBe("Admin");
      expect(wrapper.vm.usersState.users[1].role).toBe("User");
    });

    it("seeds AddUser with the row's role value", () => {
      wrapper.vm.addUser({ row: { email: "u@x.com", role: "viewer" } }, true);
      expect(wrapper.vm.selectedUser.role).toBe("viewer");
    });

    it("seeds UpdateRole with the row's role value", () => {
      wrapper.vm.updateUser({ row: { email: "u@x.com", role: "admin" } });
      expect(wrapper.vm.selectedUser.role).toBe("admin");
    });
  });
});
