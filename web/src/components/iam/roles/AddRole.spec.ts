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
// AddRole is migrated to OForm + Zod (AddRole.schema.ts). These tests mount the
// REAL <OForm> (only ODialog is stubbed) so the schema actually gates the submit.
// They assert behavior (validation + service call + emits), not removed internals
// (showNameError / isValidRoleName / nameErrorMessage / the disabled gate).

import { mount, flushPromises } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddRole from "@/components/iam/roles/AddRole.vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/iam", () => ({
  createRole: vi.fn(),
  updateRole: vi.fn(),
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

const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "size",
    "title",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "formId",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div data-test-stub="o-dialog" :data-open="open" :data-title="title" :data-form-id="formId">
      <div data-test-stub="o-dialog-body"><slot /></div>
      <div data-test-stub="o-dialog-footer">
        <slot name="footer" />
        <button
          v-if="secondaryButtonLabel"
          data-test="o-dialog-secondary-btn"
          @click="$emit('click:secondary')"
        >{{ secondaryButtonLabel }}</button>
        <button
          v-if="primaryButtonLabel"
          data-test="o-dialog-primary-btn"
          @click="$emit('click:primary')"
        >{{ primaryButtonLabel }}</button>
      </div>
    </div>
  `,
  inheritAttrs: false,
};

function mountComp(props: Record<string, any> = {}) {
  return mount(AddRole, {
    global: {
      plugins: [store, i18n],
      stubs: { ODialog: ODialogStub },
    },
    props: {
      open: true,
      role: null,
      org_identifier: "test-org",
      ...props,
    },
  });
}

const getForm = (wrapper: any) => wrapper.findComponent({ name: "OForm" });
const getNameInput = (wrapper: any) =>
  wrapper.find('[data-test="add-role-rolename-input-btn"] input');

const submitForm = async (wrapper: any) => {
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
};

describe("AddRole", () => {
  let wrapper: any;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mountComp();
  });

  afterEach(() => {
    try {
      wrapper?.unmount();
    } catch {
      // teleported components can throw during unmount in jsdom
    }
  });

  describe("rendering", () => {
    it("renders the dialog and role name input", () => {
      expect(wrapper.exists()).toBe(true);
      expect(wrapper.find('[data-test="add-role-section"]').exists()).toBe(true);
      expect(getNameInput(wrapper).exists()).toBe(true);
    });

    it("wires the OForm to the dialog via form-id", () => {
      expect(getForm(wrapper).exists()).toBe(true);
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-form-id"),
      ).toBe("add-role-form");
    });

    it("passes a Zod schema to OForm", () => {
      expect(getForm(wrapper).props("schema")).toBeDefined();
    });

    it("seeds blank default-values in create mode", () => {
      expect(getForm(wrapper).props("defaultValues")).toEqual({
        name: "",
        startFrom: "custom",
      });
    });

    it("seeds the role name when a role prop is provided", () => {
      const w = mountComp({ role: { name: "existing_role" } });
      expect(getForm(w).props("defaultValues")).toEqual({
        name: "existing_role",
        startFrom: "custom",
      });
      w.unmount();
    });

    it("preserves the maxlength attribute on the input", () => {
      expect(getNameInput(wrapper).attributes("maxlength")).toBe("100");
    });

    it("shows the start-from presets", () => {
      expect(
        wrapper.find('[data-test="add-role-start-from-section"]').exists(),
      ).toBe(true);
    });

    it("keeps Save enabled (R3 — no disabled gate)", () => {
      const saveBtn = wrapper.find('[data-test="o-dialog-primary-btn"]');
      expect(saveBtn.attributes("disabled")).toBeUndefined();
    });

    it("renders the dialog title", () => {
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-title"),
      ).toBeTruthy();
    });

    it("reflects the open prop on the dialog and defaults it to false", async () => {
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-open"),
      ).toBe("true");
      await wrapper.setProps({ open: false });
      expect(
        wrapper.find('[data-test-stub="o-dialog"]').attributes("data-open"),
      ).toBe("false");

      const w = mount(AddRole, {
        global: { plugins: [store, i18n], stubs: { ODialog: ODialogStub } },
      });
      expect(w.props("open")).toBe(false);
      w.unmount();
    });
  });

  describe("schema validation (real OForm)", () => {
    it("does not validate before the first submit", async () => {
      await getNameInput(wrapper).setValue("invalid name");
      await flushPromises();
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it("blocks submit and does NOT call createRole when name is empty", async () => {
      const { createRole } = await import("@/services/iam");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(createRole).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Role name is required.");
    });

    it("blocks submit for a name with invalid characters (restored regex rule)", async () => {
      const { createRole } = await import("@/services/iam");
      await getNameInput(wrapper).setValue("invalid role!");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(createRole).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain(
        "Use letters, numbers and underscores only, without spaces.",
      );
    });

    it("submits and calls createRole once when the name is valid", async () => {
      const { createRole } = await import("@/services/iam");
      vi.mocked(createRole).mockResolvedValue({ data: {} } as any);

      await getNameInput(wrapper).setValue("test_role");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(createRole).toHaveBeenCalledTimes(1);
      expect(createRole).toHaveBeenCalledWith(
        "test_role",
        store.state.selectedOrganization.identifier,
      );
    });

    it("trims the submitted name", async () => {
      const { createRole } = await import("@/services/iam");
      vi.mocked(createRole).mockResolvedValue({ data: {} } as any);

      await getNameInput(wrapper).setValue("  test_role  ");
      await submitForm(wrapper);

      expect(createRole).toHaveBeenCalledWith(
        "test_role",
        store.state.selectedOrganization.identifier,
      );
    });

    it("blocks submit when the name exceeds 100 characters (restored max rule)", async () => {
      const { createRole } = await import("@/services/iam");
      // maxlength caps typing, so set the value directly to exercise the schema.
      getForm(wrapper).vm.form.setFieldValue("name", "a".repeat(101));
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(createRole).not.toHaveBeenCalled();
    });
  });

  describe("role creation behavior", () => {
    it("emits update:open(false) + added:role and shows success toast on success", async () => {
      const { createRole } = await import("@/services/iam");
      vi.mocked(createRole).mockResolvedValue({ data: {} } as any);

      await getNameInput(wrapper).setValue("test_role");
      await submitForm(wrapper);

      expect(wrapper.emitted("added:role")).toBeTruthy();
      const updateOpen = wrapper.emitted("update:open");
      expect(updateOpen[updateOpen.length - 1]).toEqual([false]);
      expect(mockToast).toHaveBeenCalledWith({
        message: 'Role "test_role" Created Successfully!',
        variant: "success",
      });
    });

    it("shows an error toast on a non-403 failure and does not emit added:role", async () => {
      const { createRole } = await import("@/services/iam");
      vi.mocked(createRole).mockRejectedValue({
        response: { status: 400, data: { message: "Role exists" } },
      });

      await getNameInput(wrapper).setValue("test_role");
      await submitForm(wrapper);

      expect(mockToast).toHaveBeenCalledWith({
        message: "Role exists",
        variant: "error",
      });
      expect(wrapper.emitted("added:role")).toBeFalsy();
    });

    it("does not show an error toast for a 403 failure", async () => {
      const { createRole } = await import("@/services/iam");
      vi.mocked(createRole).mockRejectedValue({ response: { status: 403 } });

      await getNameInput(wrapper).setValue("test_role");
      await submitForm(wrapper);

      expect(mockToast).not.toHaveBeenCalled();
    });

    it("retains the entered name after a failed save (form not reset on error)", async () => {
      const { createRole } = await import("@/services/iam");
      vi.mocked(createRole).mockRejectedValue({
        response: { status: 500, data: { message: "x" } },
      });

      await getNameInput(wrapper).setValue("keep_me");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.values.name).toBe("keep_me");
      expect(wrapper.emitted("added:role")).toBeFalsy();
    });
  });

  describe("dialog interactions", () => {
    it("emits update:open(false) when cancel is clicked", async () => {
      await wrapper.find('[data-test="o-dialog-secondary-btn"]').trigger("click");
      const emitted = wrapper.emitted("update:open");
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });

    it("re-emits update:open from the dialog's update:open event", async () => {
      await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);
      const emitted = wrapper.emitted("update:open");
      expect(emitted[emitted.length - 1]).toEqual([false]);
    });
  });
});
