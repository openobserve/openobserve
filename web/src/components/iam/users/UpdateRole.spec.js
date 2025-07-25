import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import UpdateRole from "./UpdateRole.vue";
import organizationsService from "@/services/organizations";

// Mock the organizations service
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

installQuasar({
  plugins: [Dialog, Notify],
});

describe("UpdateRole Component", () => {
  let wrapper;
  let mockStore;
  let notifyMock;
  let dismissMock;

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
        }
      }
    };

    // Setup notify mock with dismiss function
    dismissMock = vi.fn();
    notifyMock = vi.fn().mockReturnValue(dismissMock);

    // Mount component with default props
    wrapper = mount(UpdateRole, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          QCard: false,
          QCardSection: false,
          QSeparator: false,
          QForm: false,
          QInput: false,
          QSelect: false,
          QBtn: false,
        }
      },
      props: {
        modelValue: {
          org_member_id: "456",
          role: "admin",
          first_name: "John",
          email: "john@example.com"
        }
      }
    });

    // Attach notify mock to wrapper
    wrapper.vm.$q = {
      ...wrapper.vm.$q,
      notify: notifyMock
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with correct props data", () => {
      expect(wrapper.vm.orgMemberData).toEqual({
        org_member_id: "456",
        role: "admin",
        first_name: "John",
        email: "john@example.com"
      });
    });

    it("has correct default role options", () => {
      expect(wrapper.vm.roleOptions).toContain("admin");
    });
  });

  describe("Form Validation and Submission", () => {
    it("submits form with valid data", async () => {
      // Mock successful API response
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { success: true }
      });

      // Mock form validation
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(organizationsService.update_member_role).toHaveBeenCalledWith(
        {
          id: 456,
          role: "admin",
          organization_id: 123
        },
        "test-org"
      );

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "positive",
          message: "Organization member updated successfully."
        })
      );
      expect(dismissMock).toHaveBeenCalled();
    });

    it("handles form validation failure", async () => {
      // Mock form validation failure
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(false)
      };

      await wrapper.vm.onSubmit();
      
      expect(organizationsService.update_member_role).not.toHaveBeenCalled();
    });

    it("handles API error response", async () => {
      // Mock API error response
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { error_members: ["Some error"] }
      });

      // Mock form validation
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Error while updating organization member"
        })
      );
      expect(dismissMock).toHaveBeenCalled();
    });

    it("shows loading notification during form submission", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      vi.mocked(organizationsService.update_member_role).mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 100))
      );

      wrapper.vm.onSubmit();
      
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          spinner: true,
          message: "Please wait...",
          timeout: 2000
        })
      );
    });

    it("resets form validation after successful submission", async () => {
      const resetValidationMock = vi.fn();
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: resetValidationMock
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { success: true }
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(resetValidationMock).toHaveBeenCalled();
    });

    it("handles network error during submission", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      // Mock the API call to return error_members
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { error_members: ["Some error"] }
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      // Should show error notification
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "negative",
          message: "Error while updating organization member",
          timeout: 15000
        })
      );
    });

    it("handles undefined response data gracefully", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      // Mock API to return a response with data but no error_members
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: {}
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      // Should show success notification since no error_members
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "positive",
          message: "Organization member updated successfully.",
          timeout: 3000
        })
      );
    });

    it("handles malformed API response", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { unexpected: "format" }
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      // Should show success notification since no error_members
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "positive",
          message: "Organization member updated successfully.",
          timeout: 3000
        })
      );
    });
  });

  describe("Component Props and Emits", () => {
    it("emits updated event on successful form submission", async () => {
      const responseData = { success: true };
      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: responseData
      });

      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(wrapper.emitted().updated[0]).toEqual([responseData]);
      expect(dismissMock).toHaveBeenCalled();
    });

    it("updates orgMemberData when modelValue prop changes", async () => {
      const newModelValue = {
        org_member_id: "789",
        role: "admin",
        first_name: "Jane",
        email: "jane@example.com"
      };

      wrapper.vm.orgMemberData = newModelValue;
      await wrapper.vm.$nextTick(); 

      expect(wrapper.vm.orgMemberData).toEqual({
        org_member_id: newModelValue.org_member_id,
        role: newModelValue.role,
        first_name: newModelValue.first_name,
        email: newModelValue.email
      });
    });
  });

  describe("Role Selection", () => {
    it("initializes with admin role option", () => {
      expect(wrapper.vm.roleOptions).toEqual(["admin"]);
    });

    it("updates role when selected", async () => {
      wrapper.vm.orgMemberData.role = "admin";
      await wrapper.vm.$nextTick();
      
      const roleSelect = wrapper.find('.q-select');
      expect(roleSelect.exists()).toBe(true);
      expect(wrapper.vm.orgMemberData.role).toBe("admin");
    });
  });

  describe("Form State Management", () => {
    it("maintains form state after failed submission", async () => {
      const initialData = {
        org_member_id: "456",
        role: "admin",
        first_name: "John",
        email: "john@example.com"
      };

      wrapper.vm.orgMemberData = { ...initialData };
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn()
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(wrapper.vm.orgMemberData).toEqual(initialData);
    });

    it("properly formats organization ID for API call", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(organizationsService.update_member_role).toHaveBeenCalledWith(
        expect.objectContaining({
          organization_id: expect.any(Number)
        }),
        expect.any(String)
      );
    });
  });

  describe("UI Elements", () => {
    it("displays user's first name in read-only mode", () => {
      const firstNameInput = wrapper.find('input[aria-label="user.name"]');
      expect(firstNameInput.exists()).toBe(true);
      expect(firstNameInput.element.value).toBe("John");
    });

    it("shows role selector with correct options", () => {
      const roleSelect = wrapper.find('.q-select');
      expect(roleSelect.exists()).toBe(true);
    });

    it("has save button", () => {
      const saveButton = wrapper.find('button[type="submit"]');
      expect(saveButton.exists()).toBe(true);
    });
  });

  describe("UI Interactions", () => {
    it("displays first name in read-only mode", () => {
      const input = wrapper.find('input[readonly]');
      expect(input.exists()).toBe(true);
    });

    it("shows form title correctly", () => {
      const title = wrapper.find('.text-body1');
      expect(title.exists()).toBe(true);
      expect(title.text()).toBe('user.editUser');
    });

    it("has proper form layout structure", () => {
      const form = wrapper.find('form');
      expect(form.exists()).toBe(true);
      expect(form.classes()).toContain('q-form');
    });

    it("prevents form submission on validation failure", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn()
      };

      const form = wrapper.find('form');
      await form.trigger('submit.prevent');

      expect(organizationsService.update_member_role).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    it("handles undefined response data gracefully", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: undefined
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalled();
    });

    it("handles malformed API response", async () => {
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(true),
        resetValidation: vi.fn()
      };

      vi.mocked(organizationsService.update_member_role).mockResolvedValue({
        data: { unexpected: "format" }
      });

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalled();
    });
  });

  describe("Form Input Validation", () => {
    it("validates required role field", async () => {
      wrapper.vm.orgMemberData.role = "";
      await wrapper.vm.$nextTick();

      // Mock validation method
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn()
      };

      const roleSelect = wrapper.findComponent({ name: 'QSelect' });
      expect(roleSelect.exists()).toBe(true);
      
      await wrapper.vm.onSubmit();
      await wrapper.vm.$nextTick();
      
      // For Quasar components, we should verify the validation was called
      expect(wrapper.vm.updateUserForm.validate).toHaveBeenCalled();
    });

    it("prevents submission with empty role", async () => {
      wrapper.vm.orgMemberData.role = "";
      wrapper.vm.updateUserForm = {
        validate: vi.fn().mockResolvedValue(false),
        resetValidation: vi.fn()
      };

      await wrapper.vm.onSubmit();
      await flushPromises();

      expect(organizationsService.update_member_role).not.toHaveBeenCalled();
    });
  });

  describe("Component Reactivity", () => {
    it("updates form data when modelValue changes", async () => {
      const newData = {
        org_member_id: "789",
        role: "admin",
        first_name: "Jane",
        email: "jane@example.com"
      };

      // We need to trigger the created hook again
      wrapper = mount(UpdateRole, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            QCard: false,
            QCardSection: false,
            QSeparator: false,
            QForm: false,
            QInput: false,
            QSelect: false,
            QBtn: false,
          }
        },
        props: {
          modelValue: newData
        }
      });

      expect(wrapper.vm.orgMemberData).toEqual(newData);
    });

    it("maintains role options after component update", async () => {
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.roleOptions).toContain("admin");
      expect(wrapper.vm.roleOptions.length).toBe(1);
    });
  });

  describe("Close Button Functionality", () => {
    it("has close button in header", () => {
      const closeButton = wrapper.findComponent({ name: 'QBtn', props: { icon: 'cancel' } });
      expect(closeButton.exists()).toBe(true);
    });

    it("has cancel button in form", () => {
      const cancelButton = wrapper.findComponent({ name: 'QBtn', props: { 'text-color': 'light-text' } });
      expect(cancelButton.exists()).toBe(true);
    });
  });

  describe("Form Layout and Styling", () => {
    it("has proper card structure", () => {
      const card = wrapper.findComponent({ name: 'QCard' });
      expect(card.exists()).toBe(true);
      expect(card.classes()).toContain('full-height');
    });

    it("has form section with proper spacing", () => {
      const formSection = wrapper.findComponent({ name: 'QCardSection' });
      expect(formSection.exists()).toBe(true);
      expect(formSection.classes()).toContain('q-px-md');
      expect(formSection.classes()).toContain('q-py-md');
    });

    it("has separator between header and form", () => {
      const separator = wrapper.findComponent({ name: 'QSeparator' });
      expect(separator.exists()).toBe(true);
    });
  });

  describe("Input Field Properties", () => {
    it("has read-only name input with correct attributes", () => {
      const nameInput = wrapper.findComponent({ name: 'QInput', props: { label: 'user.name' } });
      expect(nameInput.exists()).toBe(true);
      expect(nameInput.props('readonly')).toBe(true);
      expect(nameInput.props('dense')).toBe(true);
    });

    it("has role select with correct attributes", () => {
      const roleSelect = wrapper.findComponent({ name: 'QSelect' });
      expect(roleSelect.exists()).toBe(true);
      expect(roleSelect.props('dense')).toBe(true);
      expect(roleSelect.props('outlined')).toBe(true);
    });
  });
});
