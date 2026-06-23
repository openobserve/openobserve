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
// AddServiceAccount is migrated to OForm + Zod (AddServiceAccount.schema.ts).
// It is an Options-API form, so the schema (a create/update variant computed)
// and the defaults computed are returned from setup(). These tests mount the
// REAL <OForm> (only ODialog is stubbed) so the conditional email schema
// actually gates the submit — behavior is asserted, not the removed emailError.

import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

vi.mock("@/services/service_accounts", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: vi.fn().mockReturnValue(vi.fn()),
}));

vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: mockToast,
}));

import AddServiceAccount from "./AddServiceAccount.vue";
import service_accounts from "@/services/service_accounts";

// ODialog stub: renders the default slot so the REAL OForm mounts, and exposes
// the footer primary/secondary buttons. Save submits via `form-id` in the app;
// tests drive the form's own submit so the schema runs deterministically.
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
    <div data-test-stub="o-dialog" :data-open="String(open)" :data-title="title" :data-form-id="formId">
      <slot />
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
  `,
  inheritAttrs: false,
};

function mountComp(props: Record<string, unknown> = {}): VueWrapper<any> {
  return mount(AddServiceAccount, {
    props: {
      open: true,
      modelValue: {
        org_member_id: "",
        role: "admin",
        first_name: "",
        email: "",
        organization: "",
      },
      isUpdated: false,
      ...props,
    },
    global: {
      plugins: [store, i18n],
      stubs: { ODialog: ODialogStub },
    },
  });
}

const getForm = (wrapper: VueWrapper<any>) =>
  wrapper.findComponent({ name: "OForm" });
const getEmailInput = (wrapper: VueWrapper<any>) =>
  wrapper.find('[data-test="iam-add-service-account-email-input"] input');
const getDescriptionInput = (wrapper: VueWrapper<any>) =>
  wrapper.find('[data-test="iam-add-service-account-description-input"] input');

const submitForm = async (wrapper: VueWrapper<any>) => {
  await getForm(wrapper).vm.form.handleSubmit();
  await flushPromises();
};

describe("AddServiceAccount", () => {
  let wrapper: VueWrapper<any>;

  beforeEach(() => {
    vi.clearAllMocks();
    wrapper = mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
  });

  describe("rendering", () => {
    it("renders the dialog with the add title in create mode", () => {
      const dialog = wrapper.find('[data-test-stub="o-dialog"]');
      expect(dialog.exists()).toBe(true);
      expect(dialog.attributes("data-title")).toBe("New service account");
      expect(dialog.attributes("data-form-id")).toBe("add-service-account-form");
    });

    it("shows both email and description inputs in create mode", () => {
      expect(getEmailInput(wrapper).exists()).toBe(true);
      expect(getDescriptionInput(wrapper).exists()).toBe(true);
    });

    it("hides the email input and shows the update title in update mode", async () => {
      const w = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Existing Description",
          organization: "default",
        },
      });
      await nextTick();

      expect(
        w.find('[data-test="iam-add-service-account-email-input"]').exists(),
      ).toBe(false);
      expect(getDescriptionInput(w).exists()).toBe(true);
      expect(
        w.find('[data-test-stub="o-dialog"]').attributes("data-title"),
      ).toBe("Update Service Account");
      w.unmount();
    });

    it("prefills the description from modelValue in update mode", () => {
      const w = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "My Description",
          organization: "default",
        },
      });
      expect(getForm(w).props("defaultValues")).toEqual({
        email: "",
        first_name: "My Description",
      });
      w.unmount();
    });
  });

  describe("schema validation (real OForm, create mode)", () => {
    it("blocks submit and does NOT call create when email is empty", async () => {
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(service_accounts.create).not.toHaveBeenCalled();
      expect(wrapper.text()).toContain("Please enter a valid email address");
    });

    it("blocks submit when the email format is invalid", async () => {
      await getEmailInput(wrapper).setValue("not-an-email");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(false);
      expect(service_accounts.create).not.toHaveBeenCalled();
    });

    it("treats an email with surrounding whitespace as invalid", async () => {
      await getEmailInput(wrapper).setValue("   invalid   ");
      await submitForm(wrapper);

      expect(service_accounts.create).not.toHaveBeenCalled();
    });

    it("submits and calls create with the payload on a valid email", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} } as any);
      await getEmailInput(wrapper).setValue("new@example.com");
      await getDescriptionInput(wrapper).setValue("My Service Account");
      await submitForm(wrapper);

      expect(getForm(wrapper).vm.form.state.isValid).toBe(true);
      expect(service_accounts.create).toHaveBeenCalledTimes(1);
      expect(service_accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "new@example.com",
          first_name: "My Service Account",
          organization: "default",
        }),
        "default",
      );
    });

    it("accepts a valid email with subdomains", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} } as any);
      await getEmailInput(wrapper).setValue("user@sub.example.com");
      await submitForm(wrapper);

      expect(service_accounts.create).toHaveBeenCalled();
    });
  });

  describe("creation behavior", () => {
    it("emits updated + update:open(false) after a successful create", async () => {
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} } as any);
      await getEmailInput(wrapper).setValue("new@example.com");
      await submitForm(wrapper);

      expect(wrapper.emitted("updated")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("keeps the dialog open and shows an error toast on a 500 failure", async () => {
      vi.mocked(service_accounts.create).mockRejectedValue({
        response: { status: 500, data: { message: "Server error" } },
      });
      await getEmailInput(wrapper).setValue("fail@example.com");
      await submitForm(wrapper);

      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(wrapper.emitted("updated")).toBeFalsy();
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      );
    });

    it("does not throw on a 403 failure during create", async () => {
      vi.mocked(service_accounts.create).mockRejectedValue({
        response: { status: 403 },
      });
      await getEmailInput(wrapper).setValue("forbidden@example.com");

      await expect(submitForm(wrapper)).resolves.not.toThrow();
      expect(service_accounts.create).toHaveBeenCalled();
    });
  });

  describe("update behavior", () => {
    let updateWrapper: VueWrapper<any>;

    beforeEach(async () => {
      updateWrapper = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Original Description",
          organization: "default",
        },
      });
      await nextTick();
    });

    afterEach(() => {
      updateWrapper?.unmount();
    });

    it("submits without an email field and calls update with the payload", async () => {
      vi.mocked(service_accounts.update).mockResolvedValue({ data: {} } as any);
      await getDescriptionInput(updateWrapper).setValue("Updated Description");
      await submitForm(updateWrapper);

      expect(getForm(updateWrapper).vm.form.state.isValid).toBe(true);
      expect(service_accounts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: "Updated Description",
          organization: "default",
        }),
        "default",
        "existing@example.com",
      );
    });

    it("emits updated + update:open(false) after a successful update", async () => {
      vi.mocked(service_accounts.update).mockResolvedValue({ data: {} } as any);
      await submitForm(updateWrapper);

      expect(updateWrapper.emitted("updated")).toBeTruthy();
      expect(updateWrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });

  describe("dialog interactions", () => {
    it("emits update:open(false) when cancel is clicked", async () => {
      await wrapper.find('[data-test="o-dialog-secondary-btn"]').trigger("click");
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("forwards update:open from the dialog", async () => {
      await wrapper.findComponent(ODialogStub).vm.$emit("update:open", false);
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });
});
