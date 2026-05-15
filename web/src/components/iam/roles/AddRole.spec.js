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

import { flushPromises, mount } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Dialog, Notify } from "quasar";
import { installQuasar } from "@/test/unit/helpers";
import i18n from "@/locales";
import AddRole from "./AddRole.vue";
import { createRole } from "@/services/iam";

// Mock the IAM service
vi.mock("@/services/iam", () => ({
  createRole: vi.fn(),
  updateRole: vi.fn(),
}));

// Mock vue-i18n so t(key) returns the key unchanged
vi.mock("vue-i18n", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useI18n: () => ({
      t: (key) => key,
    }),
  };
});

// Mock the analytics tracker — irrelevant to UI flow.
const trackMock = vi.fn();
vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: trackMock }),
}));

installQuasar({
  plugins: [Dialog, Notify],
});

// ODrawer stub: exposes the migrated props (open/width/title/...) and drives
// the primary/secondary/neutral buttons via the standard click:* emits. Buttons
// inside the default slot (the AddRole component still renders its own
// OButton cancel/save inside the slot) are also exposed for direct clicks.
const ODrawerStub = {
  name: "ODrawer",
  props: [
    "open",
    "width",
    "showClose",
    "persistent",
    "size",
    "title",
    "subTitle",
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
      data-test-stub="o-drawer"
      :data-open="open"
      :data-title="title"
      :data-width="width"
    >
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
    </div>
  `,
  inheritAttrs: false,
};

const findDrawer = (w) =>
  w.findComponent({ name: "ODrawer" });

describe("AddRole Component", () => {
  let wrapper;
  let mockStore;
  let notifyMock;

  const mountAddRole = (props = {}) =>
    mount(AddRole, {
      global: {
        plugins: [i18n],
        provide: {
          store: mockStore,
        },
        stubs: {
          ODrawer: ODrawerStub,
          QInput: true,
        },
      },
      props: {
        open: true,
        role: null,
        org_identifier: "test-org",
        ...props,
      },
    });

  beforeEach(() => {
    mockStore = {
      state: {
        selectedOrganization: {
          identifier: "test-org",
        },
      },
    };

    notifyMock = vi.fn();

    wrapper = mountAddRole();

    // Attach notify mock onto the component's $q instance.
    wrapper.vm.$q.notify = notifyMock;
  });

  afterEach(() => {
    vi.clearAllMocks();
    if (wrapper) wrapper.unmount();
  });

  describe("Component Initialization", () => {
    it("mounts successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the ODrawer with migrated props", () => {
      const drawer = findDrawer(wrapper);
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("open")).toBe(true);
      expect(drawer.props("width")).toBe(30);
      expect(drawer.props("title")).toBe("iam.addRole");
    });

    it("initializes with empty role name", () => {
      expect(wrapper.vm.name).toBe("");
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

      expect(createRole).toHaveBeenCalledWith("test_role", "test-org");
      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Role "test_role" Created Successfully!',
          color: "positive",
        }),
      );
      // Migrated emits: update:open(false) replaces the old cancel:hideform.
      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[updateOpen.length - 1]).toEqual([false]);
      expect(wrapper.emitted("added:role")).toBeTruthy();
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
          data: { message: "Role already exists" },
        },
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();

      await wrapper.vm.saveRole();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Role already exists",
          color: "negative",
        }),
      );
    });

    it("ignores 403 error notifications", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: { status: 403 },
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();

      await wrapper.vm.saveRole();
      await flushPromises();

      expect(notifyMock).not.toHaveBeenCalled();
    });
  });

  describe("UI Interactions", () => {
    it("emits update:open(false) when ODrawer requests close", async () => {
      // Simulate ODrawer's own close handling propagating via update:open.
      await findDrawer(wrapper).vm.$emit("update:open", false);

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[0]).toEqual([false]);
    });

    it("emits update:open(false) when the cancel OButton is clicked", async () => {
      const cancelButton = wrapper.find('[data-test="add-alert-cancel-btn"]');
      expect(cancelButton.exists()).toBe(true);
      await cancelButton.trigger("click");

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[0]).toEqual([false]);
    });
  });

  describe("Form Validation", () => {
    it("shows required error when name is empty", async () => {
      const input = wrapper.findComponent({ name: "QInput" });
      const rules = input.props("rules");

      const validationResult = await rules[0]("", {});
      expect(validationResult).toBe("common.nameRequired");
    });

    it("shows format error for invalid role name", async () => {
      wrapper.vm.name = "invalid@role";
      await wrapper.vm.$nextTick();

      const input = wrapper.findComponent({ name: "QInput" });
      const rules = input.props("rules");

      const validationResult = await rules[0]("invalid@role", {});
      expect(validationResult).toBe(
        "Use alphanumeric and '_' characters only, without spaces.",
      );
    });

    it("enforces maximum length constraint", () => {
      const input = wrapper.findComponent({ name: "QInput" });
      // maxlength is passed as a string in the template.
      expect(input.props("maxlength")).toBe("100");
    });
  });

  describe("Error Handling", () => {
    it("handles network error during role creation", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 500,
          data: { message: "Network Error" },
        },
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          color: "negative",
          message: "Network Error",
        }),
      );
    });

    it("handles missing error response data", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: { status: 400 },
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({ color: "negative" }),
      );
    });
  });

  describe("Component State Management", () => {
    it("maintains role name state after failed submission", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: { message: "Error" },
        },
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(wrapper.vm.name).toBe("test_role");
    });

    it("emits update:open(false) after a successful submission", async () => {
      vi.mocked(createRole).mockResolvedValue({});

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[updateOpen.length - 1]).toEqual([false]);
    });
  });

  describe("Role Name Format Validation", () => {
    const testCases = [
      {
        input: "valid_role_123",
        expected: true,
        description: "alphanumeric with underscore",
      },
      {
        input: "UPPERCASE_ROLE",
        expected: true,
        description: "uppercase with underscore",
      },
      {
        input: "123_numeric_start",
        expected: true,
        description: "starts with number",
      },
      {
        input: "role with space",
        expected: false,
        description: "contains space",
      },
      {
        input: "role@special",
        expected: false,
        description: "contains special character",
      },
      {
        input: "role-hyphen",
        expected: false,
        description: "contains hyphen",
      },
      {
        input: "_start_underscore",
        expected: true,
        description: "starts with underscore",
      },
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
    it("triggers save on save button click", async () => {
      vi.mocked(createRole).mockResolvedValue({});
      wrapper.vm.name = "valid_role";
      await wrapper.vm.$nextTick();

      const saveButton = wrapper.find('[data-test="add-alert-submit-btn"]');
      expect(saveButton.exists()).toBe(true);
      await saveButton.trigger("click");
      await flushPromises();

      expect(createRole).toHaveBeenCalled();
    });

    it("handles API errors correctly", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: { message: "Invalid role name" },
        },
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Invalid role name",
          color: "negative",
        }),
      );
    });

    it("handles 403 errors silently", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: { status: 403 },
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(notifyMock).not.toHaveBeenCalled();
    });
  });

  describe("Props Handling", () => {
    it("initializes with provided role name", () => {
      const localWrapper = mountAddRole({ role: { name: "existing_role" } });
      expect(localWrapper.vm.name).toBe("existing_role");
      localWrapper.unmount();
    });

    it("reflects the open prop on the drawer", () => {
      const localWrapper = mountAddRole({ open: false });
      expect(findDrawer(localWrapper).props("open")).toBe(false);
      localWrapper.unmount();
    });

    it("uses the default open value (false) when not provided", () => {
      // Mount without providing the open prop.
      const localWrapper = mount(AddRole, {
        global: {
          plugins: [i18n],
          provide: { store: mockStore },
          stubs: { ODrawer: ODrawerStub, QInput: true },
        },
      });

      expect(findDrawer(localWrapper).props("open")).toBe(false);
      localWrapper.unmount();
    });
  });

  describe("Input Field Behavior", () => {
    it("updates model value on input", async () => {
      const input = wrapper.findComponent({ name: "QInput" });
      await input.setValue("new_test_role");
      expect(wrapper.vm.name).toBe("new_test_role");
    });

    it("shows required field indicator", () => {
      const input = wrapper.findComponent({ name: "QInput" });
      expect(input.props("label")).toContain("*");
    });

    it("has correct placeholder text", () => {
      const input = wrapper.findComponent({ name: "QInput" });
      expect(input.props("label")).toContain("common.name");
    });
  });

  describe("Extended Validation Cases", () => {
    const extendedTestCases = [
      { input: "UPPERCASE_ONLY", expected: true, desc: "uppercase only" },
      { input: "lowercase_only", expected: true, desc: "lowercase only" },
      { input: "Mixed_Case_Role", expected: true, desc: "mixed case" },
      { input: "123_numeric_prefix", expected: true, desc: "numeric prefix" },
      {
        input: "_underscore_prefix",
        expected: true,
        desc: "underscore prefix",
      },
      {
        input: "role_underscore_suffix_",
        expected: true,
        desc: "underscore suffix",
      },
      { input: "role#invalid", expected: false, desc: "hash character" },
      { input: "role+invalid", expected: false, desc: "plus character" },
      { input: "role=invalid", expected: false, desc: "equals character" },
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

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[updateOpen.length - 1]).toEqual([false]);
      expect(wrapper.emitted("added:role")).toBeTruthy();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Role "test_role" Created Successfully!',
          color: "positive",
        }),
      );
    });

    it("maintains form state after failed submission", async () => {
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: { message: "Error" },
        },
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

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: `Role "${roleName}" Created Successfully!`,
          color: "positive",
          position: "bottom",
          timeout: 3000,
        }),
      );
    });

    it("shows error notification with API message", async () => {
      const errorMessage = "Custom API error message";
      vi.mocked(createRole).mockRejectedValue({
        response: {
          status: 400,
          data: { message: errorMessage },
        },
      });

      wrapper.vm.name = "test_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(notifyMock).toHaveBeenCalledWith(
        expect.objectContaining({
          message: errorMessage,
          color: "negative",
          position: "bottom",
          timeout: 3000,
        }),
      );
    });
  });

  describe("Component Layout", () => {
    it("renders the section container", () => {
      const section = wrapper.find('[data-test="add-role-section"]');
      expect(section.exists()).toBe(true);
    });

    it("has both save and cancel buttons", () => {
      const saveButton = wrapper.find('[data-test="add-alert-submit-btn"]');
      const cancelButton = wrapper.find('[data-test="add-alert-cancel-btn"]');

      expect(saveButton.exists()).toBe(true);
      expect(cancelButton.exists()).toBe(true);
    });

    it("renders the ODrawer with the iam.addRole title", () => {
      const drawer = findDrawer(wrapper);
      expect(drawer.props("title")).toBe("iam.addRole");
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

  describe("Analytics", () => {
    it("tracks the save role click on successful save", async () => {
      vi.mocked(createRole).mockResolvedValue({});
      wrapper.vm.name = "tracked_role";
      await wrapper.vm.$nextTick();
      await wrapper.vm.saveRole();
      await flushPromises();

      expect(trackMock).toHaveBeenCalledWith("Button Click", {
        button: "Save Role",
        page: "Add Role",
      });
    });
  });
});
