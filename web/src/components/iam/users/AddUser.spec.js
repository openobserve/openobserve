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

import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { installQuasar } from "@/test/unit/helpers/install-quasar-plugin";
import { Dialog, Notify, Quasar } from "quasar";
import { nextTick, ref } from "vue";

// Mock userService
vi.mock("@/services/users", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
    updateexistinguser: vi.fn(),
    getUserRoles: vi.fn(),
  },
}));

// Mock aws-exports
vi.mock("@/aws-exports", () => ({
  default: {
    isEnterprise: "true",
    isCloud: false,
  },
}));

// Mock composables that use inject()
vi.mock("@/composables/useStreams", () => ({
  default: vi.fn(() => ({
    streamList: ref([]),
    loading: ref(false),
    error: ref(null),
  })),
}));

vi.mock("@/composables/useLogs", () => ({
  default: vi.fn(() => ({
    searchObj: ref({
      loading: false,
      data: { queryResults: [], aggs: { histogram: [] } },
    }),
    searchAggData: ref({ histogram: [], total: 0 }),
    searchResultData: ref({ list: [] }),
  })),
}));

vi.mock("@/composables/useDashboard", () => ({
  default: vi.fn(() => ({
    dashboards: ref([]),
    loading: ref(false),
    error: ref(null),
  })),
}));

vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getImageURL: vi.fn(() => ""),
    verifyOrganizationStatus: vi.fn(() => Promise.resolve(true)),
    logsErrorMessage: vi.fn((code) => `Error: ${code}`),
    mergeRoutes: vi.fn((route1, route2) => [
      ...(route1 || []),
      ...(route2 || []),
    ]),
    getPath: vi.fn(() => "/"),
    useLocalTimezone: vi.fn(() => "UTC"),
    useLocalCurrentUser: vi.fn(),
    useLocalUserInfo: vi.fn(),
    invalidateLoginData: vi.fn(),
  };
});

vi.mock("@/services/auth", () => ({
  default: {
    sign_in_user: vi.fn(),
    sign_out: vi.fn(),
    get_dex_config: vi.fn(),
  },
}));

vi.mock("@/services/organizations", () => ({
  default: {
    get_organization: vi.fn(),
    list: vi.fn(),
    add_members: vi.fn(),
  },
}));

vi.mock("@/services/billings", () => ({
  default: {
    get_billing_info: vi.fn(),
    get_invoice_history: vi.fn(),
  },
}));

// Silence the analytics tracker — irrelevant to UI flow.
const trackMock = vi.fn();
vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: trackMock }),
}));

import AddUser from "@/components/iam/users/AddUser.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";
import router from "@/test/unit/helpers/router";
import userService from "@/services/users";

const node = document.createElement("div");
node.setAttribute("id", "app");
document.body.appendChild(node);

const platform = {
  is: { desktop: true, mobile: false },
  has: { touch: false },
};

installQuasar({
  plugins: [Dialog, Notify],
  config: { platform },
});

