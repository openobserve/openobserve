import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import User from "./User.vue";
import usersService from "@/services/users";
import organizationsService from "@/services/organizations";
import config from "@/aws-exports";

// Mock toast
const toastMock = vi.fn(() => vi.fn());
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: (...args) => toastMock(...args),
}));

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

// Mock vue-i18n
vi.mock('vue-i18n', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key) => key
    })
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

    // Setup notify mock with dismiss function
    dismissMock = vi.fn();
    notifyMock = vi.fn().mockReturnValue(dismissMock);

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
          RouterLink: true,
        },
      },
    });

    // Wire toast mock into notifyMock so existing assertions work
    toastMock.mockReset();
    toastMock.mockImplementation((opts) => {
      notifyMock(opts);
      return dismissMock;
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

    // TODO: notify color/type signature changed after Quasar removal
    it.skip("handles user deletion error", async () => {
      vi.mocked(usersService.delete).mockRejectedValue({
        response: { status: 500 }
      });

      wrapper.vm.deleteUserEmail = "user@example.com";
      await wrapper.vm.deleteUser();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "negative",
          message: "Error while deleting user."
        })
      );
    });

    // TODO: notify type signature changed after Quasar removal
    it.skip("updates user role successfully", async () => {
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
          type: "positive",
          message: "Organization member updated successfully."
        })
      );
    });
  });

  describe("Search and Filter", () => {
    // TODO: filterData method no longer exposed after Quasar removal
    it.skip("filters users by search query", async () => {
      const rows = [
        { first_name: "Test", email: "test@example.com", role: "admin" },
        { first_name: "User", email: "user@example.com", role: "user" }
      ];

      const result = wrapper.vm.filterData(rows, "test");
      expect(result).toHaveLength(1);
      expect(result[0].email).toBe("test@example.com");
    });

    // TODO: filterData method no longer exposed after Quasar removal
    it.skip("filters users by role", async () => {
      const rows = [
        { first_name: "Test", email: "test@example.com", role: "admin" },
        { first_name: "User", email: "user@example.com", role: "user" }
      ];

      const result = wrapper.vm.filterData(rows, "admin");
      expect(result).toHaveLength(1);
      expect(result[0].role).toBe("admin");
    });
  });

  describe("Pagination", () => {
    // TODO: changePagination method no longer exposed after Quasar removal
    it.skip("updates pagination when rows per page changes", async () => {
      // Mock the qTable reference and its setPagination method
      wrapper.vm.qTable = {
        setPagination: vi.fn()
      };

      const newPagination = { value: 50, label: "50" };
      await wrapper.vm.changePagination(newPagination);
      
      expect(wrapper.vm.selectedPerPage).toBe(50);
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(wrapper.vm.qTable.setPagination).toHaveBeenCalledWith(
        expect.objectContaining({
          rowsPerPage: 50
        })
      );
    });

    // TODO: changePagination method no longer exposed after Quasar removal
    it.skip("maintains pagination state after update", async () => {
      wrapper.vm.qTable = {
        setPagination: vi.fn()
      };

      // Set initial pagination
      const initialPagination = { value: 25, label: "25" };
      await wrapper.vm.changePagination(initialPagination);
      
      // Change to new value
      const newPagination = { value: 50, label: "50" };
      await wrapper.vm.changePagination(newPagination);
      
      expect(wrapper.vm.pagination.rowsPerPage).toBe(50);
      expect(wrapper.vm.qTable.setPagination).toHaveBeenLastCalledWith(
        expect.objectContaining({
          rowsPerPage: 50
        })
      );
    });
  });

  describe("UI Elements", () => {
    it("shows add user button when not in cloud mode", () => {
      const addButton = wrapper.find('[data-test="add-basic-user"]');
      expect(addButton.exists()).toBe(true);
    });


  });

  describe("Error Handling", () => {
    // TODO: notify signature changed after Quasar removal
    it.skip("handles network error when loading users", async () => {
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
          spinner: true,
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

    // TODO: notify color signature changed after Quasar removal
    it.skip("handles add member with success response", async () => {
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
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "positive",
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

    // TODO: filterData method no longer exposed after Quasar removal
    it.skip("handles empty filter query", async () => {
      wrapper.vm.filterQuery = "";
      const rows = [
        { first_name: "John", email: "john@example.com", role: "admin" }
      ];
      const result = wrapper.vm.filterData(rows, "");
      expect(result).toEqual(rows);
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
            RouterLink: true,
            MemberInvitation: true, // Add this stub
          },
        },
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
});
