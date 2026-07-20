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
//
// AddUser is migrated to OForm + Zod (AddUser.schema.ts): every bare control
// inside <OForm> is now an OForm* field, the conditional superRefine schema (+
// defaults) is returned from setup() (Options-API), and the BEFORE rules
// (email validity, role required, password min-8/strong, other_organization
// regex) are restored. These tests mount the REAL <OForm> and assert behavior:
// the schema gates the submit (no service call when invalid), and each restored
// rule blocks an invalid value.

import { mount, flushPromises, VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddUser from "@/components/iam/users/AddUser.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/aws-exports", () => ({
  default: {
    isCloud: "false",
    isEnterprise: "false",
  },
}));

vi.mock("@/services/users", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
    updateexistinguser: vi.fn(),
    getUserRoles: vi.fn(() => Promise.resolve({ data: [] })),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn(),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

// Keep the real zincutils, but stub the logout side-effects so signout() is testable.
vi.mock("@/utils/zincutils", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useLocalCurrentUser: vi.fn(),
    useLocalUserInfo: vi.fn(),
    invalidateLoginData: vi.fn(),
  };
});

import userServiece from "@/services/users";
import { invalidateLoginData } from "@/utils/zincutils";
import config from "@/aws-exports";

// ODialog stub: renders the default slot so the REAL OForm mounts. (The second
// ODialog — the logout confirm — is also covered by this stub.)
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "formId",
    "persistent",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div data-test-stub="o-dialog" :data-open="open" :data-title="title" :data-form-id="formId">
      <slot />
      <button
        v-if="secondaryButtonLabel"
        data-test="o-dialog-secondary-btn"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
    </div>
  `,
  inheritAttrs: false,
};

const ADMIN_EMAIL = "admin@example.com";

function mountComp(props: Record<string, any> = {}) {
  // Ensure the logged-in user is an admin distinct from the user being edited so
  // the role select is shown in add-existing mode.
  store.state.userInfo = { ...store.state.userInfo, email: ADMIN_EMAIL };
  // The component reads store.state.organizations in onBeforeMount; ensure it's
  // an array in the test store.
  store.state.organizations = store.state.organizations ?? [];
  return mount(AddUser, {
    global: {
      plugins: [store, i18n],
      stubs: { ODialog: ODialogStub },
    },
    props: {
      open: true,
      modelValue: {},
      isUpdated: false,
      userRole: "admin",
      roles: [{ label: "Admin", value: "admin" }],
      customRoles: [],
      isCloud: false,
      ...props,
    },
  });
}

// The add-user OForm is the first OForm in the tree.
const getForm = (wrapper: VueWrapper<any>) =>
  wrapper.findComponent({ name: "OForm" });
const setField = (wrapper: VueWrapper<any>, name: string, value: unknown) =>
  getForm(wrapper).vm.form.setFieldValue(name, value);
const submitForm = async (wrapper: VueWrapper<any>) => {
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
  // Let any in-flight onDynamicAsync validation (scheduled on a macrotask by
  // TanStack's async validator plumbing) land before assertions — otherwise a
  // stale run can overwrite form.state.errors after the submit settles.
  await new Promise((r) => setTimeout(r, 0));
  await flushPromises();
};

describe("AddUser", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    try {
      wrapper?.unmount();
    } catch {
      // teleported components can throw during unmount in jsdom
    }
  });

  describe("rendering & wiring", () => {
    it("renders the OForm wired to the dialog via form-id", () => {
      wrapper = mountComp();
      expect(getForm(wrapper).exists()).toBe(true);
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-form-id"),
      ).toBe("add-user-form");
    });

    it("passes the owner-created form to OForm (Rule ③ OWNER wiring)", () => {
      // OWNER pattern: the schema is baked into the useOForm form and handed to
      // <OForm :form>, so there is no :schema prop — the form must be defined,
      // and the schema-gating tests below prove the validators actually run.
      wrapper = mountComp();
      expect(getForm(wrapper).props("form")).toBeDefined();
    });

    it("shows the email field in add-existing mode", () => {
      wrapper = mountComp();
      expect(wrapper.find('[data-test="user-email-field"]').exists()).toBe(true);
    });

    it("preserves field data-tests for the role select", () => {
      wrapper = mountComp();
      expect(wrapper.find('[data-test="user-role-field"]').exists()).toBe(true);
    });

    it("reflects the open prop on the dialog", async () => {
      wrapper = mountComp();
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-open"),
      ).toBe("true");
      await wrapper.setProps({ open: false });
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-open"),
      ).toBe("false");
    });

    it("shows the add title in add mode and a different edit title in edit mode", async () => {
      wrapper = mountComp(); // add mode (empty modelValue)
      const addTitle = wrapper
        .find('[data-test-stub="o-dialog"]')
        .attributes("data-title");
      expect(addTitle).toBeTruthy();

      const w = mountComp({
        modelValue: { email: "x@y.com", first_name: "X", org_member_id: "1" },
      });
      await flushPromises();
      const editTitle = w
        .find('[data-test-stub="o-dialog"]')
        .attributes("data-title");
      expect(editTitle).toBeTruthy();
      expect(editTitle).not.toBe(addTitle);
      w.unmount();
    });

    it("filterFn filters custom roles by the typed value", () => {
      wrapper = mountComp({
        customRoles: ["admin-role", "editor-role", "viewer"],
      });
      // update() runs its callback synchronously (the filter contract).
      wrapper.vm.filterFn("edit", (fn: () => void) => fn());
      expect(wrapper.vm.filterdOption).toEqual(["editor-role"]);

      wrapper.vm.filterFn("", (fn: () => void) => fn());
      expect(wrapper.vm.filterdOption).toEqual([
        "admin-role",
        "editor-role",
        "viewer",
      ]);
    });
  });

  describe("add-existing user — schema gating (restored email + role rules)", () => {
    it("blocks submit and does NOT call the service when email is empty", async () => {
      wrapper = mountComp();
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(userServiece.updateexistinguser).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Please enter a valid email address.");
    });

    it("blocks submit when the email format is invalid (restored email validity)", async () => {
      wrapper = mountComp();
      setField(wrapper, "email", "not-an-email");
      setField(wrapper, "role", "admin");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(userServiece.updateexistinguser).not.toHaveBeenCalled();
    });

    it("blocks submit when the role is empty (restored role-required)", async () => {
      wrapper = mountComp();
      setField(wrapper, "email", "newuser@example.com");
      setField(wrapper, "role", "");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(userServiece.updateexistinguser).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Field is required");
    });

    it("submits and calls updateexistinguser when email + role are valid", async () => {
      vi.mocked(userServiece.updateexistinguser).mockResolvedValue({
        data: {},
      } as any);
      wrapper = mountComp();
      setField(wrapper, "email", "newuser@example.com");
      setField(wrapper, "role", "admin");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(userServiece.updateexistinguser).toHaveBeenCalledTimes(1);
      expect(wrapper.emitted("updated")).toBeTruthy();
    });

    it("emits update:open(false) after a successful save", async () => {
      vi.mocked(userServiece.updateexistinguser).mockResolvedValue({
        data: {},
      } as any);
      wrapper = mountComp();
      setField(wrapper, "email", "newuser@example.com");
      setField(wrapper, "role", "admin");
      await submitForm(wrapper);

      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen[updateOpen.length - 1]).toEqual([false]);
    });

    it("switches to create-new mode on a 422 and then enforces the password policy", async () => {
      vi.mocked(userServiece.updateexistinguser).mockRejectedValue({
        response: { data: { code: 422 } },
      });
      wrapper = mountComp();
      setField(wrapper, "email", "brandnew@example.com");
      setField(wrapper, "role", "admin");
      await submitForm(wrapper);

      // existingUser flipped → create-new mode; password field now shown.
      expect(wrapper.vm.existingUser).toBe(false);
      await flushPromises();
      expect(wrapper.find('[data-test="user-password-field"]').exists()).toBe(true);

      // An empty / weak password is now blocked by the schema (restored policy).
      await submitForm(wrapper);
      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(userServiece.create).not.toHaveBeenCalled();
    });
  });

  describe("create-new user — restored password policy", () => {
    // Force create-new mode directly.
    const mountAddNew = () => {
      const w = mountComp();
      w.vm.existingUser = false;
      return w;
    };

    it("blocks submit for a weak password and accepts a strong one", async () => {
      vi.mocked(userServiece.create).mockResolvedValue({ data: {} } as any);
      wrapper = mountAddNew();
      await flushPromises();

      // Weak (too short, no complexity) → blocked.
      setField(wrapper, "password", "short");
      await submitForm(wrapper);
      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(userServiece.create).not.toHaveBeenCalled();

      // Strong (≥8, lower+upper+digit+special) → passes.
      setField(wrapper, "password", "Str0ng!Pass");
      await submitForm(wrapper);
      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(userServiece.create).toHaveBeenCalledTimes(1);
    });
  });

  // The migrated schema seeds `custom_role: []` for every mode, but the wire
  // payload must match pre-migration BYTE-FOR-BYTE: `custom_role` was present
  // only when actually POPULATED (hydrated on edit, or user-selected) — an
  // untouched field was `undefined` and JSON-omitted. See `includeCustomRole`.
  describe("custom_role payload — exact pre-migration parity", () => {
    // ── OSS: the field is Enterprise/Cloud-only, so it is NEVER on the wire. ──
    it("OSS create: omits custom_role", async () => {
      vi.mocked(userServiece.create).mockResolvedValue({ data: {} } as any);
      wrapper = mountComp();
      wrapper.vm.existingUser = false; // force create-new mode
      await flushPromises();
      setField(wrapper, "password", "Str0ng!Pass");
      await submitForm(wrapper);

      expect(userServiece.create).toHaveBeenCalledTimes(1);
      const payload = vi.mocked(userServiece.create).mock.calls[0][0];
      expect(payload).not.toHaveProperty("custom_role");
    });

    it("OSS add-existing: omits custom_role (body is just { role })", async () => {
      vi.mocked(userServiece.updateexistinguser).mockResolvedValue({
        data: {},
      } as any);
      wrapper = mountComp();
      setField(wrapper, "email", "newuser@example.com");
      setField(wrapper, "role", "admin");
      await submitForm(wrapper);

      expect(userServiece.updateexistinguser).toHaveBeenCalledTimes(1);
      const body = vi.mocked(userServiece.updateexistinguser).mock.calls[0][0];
      expect(body).toEqual({ role: "admin" });
    });

    // ── Enterprise/Cloud: present only when populated, exactly as before. ──
    describe("Enterprise/Cloud", () => {
      beforeEach(() => {
        config.isEnterprise = "true";
      });
      afterEach(() => {
        config.isEnterprise = "false";
      });

      it("create-new: omits custom_role (the select is hidden in create mode)", async () => {
        vi.mocked(userServiece.create).mockResolvedValue({ data: {} } as any);
        wrapper = mountComp();
        wrapper.vm.existingUser = false;
        await flushPromises();
        setField(wrapper, "password", "Str0ng!Pass");
        await submitForm(wrapper);

        const payload = vi.mocked(userServiece.create).mock.calls[0][0];
        expect(payload).not.toHaveProperty("custom_role");
      });

      it("add-existing WITHOUT a selection: omits custom_role (untouched ⇒ omit)", async () => {
        vi.mocked(userServiece.updateexistinguser).mockResolvedValue({
          data: {},
        } as any);
        wrapper = mountComp();
        setField(wrapper, "email", "newuser@example.com");
        setField(wrapper, "role", "admin");
        await submitForm(wrapper);

        const body = vi.mocked(userServiece.updateexistinguser).mock.calls[0][0];
        expect(body).toEqual({ role: "admin" });
      });

      it("add-existing WITH a selection: sends the selected custom_role", async () => {
        vi.mocked(userServiece.updateexistinguser).mockResolvedValue({
          data: {},
        } as any);
        wrapper = mountComp();
        setField(wrapper, "email", "newuser@example.com");
        setField(wrapper, "role", "admin");
        setField(wrapper, "custom_role", ["custom-a"]);
        await submitForm(wrapper);

        const body = vi.mocked(userServiece.updateexistinguser).mock.calls[0][0];
        expect(body).toEqual({ role: "admin", custom_role: ["custom-a"] });
      });

      it("edit: sends the hydrated custom_role (even an empty array)", async () => {
        vi.mocked(userServiece.getUserRoles).mockResolvedValue({
          data: [],
        } as any);
        vi.mocked(userServiece.update).mockResolvedValue({ data: {} } as any);
        wrapper = mountComp({
          modelValue: {
            email: "other@example.com",
            first_name: "Other",
            org_member_id: "2",
          },
        });
        await flushPromises(); // let getUserRoles hydrate the field
        await submitForm(wrapper);

        expect(userServiece.update).toHaveBeenCalledTimes(1);
        const payload = vi.mocked(userServiece.update).mock.calls[0][0];
        expect(payload).toHaveProperty("custom_role");
        expect(payload.custom_role).toEqual([]);
      });
    });

    // ── Cloud parity: `supportsCustomRole` = isEnterprise || isCloud, so the
    // isCloud branch of the gate must behave identically to Enterprise. This
    // block toggles config.isCloud (not isEnterprise) to prove that path. ──
    describe("Cloud (config.isCloud = 'true')", () => {
      beforeEach(() => {
        config.isCloud = "true";
      });
      afterEach(() => {
        config.isCloud = "false";
      });

      it("create-new: omits custom_role (the select is hidden in create mode)", async () => {
        vi.mocked(userServiece.create).mockResolvedValue({ data: {} } as any);
        wrapper = mountComp();
        wrapper.vm.existingUser = false;
        await flushPromises();
        setField(wrapper, "password", "Str0ng!Pass");
        await submitForm(wrapper);

        expect(userServiece.create).toHaveBeenCalledTimes(1);
        const payload = vi.mocked(userServiece.create).mock.calls[0][0];
        expect(payload).not.toHaveProperty("custom_role");
      });

      it("add-existing WITHOUT a selection: omits custom_role (untouched ⇒ omit)", async () => {
        vi.mocked(userServiece.updateexistinguser).mockResolvedValue({
          data: {},
        } as any);
        wrapper = mountComp();
        setField(wrapper, "email", "newuser@example.com");
        setField(wrapper, "role", "admin");
        await submitForm(wrapper);

        const body = vi.mocked(userServiece.updateexistinguser).mock.calls[0][0];
        expect(body).toEqual({ role: "admin" });
      });

      it("add-existing WITH a selection: sends the selected custom_role", async () => {
        vi.mocked(userServiece.updateexistinguser).mockResolvedValue({
          data: {},
        } as any);
        wrapper = mountComp();
        setField(wrapper, "email", "newuser@example.com");
        setField(wrapper, "role", "admin");
        setField(wrapper, "custom_role", ["custom-a"]);
        await submitForm(wrapper);

        const body = vi.mocked(userServiece.updateexistinguser).mock.calls[0][0];
        expect(body).toEqual({ role: "admin", custom_role: ["custom-a"] });
      });

      it("edit: sends the hydrated custom_role (even an empty array)", async () => {
        vi.mocked(userServiece.getUserRoles).mockResolvedValue({
          data: [],
        } as any);
        vi.mocked(userServiece.update).mockResolvedValue({ data: {} } as any);
        wrapper = mountComp({
          modelValue: {
            email: "other@example.com",
            first_name: "Other",
            org_member_id: "2",
          },
        });
        await flushPromises(); // let getUserRoles hydrate the field
        await submitForm(wrapper);

        expect(userServiece.update).toHaveBeenCalledTimes(1);
        const payload = vi.mocked(userServiece.update).mock.calls[0][0];
        expect(payload).toHaveProperty("custom_role");
        expect(payload.custom_role).toEqual([]);
      });
    });
  });

  describe("edit user — restored password rules on change_password", () => {
    const mountEditSelf = () =>
      mountComp({
        modelValue: {
          email: ADMIN_EMAIL,
          first_name: "Admin",
          org_member_id: "1",
        },
      });

    it("requires old (required-only) + new (strong) passwords when changing own password", async () => {
      wrapper = mountEditSelf();
      await flushPromises();
      expect(wrapper.vm.beingUpdated).toBe(true);

      // Turn on change_password, leave passwords empty → blocked (both required).
      setField(wrapper, "change_password", true);
      await submitForm(wrapper);
      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(userServiece.update).not.toHaveBeenCalled();

      // A weak NEW password is rejected (new keeps the strong policy) — the short
      // old password here is NOT the reason it's blocked.
      setField(wrapper, "old_password", "short");
      setField(wrapper, "new_password", "weak");
      await submitForm(wrapper);
      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(userServiece.update).not.toHaveBeenCalled();

      // A SHORT (<8) old password is accepted — old_password is required-only and
      // never length/strength-checked (it predates the strong policy). Short old +
      // strong new → passes.
      vi.mocked(userServiece.update).mockResolvedValue({ data: {} } as any);
      setField(wrapper, "new_password", "Str0ng!Pass");
      await submitForm(wrapper);
      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
    });

    it("submits a plain role update (no password change) without password rules", async () => {
      vi.mocked(userServiece.update).mockResolvedValue({ data: {} } as any);
      wrapper = mountComp({
        modelValue: {
          email: "other@example.com",
          first_name: "Other",
          role: "admin",
          org_member_id: "2",
        },
      });
      await flushPromises();

      await submitForm(wrapper);
      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(userServiece.update).toHaveBeenCalledTimes(1);
    });
  });

  // The `organization === 'other'` path: a root user assigning the new user to a
  // brand-new org typed into `other_organization`. The submitted org identifier is
  // encodeURIComponent(other_organization), and the value must pass otherOrgRegex
  // (start with a letter). The old spec covered both cases; the migrated spec only
  // referenced it in a comment — restored here.
  describe("other_organization submit path (root → 'other' org)", () => {
    const mountOtherOrg = () => {
      const w = mountComp({ userRole: "root" });
      w.vm.existingUser = false; // create-new mode → password shown + required
      w.vm.organization = "other"; // root selected the "Other" org
      return w;
    };

    it("blocks submit when other_organization fails the regex (must start with a letter)", async () => {
      wrapper = mountOtherOrg();
      await flushPromises();
      setField(wrapper, "password", "Str0ng!Pass");
      setField(wrapper, "other_organization", "123-invalid"); // starts with a digit
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(userServiece.create).not.toHaveBeenCalled();
    });

    it("submits with the encoded other_organization as the target org identifier", async () => {
      vi.mocked(userServiece.create).mockResolvedValue({ data: {} } as any);
      wrapper = mountOtherOrg();
      await flushPromises();
      setField(wrapper, "password", "Str0ng!Pass");
      setField(wrapper, "other_organization", "custom-org");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(userServiece.create).toHaveBeenCalledTimes(1);
      // organization === 'other' → encodeURIComponent(other_organization) is both
      // the payload.organization and the org identifier passed to the service.
      const payload = vi.mocked(userServiece.create).mock.calls[0][0];
      const orgArg = vi.mocked(userServiece.create).mock.calls[0][1];
      expect(orgArg).toBe("custom-org");
      expect(payload.organization).toBe("custom-org");
    });
  });

  describe("dialog interactions", () => {
    it("emits update:open(false) when cancel is clicked", async () => {
      wrapper = mountComp();
      await wrapper.find('[data-test="o-dialog-secondary-btn"]').trigger("click");
      const emitted = wrapper.emitted("update:open");
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });
  });

  // Changing YOUR OWN password logs you out: the update succeeds, then a logout
  // confirmation dialog is shown (logout_confirm) instead of the normal close,
  // and confirming it runs signout().
  describe("own-password change → logout flow", () => {
    it("shows the logout confirmation when changing your OWN password", async () => {
      vi.mocked(userServiece.update).mockResolvedValue({ data: {} } as any);
      wrapper = mountComp({
        modelValue: {
          email: ADMIN_EMAIL, // self
          first_name: "Admin",
          org_member_id: "1",
        },
      });
      await flushPromises();

      setField(wrapper, "change_password", true);
      setField(wrapper, "old_password", "longenough8");
      setField(wrapper, "new_password", "Str0ng!Pass");
      // The single form is the source of truth — onSubmit reads the validated
      // `value`, so setFieldValue alone drives change_password (no formData mirror).
      await submitForm(wrapper);

      expect(userServiece.update).toHaveBeenCalledTimes(1);
      expect(wrapper.vm.logout_confirm).toBe(true);
      // The logout dialog takes over — the normal close is NOT emitted.
      expect(wrapper.emitted("update:open")).toBeFalsy();
    });

    it("does NOT show logout confirmation when changing ANOTHER user's password", async () => {
      vi.mocked(userServiece.update).mockResolvedValue({ data: {} } as any);
      wrapper = mountComp({
        modelValue: {
          email: "other@example.com", // not self
          first_name: "Other",
          org_member_id: "2",
        },
      });
      await flushPromises();

      setField(wrapper, "change_password", true);
      // Admin editing another user → old password isn't required; new is strong.
      setField(wrapper, "new_password", "Str0ng!Pass");
      await submitForm(wrapper);

      expect(userServiece.update).toHaveBeenCalledTimes(1);
      expect(wrapper.vm.logout_confirm).toBe(false);
      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen[updateOpen.length - 1]).toEqual([false]);
    });

    it("signout() clears auth state and redirects to /logout", () => {
      store.state.userInfo = { ...store.state.userInfo, email: ADMIN_EMAIL };
      store.state.organizations = [];
      const dispatchSpy = vi
        .spyOn(store, "dispatch")
        .mockReturnValue(undefined as any);
      const push = vi.fn();
      const w = mount(AddUser, {
        global: {
          plugins: [store, i18n],
          stubs: { ODialog: ODialogStub },
          mocks: { $router: { push } },
        },
        props: {
          open: true,
          modelValue: {},
          isUpdated: false,
          userRole: "admin",
          roles: [{ label: "Admin", value: "admin" }],
          customRoles: [],
          isCloud: false,
        },
      });

      w.vm.signout();

      expect(invalidateLoginData).toHaveBeenCalled();
      expect(dispatchSpy).toHaveBeenCalledWith("logout");
      expect(push).toHaveBeenCalledWith("/logout");

      w.unmount();
      dispatchSpy.mockRestore();
    });
  });

  // The aws-exports mock is a shared singleton, so flip its flag for this block
  // (and restore it) to exercise the enterprise-only branches: custom-role fetch
  // + the custom_role select.
  describe("enterprise mode (config.isEnterprise = 'true')", () => {
    beforeEach(() => {
      config.isEnterprise = "true";
    });
    afterEach(() => {
      config.isEnterprise = "false";
    });

    it("fetches user roles for an existing user in enterprise mode", async () => {
      vi.mocked(userServiece.getUserRoles).mockResolvedValue({
        data: ["custom-a"],
      } as any);
      wrapper = mountComp({
        modelValue: {
          email: "other@example.com",
          first_name: "Other",
          org_member_id: "2",
        },
      });
      await flushPromises();

      expect(userServiece.getUserRoles).toHaveBeenCalledWith(
        store.state.selectedOrganization.identifier,
        "other@example.com",
      );
    });

    it("shows the custom_role field in enterprise mode", async () => {
      wrapper = mountComp({
        modelValue: {
          email: "other@example.com",
          first_name: "Other",
          org_member_id: "2",
        },
      });
      await flushPromises();

      expect(
        wrapper.find('[data-test="user-custom-role-field"]').exists(),
      ).toBe(true);
    });
  });
});