// ODrawer stub: exposes the migrated props (open/size/title/...) and
// the standard click:* emits. The default slot still hosts the original
// q-form / inputs / OButtons so existing data-test selectors keep working.
const ODrawerStub = {
  name: "ODrawer",
  props: {
    open: { type: Boolean, default: false },
    persistent: { type: Boolean, default: false },
    showClose: { type: Boolean, default: false },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
    width: { type: [Number, String], default: undefined },
    size: { type: String, default: undefined },
    title: { type: String, default: undefined },
    subTitle: { type: String, default: undefined },
    primaryButtonLabel: { type: String, default: undefined },
    secondaryButtonLabel: { type: String, default: undefined },
    neutralButtonLabel: { type: String, default: undefined },
    primaryButtonVariant: { type: String, default: undefined },
    secondaryButtonVariant: { type: String, default: undefined },
    neutralButtonVariant: { type: String, default: undefined },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test-stub="o-drawer"
      :data-open="String(open)"
      :data-title="title"
      :data-size="size"
    >
      <div data-test-stub="o-drawer-header"><slot name="header" /></div>
      <div data-test-stub="o-drawer-body"><slot /></div>
      <div data-test-stub="o-drawer-footer"><slot name="footer" /></div>
    </div>
  `,
  inheritAttrs: false,
};

// ODialog stub for the "Password Changed" confirmation. Buttons are driven
// purely via the click:primary emit, matching the migrated v-model:open API.
const ODialogStub = {
  name: "ODialog",
  props: {
    open: { type: Boolean, default: false },
    persistent: { type: Boolean, default: false },
    showClose: { type: Boolean, default: false },
    primaryButtonDisabled: { type: Boolean, default: false },
    secondaryButtonDisabled: { type: Boolean, default: false },
    neutralButtonDisabled: { type: Boolean, default: false },
    primaryButtonLoading: { type: Boolean, default: false },
    secondaryButtonLoading: { type: Boolean, default: false },
    neutralButtonLoading: { type: Boolean, default: false },
    width: { type: [Number, String], default: undefined },
    size: { type: String, default: undefined },
    title: { type: String, default: undefined },
    subTitle: { type: String, default: undefined },
    primaryButtonLabel: { type: String, default: undefined },
    secondaryButtonLabel: { type: String, default: undefined },
    neutralButtonLabel: { type: String, default: undefined },
    primaryButtonVariant: { type: String, default: undefined },
    secondaryButtonVariant: { type: String, default: undefined },
    neutralButtonVariant: { type: String, default: undefined },
  },
  emits: ["update:open", "click:primary", "click:secondary", "click:neutral"],
  template: `
    <div
      data-test-stub="o-dialog"
      :data-open="String(open)"
      :data-title="title"
      :data-size="size"
      :data-primary-label="primaryButtonLabel"
    >
      <slot name="header" />
      <slot />
      <slot name="footer" />
      <button
        data-test-stub="o-dialog-primary"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
    </div>
  `,
  inheritAttrs: false,
};

const findDrawer = (w) =>
  w.findComponent({ name: "ODrawer" });
const findDialog = (w) =>
  w.findComponent({ name: "ODialog" });

describe("AddUser Component", () => {
  let wrapper;
  let mockRouter;
  let mockNotify;

  const defaultProps = {
    open: true,
    modelValue: {
      org_member_id: "",
      role: "admin",
      first_name: "",
      last_name: "",
      email: "",
      old_password: "",
      new_password: "",
      change_password: false,
      organization: "",
      other_organization: "",
    },
    isUpdated: false,
    userRole: "admin",
    roles: [
      { label: "Admin", value: "admin" },
      { label: "Member", value: "member" },
    ],
    customRoles: ["role1", "role2"],
  };

  const buildWrapper = (overrides = {}) =>
    mount(AddUser, {
      props: { ...defaultProps, ...overrides },
      global: {
        plugins: [[Quasar, { platform }], i18n, router],
        provide: { store, platform },
        stubs: {
          ODrawer: ODrawerStub,
          ODialog: ODialogStub,
        },
        mocks: {
          $router: mockRouter,
          $q: {
            platform,
            notify: mockNotify,
            dialog: Dialog,
          },
        },
      },
      attachTo: document.body,
    });

  beforeEach(async () => {
    vi.mocked(userService.create).mockReset();
    vi.mocked(userService.update).mockReset();
    vi.mocked(userService.updateexistinguser).mockReset();
    vi.mocked(userService.getUserRoles).mockReset();

    store.state.organizations = [
      { name: "Test Org", identifier: "test-org" },
      { name: "Another Org", identifier: "another-org" },
    ];
    store.state.selectedOrganization = {
      identifier: "test-org",
      name: "Test Org",
    };
    store.state.userInfo = { email: "test@example.com" };

    mockRouter = { push: vi.fn() };
    mockNotify = vi.fn();

    wrapper = buildWrapper();
    await flushPromises();
  });

  afterEach(() => {
    if (wrapper && typeof wrapper.unmount === "function") {
      wrapper.unmount();
    }
    vi.clearAllMocks();
  });

  describe("Component Initialization", () => {
    it("renders the component", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the ODrawer with migrated props", () => {
      const drawer = findDrawer(wrapper);
      expect(drawer.exists()).toBe(true);
      expect(drawer.props("open")).toBe(true);
      expect(drawer.props("persistent")).toBe(true);
      expect(drawer.props("size")).toBe("lg");
    });

    it("reflects the open prop on the drawer when false", () => {
      const localWrapper = buildWrapper({ open: false });
      expect(findDrawer(localWrapper).props("open")).toBe(false);
      localWrapper.unmount();
    });

    it("uses the 'add user' title when not updating", () => {
      // i18n resolves user.add → "New user" in the test locale.
      const title = findDrawer(wrapper).props("title");
      expect(title).toBeTruthy();
      expect(title.toLowerCase()).toContain("user");
    });

    it("uses the 'edit user' title when updating an existing user", () => {
      const localWrapper = buildWrapper({
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, email: "edit@example.com" },
      });
      const title = findDrawer(localWrapper).props("title");
      // i18n resolves user.editUser → "Update User" in the test locale.
      expect(title).toBeTruthy();
      expect(title.toLowerCase()).toContain("user");
      // The two titles must differ to confirm the conditional branch.
      expect(title).not.toBe(findDrawer(wrapper).props("title"));
      localWrapper.unmount();
    });
  });

  describe("Field Rendering", () => {
    it("validates email format", async () => {
      wrapper.vm.existingUser = true;
      wrapper.vm.beingUpdated = false;
      await nextTick();

      const emailInput = wrapper.find('[data-test="user-email-field"]');
      expect(emailInput.exists()).toBe(true);

      await emailInput.setValue("invalid-email");
      await emailInput.trigger("blur");

      expect(wrapper.vm.formData.email).toBe("invalid-email");
    });

    it("validates password length", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.beingUpdated = false;
      await nextTick();

      const passwordInput = wrapper.find('[data-test="user-password-field"]');
      expect(passwordInput.exists()).toBe(true);

      await passwordInput.setValue("short");
      await passwordInput.trigger("blur");

      expect(wrapper.vm.formData.password).toBe("short");
    });
  });

  describe("Form Submission", () => {
    it("creates a new user successfully", async () => {
      vi.mocked(userService.create).mockResolvedValue({
        data: { message: "User created successfully" },
        status: 200,
      });

      wrapper.vm.formData = {
        email: "test@example.com",
        password: "password123",
        first_name: "John",
        last_name: "Doe",
        role: "admin",
        organization: "test-org",
      };
      wrapper.vm.existingUser = false;
      await nextTick();

      const form = wrapper.find("form");
      await form.trigger("submit.prevent");
      await flushPromises();

      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "test@example.com",
          password: "password123",
        }),
        "test-org",
      );
    });

    it("emits update:open(false) after successful create", async () => {
      vi.mocked(userService.create).mockResolvedValue({
        data: { message: "ok" },
        status: 200,
      });

      wrapper.vm.formData = {
        email: "new@example.com",
        password: "validpass123",
        first_name: "Jane",
        last_name: "Roe",
        role: "admin",
        organization: "test-org",
      };
      wrapper.vm.existingUser = false;
      await nextTick();

      await wrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[updateOpen.length - 1]).toEqual([false]);
    });

    it("updates an existing user successfully", async () => {
      vi.mocked(userService.update).mockResolvedValue({
        data: { message: "User updated successfully" },
        status: 200,
      });

      wrapper.vm.formData = {
        email: "test@example.com",
        first_name: "John Updated",
        last_name: "Doe Updated",
        role: "admin",
        organization: "test-org",
      };
      wrapper.vm.beingUpdated = true;
      await nextTick();

      await wrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      expect(userService.update).toHaveBeenCalled();
    });
  });

  describe("Custom Roles", () => {
    it("filters custom roles based on input", async () => {
      await wrapper.setProps({ ...defaultProps, userRole: "admin" });
      wrapper.vm.existingUser = true;
      await nextTick();

      const filterFn = wrapper.vm.filterFn;
      const updateFn = vi.fn();

      filterFn("role1", updateFn);
      expect(updateFn).toHaveBeenCalled();

      const lastCall = updateFn.mock.calls[updateFn.mock.calls.length - 1];
      const filterCallback = lastCall[0];
      filterCallback();
      expect(wrapper.vm.filterdOption).toContain("role1");
    });

    it("resets custom role options when filter value is empty", async () => {
      const filterFn = wrapper.vm.filterFn;
      const updateFn = vi.fn();

      filterFn("", updateFn);
      expect(updateFn).toHaveBeenCalled();
      const filterCallback = updateFn.mock.calls[0][0];
      filterCallback();
      expect(wrapper.vm.filterdOption).toEqual(["role1", "role2"]);
    });

    it("fetches user roles for existing user in enterprise mode", async () => {
      vi.mocked(userService.getUserRoles).mockResolvedValue({
        data: ["role1"],
      });

      await wrapper.vm.fetchUserRoles("test@example.com");
      await flushPromises();

      expect(userService.getUserRoles).toHaveBeenCalledWith(
        "test-org",
        "test@example.com",
      );
    });
  });

  describe("Password Change", () => {
    it("shows logout confirmation when changing own password", async () => {
      const email = store.state.userInfo.email;

      const passwordWrapper = buildWrapper({
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, email },
      });

      await nextTick();
      await flushPromises();

      passwordWrapper.vm.formData = {
        email,
        change_password: true,
        new_password: "newpassword123",
        old_password: "oldpassword123",
      };
      passwordWrapper.vm.beingUpdated = true;
      passwordWrapper.vm.loggedInUserEmail = email;
      await nextTick();

      vi.mocked(userService.update).mockResolvedValue({
        data: { message: "Password updated" },
        status: 200,
      });

      await passwordWrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      expect(passwordWrapper.vm.logout_confirm).toBe(true);
      passwordWrapper.unmount();
    });

    it("opens the ODialog (v-model:open) once logout_confirm flips true", async () => {
      // Initially closed.
      expect(findDialog(wrapper).props("open")).toBe(false);

      wrapper.vm.logout_confirm = true;
      await nextTick();

      expect(findDialog(wrapper).props("open")).toBe(true);
    });

    it("invokes signout when the ODialog primary button is clicked", async () => {
      const signoutSpy = vi.spyOn(wrapper.vm, "signout");
      wrapper.vm.logout_confirm = true;
      await nextTick();

      await findDialog(wrapper).vm.$emit("click:primary");
      await flushPromises();

      expect(signoutSpy).toHaveBeenCalled();
    });
  });

  describe("Form Validation", () => {
    it("validates required fields", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.beingUpdated = false;
      await nextTick();

      await wrapper.find("form").trigger("submit.prevent");
      expect(userService.create).not.toHaveBeenCalled();
    });

    it("validates organization name format", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.beingUpdated = false;
      wrapper.vm.formData.organization = "other";
      wrapper.vm.formData.other_organization = "123-invalid";
      await nextTick();

      await wrapper.find("form").trigger("submit.prevent");
      expect(wrapper.text()).toContain("Input must start with a letter");
    });

    it("validates password match for change password", async () => {
      const email = store.state.userInfo.email;
      const passwordWrapper = buildWrapper({
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, email },
      });

      passwordWrapper.vm.formData = {
        email,
        change_password: true,
        old_password: "oldpassword123",
        new_password: "short",
      };
      passwordWrapper.vm.beingUpdated = true;
      await nextTick();

      await passwordWrapper.find("form").trigger("submit.prevent");
      expect(userService.update).not.toHaveBeenCalled();
      passwordWrapper.unmount();
    });
  });

  describe("User Role Management", () => {
    it("shows custom role field for admin users", async () => {
      const adminWrapper = buildWrapper({
        userRole: "admin",
        customRoles: ["role1", "role2"],
      });
      adminWrapper.vm.existingUser = true;
      await nextTick();

      const customRoleField = adminWrapper.find(
        '[data-test="user-custom-role-field"]',
      );
      expect(customRoleField.exists()).toBe(true);
      adminWrapper.unmount();
    });

    it("hides custom role field for member users", async () => {
      const memberWrapper = buildWrapper({
        userRole: "member",
        customRoles: ["role1", "role2"],
      });
      memberWrapper.vm.existingUser = true;
      await nextTick();

      const customRoleField = memberWrapper.find(
        '[data-test="user-custom-role-field"]',
      );
      expect(customRoleField.exists()).toBe(false);
      memberWrapper.unmount();
    });
  });

  describe("Enterprise Mode Features", () => {
    it("fetches user roles in enterprise mode", async () => {
      const email = "test@example.com";
      vi.mocked(userService.getUserRoles).mockResolvedValue({
        data: ["role1", "role2"],
      });

      const enterpriseWrapper = buildWrapper({
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, email },
      });

      await flushPromises();

      expect(userService.getUserRoles).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        email,
      );

      enterpriseWrapper.unmount();
    });

    it("handles error in fetching user roles", async () => {
      const email = "test@example.com";

      vi.mocked(userService.getUserRoles).mockRejectedValue({
        message: "Failed to fetch roles",
      });
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const enterpriseWrapper = buildWrapper({
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, email },
      });

      await flushPromises();

      expect(consoleSpy).toHaveBeenCalledWith(
        "Error fetching user roles:",
        expect.any(Object),
      );

      consoleSpy.mockRestore();
      enterpriseWrapper.unmount();
    });
  });

  describe("Password Visibility Toggle", () => {
    it("toggles new password visibility", async () => {
      const localWrapper = buildWrapper({
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, email: "test@example.com" },
      });

      localWrapper.vm.formData.change_password = true;
      await nextTick();

      expect(localWrapper.vm.isNewPwd).toBe(true);
      localWrapper.vm.isNewPwd = false;
      await nextTick();
      expect(localWrapper.vm.isNewPwd).toBe(false);

      localWrapper.unmount();
    });

    it("toggles old password visibility", async () => {
      const localWrapper = buildWrapper({
        isUpdated: true,
        modelValue: {
          ...defaultProps.modelValue,
          email: store.state.userInfo.email,
        },
      });

      localWrapper.vm.formData.change_password = true;
      await nextTick();

      expect(localWrapper.vm.isOldPwd).toBe(true);
      localWrapper.vm.isOldPwd = false;
      await nextTick();
      expect(localWrapper.vm.isOldPwd).toBe(false);

      localWrapper.unmount();
    });

    it("toggles the new-user password visibility (isPwd)", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.beingUpdated = false;
      await nextTick();

      expect(wrapper.vm.isPwd).toBe(true);
      wrapper.vm.isPwd = false;
      await nextTick();
      expect(wrapper.vm.isPwd).toBe(false);
    });
  });

  describe("Form Field Validation", () => {
    it("validates email format correctly", async () => {
      const validEmails = [
        "test@example.com",
        "user.name@domain.co.uk",
        "user+label@example.com",
      ];
      const invalidEmails = [
        "invalid-email",
        "@domain.com",
        "user@",
        "user@domain",
        "user.domain.com",
      ];

      wrapper.vm.existingUser = true;
      await nextTick();

      for (const email of validEmails) {
        wrapper.vm.formData.email = email;
        await nextTick();
        const isValid = await wrapper.vm.$refs.updateUserForm.validate();
        expect(isValid).toBe(true);
      }

      for (const email of invalidEmails) {
        wrapper.vm.formData.email = email;
        await nextTick();
        const isValid = await wrapper.vm.$refs.updateUserForm.validate();
        expect(isValid).toBe(false);
      }
    });

    it("validates password requirements", async () => {
      wrapper.vm.existingUser = false;
      await nextTick();

      wrapper.vm.formData.password = "";
      await nextTick();
      let isValid = await wrapper.vm.$refs.updateUserForm.validate();
      expect(isValid).toBe(false);

      wrapper.vm.formData.password = "short";
      await nextTick();
      isValid = await wrapper.vm.$refs.updateUserForm.validate();
      expect(isValid).toBe(false);

      wrapper.vm.formData.password = "validpassword123";
      await nextTick();
      isValid = await wrapper.vm.$refs.updateUserForm.validate();
      expect(isValid).toBe(true);
    });
  });

  describe("Organization Handling", () => {
    it("initializes with selected organization", () => {
      expect(wrapper.vm.formData.organization).toBe(
        store.state.selectedOrganization.identifier,
      );
    });

    it("updates organization options when store changes", async () => {
      const newOrgs = [
        { name: "New Org", identifier: "new-org" },
        { name: "Another New Org", identifier: "another-new-org" },
      ];

      store.state.organizations = newOrgs;
      await nextTick();

      expect(wrapper.vm.organizationOptions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ value: "new-org" }),
          expect.objectContaining({ value: "another-new-org" }),
        ]),
      );
    });
  });

  describe("Component State Management", () => {
    it("handles password toggle state", async () => {
      const localWrapper = buildWrapper({
        isUpdated: true,
        modelValue: { ...defaultProps.modelValue, email: "test@example.com" },
      });

      expect(localWrapper.vm.formData.change_password).toBe(false);
      expect(localWrapper.vm.formData.new_password).toBe("");
      expect(localWrapper.vm.formData.old_password).toBe("");

      localWrapper.vm.formData.change_password = true;
      localWrapper.vm.formData.new_password = "testpassword";
      localWrapper.vm.formData.old_password = "oldpassword";
      await nextTick();

      expect(localWrapper.vm.formData.new_password).toBe("testpassword");
      expect(localWrapper.vm.formData.old_password).toBe("oldpassword");

      localWrapper.unmount();
    });

    it("maintains form state during validation errors", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.formData = {
        email: "test@example.com",
        first_name: "John",
        last_name: "Doe",
        password: "short",
      };
      await nextTick();

      await wrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      expect(wrapper.vm.formData.email).toBe("test@example.com");
      expect(wrapper.vm.formData.first_name).toBe("John");
      expect(wrapper.vm.formData.last_name).toBe("Doe");
    });
  });

  describe("UI Interactions", () => {
    it("emits update:open(false) when the cancel OButton is clicked", async () => {
      const cancelButton = wrapper.find('[data-test="cancel-user-button"]');
      expect(cancelButton.exists()).toBe(true);
      await cancelButton.trigger("click");

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[updateOpen.length - 1]).toEqual([false]);
    });

    it("emits update:open(false) when ODrawer requests close", async () => {
      await findDrawer(wrapper).vm.$emit("update:open", false);

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen).toBeTruthy();
      expect(updateOpen?.[0]).toEqual([false]);
    });

    it("shows/hides fields based on user type", async () => {
      wrapper.vm.existingUser = true;
      wrapper.vm.beingUpdated = false;
      await nextTick();

      expect(wrapper.find('[data-test="user-email-field"]').exists()).toBe(
        true,
      );
      expect(
        wrapper.find('[data-test="user-password-field"]').exists(),
      ).toBe(false);

      wrapper.vm.existingUser = false;
      await nextTick();

      expect(wrapper.find('[data-test="user-email-field"]').exists()).toBe(
        false,
      );
      expect(
        wrapper.find('[data-test="user-password-field"]').exists(),
      ).toBe(true);
    });
  });

  describe("Form Validation and Submission", () => {
    it("validates and submits new user form successfully", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.formData = {
        email: "newuser@example.com",
        password: "validPassword123",
        first_name: "John",
        last_name: "Doe",
        role: "admin",
        organization: store.state.selectedOrganization.identifier,
      };

      vi.mocked(userService.create).mockResolvedValue({
        data: { message: "User created successfully" },
        status: 200,
      });

      await nextTick();
      await wrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      expect(userService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "newuser@example.com",
          password: "validPassword123",
          first_name: "John",
          last_name: "Doe",
          role: "admin",
        }),
        store.state.selectedOrganization.identifier,
      );
    });

    it("validates password requirements for new user", async () => {
      wrapper.vm.existingUser = false;
      wrapper.vm.formData = {
        email: "newuser@example.com",
        password: "short",
        first_name: "John",
        last_name: "Doe",
        role: "admin",
        organization: store.state.selectedOrganization.identifier,
      };

      await nextTick();
      await wrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      expect(userService.create).not.toHaveBeenCalled();
    });
  });

  describe("Password Change Functionality", () => {
    it("validates old and new password fields when changing password", async () => {
      wrapper.vm.formData = {
        email: "user@example.com",
        change_password: true,
        old_password: "",
        new_password: "short",
        first_name: "John",
        last_name: "Doe",
        role: "admin",
        organization: store.state.selectedOrganization.identifier,
      };
      wrapper.vm.beingUpdated = true;

      await nextTick();
      await wrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      expect(userService.update).not.toHaveBeenCalled();
    });
  });

  describe("Organization Selection", () => {
    it("handles custom organization name input", async () => {
      wrapper.vm.formData = {
        email: "user@example.com",
        password: "validPass123",
        first_name: "John",
        last_name: "Doe",
        role: "admin",
        organization: "other",
        other_organization: "custom-org",
      };
      wrapper.vm.existingUser = false;

      const dismissMock = vi.fn();
      wrapper.vm.$q.notify = vi.fn().mockReturnValue(dismissMock);

      vi.mocked(userService.create).mockResolvedValue({
        data: { message: "User created successfully" },
      });

      await nextTick();
      await wrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      expect(userService.create).toHaveBeenCalledWith(
        {
          email: "user@example.com",
          password: "validPass123",
          first_name: "John",
          last_name: "Doe",
          role: "admin",
          organization: "other",
          other_organization: "custom-org",
        },
        "custom-org",
      );
    });

    it("validates custom organization name format", async () => {
      wrapper.vm.formData = {
        email: "user@example.com",
        password: "validPass123",
        first_name: "John",
        last_name: "Doe",
        role: "admin",
        organization: "other",
        other_organization: "123-invalid",
      };
      wrapper.vm.existingUser = false;

      await nextTick();
      await wrapper.find("form").trigger("submit.prevent");
      await flushPromises();

      expect(userService.create).not.toHaveBeenCalled();
    });
  });

  describe("Role Management", () => {
    it("fetches and displays custom roles for admin users", async () => {
      const email = "test@example.com";
      const roles = ["role1", "role2"];

      vi.mocked(userService.getUserRoles).mockResolvedValue({
        data: roles,
      });

      wrapper.vm.existingUser = true;
      wrapper.vm.formData.email = email;
      await wrapper.vm.fetchUserRoles(email);
      await flushPromises();

      expect(userService.getUserRoles).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        email,
      );
      expect(wrapper.vm.filterdOption).toEqual(roles);
    });
  });
});
