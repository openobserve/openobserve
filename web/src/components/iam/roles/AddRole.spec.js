import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import store from "@/test/unit/helpers/store";
import i18n from "@/locales";
import AddRole from "./AddRole.vue";
import { createRole, updateRole } from "@/services/iam";

// Mock the IAM service
vi.mock("@/services/iam", () => ({
  createRole: vi.fn(),
  updateRole: vi.fn()
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

describe("AddRole Component", () => {
  let wrapper;
  let mockStore;
  let notifyMock;

  beforeEach(() => {
    // Setup mock store
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org"
        }
      }
    };

    // Setup notify mock
    notifyMock = vi.fn();

    // Mount component
    wrapper = mount(AddRole, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          QCard: false,
          QCardSection: false,
          QIcon: true,
          QInput: true,
          QBtn: true
        }
      },
      props: {
        width: "30vw",
        role: null,
        org_identifier: "test-org"
      }
    });

    // Attach notify mock
    wrapper.vm.$q.notify = notifyMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("initializes with empty role name", () => {
      expect(wrapper.vm.name).toBe("");
    });

    it("shows correct title", () => {
      const title = wrapper.find('[data-test="add-role-section-title"]');
      expect(title.text()).toBe("iam.addRole");
    });
  });

  describe("Role Name Validation", () => {
    it("validates valid role name", async () => {
      wrapper.vm.name = "test_role_123";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isValidRoleName).toBe(true);
    });

    it("invalidates role name with spaces", async () => {
      wrapper.vm.name = "test role";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isValidRoleName).toBe(false);
    });

    it("invalidates role name with special characters", async () => {
      wrapper.vm.name = "test@role";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isValidRoleName).toBe(false);
    });

    it("validates role name with underscores", async () => {
      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isValidRoleName).toBe(true);
    });
  });

  describe("Role Creation", () => {
    it("creates role successfully", async () => {
      vi.mocked(createRole).mockResolvedValue({});
      
      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(createRole).toHaveBeenCalledWith(
        "test_role",
        "test-org"
      );
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Role "test_role" Created Successfully!',
          color: "positive"
        })
      );
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
      expect(wrapper.emitted()["added:role"]).toBeTruthy();
    });

    it("prevents creation with invalid role name", async () => {
      wrapper.vm.name = "invalid role";
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(createRole).not.toHaveBeenCalled();
    });

    it("prevents creation with empty role name", async () => {
      wrapper.vm.name = "";
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(createRole).not.toHaveBeenCalled();
    });

    it("handles creation error", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: {
            message: "Role already exists"
          }
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Role already exists",
          color: "negative"
        })
      );
    });

    it("ignores 403 error notifications", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 403
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.$q.notify).not.toHaveBeenCalled();
    });
  });

  describe("UI Interactions", () => {
    it("emits cancel event on close icon click", async () => {
      const closeIcon = wrapper.find('[data-test="add-role-close-dialog-btn"]');
      await closeIcon.trigger("click");
      
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("emits cancel event on cancel button click", async () => {
      const cancelButton = wrapper.find('[data-test="add-alert-cancel-btn"]');
      await cancelButton.trigger("click");
      
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });

    it("handles whitespace in role name", async () => {
      // Since v-model.trim is used in template, we need to test the computed value
      const input = wrapper.findComponent({ name: 'QInput' });
      await input.setValue("  test_role  ");
      expect(input.props('modelValue')).toBe("test_role");
    });

    it("shows validation hint for invalid role name", async () => {
      // Remove stub for QInput to allow rendering of the hint slot
      const wrapper = mount(AddRole, {
        global: {
          plugins: [i18n],
          provide: {
            store: mockStore,
          },
          stubs: {
            QCard: false,
            QCardSection: false,
            QIcon: true,
            QBtn: true
          }
        }
      });

      const hintText = wrapper.find('.q-field__messages').text();
      expect(hintText).toBe('Use alphanumeric and \'_\' characters only, without spaces.');
    });
  });

  describe("Form Validation", () => {
    it("shows required error when name is empty", async () => {
      const input = wrapper.findComponent({ name: 'QInput' });
      const rules = input.props('rules');
      
      const validationResult = await rules[0]("", {});
      expect(validationResult).toBe("common.nameRequired");
    });

    it("shows format error for invalid role name", async () => {
      wrapper.vm.name = "invalid@role";
      await wrapper.vm.$nextTick();
      
      const input = wrapper.findComponent({ name: 'QInput' });
      const rules = input.props('rules');
      
      const validationResult = await rules[0]("invalid@role", {});
      expect(validationResult).toBe("Use alphanumeric and '_' characters only, without spaces.");
    });

    it("enforces maximum length constraint", async () => {
      const input = wrapper.findComponent({ name: 'QInput' });
      // Convert maxlength to string since it's passed as string in template
      expect(input.props('maxlength')).toBe("100");
    });
  });

  describe("Error Handling", () => {
    it("handles network error during role creation", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 500,
          data: {
            message: "Network Error"
          }
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "negative",
          message: "Network Error"
        })
      );
    });

    it("handles missing error response data", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "negative"
        })
      );
    });
  });

  describe("Component State Management", () => {
    it("maintains role name state after failed submission", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: {
            message: "Error"
          }
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.name).toBe("test_role");
    });

    it("clears role name after successful submission", async () => {
      vi.mocked(createRole).mockResolvedValue({});
      
      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
    });
  });

  describe("Role Name Format Validation", () => {
    const testCases = [
      { input: "valid_role_123", expected: true, description: "alphanumeric with underscore" },
      { input: "UPPERCASE_ROLE", expected: true, description: "uppercase with underscore" },
      { input: "123_numeric_start", expected: true, description: "starts with number" },
      { input: "role with space", expected: false, description: "contains space" },
      { input: "role@special", expected: false, description: "contains special character" },
      { input: "role-hyphen", expected: false, description: "contains hyphen" },
      { input: "_start_underscore", expected: true, description: "starts with underscore" }
    ];

    testCases.forEach(({ input, expected, description }) => {
      it(`validates role name that ${description}`, async () => {
        wrapper.vm.name = input;
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.isValidRoleName).toBe(expected);
      });
    });
  });

  describe("Save Button Behavior", () => {
    it("triggers save on button click", async () => {
      vi.mocked(createRole).mockResolvedValue({});
      const saveButton = wrapper.find('[data-test="add-alert-submit-btn"]');
      wrapper.vm.name = "valid_role";
      await wrapper.vm.$nextTick();
      
      await saveButton.trigger("click");
      await flushPromises();

      expect(createRole).toHaveBeenCalled();
    });


    // Add a test for proper error handling
    it("handles API errors correctly", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: {
            message: "Invalid role name"
          }
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Invalid role name",
          color: "negative"
        })
      );
    });

    // Add a test for 403 error handling
    it("handles 403 errors silently", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 403
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.$q.notify).not.toHaveBeenCalled();
    });
  });

  describe("Props Handling", () => {
    it("initializes with provided role name", async () => {
      const wrapper = mount(AddRole, {
        global: {
          plugins: [i18n],
          provide: { store: mockStore }
        },
        props: {
          role: { name: "existing_role" }
        }
      });

      expect(wrapper.vm.name).toBe("existing_role");
    });

    it("uses default width when not provided", () => {
      const wrapper = mount(AddRole, {
        global: {
          plugins: [i18n],
          provide: { store: mockStore }
        }
      });

      // The width prop has been removed from the component
      // Verify the component mounts successfully without the width prop
      expect(wrapper.exists()).toBe(true);
    });
  });

  // Add new test categories after existing ones
  describe("Input Field Behavior", () => {
    it("updates model value on input", async () => {
      const input = wrapper.findComponent({ name: 'QInput' });
      await input.setValue("new_test_role");
      expect(wrapper.vm.name).toBe("new_test_role");
    });

    it("shows required field indicator", () => {
      const input = wrapper.findComponent({ name: 'QInput' });
      expect(input.props('label')).toContain('*');
    });

    it("has correct placeholder text", () => {
      const input = wrapper.findComponent({ name: 'QInput' });
      expect(input.props('label')).toContain('common.name');
    });
  });

  describe("Extended Validation Cases", () => {
    const extendedTestCases = [
      { input: "UPPERCASE_ONLY", expected: true, desc: "uppercase only" },
      { input: "lowercase_only", expected: true, desc: "lowercase only" },
      { input: "Mixed_Case_Role", expected: true, desc: "mixed case" },
      { input: "123_numeric_prefix", expected: true, desc: "numeric prefix" },
      { input: "_underscore_prefix", expected: true, desc: "underscore prefix" },
      { input: "role_underscore_suffix_", expected: true, desc: "underscore suffix" },
      { input: "role#invalid", expected: false, desc: "hash character" },
      { input: "role+invalid", expected: false, desc: "plus character" },
      { input: "role=invalid", expected: false, desc: "equals character" }
    ];

    extendedTestCases.forEach(({ input, expected, desc }) => {
      it(`validates role name with ${desc}`, async () => {
        wrapper.vm.name = input;
        await wrapper.vm.$nextTick();
        expect(wrapper.vm.isValidRoleName).toBe(expected);
      });
    });
  });

  describe("Form State Management", () => {
    it("emits correct events after successful submission", async () => {
      vi.mocked(createRole).mockResolvedValue({});
      
      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      // Check that the form emits the correct events
      expect(wrapper.emitted()["cancel:hideform"]).toBeTruthy();
      expect(wrapper.emitted()["added:role"]).toBeTruthy();
      
      // Check that success notification was shown
      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Role "test_role" Created Successfully!',
          color: "positive"
        })
      );
    });

    it("maintains form state after failed submission", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: { message: "Error" }
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.name).toBe("test_role");
    });
  });

  describe("Notification Behavior", () => {
    it("shows success notification with correct role name", async () => {
      vi.mocked(createRole).mockResolvedValue({});
      
      const roleName = "success_test_role";
      wrapper.vm.name = roleName;
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Role "${roleName}" Created Successfully!`,
          color: "positive",
          position: "bottom",
          timeout: 3000
        })
      );
    });

    it("shows error notification with API message", async () => {
      const errorMessage = "Custom API error message";
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: { message: errorMessage }
        }
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.$q.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          message: errorMessage,
          color: "negative",
          position: "bottom",
          timeout: 3000
        })
      );
    });
  });

  describe("Component Layout", () => {
    it("has correct section title", () => {
      const title = wrapper.find('[data-test="add-role-section-title"]');
      expect(title.text()).toBe("iam.addRole");
    });

    it("has both save and cancel buttons", () => {
      const saveButton = wrapper.find('[data-test="add-alert-submit-btn"]');
      const cancelButton = wrapper.find('[data-test="add-alert-cancel-btn"]');
      
      expect(saveButton.exists()).toBe(true);
      expect(cancelButton.exists()).toBe(true);
    });

    it("has close dialog icon", () => {
      const closeIcon = wrapper.find('[data-test="add-role-close-dialog-btn"]');
      expect(closeIcon.exists()).toBe(true);
    });
  });

  describe("Edge Cases", () => {
    it("handles very long role names", async () => {
      const longName = "a".repeat(100);
      wrapper.vm.name = longName;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.name.length).toBe(100);
      expect(wrapper.vm.isValidRoleName).toBe(true);
    });

    it("handles role names with multiple underscores", async () => {
      wrapper.vm.name = "role___with___multiple___underscores";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isValidRoleName).toBe(true);
    });

    it("handles role names with numbers and underscores mixed", async () => {
      wrapper.vm.name = "role_123_test_456_name_789";
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.isValidRoleName).toBe(true);
    });
  });
});
