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

import { flushPromises, mount, VueWrapper } from "@vue/test-utils";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { nextTick } from "vue";
import i18n from "@/locales";
import store from "@/test/unit/helpers/store";

// --- vi.mock() at the top — hoisted by Vitest ---

vi.mock("@/services/service_accounts", () => ({
  default: {
    create: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@/services/reodotdev_analytics", () => ({
  useReo: () => ({ track: vi.fn() }),
}));

// Mock toast so no real timeout side-effects bleed into tests.
vi.mock("@/lib/feedback/Toast/useToast", () => ({
  toast: vi.fn().mockReturnValue(vi.fn()), // returns a dismiss fn
}));

import AddServiceAccount from "./AddServiceAccount.vue";
import service_accounts from "@/services/service_accounts";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

// ODialog: renders its default slot content so all inner elements are queryable.
const ODialogStub = {
  name: "ODialog",
  props: [
    "open",
    "width",
    "title",
    "size",
    "primaryButtonLabel",
    "secondaryButtonLabel",
    "primaryButtonDisabled",
    "secondaryButtonDisabled",
  ],
  emits: ["update:open", "click:primary", "click:secondary"],
  template: `
    <div
      data-test-stub="o-drawer"
      :data-open="String(open)"
      :data-title="title"
    >
      <slot />
      <button
        v-if="secondaryButtonLabel"
        data-test="o-dialog-secondary-btn"
        :disabled="secondaryButtonDisabled"
        @click="$emit('click:secondary')"
      >{{ secondaryButtonLabel }}</button>
      <button
        v-if="primaryButtonLabel"
        data-test="o-dialog-primary-btn"
        :disabled="primaryButtonDisabled"
        @click="$emit('click:primary')"
      >{{ primaryButtonLabel }}</button>
    </div>
  `,
};

// OInput: renders a real <input> so setValue() works and emits update:modelValue.
const OInputStub = {
  name: "OInput",
  props: ["modelValue", "label", "error", "errorMessage", "disabled"],
  emits: ["update:modelValue"],
  inheritAttrs: false,
  template: `
    <div v-bind="$attrs">
      <label v-if="label">{{ label }}</label>
      <input
        :value="modelValue"
        @input="$emit('update:modelValue', $event.target.value)"
      />
      <span v-if="error && errorMessage" role="alert">{{ errorMessage }}</span>
    </div>
  `,
};

// ---------------------------------------------------------------------------
// Mount factory
// ---------------------------------------------------------------------------

function mountComp(props: Record<string, unknown> = {}): VueWrapper {
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
      stubs: {
        ODialog: ODialogStub,
        OInput: OInputStub,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Helper: Save/Cancel are now ODialog's built-in primary/secondary footer
// buttons (see ODialogStub), addressed by their canonical data-test slugs.
// ---------------------------------------------------------------------------

function getSaveButton(wrapper: VueWrapper) {
  return wrapper.find('[data-test="o-dialog-primary-btn"]');
}

function getCancelButton(wrapper: VueWrapper) {
  return wrapper.find('[data-test="o-dialog-secondary-btn"]');
}

function getEmailInput(wrapper: VueWrapper) {
  return wrapper.find('[data-test="iam-add-service-account-email-input"] input');
}

function getDescriptionInput(wrapper: VueWrapper) {
  return wrapper.find(
    '[data-test="iam-add-service-account-description-input"] input',
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AddServiceAccount", () => {
  let wrapper: VueWrapper;

  beforeEach(() => {
    vi.mocked(service_accounts.create).mockReset();
    vi.mocked(service_accounts.update).mockReset();

    wrapper = mountComp();
  });

  afterEach(() => {
    wrapper?.unmount();
    vi.clearAllMocks();
  });

  // ── Rendering ─────────────────────────────────────────────────────────────

  describe("rendering", () => {
    it("renders successfully", () => {
      expect(wrapper.exists()).toBe(true);
    });

    it("renders the ODrawer wrapper", () => {
      expect(wrapper.find('[data-test-stub="o-drawer"]').exists()).toBe(true);
    });

    it("passes the add title to ODrawer when not updating", () => {
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');

      expect(drawer.attributes("data-title")).toBe("New service account");
    });

    it("passes open prop to ODrawer as true when open=true", () => {
      const drawer = wrapper.find('[data-test-stub="o-drawer"]');

      expect(drawer.attributes("data-open")).toBe("true");
    });

    it("shows both email and description inputs in add mode", () => {
      // Email input is only shown when not beingUpdated
      expect(getEmailInput(wrapper).exists()).toBe(true);
      expect(getDescriptionInput(wrapper).exists()).toBe(true);
    });

    it("hides email input when updating an existing service account", async () => {
      // Arrange
      const updateWrapper = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Existing Description",
          organization: "default",
        },
      });
      await nextTick();

      // Assert
      expect(
        updateWrapper.find(
          '[data-test="iam-add-service-account-email-input"]',
        ).exists(),
      ).toBe(false);
      expect(getDescriptionInput(updateWrapper).exists()).toBe(true);

      updateWrapper.unmount();
    });

    it("shows update title when beingUpdated", async () => {
      // Arrange
      const updateWrapper = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Desc",
          organization: "default",
        },
      });
      await nextTick();

      // Assert
      const drawer = updateWrapper.find('[data-test-stub="o-drawer"]');
      expect(drawer.attributes("data-title")).toBe("Update Service Account");

      updateWrapper.unmount();
    });

    it("renders a save button", () => {
      expect(getSaveButton(wrapper).exists()).toBe(true);
    });

    it("renders a cancel button", () => {
      expect(getCancelButton(wrapper).exists()).toBe(true);
    });
  });

  // ── Form validation ────────────────────────────────────────────────────────

  describe("form validation", () => {
    it("does not call create when email is empty and save is clicked", async () => {
      // Act
      await getSaveButton(wrapper).trigger("click");

      // Assert
      expect(service_accounts.create).not.toHaveBeenCalled();
    });

    it("shows an error message when email is empty and save is clicked", async () => {
      // Act
      await getSaveButton(wrapper).trigger("click");
      await nextTick();

      // Assert — the OInputStub renders a role="alert" when error+errorMessage are set
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
      expect(wrapper.find('[role="alert"]').text()).toContain(
        "valid email address",
      );
    });

    it("does not call create when email format is invalid", async () => {
      // Arrange
      await getEmailInput(wrapper).setValue("not-an-email");

      // Act
      await getSaveButton(wrapper).trigger("click");

      // Assert
      expect(service_accounts.create).not.toHaveBeenCalled();
    });

    it("shows an error message when email format is invalid", async () => {
      // Arrange
      await getEmailInput(wrapper).setValue("bad-format");

      // Act
      await getSaveButton(wrapper).trigger("click");
      await nextTick();

      // Assert
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);
    });

    it("clears the email error when the user starts typing again", async () => {
      // Arrange — trigger an error first
      await getSaveButton(wrapper).trigger("click");
      await nextTick();
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);

      // Act — user corrects the input
      await getEmailInput(wrapper).setValue("fix@example.com");
      await nextTick();

      // Assert — error is cleared
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });
  });

  // ── Service account creation ───────────────────────────────────────────────

  describe("service account creation", () => {
    it("calls create with correct payload on valid submit", async () => {
      // Arrange
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} });
      await getEmailInput(wrapper).setValue("new@example.com");
      await getDescriptionInput(wrapper).setValue("My Service Account");

      // Act
      await getSaveButton(wrapper).trigger("click");
      await flushPromises();

      // Assert
      expect(service_accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: "new@example.com",
          first_name: "My Service Account",
          organization: "default",
        }),
        "default",
      );
    });

    it("emits 'updated' and 'update:open' false after successful creation", async () => {
      // Arrange
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} });
      await getEmailInput(wrapper).setValue("new@example.com");

      // Act
      await getSaveButton(wrapper).trigger("click");
      await flushPromises();

      // Assert
      expect(wrapper.emitted("updated")).toBeTruthy();
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("does not emit 'update:open' when create returns a 500 error", async () => {
      // Arrange
      vi.mocked(service_accounts.create).mockRejectedValue({
        response: { status: 500, data: { message: "Server error" } },
      });
      await getEmailInput(wrapper).setValue("fail@example.com");

      // Act
      await getSaveButton(wrapper).trigger("click");
      await flushPromises();

      // Assert — drawer must remain open on failure
      expect(wrapper.emitted("update:open")).toBeFalsy();
      expect(wrapper.emitted("updated")).toBeFalsy();
    });

    it("does not throw on 403 error during create", async () => {
      // Arrange
      vi.mocked(service_accounts.create).mockRejectedValue({
        response: { status: 403 },
      });
      await getEmailInput(wrapper).setValue("forbidden@example.com");

      // Act & Assert — must not throw
      await expect(
        (async () => {
          await getSaveButton(wrapper).trigger("click");
          await flushPromises();
        })(),
      ).resolves.not.toThrow();

      expect(service_accounts.create).toHaveBeenCalled();
    });
  });

  // ── Service account update ─────────────────────────────────────────────────

  describe("service account update", () => {
    let updateWrapper: VueWrapper;

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

    it("calls update with correct payload on save", async () => {
      // Arrange
      vi.mocked(service_accounts.update).mockResolvedValue({ data: {} });
      await getDescriptionInput(updateWrapper).setValue("Updated Description");

      // Act
      await getSaveButton(updateWrapper).trigger("click");
      await flushPromises();

      // Assert
      expect(service_accounts.update).toHaveBeenCalledWith(
        expect.objectContaining({
          first_name: "Updated Description",
          organization: "default",
        }),
        "default",
        "existing@example.com",
      );
    });

    it("emits 'updated' and 'update:open' false after successful update", async () => {
      // Arrange
      vi.mocked(service_accounts.update).mockResolvedValue({ data: {} });

      // Act
      await getSaveButton(updateWrapper).trigger("click");
      await flushPromises();

      // Assert
      expect(updateWrapper.emitted("updated")).toBeTruthy();
      expect(updateWrapper.emitted("update:open")).toBeTruthy();
      expect(updateWrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("does not emit 'update:open' when update returns a 500 error", async () => {
      // Arrange
      vi.mocked(service_accounts.update).mockRejectedValue({
        response: { status: 500, data: { message: "Update failed" } },
      });

      // Act
      await getSaveButton(updateWrapper).trigger("click");
      await flushPromises();

      // Assert — drawer must stay open on failure
      expect(updateWrapper.emitted("update:open")).toBeFalsy();
      expect(updateWrapper.emitted("updated")).toBeFalsy();
    });

    it("does not throw on 403 error during update", async () => {
      // Arrange
      vi.mocked(service_accounts.update).mockRejectedValue({
        response: { status: 403 },
      });

      // Act & Assert
      await expect(
        (async () => {
          await getSaveButton(updateWrapper).trigger("click");
          await flushPromises();
        })(),
      ).resolves.not.toThrow();

      expect(service_accounts.update).toHaveBeenCalled();
    });
  });

  // ── UI interactions ────────────────────────────────────────────────────────

  describe("UI interactions", () => {
    it("emits 'update:open' false when cancel button is clicked", async () => {
      // Act
      await getCancelButton(wrapper).trigger("click");

      // Assert
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });

    it("emits 'update:open' when ODrawer emits update:open", async () => {
      // Act
      await wrapper
        .findComponent({ name: "ODialog" })
        .vm.$emit("update:open", false);

      // Assert
      expect(wrapper.emitted("update:open")).toBeTruthy();
      expect(wrapper.emitted("update:open")![0]).toEqual([false]);
    });
  });

  // ── Props reactivity ───────────────────────────────────────────────────────

  describe("props reactivity", () => {
    it("switches to update mode when modelValue with email is set", async () => {
      // Arrange — start in add mode, email field visible
      expect(getEmailInput(wrapper).exists()).toBe(true);

      // Act — simulate parent providing an existing user
      await wrapper.setProps({
        modelValue: {
          email: "existing@example.com",
          first_name: "Desc",
          organization: "default",
        },
      });
      await nextTick();

      // Assert — email field hidden in update mode
      expect(
        wrapper.find('[data-test="iam-add-service-account-email-input"]').exists(),
      ).toBe(false);
    });

    it("switches back to add mode when modelValue is reset to empty and isUpdated is false", async () => {
      // Arrange — start in update mode
      const updateWrapper = mountComp({
        isUpdated: true,
        modelValue: {
          email: "existing@example.com",
          first_name: "Desc",
          organization: "default",
        },
      });
      await nextTick();
      expect(
        updateWrapper.find(
          '[data-test="iam-add-service-account-email-input"]',
        ).exists(),
      ).toBe(false);

      // Act — reset both modelValue and isUpdated to reflect add mode.
      // The watcher sets beingUpdated = props.isUpdated when email is absent,
      // so isUpdated must also be cleared for the email field to reappear.
      await updateWrapper.setProps({
        isUpdated: false,
        modelValue: {
          org_member_id: "",
          role: "admin",
          first_name: "",
          email: "",
          organization: "",
        },
      });
      await nextTick();

      // Assert — email field re-appears
      expect(
        updateWrapper.find(
          '[data-test="iam-add-service-account-email-input"]',
        ).exists(),
      ).toBe(true);

      updateWrapper.unmount();
    });
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("does not emit 'updated' when save is clicked with empty email (add mode)", async () => {
      // Act — click save without filling email
      await getSaveButton(wrapper).trigger("click");
      await flushPromises();

      // Assert
      expect(wrapper.emitted("updated")).toBeFalsy();
    });

    it("treats email with leading/trailing whitespace as invalid", async () => {
      // Arrange
      await getEmailInput(wrapper).setValue("   invalid   ");

      // Act
      await getSaveButton(wrapper).trigger("click");

      // Assert — the regex /^[^\s@]+@[^\s@]+\.[^\s@]+$/ rejects strings with spaces
      expect(service_accounts.create).not.toHaveBeenCalled();
    });

    it("accepts a valid email with subdomains", async () => {
      // Arrange
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} });
      await getEmailInput(wrapper).setValue("user@sub.example.com");

      // Act
      await getSaveButton(wrapper).trigger("click");
      await flushPromises();

      // Assert
      expect(service_accounts.create).toHaveBeenCalled();
    });

    it("encodes other_organization when selectedOrg is 'other'", async () => {
      // Arrange — set store org identifier to "other" to exercise the encodeURIComponent branch
      store.commit("setSelectedOrganization", {
        identifier: "other",
        label: "Other Org",
        user_email: "example@gmail.com",
      });
      vi.mocked(service_accounts.create).mockResolvedValue({ data: {} });

      const otherWrapper = mountComp();
      await nextTick();

      // Give formData.other_organization a value so encodeURIComponent has input
      // (no public API to set this; set via vm — only way to reach this branch)
      otherWrapper.vm.formData.other_organization = "my custom org";

      await getEmailInput(otherWrapper).setValue("test@example.com");

      // Act
      await getSaveButton(otherWrapper).trigger("click");
      await flushPromises();

      // Assert — create was still called (branch executed without throwing)
      expect(service_accounts.create).toHaveBeenCalled();

      // Restore store state for subsequent tests
      store.commit("setSelectedOrganization", {
        identifier: "default",
        label: "default Organization",
        user_email: "example@gmail.com",
      });

      otherWrapper.unmount();
    });
  });
});
